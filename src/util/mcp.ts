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

// Load environment variables
dotenv.config();

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
let gitClient: Client | null = null;
let commanderClient: Client | null = null;

/**
 * Initialize MCP clients for Git and Desktop Commander
 */
export async function initMcpClients() {
  if (!gitClient) {
    gitClient = new Client({ name: "deebo-git-client", version: "0.1.0" });
    
    // Determine Git MCP server command
    let gitCommand: string;
    let gitArgs: string[];
    
    // Check if MCP_GIT_PATH is set in .env
    if (process.env.MCP_GIT_PATH) {
      if (process.env.MCP_GIT_PATH.endsWith('/') || process.env.MCP_GIT_PATH.endsWith('\\')) {
        // It's a directory
        gitCommand = "python";
        gitArgs = ["-m", "mcp_server_git"];
        process.env.PYTHONPATH = process.env.MCP_GIT_PATH;
      } else {
        // It's a file
        gitCommand = "python";
        gitArgs = [process.env.MCP_GIT_PATH];
      }
    } else {
      // Use the virtual environment if available
      const venvPath = process.env.VENV_PATH || path.join(projectRoot, "venv");
      
      try {
        await fs.access(venvPath);
        // Venv exists, use it
        const pythonBin = process.platform === "win32" 
          ? path.join(venvPath, "Scripts", "python")
          : path.join(venvPath, "bin", "python");
        
        gitCommand = pythonBin;
        gitArgs = ["-m", "mcp_server_git"];
      } catch (e) {
        // Fallback to uvx
        console.error("Virtual environment not found, falling back to uvx");
        gitCommand = "uvx";
        gitArgs = ["mcp-server-git"];
      }
    }
    
    // Create transport and connect
    const gitTransport = new StdioClientTransport({
      command: gitCommand,
      args: gitArgs,
    });
    
    try {
      await gitClient.connect(gitTransport);
      console.error("Git MCP client initialized with command:", gitCommand, gitArgs.join(" "));
    } catch (error) {
      console.error("Failed to initialize Git MCP client:", error);
      throw error;
    }
  }
  
  if (!commanderClient) {
    commanderClient = new Client({ name: "deebo-commander-client", version: "0.1.0" });
    
    // Determine Desktop Commander command
    let commanderCommand: string;
    let commanderArgs: string[];
    
    // Check if MCP_COMMANDER_PATH is set in .env
    if (process.env.MCP_COMMANDER_PATH) {
      if (process.env.MCP_COMMANDER_PATH.endsWith('.js')) {
        // It's a JavaScript file
        commanderCommand = "node";
        commanderArgs = [process.env.MCP_COMMANDER_PATH];
      } else {
        // It's a directory or command
        commanderCommand = process.env.MCP_COMMANDER_PATH;
        commanderArgs = [];
      }
    } else {
      // Use locally installed package if available
      const localCommanderPath = path.join(projectRoot, "node_modules", ".bin", "desktop-commander");
      
      try {
        await fs.access(localCommanderPath);
        // Local package exists, use it
        commanderCommand = localCommanderPath;
        commanderArgs = [];
      } catch (e) {
        // Fallback to npx
        console.error("Local Desktop Commander not found, falling back to npx");
        commanderCommand = "npx";
        commanderArgs = ["-y", "@wonderwhy-er/desktop-commander"];
      }
    }
    
    // Create transport and connect
    const commanderTransport = new StdioClientTransport({
      command: commanderCommand,
      args: commanderArgs,
    });
    
    try {
      await commanderClient.connect(commanderTransport);
      console.error("Desktop Commander MCP client initialized with command:", commanderCommand, commanderArgs.join(" "));
    } catch (error) {
      console.error("Failed to initialize Desktop Commander MCP client:", error);
      throw error;
    }
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
    if (!gitClient) await initMcpClients();
    const result = await gitClient!.callTool({
      name: "git_status",
      arguments: { repo_path: repoPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async diffUnstaged(repoPath: string) {
    if (!gitClient) await initMcpClients();
    const result = await gitClient!.callTool({
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
 * Desktop Commander MCP operations
 */
export const commanderOperations = {
  async executeCommand(command: string, timeoutMs = 10000) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
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
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "read_output",
      arguments: { pid }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async readFile(filePath: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "read_file",
      arguments: { path: filePath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async writeFile(filePath: string, content: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "write_file",
      arguments: { 
        path: filePath,
        content: content
      }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async editBlock(blockContent: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "edit_block",
      arguments: { blockContent }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async listDirectory(dirPath: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "list_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async createDirectory(dirPath: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
      name: "create_directory",
      arguments: { path: dirPath }
    }) as ToolResponse;
    
    return getTextContent(result);
  },
  
  async codeSearch(directory: string, pattern: string) {
    if (!commanderClient) await initMcpClients();
    const result = await commanderClient!.callTool({
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
    return await commanderOperations.executeCommand(`cd ${repoPath} && git checkout -b ${branchName}`);
  },
  
  async checkoutBranch(repoPath: string, branchName: string) {
    return await commanderOperations.executeCommand(`cd ${repoPath} && git checkout ${branchName}`);
  },
  
  async commitChanges(repoPath: string, message: string) {
    return await commanderOperations.executeCommand(`cd ${repoPath} && git add . && git commit -m "${message}"`);
  },
  
  async deleteBranch(repoPath: string, branchName: string) {
    // First checkout main to avoid being on the branch we're deleting
    await commanderOperations.executeCommand(`cd ${repoPath} && git checkout main || git checkout master`);
    return await commanderOperations.executeCommand(`cd ${repoPath} && git branch -D ${branchName}`);
  },
  
  async getCurrentBranch(repoPath: string) {
    const result = await commanderOperations.executeCommand(`cd ${repoPath} && git branch --show-current`);
    return result.output.trim();
  },
  
  async mergeFromBranch(repoPath: string, sourceBranch: string) {
    return await commanderOperations.executeCommand(`cd ${repoPath} && git merge ${sourceBranch}`);
  }
};
