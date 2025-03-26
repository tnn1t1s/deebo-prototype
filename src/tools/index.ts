import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { 
  ErrorCode, 
  McpError, 
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { activeSessions } from "../resources/index.js";
import { agentCoordinator } from "../agents/coordinator.js";

// Lazy initialize logger when needed
let logger: any; // Type will be set when logger is created
async function getLogger() {
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'tools');
  }
  return logger;
}

/**
 * Initialize tool capabilities for the MCP server
 * @param server The MCP server instance
 */
export async function initializeTools(server: Server) {
  const log = await getLogger();
  log.info('Initializing tool handlers');

  // Define available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const log = await getLogger();
    log.info('Processing tools/list request');
    
    return {
      tools: [
        {
          name: "start_debug_session",
          description: "Start a debugging session with an error and optional repository path",
          inputSchema: {
            type: "object",
            properties: {
              error_message: {
                type: "string",
                description: "Error message from the code to debug"
              },
              code_context: {
                type: "string",
                description: "Code surrounding the error"
              },
              language: {
                type: "string",
                description: "Programming language"
              },
              file_path: {
                type: "string",
                description: "Path to the file with error"
              },
              repo_path: {
                type: "string",
                description: "Path to Git repository (recommended)"
              }
            },
            required: ["error_message"]
          }
        },
        {
          name: "check_debug_status",
          description: "Check the status of a debugging session",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "ID of the debug session to check"
              }
            },
            required: ["session_id"]
          }
        },
        {
          name: "cancel_debug_session",
          description: "Cancel a running debugging session",
          inputSchema: {
            type: "object",
            properties: {
              session_id: {
                type: "string",
                description: "ID of the debug session to cancel"
              }
            },
            required: ["session_id"]
          }
        }
      ]
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    const log = await getLogger();
    log.info(`Executing tool: ${name}`, { toolArgs });
    
    // Tool 1: Start Debug Session
    if (name === "start_debug_session") {
      // Validate arguments with zod
      const schema = z.object({
        error_message: z.string().min(1),
        code_context: z.string().optional(),
        language: z.string().optional(),
        file_path: z.string().optional(),
        repo_path: z.string().optional()
      }).transform(data => ({
        ...data,
        file_path: data.file_path === '' ? undefined : data.file_path,
        repo_path: data.repo_path === '' ? undefined : data.repo_path
      }));
      
      const result = schema.safeParse(toolArgs);
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid parameters: ${result.error.message}`
        );
      }
      
      const { error_message, code_context, language, file_path, repo_path } = result.data;

      const sessionId = uuidv4();
      const { createLogger } = await import("../util/logger.js");
      const sessionLogger = createLogger(sessionId, 'mcp-session');
      
      sessionLogger.info('Starting new debug session', {
        error: error_message.substring(0, 100), // Truncate long errors
        language,
        file_path,
        repo_path
      });
      
      try {
        // Create session
        const session: {
          id: string;
          status: string;
          logs: string[];
          startTime: number;
          lastChecked: number;
          finalResult?: any;
          error?: string;
          scenarioResults: any[];
          request: any;
        } = {
          id: sessionId,
          status: "running",
          logs: [
            "Deebo debugging session initialized",
            `Received error: ${error_message}`,
            `Language: ${language || "Not specified"}`,
            repo_path ? `Repository path: ${repo_path}` : "No repository path provided",
            file_path ? `File path: ${file_path}` : "No file path provided",
            "Deebo will analyze your error through the following process:",
            "1. Mother agent will analyze the error and codebase to identify potential causes",
            "2. Scenario agents will be created to test different hypotheses in isolation", 
            "3. Each scenario agent will create its own Git branch for investigation",
            "4. Results from all scenario agents will be collected and evaluated",
            "5. The mother agent will select the best fix and verify it works",
            "6. A final recommendation will be provided with implementation details"
          ],
          startTime: Date.now(),
          lastChecked: Date.now(),
          scenarioResults: [],
          request: {
            error: error_message,
            context: code_context,
            codebase: repo_path ? { repoPath: repo_path, filePath: file_path } : undefined
          }
        };

        // Add to active sessions for resource access
        activeSessions.set(sessionId, session);
        sessionLogger.debug('Session object created', { session });

        // Start debug session with agent coordinator
        await agentCoordinator.startSession({
          sessionId,
          error: error_message,
          context: code_context,
          language,
          filePath: file_path,
          repoPath: repo_path
        });

        sessionLogger.info('Debug session started successfully');
        return {
          content: [{ 
            type: "text" as const,
            text: JSON.stringify({ 
              session_id: sessionId,
              message: "Debug session started successfully"
            })
          }]
        };
      } catch (error: any) {
        sessionLogger.error('Failed to start debug session', { error: error.message });
        sessionLogger.close();
        
        // Improved error handling with appropriate MCP error codes
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to start debug session: ${error.message}`
        );
      }
    }
    // Tool 2: Check Debug Status
    else if (name === "check_debug_status") {
      // Validate arguments with zod
      const schema = z.object({
        session_id: z.string().min(1)
      });
      
      const result = schema.safeParse(toolArgs);
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid session_id: ${result.error.message}`
        );
      }
      
      const { session_id } = result.data;
      const { createLogger } = await import("../util/logger.js");
      const sessionLogger = createLogger(session_id, 'mcp-status-check');
      sessionLogger.info('Checking session status');

      try {
        // Get session and agent status
        const session = activeSessions.get(session_id);
        if (!session) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Session not found: ${session_id}`
          );
        }

        const agents = agentCoordinator.getSessionAgents(session_id);
        const motherAgent = agents.find(a => a.type === 'mother');
        
        if (!motherAgent) {
          throw new McpError(
            ErrorCode.InternalError,
            `Mother agent not found for session: ${session_id}`
          );
        }

        session.lastChecked = Date.now();
        sessionLogger.debug('Status retrieved', {
          sessionStatus: session.status,
          agentStatus: motherAgent.status,
          numLogs: session.logs.length
        });

        const response = {
          content: [{ 
            type: "text" as const,
            text: JSON.stringify({
              session_id,
              status: session.status,
              agent_status: motherAgent.status,
              progress: motherAgent.progress,
              logs: session.logs,
              result: session.finalResult || null,
              error: session.error || null
            })
          }]
        };

        sessionLogger.info('Status check complete');
        sessionLogger.close();
        return response;
      } catch (error: any) {
        sessionLogger.error('Failed to check session status', { error: error.message });
        sessionLogger.close();
        
        // Improved error handling with appropriate MCP error codes
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to check session status: ${error.message}`
        );
      }
    }
    // Tool 3: Cancel Debug Session
    else if (name === "cancel_debug_session") {
      // Validate arguments with zod
      const schema = z.object({
        session_id: z.string().min(1)
      });
      
      const result = schema.safeParse(toolArgs);
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid session_id: ${result.error.message}`
        );
      }
      
      const { session_id } = result.data;
      const { createLogger } = await import("../util/logger.js");
      const sessionLogger = createLogger(session_id, 'mcp-cancel');
      sessionLogger.info('Cancelling debug session');

      try {
        // Get session and agents
        const session = activeSessions.get(session_id);
        if (!session) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Session not found: ${session_id}`
          );
        }

        const agents = agentCoordinator.getSessionAgents(session_id);
        if (agents.length === 0) {
          throw new McpError(
            ErrorCode.InternalError,
            `No agents found for session: ${session_id}`
          );
        }

        // Check if already finished
        const motherAgent = agents.find(a => a.type === 'mother');
        if (motherAgent && (motherAgent.status === 'complete' || motherAgent.status === 'error')) {
          return {
            content: [{ 
              type: "text" as const,
              text: JSON.stringify({
                session_id,
                message: "Session already finished",
                status: motherAgent.status
              })
            }]
          };
        }

        // Mark session and agents as cancelled
        session.status = "error";
        session.error = "Session cancelled by user";
        session.logs.push("Debug session cancelled by user");

        // Clean up agents
        await agentCoordinator.cleanupSession(session_id);
        
        sessionLogger.info('Session cancelled successfully');
        sessionLogger.close();
        
        return {
          content: [{ 
            type: "text" as const,
            text: JSON.stringify({
              session_id,
              message: "Debug session cancelled successfully"
            })
          }]
        };
      } catch (error: any) {
        sessionLogger.error('Failed to cancel session', { error: error.message });
        sessionLogger.close();
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to cancel session: ${error.message}`
        );
      }
    }
    // Unknown tool
    else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`
      );
    }
  });

  log.info('Tool handlers initialized');
}
