import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { activeSessions } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, CancelDebugSessionParams, ToolResponse } from "../../types/mcp.d.js";

import { cancelDebugSessionSchema, debugSessionResponseSchema } from '../schemas.js';
import type { z } from 'zod';

export type CancelDebugSessionParams = z.infer<typeof cancelDebugSessionSchema>;



/**
 * Handler for the cancel_debug_session tool
 * Cancels an active debug session and cleans up resources
 */
export async function handleCancelDebugSession(
  { session_id }: CancelDebugSessionParams
): Promise<ToolResponse> {
  const logger = await getLogger();
  logger.info(`Executing cancel_debug_session tool`, { session_id });
  
  const { createLogger } = await import("../../util/logger.js");
  const sessionLogger = createLogger(session_id, 'mcp-cancel');
  sessionLogger.info('Cancelling debug session');

  try {
    // Get session and agents
    const session = activeSessions.get(session_id);
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
    if (agents.length === 0) {
      const response = debugSessionResponseSchema.parse({
        session_id,
        status: "error",
        message: `No agents found for session: ${session_id}`,
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

    // Check if already finished
    const motherAgent = agents.find(a => a.type === 'mother');
    if (motherAgent && (motherAgent.status === 'complete' || motherAgent.status === 'error')) {
      const response = debugSessionResponseSchema.parse({
        session_id,
        status: motherAgent.status,
        message: "Session already finished",
        result: session.finalResult || null,
        timestamp: new Date().toISOString()
      });
      
      return {
        content: [{ 
          type: "text" as const,
          text: JSON.stringify(response)
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
    
    const response = debugSessionResponseSchema.parse({
      session_id,
      status: "cancelled",
      message: "Debug session cancelled successfully",
      result: session.finalResult || null,
      timestamp: new Date().toISOString()
    });
    
    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(response)
      }]
    };
  } catch (error: any) {
    sessionLogger.error('Failed to cancel session', { error: error.message });
    sessionLogger.close();
    
    const errorResponse = debugSessionResponseSchema.parse({
      session_id,
      status: "error",
      message: `Failed to cancel session: ${error.message}`,
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
