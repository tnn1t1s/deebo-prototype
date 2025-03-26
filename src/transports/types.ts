import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Transport interface for MCP servers
 */
export interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
}
