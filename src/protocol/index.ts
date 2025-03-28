import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Protocol error codes beyond standard JSON-RPC errors
 */
export const ProtocolErrorCodes = {
  // Standard JSON-RPC error codes
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  
  // Custom error codes (must be above -32000)
  SessionNotFound: -31000,
  SessionAlreadyExists: -31001,
  InvalidSessionState: -31002,
  AgentError: -31009
} as const;

// Track initialization state (used by other modules)
export let isInitialized = false;

export async function initializeProtocol(): Promise<void> {
  if (isInitialized) {
    return;
  }

  // Just set initialized flag - trust MCP SDK to handle protocol
  isInitialized = true;
}
