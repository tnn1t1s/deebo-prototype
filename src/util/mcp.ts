import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

// Add type declaration for dotenv if needed
declare module 'dotenv' {
  export function config(options?: { path?: string, encoding?: string, debug?: boolean }): { parsed?: { [key: string]: string } };
}

// Load environment variables with explicit path - simple version with no type errors
dotenv.config({ path: process.cwd() + '/.env' });
console.error("MCP: Loaded .env file from:", process.cwd() + '/.env');

const execAsync = promisify(exec);

// Get project root directory
const projectRoot = path.resolve(process.cwd());

// Tool response type for type safety
interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

// Clients for MCP servers
import { createLogger } from "./logger.js";

const logger = createLogger('mcp', 'client');

interface McpClient {
  client: Client | null;
  isConnecting: boolean;
  retryCount: number;
  lastError?: Error;
}

const clients: { [key: string]: McpClient } = {
  git: {
    client: null,
    isConnecting: false,
    retryCount: 0
  },
  filesystem: {
    client: null,
    isConnecting: false,
    retryCount: 0
  }
};

/**
 * Initialize MCP clients for Git and Desktop Commander
 */
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

async function validateCapabilities(client: Client, requiredCapabilities: string[]) {
  const serverCapabilities = await client.initialize();
  const missingCapabilities = requiredCapabilities.filter(
    cap => !serverCapabilities.capabilities[cap]
  );
  
  if (missingCapabilities.length > 0) {
    throw new Error(`Server missing required capabilities: ${missingCapabilities.join(', ')}`);
  }
}

export async function initMcpClients() {
  // Helper to handle client initialization with retries
async function initializeClient(
  clientKey: 'git' | 'filesystem',
  createTransport: () => StdioClientTransport,
  requiredCapabilities: string[]
) {
  const clientInfo = clients[clientKey];
  
  if (clientInfo.isConnecting) {
    logger.debug(`${clientKey} client initialization already in progress`);
    return;
  }
  
  if (clientInfo.client && clientInfo.retryCount === 0) {
    return;
  }
  
  if (clientInfo.retryCount >= MAX_RETRY_ATTEMPTS) {
    logger.error(`${clientKey} client initialization failed after ${MAX_RETRY_ATTEMPTS} attempts`);
    return;
  }
  
  clientInfo.isConnecting = true;
  
  try {
    const client = new Client({
      name: `deebo-${clientKey}-client`,
      version: "0.1.0"
    });
    
    const transport = createTransport();
    await client.connect(transport);
    await validateCapabilities(client, requiredCapabilities);
    
    clientInfo.client = client;
    clientInfo.retryCount = 0;
    clientInfo.lastError = undefined;
    logger.info(`${clientKey} client initialized successfully`);
  } catch (error) {
    clientInfo.lastError = error as Error;
    clientInfo.retryCount++;
    logger.error(`${clientKey} client initialization failed:`, { error, attempt: clientInfo.retryCount });
    
    if (clientInfo.retryCount < MAX_RETRY_ATTEMPTS) {
      setTimeout(() => {
        clientInfo.isConnecting = false;
        initializeClient(clientKey, createTransport, requiredCapabilities);
      }, RETRY_DELAY * Math.pow(2, clientInfo.retryCount - 1));
    }
  } finally {
    clientInfo.isConnecting = false;
  }
}

// Initialize Git client
if (!clients.git.client) {
    console.error("MCP: Initializing Git MCP client...");
    await initializeClient('git', () => new StdioClientTransport({
      command: gitCommand,
      args: gitArgs,
    }), ['git', 'resources']);
    
    // Determine Git MCP server command
    let gitCommand: string;
    let gitArgs: string[];
    
    // Check if MCP_GIT_PATH is set in .env
    if (process.env.MCP_GIT_PATH) {
      console.error(`MCP: Using configured MCP_GIT_PATH: ${process.env.MCP_GIT_PATH}`);
      if (process.env.MCP_GIT_PATH.endsWith('/') || process.env.MCP_GIT_PATH.endsWith('\\')) {
        // It's a directory
        gitCommand = "python";
        gitArgs = ["-m", "mcp_server_git"];
        process.env.PYTHONPATH = process.env.MCP_GIT_PATH;
        console.error(`MCP: Setting PYTHONPATH to: ${process.env.PYTHONPATH}`);
      } else {
        // It's a file
        gitCommand = "python";
        gitArgs = [process.env.MCP_GIT_PATH];
      }
    } else {
      // Use the virtual environment if available
      const venvPath = process.env.VENV_PATH || path.join(projectRoot, "venv");
      console.error(`MCP: Looking for virtual environment at: ${venvPath}`);
      
      try {
        await fs.access(venvPath);
        // Venv exists, use it
        const pythonBin = process.platform === "win32" 
          ? path.join(venvPath, "Scripts", "python")
          : path.join(venvPath, "bin", "python");
        
        console.error(`MCP: Found virtual environment, using Python at: ${pythonBin}`);
        gitCommand = pythonBin;
        gitArgs = ["-m", "mcp_server_git"];
      } catch (e) {
        // Fallback to uvx
        console.error("MCP: Virtual environment not found, falling back to uvx");
        gitCommand = "uvx";
        gitArgs = ["mcp-server-git"];
      }
    }
    
    console.error(`MCP: Starting Git MCP client with command: ${gitCommand} ${gitArgs.join(" ")}`);
    
    // Create transport and connect
    const gitTransport = new StdioClientTransport({
      command: gitCommand,
      args: gitArgs,
    });
    
    // Empty block to remove try-catch
  }
  
  // Initialize Filesystem client
if (!clients.filesystem.client) {
    console.error("MCP: Initializing Filesystem MCP client...");
    await initializeClient('filesystem', () => new StdioClientTransport({
      command: fsCommand,
      args: fsArgs,
    }), ['filesystem', 'tools']);
    
    // Determine Filesystem MCP command
    let fsCommand: string;
    let fsArgs: string[];
    
    // Check if MCP_FILESYSTEM_PATH is set in .env
    if (process.env.MCP_FILESYSTEM_PATH) {
      console.error(`MCP: Using configured MCP_FILESYSTEM_PATH: ${process.env.MCP_FILESYSTEM_PATH}`);
      if (process.env.MCP_FILESYSTEM_PATH.endsWith('.js')) {
        // It's a JavaScript file
        fsCommand = "node";
        fsArgs = [process.env.MCP_FILESYSTEM_PATH];
      } else {
        // It's a directory or command
        fsCommand = process.env.MCP_FILESYSTEM_PATH;
        fsArgs = [];
      }
    } else {
      // Use npx to run the filesystem MCP server with allowed directories
      console.error("MCP: MCP_FILESYSTEM_PATH not set, using npx with server-filesystem");
      fsCommand = "npx";
      fsArgs = ["-y", "@modelcontextprotocol/server-filesystem", projectRoot];
    }
    
    console.error(`MCP: Starting Filesystem MCP client with command: ${fsCommand} ${fsArgs.join(" ")}`);
    
    // Create transport and connect
    const filesystemTransport = new StdioClientTransport({
      command: fsCommand,
      args: fsArgs,
    });
    
    // Empty block to remove try-catch
  }
}

/**
 * Get text content from tool response
 */
function getTextContent(result: any): string {
  if (!result || !result.content || !Array.isArray(result.content) || result.content.length === 0) {
    return "";
  }
  
  const content = result.content[0];
  return (content && typeof content.text === 'string') ? content.text : "";
}

/**
 * Git MCP server operations
 */
export const gitOperations = {
  async status(repoPath: string) {
    try {
      await initMcpClients();
      
      // Check client status after initialization
      if (!clients.git.client) {
        logger.error("Git client not available for status operation", { lastError: clients.git.lastError });
        return "Error: Git MCP client not available. Check server initialization.";
      }
      
      const result = await gitClient.callTool({
        name: "git_status",
        arguments: { repo_path: repoPath }
      }) as ToolResponse;
      
      return getTextContent(result);
    } catch (error) {
      console.error(`MCP: Error getting git status: ${error}`);
      return `Error fetching git status: ${error}`;
    }
  },
  
  async diffUnstaged(repoPath: string) {
    await initMcpClients();
if (!clients.git.client) throw new Error("Git client not available");
const result = await clients.git.client.callTool({
      name: "git_diff_unstaged",
      arguments: { repo_path: repoPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async show(repoPath: string, revision: string) {
    if (!gitClient) await initMcpClients();
    const result = await gitClient!.callTool({
      name: "git_show",
      arguments: { 
        repo_path: repoPath,
        revision: revision
      }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async log(repoPath: string, maxCount = 5) {
    if (!gitClient) await initMcpClients();
    const result = await gitClient!.callTool({
      name: "git_log",
      arguments: { 
        repo_path: repoPath,
        max_count: maxCount
      }
    }) as ToolResponse;
    
    return getTextContent(result);
  }
};

/**
 * Filesystem MCP operations
 */
export const filesystemOperations = {
  async executeCommand(command: string, timeoutMs = 10000) {
    await initMcpClients();
if (!clients.filesystem.client) throw new Error("Filesystem client not available");
const result = await clients.filesystem.client.callTool({
      name: "execute_command",
      arguments: { 
        command: command,
        timeout_ms: timeoutMs
      }
    }) as ToolResponse;
    
    const content = getTextContent(result);
    return {
      pid: parseInt(content.match(/PID: (\d+)/)?.[1] || "0"),
      output: content.replace(/PID: \d+\n/, "")
    };
  },
  
  async readOutput(pid: number) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "read_output",
      arguments: { pid }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async readFile(filePath: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "read_file",
      arguments: { path: filePath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async writeFile(filePath: string, content: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "write_file",
      arguments: { 
        path: filePath,
        content: content
      }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async editBlock(blockContent: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "edit_block",
      arguments: { blockContent }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async listDirectory(dirPath: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "list_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async createDirectory(dirPath: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "create_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async codeSearch(directory: string, pattern: string) {
    if (!filesystemClient) await initMcpClients();
    const result = await filesystemClient!.callTool({
      name: "code_search",
      arguments: { 
        directory,
        pattern
      }
    }) as ToolResponse;
    
    return getTextContent(result);
  }
};

/**
 * Git branch operations for scenario agents
 */
export const gitBranchOperations = {
  async createBranch(repoPath: string, branchName: string) {
    return await filesystemOperations.executeCommand(`cd ${repoPath} && git checkout -b ${branchName}`);
  },
  
  async checkoutBranch(repoPath: string, branchName: string) {
    return await filesystemOperations.executeCommand(`cd ${repoPath} && git checkout ${branchName}`);
  },
  
  async commitChanges(repoPath: string, message: string) {
    return await filesystemOperations.executeCommand(`cd ${repoPath} && git add . && git commit -m "${message}"`);
  },
  
  async deleteBranch(repoPath: string, branchName: string) {
    // First checkout main to avoid being on the branch we're deleting
    await filesystemOperations.executeCommand(`cd ${repoPath} && git checkout main || git checkout master`);
    return await filesystemOperations.executeCommand(`cd ${repoPath} && git branch -D ${branchName}`);
  },
  
  async getCurrentBranch(repoPath: string) {
    const result = await filesystemOperations.executeCommand(`cd ${repoPath} && git branch --show-current`);
    return result.output.trim();
  },
  
  async mergeFromBranch(repoPath: string, sourceBranch: string) {
    return await filesystemOperations.executeCommand(`cd ${repoPath} && git merge ${sourceBranch}`);
  }
};
