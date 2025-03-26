import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Ensure initialization is complete before creating logger
export let isInitialized = false;

export function setInitialized() {
  isInitialized = true;
}

/**
 * Initialize transport capabilities for the MCP server
 * @param server The MCP server instance
 */
export async function initializeTransports(server: Server) {
  // Currently no server handlers needed for transports
  // This function exists for consistency with other modules
  // and potential future transport-related server capabilities
}
