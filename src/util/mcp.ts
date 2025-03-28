import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LoggerLike } from "../types/logger.js";
import type { ToolResponse } from "../types/mcp.d.js";
import { PathResolver } from "./path-resolver.js";

/**
 * Convert ProcessEnv to Record<string, string> safely
 */
function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.entries(env).reduce<Record<string, string>>((acc, [key, val]) => {
    if (typeof val === 'string') {
      acc[key] = val;
    }
    return acc;
  }, {});
}

// Configuration for client initialization
interface ClientConfig {
  command: string;
  args: string[];
  capabilities: string[];
  env?: Record<string, string>;
}

// Client type definition
type McpClient = Client & {
  callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
};

// Client storage
const clients: { [key: string]: McpClient | null } = {
  git: null,
  filesystem: null
};

// Constants
const DEFAULT_TIMEOUT = 10000; // 10 seconds

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
 * Initialize MCP client
 */
async function initializeClient(
  clientKey: keyof typeof clients,
  config: ClientConfig
): Promise<void> {
  const log = await getLogger();
  
  try {
    // Load tool configuration using path resolver
    const { readFile } = await import('fs/promises');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    const toolsConfigPath = pathResolver.resolvePath('config/tools.json');
    const toolsConfig = JSON.parse(
      await readFile(toolsConfigPath, 'utf-8')
    );

    const client = new Client({
      name: `deebo-${clientKey}-client`,
      version: "0.1.0"
    }) as McpClient;
    
    // Get environment from tools config
    const env = toolsConfig.tools[`${clientKey}-mcp`]?.env || {};
    
    // Import homedir for infrastructure root path
    const { homedir } = await import('os');
    const { join } = await import('path');

    // Create environment with proper PATH and PYTHONPATH handling
    const baseEnv: Record<string, string> = {
      DEEBO_ROOT: process.env.DEEBO_ROOT || process.cwd(),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      NODE_ENV: process.env.NODE_ENV || '',
      INFRASTRUCTURE_ROOT: process.env.DEEBO_ROOT || process.cwd(),
      PATH: env.PATH || process.env.PATH || '',
      PYTHONPATH: env.PYTHONPATH || process.env.PYTHONPATH || ''
    };

    // Add other environment variables using sanitizeEnv
    const combinedEnv = {
      ...baseEnv,
      ...sanitizeEnv(process.env)
    };

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: combinedEnv,
      cwd: process.env.DEEBO_ROOT || process.cwd()
    });
    
    await client.connect(transport);
    clients[clientKey] = client;
    log.info(`${clientKey} client initialized successfully`);
  } catch (error) {
    log.error(`${clientKey} client initialization failed:`, { error });
    throw error;
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
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }

    // Initialize Git client using Python with retries
    if (!clients.git) {
      const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
      const maxRetries = 3;
      const retryDelay = 1000; // 1 second
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Validate Python setup
          const pythonValid = await pathResolver.validatePythonSetup();
          if (!pythonValid) {
            throw new Error('Python setup validation failed. Please ensure Python and git-mcp are properly installed.');
          }

          const pythonPath = pathResolver.getPythonInterpreterPath();
          if (!pythonPath) {
            throw new Error('Python interpreter path not found');
          }

          await initializeClient('git', {
            command: pythonPath,
            args: ['-m', 'mcp_server_git'],
            capabilities: ['git', 'resources'],
            env: pathResolver.getPythonEnv()
          });
          
          log.info('Git client initialized successfully');
          break;
        } catch (error) {
          if (attempt === maxRetries) {
            log.error('Failed to initialize Git client after multiple attempts', { error });
            throw error;
          }
          log.warn(`Git client initialization attempt ${attempt} failed, retrying...`, { error });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // Initialize Filesystem client using official MCP server with retries
    if (!clients.filesystem) {
      const maxRetries = 3;
      const retryDelay = 1000; // 1 second

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const fsConfig: ClientConfig = {
            command: 'npx',
            args: [
              '-y',
              '@modelcontextprotocol/server-filesystem',
              pathResolver.resolvePath('.')
            ],
            capabilities: ['filesystem', 'tools']
          };
          
          await initializeClient('filesystem', fsConfig);
          log.info('Filesystem client initialized successfully');
          break;
        } catch (error) {
          if (attempt === maxRetries) {
            log.error('Failed to initialize Filesystem client after multiple attempts', { error });
            throw error;
          }
          log.warn(`Filesystem client initialization attempt ${attempt} failed, retrying...`, { error });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
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
function getTextContent(result: unknown): string {
  const response = result as ToolResponse;
  if (!response?.content?.length) return '';
  const content = response.content[0];
  return (content?.type === 'text' && content.text) ? content.text : '';
}

/**
 * Git MCP server operations
 */
export const gitOperations = {
  async status(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_status",
      arguments: { repo_path: repoPath }
    });
    
    return getTextContent(result);
  },
  
  async diffUnstaged(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_diff_unstaged",
      arguments: { repo_path: repoPath }
    });
    
    return getTextContent(result);
  },
  
  async show(repoPath: string, revision: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_show",
      arguments: { repo_path: repoPath, revision }
    });
    
    return getTextContent(result);
  },
  
  async log(repoPath: string, maxCount = 5): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_log",
      arguments: { repo_path: repoPath, max_count: maxCount }
    });
    
    return getTextContent(result);
  }
};

/**
 * Filesystem MCP operations
 */
export const filesystemOperations = {
  async executeCommand(command: string, timeoutMs = DEFAULT_TIMEOUT): Promise<{ pid: number; output: string }> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "execute_command",
      arguments: { command, timeout_ms: timeoutMs }
    });
    
    const content = getTextContent(result);
    return {
      pid: parseInt(content.match(/PID: (\d+)/)?.[1] || "0"),
      output: content.replace(/PID: \d+\n/, "")
    };
  },

  async readFile(filePath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "read_file",
      arguments: { path: filePath }
    });
    
    return getTextContent(result);
  },
  
  async writeFile(filePath: string, content: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "write_file",
      arguments: { path: filePath, content }
    });
    
    return getTextContent(result);
  },
  
  async editBlock(blockContent: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "edit_block",
      arguments: { blockContent }
    });
    
    return getTextContent(result);
  },
  
  async listDirectory(dirPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "list_directory",
      arguments: { path: dirPath }
    });
    
    return getTextContent(result);
  },
  
  async createDirectory(dirPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "create_directory",
      arguments: { path: dirPath }
    });
    
    return getTextContent(result);
  },
  
  async searchCode(pattern: string, directory: string): Promise<string> {
    await initMcpClients();
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    
    const result = await clients.filesystem.callTool({
      name: "search_code",
      arguments: { pattern, directory }
    });
    
    return getTextContent(result);
  }
};

/**
 * Close all MCP client connections and clean up resources
 */
export async function disposeMcpClients(): Promise<void> {
  const log = await getLogger();
  try {
    // Log before cleanup
    await log.info('Disposing MCP clients');

    // Use built-in client close()
    await Promise.all(
      Object.entries(clients)
        .filter(([_, client]) => client !== null)
        .map(async ([key, client]) => {
          try {
            await client?.close();
            clients[key] = null;
            await log.info(`${key} client closed successfully`);
          } catch (error) {
            await log.error(`Failed to close ${key} client`, { error });
          }
        })
    );

    // Reset initialization state
    mcpInitialized = false;
    
    // Final log before finishing
    await log.info('All MCP clients disposed');
  } catch (error) {
    // Log error before throwing
    await log.error('Error during MCP cleanup', { error });
    
    // Reset initialization state even on error
    mcpInitialized = false;
    
    throw error;
  }
}

/**
 * Git branch operations using git-mcp tools
 */
export const gitBranchOperations = {
  async createBranch(repoPath: string, branchName: string, startPoint?: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_create_branch",
      arguments: {
        repo_path: repoPath,
        branch_name: branchName,
        ...(startPoint && { start_point: startPoint })
      }
    });
    
    return getTextContent(result);
  },
  
  async checkoutBranch(repoPath: string, branchName: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_checkout",
      arguments: {
        repo_path: repoPath,
        branch_name: branchName
      }
    });
    
    return getTextContent(result);
  },
  
  async commitChanges(repoPath: string, message: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_commit",
      arguments: {
        repo_path: repoPath,
        message
      }
    });
    
    return getTextContent(result);
  },
  
  async addFiles(repoPath: string, files: string[]): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_add",
      arguments: {
        repo_path: repoPath,
        files
      }
    });
    
    return getTextContent(result);
  },
  async resetChanges(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_reset",
      arguments: {
        repo_path: repoPath
      }
    });
    
    return getTextContent(result);
  },

  async initRepo(repoPath: string): Promise<string> {
    await initMcpClients();
    if (!clients.git) throw new Error("Git client not available");
    
    const result = await clients.git.callTool({
      name: "git_init",
      arguments: {
        repo_path: repoPath
      }
    });
    
    return getTextContent(result);
  }
};
