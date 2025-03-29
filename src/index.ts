import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir } from 'fs/promises';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMotherAgent } from './mother-agent.js';

// Load environment variables from .env file
config();

// Validate required environment variables
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

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

    // Run mother agent in background
    runMotherAgent(
      sessionId,
      error,
      context ?? "",
      language ?? "typescript",
      filePath ?? "",
      repoPath
    ).catch(err => console.error('Debug session failed:', err));

    // Return session ID immediately
    return {
      content: [{
        type: "text",
        text: sessionId
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
      const logPath = join(DEEBO_ROOT, 'logs', `${sessionId}.log`);
      const logContent = await readFile(logPath, 'utf8');
      const lines = logContent.split('\n').filter(Boolean);
      const events = lines.map(line => JSON.parse(line));
      const lastEvent = events[events.length - 1];
      
      return {
        content: [{ 
          type: "text",
          text: JSON.stringify({
            sessionId,
            status: lastEvent.level === 'error' ? 'failed' : 'in_progress',
            events
          })
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
