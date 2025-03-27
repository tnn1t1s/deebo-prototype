import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { sessionManager } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, ToolResponse, DebugSession } from "../../types/mcp.d.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { startDebugSessionSchema, debugSessionResponseSchema } from '../schemas.js';

export type StartDebugSessionParams = z.infer<typeof startDebugSessionSchema>;

/**
 * Handler for the start_debug_session tool
 * Creates a new debug session and launches the mother agent to coordinate debugging
 */
export async function handleStartDebugSession(
  { error_message, code_context, language, file_path, repo_path }: StartDebugSessionParams,
  extra: RequestHandlerExtra
): Promise<ToolResponse> {
  const logger = await getLogger();
  logger.info('Debug session request received', { 
    error_short: error_message.substring(0, 100),
    language,
    hasFilePath: !!file_path,
    hasRepoPath: !!repo_path,
    hasContext: !!code_context
  });
  
  const sessionId = uuidv4();
  const { createLogger } = await import("../../util/logger.js");
  const sessionLogger = createLogger(sessionId, 'mcp-session');
  
  sessionLogger.info('Starting new debug session', {
    error: error_message.substring(0, 100), // Truncate long errors
    language,
    file_path,
    repo_path
  });
  
  try {
    // Initialize directories using PathResolver
    const { getPathResolver } = await import('../../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    await pathResolver.ensureDirectory('reports');
    
    // Create session with structured logging
    const session: DebugSession = {
      id: sessionId,
      status: "running",
      startTime: Date.now(),
      lastChecked: Date.now(),
      logs: [
        JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'session_start',
          data: {
            sessionId,
            config: {
              language: language || "Not specified",
              filePath: file_path || "Not provided",
              repoPath: repo_path || "Not provided",
              contextSize: code_context?.length || 0
            },
            error: error_message
          }
        })
      ],
      scenarioResults: [],
      request: {
        error: error_message,
        context: code_context,
        codebase: repo_path ? {
          repoPath: repo_path,
          filePath: file_path
        } : undefined
      }
    };

    // Add to active sessions for resource access
    sessionManager.set(sessionId, session);
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
    const response = debugSessionResponseSchema.parse({
      session_id: sessionId,
      status: "running",
      message: "Debug session started successfully",
      result: null,
      timestamp: new Date().toISOString()
    });
    
    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(response)
      }]
    };
  } catch (error: any) {
    sessionLogger.error('Failed to start debug session', { error: error.message });
    sessionLogger.close();
    
    // Construct error response
    const errorResponse = debugSessionResponseSchema.parse({
      session_id: sessionId,
      status: "error",
      message: `Failed to start debug session: ${error.message}`,
      result: null,
      timestamp: new Date().toISOString()
    });

    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(errorResponse)
      }],
      isError: true
    };
  }
}
