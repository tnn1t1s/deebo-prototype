import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

import { join } from 'path';
import { homedir, tmpdir } from 'os';

// Track initialization state
let isInitialized = false;

// Path validation helper
function validatePath(filePath) {
  // Never allow root directory
  if (filePath === '/' || filePath.match(/^\/[^/]+$/)) {
    throw new Error(`CRITICAL SAFETY ERROR: Attempted to access system root level: ${filePath}`);
  }

  // If absolute path, ensure it's under a valid root
  if (path.isAbsolute(filePath)) {
    const validRoots = [
      process.cwd(),
      join(homedir(), '.deebo-prototype'),
      join(tmpdir(), 'deebo-prototype')
    ];
    const isUnderValidRoot = validRoots.some(root => filePath.startsWith(root));
    if (!isUnderValidRoot) {
      throw new Error(`Path not under valid root directory: ${filePath}`);
    }
  }
}

// Initialize paths
async function initializePaths() {
  // Create required directories with safe defaults
  const defaultDirs = [
    'tmp',
    'sessions',
    'reports'
  ];

  for (const dir of defaultDirs) {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory: ${dirPath}`, error);
        throw error;
      }
    }
  }
}

// Create MCP server with initialization check
const server = new McpServer({
  name: "filesystem-mcp",
  version: "1.0.0"
});

// Initialize paths before adding capability
await initializePaths();

// Add capabilities after initialization
server.addCapability('tools');
server.addCapability('filesystem');

isInitialized = true;

// Tool: Read File
server.tool(
  "read_file",
  {
    path: z.string().describe("Path to the file")
  },
  async ({ path: filePath }) => {
    try {
      if (!isInitialized) {
        throw new Error('Filesystem MCP not initialized');
      }
      
      // Validate path
      validatePath(filePath);
      
      // Ensure file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Get file stats
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${filePath}`);
      }
      
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

// Tool: Read Multiple Files
server.tool(
  "read_multiple_files",
  {
    paths: z.array(z.string()).describe("Paths to the files")
  },
  async ({ paths }) => {
    try {
      const results = [];
      for (const filePath of paths) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          results.push({ path: filePath, content });
        } catch (error) {
          results.push({ path: filePath, error: error.message });
        }
      }
      
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error reading multiple files: ${error.message}` }],
      };
    }
  }
);

// Tool: Write File
server.tool(
  "write_file",
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

// Tool: Edit File
server.tool(
  "edit_file",
  {
    path: z.string().describe("Path to the file to edit"),
    edits: z.array(z.object({
      oldText: z.string().describe("Text to replace"),
      newText: z.string().describe("New text")
    })).describe("List of edits to perform"),
    dryRun: z.boolean().optional().describe("Preview changes without applying")
  },
  async ({ path: filePath, edits, dryRun = false }) => {
    try {
      // Read file
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Create diff
      const changes = [];
      let newContent = content;
      
      for (const edit of edits) {
        if (!content.includes(edit.oldText)) {
          changes.push(`Warning: Could not find text to replace: "${edit.oldText.substring(0, 30)}..."`);
          continue;
        }
        
        changes.push(`- ${edit.oldText.substring(0, 40)}${edit.oldText.length > 40 ? '...' : ''}`);
        changes.push(`+ ${edit.newText.substring(0, 40)}${edit.newText.length > 40 ? '...' : ''}`);
        
        newContent = newContent.replace(edit.oldText, edit.newText);
      }
      
      // If dry run, return changes
      if (dryRun) {
        return {
          content: [{ 
            type: "text", 
            text: `Dry run for ${filePath}:\n\n${changes.join('\n')}` 
          }],
        };
      }
      
      // Write changes
      fs.writeFileSync(filePath, newContent, 'utf-8');
      
      return {
        content: [{ 
          type: "text", 
          text: `Successfully edited ${filePath}:\n\n${changes.join('\n')}` 
        }],
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
  {
    command: z.string().describe("Command to execute"),
    timeout_ms: z.number().optional().describe("Command timeout in ms")
  },
  async ({ command, timeout_ms = 30000 }) => {
    return new Promise((resolve) => {
      const pid = Math.floor(Math.random() * 100000); // Fake PID
      const execOpts = { 
        encoding: 'utf-8', 
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeout_ms 
      };
      
      exec(command, execOpts, (error, stdout, stderr) => {
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
          content: [{ 
            type: "text", 
            text: `PID: ${pid}\n${stdout}` 
          }],
        });
      });
    });
  }
);

// Tool: Read Output
server.tool(
  "read_output",
  {
    pid: z.number().describe("Process ID to read from")
  },
  async ({ pid }) => {
    // This is a simulation since we don't actually track processes
    return {
      content: [{ 
        type: "text", 
        text: `Process ${pid} has completed.` 
      }],
    };
  }
);

// Tool: Search Code
server.tool(
  "search_code",
  {
    path: z.string().describe("Path to search in"),
    pattern: z.string().describe("Search pattern"),
    filePattern: z.string().optional().describe("File pattern to match"),
    ignoreCase: z.boolean().optional().describe("Ignore case when searching"),
    maxResults: z.number().optional().describe("Maximum number of results")
  },
  async ({ path: searchPath, pattern, filePattern, ignoreCase = true, maxResults = 100 }) => {
    try {
      let cmd = `grep -r${ignoreCase ? 'i' : ''} "${pattern}" ${searchPath}`;
      if (filePattern) {
        cmd += ` --include="${filePattern}"`;
      }
      if (maxResults) {
        cmd += ` | head -n ${maxResults}`;
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

// Tool: Get File Info
server.tool(
  "get_file_info",
  {
    path: z.string().describe("Path to the file or directory")
  },
  async ({ path: filePath }) => {
    try {
      const stats = fs.statSync(filePath);
      const info = {
        path: filePath,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        permissions: stats.mode.toString(8).slice(-3)
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting file info: ${error.message}` }],
      };
    }
  }
);

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Filesystem MCP Server running on stdio");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});