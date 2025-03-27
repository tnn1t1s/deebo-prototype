import type { DeeboMcpServer } from '../types/mcp.d.js';

// Ensure initialization is complete before creating logger
export let isInitialized = false;

export function setInitialized() {
  isInitialized = true;
}

/**
 * Initialize agent capabilities for the MCP server
 * @param server The MCP server instance
 */
export async function initializeAgents(server: DeeboMcpServer) {
  // Currently no server handlers needed for agents
  // This function exists for consistency with other modules
  // and potential future agent-related server capabilities
}
