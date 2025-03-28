import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createLogger } from './logger.js';
import { loadPythonConfig, getPythonEnv } from './config.js';

// Client type definition
type McpClient = Client & {
  callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
};

// Client storage
const clients: { [key: string]: McpClient | null } = {
  git: null,
  filesystem: null
};

// Initialize logger
let logger: any;

/**
 * Initialize MCP clients
 */
export async function initMcpClients(): Promise<void> {
  if (!logger) {
    logger = await createLogger('system', 'mcp');
  }

  try {
    // Initialize Git client
    if (!clients.git) {
      // Load Python config for git-mcp
      const pythonConfig = await loadPythonConfig();
      const env = getPythonEnv(pythonConfig);

      const client = new Client({
        name: 'deebo-git-client',
        version: '0.1.0'
      }) as McpClient;

      const transport = new StdioClientTransport({
        command: pythonConfig.interpreter_path,
        args: ['-m', 'mcp_server_git'],
        env
      });

      await client.connect(transport);
      clients.git = client;
      logger.info('Git client initialized');
    }

    // Initialize Filesystem client
    if (!clients.filesystem) {
      const client = new Client({
        name: 'deebo-filesystem-client',
        version: '0.1.0'
      }) as McpClient;

      // Convert process.env to Record<string, string>
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }

      const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        env
      });

      await client.connect(transport);
      clients.filesystem = client;
      logger.info('Filesystem client initialized');
    }

    logger.info('All MCP clients initialized');
  } catch (error) {
    logger.error('Failed to initialize MCP clients', { error });
    throw error;
  }
}

/**
 * Get text content from tool response
 */
function getTextContent(result: unknown): string {
  const response = result as { content?: Array<{ type: string; text?: string }> };
  if (!response?.content?.length) return '';
  const content = response.content[0];
  return (content?.type === 'text' && content.text) ? content.text : '';
}

/**
 * Git operations
 */
export const gitOperations = {
  async status(repoPath: string): Promise<string> {
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_status",
      arguments: { repo_path: repoPath }
    });
    return getTextContent(result);
  },
  
  async diffUnstaged(repoPath: string): Promise<string> {
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_diff_unstaged",
      arguments: { repo_path: repoPath }
    });
    return getTextContent(result);
  },
  
  async show(repoPath: string, revision: string): Promise<string> {
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_show",
      arguments: { repo_path: repoPath, revision }
    });
    return getTextContent(result);
  },
  
  async log(repoPath: string, maxCount = 5): Promise<string> {
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_log",
      arguments: { repo_path: repoPath, max_count: maxCount }
    });
    return getTextContent(result);
  }
};

/**
 * Filesystem operations
 */
export const filesystemOperations = {
  async executeCommand(command: string): Promise<string> {
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    const result = await clients.filesystem.callTool({
      name: "execute_command",
      arguments: { command }
    });
    return getTextContent(result);
  },

  async readFile(filePath: string): Promise<string> {
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    const result = await clients.filesystem.callTool({
      name: "read_file",
      arguments: { path: filePath }
    });
    return getTextContent(result);
  },
  
  async writeFile(filePath: string, content: string): Promise<string> {
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    const result = await clients.filesystem.callTool({
      name: "write_file",
      arguments: { path: filePath, content }
    });
    return getTextContent(result);
  },
  
  async listDirectory(dirPath: string): Promise<string> {
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    const result = await clients.filesystem.callTool({
      name: "list_directory",
      arguments: { path: dirPath }
    });
    return getTextContent(result);
  },
  
  async createDirectory(dirPath: string): Promise<string> {
    if (!clients.filesystem) throw new Error("Filesystem client not available");
    const result = await clients.filesystem.callTool({
      name: "create_directory",
      arguments: { path: dirPath }
    });
    return getTextContent(result);
  }
};

/**
 * Git branch operations
 */
export const gitBranchOperations = {
  async createBranch(repoPath: string, branchName: string): Promise<string> {
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_create_branch",
      arguments: {
        repo_path: repoPath,
        branch_name: branchName
      }
    });
    return getTextContent(result);
  },
  
  async checkoutBranch(repoPath: string, branchName: string): Promise<string> {
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
    if (!clients.git) throw new Error("Git client not available");
    const result = await clients.git.callTool({
      name: "git_add",
      arguments: {
        repo_path: repoPath,
        files
      }
    });
    return getTextContent(result);
  }
};
