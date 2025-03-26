import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";

// Create MCP server for Git operations
const server = new McpServer({
  name: "git-mcp",
  version: "0.1.0",
  capabilities: {
    tools: {},
  },
});

// Tool: Git Status
server.tool(
  "git_status",
  "Get the status of a Git repository",
  {
    repo_path: z.string().describe("Path to the repository")
  },
  async ({ repo_path }) => {
    try {
      const output = execSync('git status', { cwd: repo_path, encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      };
    }
  }
);

// Tool: Git Diff
server.tool(
  "git_diff",
  "Get the diff of unstaged changes in a Git repository",
  {
    repo_path: z.string().describe("Path to the repository")
  },
  async ({ repo_path }) => {
    try {
      const output = execSync('git diff', { cwd: repo_path, encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: output || "No changes" }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      };
    }
  }
);

// Tool: Git Log
server.tool(
  "git_log",
  "Get the commit history of a Git repository",
  {
    repo_path: z.string().describe("Path to the repository"),
    max_count: z.number().optional().describe("Maximum number of commits to show")
  },
  async ({ repo_path, max_count }) => {
    try {
      const cmd = max_count ? `git log -n ${max_count}` : 'git log -n 5';
      const output = execSync(cmd, { cwd: repo_path, encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      };
    }
  }
);

// Tool: Git Branch
server.tool(
  "git_branch",
  "Create, list, or switch branches",
  {
    repo_path: z.string().describe("Path to the repository"),
    operation: z.enum(["list", "create", "checkout", "delete"]).describe("Branch operation"),
    branch_name: z.string().optional().describe("Name of the branch")
  },
  async ({ repo_path, operation, branch_name }) => {
    try {
      let cmd = '';
      
      switch (operation) {
        case 'list':
          cmd = 'git branch';
          break;
        case 'create':
          if (!branch_name) {
            throw new Error("Branch name is required for 'create' operation");
          }
          cmd = `git checkout -b ${branch_name}`;
          break;
        case 'checkout':
          if (!branch_name) {
            throw new Error("Branch name is required for 'checkout' operation");
          }
          cmd = `git checkout ${branch_name}`;
          break;
        case 'delete':
          if (!branch_name) {
            throw new Error("Branch name is required for 'delete' operation");
          }
          cmd = `git branch -D ${branch_name}`;
          break;
      }
      
      const output = execSync(cmd, { cwd: repo_path, encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: output || "Operation successful" }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      };
    }
  }
);

// Tool: Git Commit
server.tool(
  "git_commit",
  "Commit changes to a Git repository",
  {
    repo_path: z.string().describe("Path to the repository"),
    message: z.string().describe("Commit message"),
    add_all: z.boolean().optional().describe("Whether to add all changes")
  },
  async ({ repo_path, message, add_all }) => {
    try {
      if (add_all) {
        execSync('git add -A', { cwd: repo_path });
      }
      
      const output = execSync(`git commit -m "${message}"`, { cwd: repo_path, encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }],
      };
    }
  }
);

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Git MCP Server running on stdio");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});