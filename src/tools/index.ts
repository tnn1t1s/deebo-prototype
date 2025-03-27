import { 
  ErrorCode, 
  McpError,
  ToolResult
} from "@modelcontextprotocol/sdk/types.js";
import type { DeeboMcpServer } from "../types/mcp.d.js";
import { getLogger } from "./logger.js";

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

/**
 * Initialize tool capabilities for the MCP server
 */
export async function initializeTools(server: DeeboMcpServer): Promise<void> {
  const logger = await getLogger();
  logger.info('Initializing tool handlers');

  // Register debug session tools
  server.tool({
    name: "start_debug_session",
    description: "Start a new debugging session",
    schema: startDebugSessionSchema,
    handler: handleStartDebugSession
  });

  server.tool({
    name: "check_debug_status", 
    description: "Check the status of a debugging session",
    schema: checkDebugStatusSchema,
    handler: handleCheckDebugStatus
  });

  server.tool({
    name: "cancel_debug_session",
    description: "Cancel an ongoing debug session",
    schema: cancelDebugSessionSchema,
    handler: handleCancelDebugSession
  });

  logger.info('Tool handlers initialized');
}