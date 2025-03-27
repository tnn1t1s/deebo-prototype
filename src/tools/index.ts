import { 
  ErrorCode, 
  McpError,
  CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import type { DeeboMcpServer } from "../types/mcp.d.js";
import type { LoggerLike } from "../types/logger.js";

// Import schemas and handlers
import {
  startDebugSessionSchema,
  checkDebugStatusSchema,
  cancelDebugSessionSchema
} from "./schemas.js";

import {
  handleStartDebugSession,
  handleCheckDebugStatus,
  handleCancelDebugSession
} from "./handlers/index.js";

let toolsInitialized = false;

/**
 * Initialize tool capabilities for the MCP server
 */
export async function initializeTools(server: DeeboMcpServer): Promise<void> {
  // Start with initLogger
  const { initLogger } = await import('../util/init-logger.js');
  let logger: LoggerLike = initLogger;

  if (toolsInitialized) {
    logger.info('Tools already initialized');
    return;
  }

  try {
    // Ensure required directories exist
    const { PathResolver } = await import('../util/path-resolver.js');
    const pathResolver = await PathResolver.getInstance();
    
    const resolver = await pathResolver;
    if (!resolver.isInitialized()) {
      await resolver.initialize();
    }

    // Now safe to use regular logger
    const { createLogger } = await import('../util/logger.js');
    logger = createLogger('server', 'tools');

    logger.info('Starting tool initialization');

    // Register debug session tools with proper typing
    server.tool(
      "start_debug_session",
      "Start a new debugging session",
      startDebugSessionSchema.shape,
      handleStartDebugSession
    );

    server.tool(
      "check_debug_status", 
      "Check the status of a debugging session",
      checkDebugStatusSchema.shape,
      handleCheckDebugStatus
    );

    server.tool(
      "cancel_debug_session",
      "Cancel an ongoing debug session",
      cancelDebugSessionSchema.shape,
      handleCancelDebugSession
    );

    toolsInitialized = true;
    logger.info('Tool handlers initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize tools', { error });
    throw error;
  }
}
