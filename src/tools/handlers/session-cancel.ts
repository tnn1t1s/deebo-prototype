import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { createLogEntry } from "../../util/log-validator.js";
import { sessionManager } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, ToolResponse } from "../../types/mcp.d.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { cancelDebugSessionSchema, debugSessionResponseSchema } from '../schemas.js';

export type CancelDebugSessionParams = z.infer<typeof cancelDebugSessionSchema>;

/**
 * Handler for the cancel_debug_session tool
 * Cancels an active debug session and cleans up resources
 */
export async function handleCancelDebugSession(
  { session_id }: CancelDebugSessionParams,
  extra: RequestHandlerExtra
): Promise<ToolResponse> {
  // Get safe loggers
  const logger = await getLogger();
  await logger.info(`Executing cancel_debug_session tool`, { session_id });
  
  let sessionLogger;
  try {
    // Get path resolver for validation
    const { PathResolver } = await import('../../util/path-resolver.js');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    
    // Create session-specific logger after validation
    const { createLogger } = await import("../../util/logger.js");
    sessionLogger = await createLogger(session_id, 'mcp-cancel');
  } catch (error: unknown) {
    // Fallback to main logger if session logger creation fails
    await logger.warn('Failed to create session logger, using main logger', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    sessionLogger = logger;
  }
  
  await sessionLogger.info('Cancelling debug session');

  try {
    // Get session and agents
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

    // Clean up all session resources
    await sessionLogger.info('Starting session cleanup');
    await agentCoordinator.cleanupSession(session_id);
    await sessionLogger.info('Session cleanup complete');
    
    await sessionLogger.info('Session cancelled successfully');
    await sessionLogger.close();
    
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
  } catch (error: unknown) {
    await sessionLogger.error('Failed to cancel session', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    await sessionLogger.close();
    
    const errorResponse = debugSessionResponseSchema.parse({
      session_id,
      status: "error",
      message: `Failed to cancel session: ${error instanceof Error ? error.message : String(error)}`,
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
