import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { activeSessions } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, CheckDebugStatusParams, ToolResponse } from "../../types/mcp.d.js";

// Input schema for check_debug_status tool
export const checkDebugStatusSchema = {
  session_id: z.string().min(1)
};

/**
 * Register the check_debug_status tool with the server
 */
export function registerCheckDebugStatus(server: DeeboMcpServer): void {
  // Use a string description and pass the schema as an argument to the handler function
  server.tool(
    "check_debug_status",
    "Check the status of a debugging session",
    async (args: any, extra: RequestHandlerExtra) => {
      // Extract parameters using the schema
      const params = checkDebugStatusSchema.parse ? 
                     checkDebugStatusSchema.parse(args) : 
                     args as CheckDebugStatusParams;
      
      return handleCheckDebugStatus(params);
    }
  );
}

/**
 * Handler for the check_debug_status tool
 * Checks the status of an existing debug session
 */
export async function handleCheckDebugStatus(
  { session_id }: CheckDebugStatusParams
): Promise<ToolResponse> {
  const logger = await getLogger();
  logger.info(`Executing check_debug_status tool`, { session_id });
  
  const { createLogger } = await import("../../util/logger.js");
  const sessionLogger = createLogger(session_id, 'mcp-status-check');
  sessionLogger.info('Checking session status');

  try {
    // Get session and agent status
    const session = activeSessions.get(session_id);
    if (!session) {
      return {
        content: [{ 
          type: "text" as const,
          text: `Error: Session not found: ${session_id}`
        }],
        isError: true
      };
    }

    const agents = agentCoordinator.getSessionAgents(session_id);
    const motherAgent = agents.find(a => a.type === 'mother');
    
    if (!motherAgent) {
      return {
        content: [{ 
          type: "text" as const,
          text: `Error: Mother agent not found for session: ${session_id}`
        }],
        isError: true
      };
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
          logs: session.logs,
          result: session.finalResult || null
        })
      }]
    };

    sessionLogger.info('Status check complete');
    sessionLogger.close();
    return response;
  } catch (error: any) {
    sessionLogger.error('Failed to check session status', { error: error.message });
    sessionLogger.close();
    
    return {
      content: [{ 
        type: "text" as const,
        text: `Error: Failed to check session status: ${error.message}`
      }],
      isError: true
    };
  }
}
