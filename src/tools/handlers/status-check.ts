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
  await logger.info(`Executing check_debug_status tool`, { session_id });
  
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
    sessionLogger = await createLogger(session_id, 'mcp-status-check');
  } catch (error: unknown) {
    // Fallback to main logger if session logger creation fails
    await logger.warn('Failed to create session logger, using main logger', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    sessionLogger = logger;
  }
  
  await sessionLogger.info('Checking session status');

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
    await sessionLogger.debug('Status retrieved', {
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

    await sessionLogger.info('Status check complete');
    await sessionLogger.close();
    
    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(response)
      }]
    };
  } catch (error: unknown) {
    await sessionLogger.error('Failed to check session status', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    await sessionLogger.close();
    
    const errorResponse = debugSessionResponseSchema.parse({
      session_id,
      status: "error",
      message: `Failed to check session status: ${error instanceof Error ? error.message : String(error)}`,
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
