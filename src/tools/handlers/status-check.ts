import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { sessionManager } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, ToolResponse } from "../../types/mcp.d.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { debugSessionResponseSchema, checkDebugStatusSchema } from '../schemas.js';

export type CheckDebugStatusParams = z.infer<typeof checkDebugStatusSchema>;

/**
 * Handler for the check_debug_status tool
 * Checks the status of an existing debug session
 */
export async function handleCheckDebugStatus(
  { session_id }: CheckDebugStatusParams,
  extra: RequestHandlerExtra
): Promise<ToolResponse> {
  // Get safe loggers
  const logger = await getLogger();
  logger.info(`Executing check_debug_status tool`, { session_id });
  
  let sessionLogger;
  try {
    // Get path resolver for validation
    const { getPathResolver } = await import('../../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Create session-specific logger after validation
    const { createLogger } = await import("../../util/logger.js");
    sessionLogger = createLogger(session_id, 'mcp-status-check');
  } catch (error) {
    // Fallback to main logger if session logger creation fails
    logger.warn('Failed to create session logger, using main logger', { error });
    sessionLogger = logger;
  }
  
  sessionLogger.info('Checking session status');

  try {
    // Get session and agent status
    const session = sessionManager.get(session_id);
    if (!session) {
      const response = debugSessionResponseSchema.parse({
        session_id,
        status: "error",
        message: `Session not found: ${session_id}`,
        result: null,
        timestamp: new Date().toISOString()
      });
      
      return {
        content: [{ 
          type: "text" as const,
          text: JSON.stringify(response)
        }],
        isError: true
      };
    }

    const agents = agentCoordinator.getSessionAgents(session_id);
    const motherAgent = agents.find(a => a.type === 'mother');
    
    if (!motherAgent) {
      const response = debugSessionResponseSchema.parse({
        session_id,
        status: "error",
        message: `Mother agent not found for session: ${session_id}`,
        result: null,
        timestamp: new Date().toISOString()
      });
      
      return {
        content: [{ 
          type: "text" as const,
          text: JSON.stringify(response)
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

    const response = debugSessionResponseSchema.parse({
      session_id,
      status: session.status,
      message: `Session status: ${session.status}`,
      result: session.finalResult || null,
      logs: session.logs,
      timestamp: new Date().toISOString()
    });

    sessionLogger.info('Status check complete');
    sessionLogger.close();
    
    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(response)
      }]
    };
  } catch (error: any) {
    sessionLogger.error('Failed to check session status', { error: error.message });
    sessionLogger.close();
    
    const errorResponse = debugSessionResponseSchema.parse({
      session_id,
      status: "error",
      message: `Failed to check session status: ${error.message}`,
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
