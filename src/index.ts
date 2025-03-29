import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir } from 'fs/promises';
import { runMotherAgent } from './mother-agent.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Set up basic directories
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEEBO_ROOT = join(__dirname, '..');

// Create required directories
await mkdir(join(DEEBO_ROOT, 'sessions'), { recursive: true });
await mkdir(join(DEEBO_ROOT, 'logs'), { recursive: true });
await mkdir(join(DEEBO_ROOT, 'reports'), { recursive: true });

// Create MCP server
const server = new McpServer({
  name: "Deebo",
  version: "1.0.0"
});

// Register start tool - begins a debug session
server.tool(
  "start",
  {
    error: z.string(),
    repoPath: z.string(),
    context: z.string().optional(),
    language: z.string().optional(),
    filePath: z.string().optional()
  },
  async ({ error, repoPath, context, language, filePath }) => {
    const sessionId = `session-${Date.now()}`;
    
    try {
      // Run mother agent and wait for result
      const result = await runMotherAgent(
        sessionId,
        error,
        context ?? "",
        language ?? "typescript",
        filePath ?? "",
        repoPath
      );

      return {
        content: [{ 
          type: "text",
          text: JSON.stringify({
            sessionId,
            status: "complete",
            solution: result?.solution
          })
        }]
      };
    } catch (err) {
      // More informative error response
      return {
        content: [{ 
          type: "text",
          text: JSON.stringify({
            sessionId,
            status: "failed",
            error: err instanceof Error ? err.message : String(err)
          })
        }]
      };
    }
  }
);

// Register check tool - gets status of a debug session
server.tool(
  "check",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    try {
      const logPath = join(DEEBO_ROOT, 'logs', `${sessionId}.log`);
      const logContent = await readFile(logPath, 'utf8');
      // Split into lines and return directly - no parsing needed
      return {
        content: [{ 
          type: "text",
          text: logContent  // Just return the raw logs
        }]
      };
    } catch (err) {
      return {
        content: [{ 
          type: "text",
          text: `Session initializing`
        }]
      };
    }
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);