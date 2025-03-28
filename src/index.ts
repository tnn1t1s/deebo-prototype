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
    context: z.string().optional(),
    language: z.string().optional(),
    filePath: z.string().optional(),
    repoPath: z.string().optional()
  },
  async ({ error, context, language, filePath, repoPath }) => {
    const sessionId = `session-${Date.now()}`;
    
    // Run mother agent directly in same process
    runMotherAgent(
      sessionId,
      error,
      context ?? "",
      language ?? "typescript",
      filePath ?? "",
      repoPath ?? ""
    ).catch(err => console.error('Debug session failed:', err));

    // Return session ID immediately
    return {
      content: [{ 
        type: "text",
        text: sessionId // Just return the session ID as per SDK format
      }]
    };
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
      // Just read the single session log file
      const logPath = join(DEEBO_ROOT, 'logs', `${sessionId}.log`);
      const log = await readFile(logPath, 'utf8');
      return {
        content: [{ 
          type: "text",
          text: log
        }]
      };
    } catch (err) {
      const error = err as Error;
      return {
        content: [{ 
          type: "text",
          text: `Session not found or still initializing`
        }]
      };
    }
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
