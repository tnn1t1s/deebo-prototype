import { McpServer as BaseMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError, ReadResourceResult, RequestHandlerExtra, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Extend the McpServer interface to include required methods for our project
export interface DeeboMcpServer extends BaseMcpServer {
  // Add missing methods that are needed by our implementation
  notifyResourcesListChanged(): void;
  
  // Method for registering request handlers (from base Server class)
  setRequestHandler<T>(schema: T, handler: (request: any, extra: RequestHandlerExtra) => any): void;
}

// Define Agent types to avoid any
export interface Agent {
  id: string;
  type: string;
  status: string;
  progress?: number;
}

// Define Session type to avoid any
export interface DebugSession {
  id: string;
  status: string;
  logs: string[];
  startTime: number;
  lastChecked: number;
  finalResult?: any;
  error?: string;
  scenarioResults: any[];
  request: {
    error: string;
    context?: string;
    codebase?: {
      repoPath?: string;
      filePath?: string;
    };
  };
}

// Tool parameters
export interface StartDebugSessionParams {
  error_message: string;
  code_context?: string;
  language?: string;
  file_path?: string;
  repo_path?: string;
}

export interface CheckDebugStatusParams {
  session_id: string;
}

export interface CancelDebugSessionParams {
  session_id: string;
}

// Use SDK's CallToolResult type for tool responses
export type ToolResponse = CallToolResult & {
  [key: string]: unknown;
};

export interface DebugSessionResult {
  fix: string;
  confidence: number;
  changes_required: {
    type: string;
    description: string;
    priority: string;
  }[];
  affected_files: string[];
  estimated_time_to_fix: string;
}

// Agent coordinator interface
export interface AgentCoordinator {
  startSession(options: {
    sessionId: string;
    error: string;
    context?: string;
    language?: string;
    filePath?: string;
    repoPath?: string;
  }): Promise<void>;
  getSessionAgents(sessionId: string): Agent[];
  cleanupSession(sessionId: string): Promise<void>;
}
