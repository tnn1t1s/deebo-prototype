import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import type { LoggerLike } from "../types/logger.js";

// Configuration for client initialization
interface ClientConfig {
  command: string;
  args: string[];
  capabilities: string[];
}

// Tool response type for type safety
interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

// MCP client state tracking
interface McpClient {
  client: Client | null;
  isConnecting: boolean;
  retryCount: number;
  lastError?: Error;
  initialized: boolean;
  initializationTime?: number;
  validatedCapabilities?: string[];
}

// Map of client types to their states
const clients: Record<'git' | 'filesystem', McpClient> = {
  git: {
    client: null,
    isConnecting: false,
    retryCount: 0,
    initialized: false,
    validatedCapabilities: []
  },
  filesystem: {
    client: null,
    isConnecting: false,
    retryCount: 0,
    initialized: false,
    validatedCapabilities: []
  }
};

// Constants
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second
const DEFAULT_TIMEOUT = 10000; // 10 seconds

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Initialize logger
let logger: LoggerLike;

/**
 * Ensure logger is initialized
 */
async function getLogger(): Promise<LoggerLike> {
  if (!logger) {
    const { initLogger } = await import('./init-logger.js');
    logger = initLogger;
  }
  return logger;
}

/**
 * Initialize MCP client with validation and retry logic
 */
async function initializeClient(
  clientKey: keyof typeof clients,
  config: ClientConfig
): Promise<void> {
  const clientInfo = clients[clientKey];
  const log = await getLogger();
  
  if (clientInfo.isConnecting) {
    log.debug(`${clientKey} client initialization already in progress`);
    return;
  }
  
  if (clientInfo.client && clientInfo.retryCount === 0) {
    return;
  }
  
  if (clientInfo.retryCount >= MAX_RETRY_ATTEMPTS) {
    log.error(`${clientKey} client initialization failed after ${MAX_RETRY_ATTEMPTS} attempts`);
    return;
  }
  
  clientInfo.isConnecting = true;
  
  try {
    const client = new Client({
      name: `deebo-${clientKey}-client`,
      version: "0.1.0"
    });
    
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args
    });
    
    await client.connect(transport);
    
    // Validate capabilities
    const serverInfo = await client.listTools();
    const availableCapabilities = serverInfo.tools.map(tool => tool.name);
    
    const missingCapabilities = config.capabilities.filter(
      cap => !availableCapabilities.includes(cap)
    );
    
    if (missingCapabilities.length > 0) {
      throw new Error(`Server missing required capabilities: ${missingCapabilities.join(', ')}`);
    }
    
    clientInfo.client = client;
    clientInfo.initialized = true;
    clientInfo.retryCount = 0;
    clientInfo.lastError = undefined;
    clientInfo.validatedCapabilities = [...availableCapabilities];
    clientInfo.initializationTime = Date.now();
    
    log.info(`${clientKey} client initialized successfully`);
  } catch (error) {
    clientInfo.lastError = error as Error;
    clientInfo.retryCount++;
    log.error(`${clientKey} client initialization failed:`, { error, attempt: clientInfo.retryCount });
    
    if (clientInfo.retryCount < MAX_RETRY_ATTEMPTS) {
      setTimeout(() => {
        clientInfo.isConnecting = false;
        initializeClient(clientKey, config).catch(err => 
          log.error(`Retry failed for ${clientKey}`, { error: err })
        );
      }, RETRY_DELAY * Math.pow(2, clientInfo.retryCount - 1));
    }
  } finally {
    clientInfo.isConnecting = false;
  }
}

/**
 * Initialize all MCP clients
 */
let mcpInitialized = false;

export async function initMcpClients(): Promise<void> {
  const log = await getLogger();

  if (mcpInitialized) {
    log.info('MCP clients already initialized');
    return;
  }

  try {
    // Initialize Git client
    if (!clients.git.client) {
      const gitConfig: ClientConfig = {
        command: process.env.MCP_GIT_PATH || 'npx',
        args: process.env.MCP_GIT_PATH 
          ? [process.env.MCP_GIT_PATH]
          : ['-y', '@modelcontextprotocol/server-git'],
        capabilities: ['git', 'resources']
      };
      
      await initializeClient('git', gitConfig);
    }

    // Initialize Filesystem client
    if (!clients.filesystem.client) {
      const fsConfig: ClientConfig = {
        command: process.env.MCP_FILESYSTEM_PATH || 'npx',
        args: process.env.MCP_FILESYSTEM_PATH
          ? [process.env.MCP_FILESYSTEM_PATH]
          : ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        capabilities: ['filesystem', 'tools']
      };
      
      await initializeClient('filesystem', fsConfig);
    }

    mcpInitialized = true;
    log.info('All MCP clients initialized successfully');
  } catch (error) {
    log.error('Failed to initialize MCP clients', { error });
    throw error;
  }
}

/**
 * Get text content from tool response
 */
function getTextContent(result: ToolResponse): string {
  if (!result?.content?.length) return '';
  const content = result.content[0];
  return (content?.type === 'text' && content.text) ? content.text : '';
}

/**
 * Git MCP server operations
 */
export const gitOperations = {
  async status(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git.client) throw new Error("Git client not available");
    
    const result = await clients.git.client.callTool({
      name: "git_status",
      arguments: { repo_path: repoPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async diffUnstaged(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git.client) throw new Error("Git client not available");
    
    const result = await clients.git.client.callTool({
      name: "git_diff_unstaged",
      arguments: { repo_path: repoPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async show(repoPath: string, revision: string): Promise<string> {
    await initMcpClients();
    if (!clients.git.client) throw new Error("Git client not available");
    
    const result = await clients.git.client.callTool({
      name: "git_show",
      arguments: { repo_path: repoPath, revision }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async log(repoPath: string, maxCount = 5): Promise<string> {
    await initMcpClients();
    if (!clients.git.client) throw new Error("Git client not available");
    
    const result = await clients.git.client.callTool({
      name: "git_log",
      arguments: { repo_path: repoPath, max_count: maxCount }
    }) as ToolResponse;
    
    return getTextContent(result);
  }
};

/**
 * Filesystem MCP operations
 */
export const filesystemOperations = {
  async executeCommand(command: string, timeoutMs = DEFAULT_TIMEOUT) {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "execute_command",
      arguments: { command, timeout_ms: timeoutMs }
    }) as ToolResponse;
    
    const content = getTextContent(result);
    return {
      pid: parseInt(content.match(/PID: (\d+)/)?.[1] || "0"),
      output: content.replace(/PID: \d+\n/, "")
    };
  },
  
  async readOutput(pid: number): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "read_output",
      arguments: { pid }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async readFile(filePath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "read_file",
      arguments: { path: filePath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async writeFile(filePath: string, content: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "write_file",
      arguments: { path: filePath, content }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async editBlock(blockContent: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "edit_block",
      arguments: { blockContent }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async listDirectory(dirPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "list_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async createDirectory(dirPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "create_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async searchCode(pattern: string, directory: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem.client) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.client.callTool({
      name: "search_code",
      arguments: { pattern, directory }
    }) as ToolResponse;
    
    return getTextContent(result);
  }
};

/**
 * Git branch operations for scenario agents
 */
export const gitBranchOperations = {
  async createBranch(repoPath: string, branchName: string) {
    return await filesystemOperations.executeCommand(
      `cd ${repoPath} && git checkout -b ${branchName}`
    );
  },
  
  async checkoutBranch(repoPath: string, branchName: string) {
    return await filesystemOperations.executeCommand(
      `cd ${repoPath} && git checkout ${branchName}`
    );
  },
  
  async commitChanges(repoPath: string, message: string) {
    return await filesystemOperations.executeCommand(
      `cd ${repoPath} && git add . && git commit -m "${message}"`
    );
  },
  
  async deleteBranch(repoPath: string, branchName: string) {
    // First checkout main to avoid being on the branch we're deleting
    await filesystemOperations.executeCommand(
      `cd ${repoPath} && git checkout main || git checkout master`
    );
    return await filesystemOperations.executeCommand(
      `cd ${repoPath} && git branch -D ${branchName}`
    );
  },
  
  async getCurrentBranch(repoPath: string) {
    const result = await filesystemOperations.executeCommand(
      `cd ${repoPath} && git branch --show-current`
    );
    return result.output.trim();
  },
  
  async mergeFromBranch(repoPath: string, sourceBranch: string) {
    return await filesystemOperations.executeCommand(
      `cd ${repoPath} && git merge ${sourceBranch}`
    );
  }
};