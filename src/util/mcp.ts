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
let gitClient: Client | null = null;
let commanderClient: Client | null = null;

/**
 * Initialize MCP clients for Git and Desktop Commander
 */
export async function initMcpClients() {
  if (!gitClient) {
    console.error("MCP: Initializing Git MCP client...");
    gitClient = new Client({ name: "deebo-git-client", version: "0.1.0" });
    
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
    
    try {
      await gitClient.connect(gitTransport);
      console.error("MCP: Git MCP client initialized successfully");
    } catch (error) {
      console.error("MCP: Failed to initialize Git MCP client:", error);
      console.error("MCP: This is not fatal - continuing with limited functionality");
      gitClient = null; // Reset to null so we can try again later
    }
  }
  
  if (!commanderClient) {
    console.error("MCP: Initializing Desktop Commander MCP client...");
    commanderClient = new Client({ name: "deebo-commander-client", version: "0.1.0" });
    
    // Determine Desktop Commander command
    let commanderCommand: string;
    let commanderArgs: string[];
    
    // Check if MCP_COMMANDER_PATH is set in .env
    if (process.env.MCP_COMMANDER_PATH) {
      console.error(`MCP: Using configured MCP_COMMANDER_PATH: ${process.env.MCP_COMMANDER_PATH}`);
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
      console.error(`MCP: Looking for local Desktop Commander at: ${localCommanderPath}`);
      
      try {
        await fs.access(localCommanderPath);
        // Local package exists, use it
        console.error(`MCP: Found local Desktop Commander`);
        commanderCommand = localCommanderPath;
        commanderArgs = [];
      } catch (e) {
        // Fallback to npx
        console.error("MCP: Local Desktop Commander not found, falling back to npx");
        commanderCommand = "npx";
        commanderArgs = ["-y", "@wonderwhy-er/desktop-commander"];
      }
    }
    
    console.error(`MCP: Starting Desktop Commander with command: ${commanderCommand} ${commanderArgs.join(" ")}`);
    
    // Create transport and connect
    const commanderTransport = new StdioClientTransport({
      command: commanderCommand,
      args: commanderArgs,
    });
    
    try {
      await commanderClient.connect(commanderTransport);
      console.error("MCP: Desktop Commander MCP client initialized successfully");
    } catch (error) {
      console.error("MCP: Failed to initialize Desktop Commander MCP client:", error);
      console.error("MCP: This is not fatal - continuing with limited functionality");
      commanderClient = null; // Reset to null so we can try again later
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
    try {
      if (!gitClient) await initMcpClients();
      
      // If gitClient is still null after initialization, return an error message
      if (!gitClient) {
        console.error("MCP: Git client not available for status operation");
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
