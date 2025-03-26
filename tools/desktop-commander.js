import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// Create MCP server for file system and command execution operations
const server = new McpServer({
  name: "desktop-commander",
  version: "0.1.0",
  capabilities: {
    tools: {},
  },
});

// Tool: Read File
server.tool(
  "read_file",
  "Read a file from the file system",
  {
    path: z.string().describe("Path to the file")
  },
  async ({ path: filePath }) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        content: [{ type: "text", text: content }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error reading file: ${error.message}` }],
      };
    }
  }
);

// Tool: Write File
server.tool(
  "write_file",
  "Write content to a file",
  {
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write")
  },
  async ({ path: filePath, content }) => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, content, 'utf-8');
      return {
        content: [{ type: "text", text: `File written successfully: ${filePath}` }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error writing file: ${error.message}` }],
      };
    }
  }
);

// Tool: Edit Block
server.tool(
  "edit_block",
  "Apply surgical text replacements to a file",
  {
    blockContent: z.string().describe("Block content with file path and edit directives")
  },
  async ({ blockContent }) => {
    try {
      // Parse block content
      const match = blockContent.match(/^([^\n]+)\n<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE$/);
      if (!match) {
        throw new Error("Invalid block format. Expected: filepath\n<<<<<<< SEARCH\ncontent to find\n=======\nnew content\n>>>>>>> REPLACE");
      }
      
      const [_, filePath, searchText, replaceText] = match;
      
      // Read file
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Replace content
      if (!content.includes(searchText)) {
        throw new Error(`Search text not found in ${filePath}`);
      }
      
      const newContent = content.replace(searchText, replaceText);
      
      // Write back
      fs.writeFileSync(filePath, newContent, 'utf-8');
      
      return {
        content: [{ type: "text", text: `Successfully edited ${filePath}` }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error editing file: ${error.message}` }],
      };
    }
  }
);

// Tool: List Directory
server.tool(
  "list_directory",
  "List files and directories in a specified path",
  {
    path: z.string().describe("Path to the directory")
  },
  async ({ path: dirPath }) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = items.map(item => 
        `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`
      ).join('\n');
      
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing directory: ${error.message}` }],
      };
    }
  }
);

// Tool: Create Directory
server.tool(
  "create_directory",
  "Create a directory",
  {
    path: z.string().describe("Path to the directory to create")
  },
  async ({ path: dirPath }) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return {
        content: [{ type: "text", text: `Directory created successfully: ${dirPath}` }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error creating directory: ${error.message}` }],
      };
    }
  }
);

// Tool: Execute Command
server.tool(
  "execute_command",
  "Execute a shell command",
  {
    command: z.string().describe("Command to execute"),
    cwd: z.string().optional().describe("Working directory")
  },
  async ({ command, cwd }) => {
    return new Promise((resolve) => {
      exec(command, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            isError: true,
            content: [{ 
              type: "text", 
              text: `Error executing command: ${error.message}\nStderr: ${stderr}` 
            }],
          });
          return;
        }
        
        resolve({
          content: [{ type: "text", text: stdout }],
        });
      });
    });
  }
);

// Tool: Search Code
server.tool(
  "search_code",
  "Search for code patterns in files",
  {
    path: z.string().describe("Path to search in"),
    pattern: z.string().describe("Search pattern"),
    file_pattern: z.string().optional().describe("File pattern to match")
  },
  async ({ path: searchPath, pattern, file_pattern }) => {
    try {
      let cmd = `grep -r "${pattern}" ${searchPath}`;
      if (file_pattern) {
        cmd += ` --include="${file_pattern}"`;
      }
      
      const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      return {
        content: [{ type: "text", text: output || "No matches found" }],
      };
    } catch (error) {
      // Grep returns non-zero when no matches found
      if (error.status === 1 && !error.stderr) {
        return {
          content: [{ type: "text", text: "No matches found" }],
        };
      }
      
      return {
        isError: true,
        content: [{ type: "text", text: `Error searching code: ${error.message}` }],
      };
    }
  }
);

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Desktop Commander MCP Server running on stdio");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});