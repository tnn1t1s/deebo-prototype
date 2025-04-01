import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir } from 'fs/promises';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMotherAgent } from './mother-agent.js';
import { getProjectId } from './util/sanitize.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);


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
await mkdir(join(DEEBO_ROOT, 'memory-bank'), { recursive: true });

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
    const projectId = getProjectId(repoPath);
    const sessionId = `session-${Date.now()}`;
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs'), { recursive: true });
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'reports'), { recursive: true });
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
    sessionId: z.string(),
    repoPath: z.string()  // Need repo path to find project directory
  },
  async ({ sessionId, repoPath }) => {
    try {
      const projectId = getProjectId(repoPath);
      const logPath = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs', 'mother.log');
      const logContent = await readFile(logPath, 'utf8');
      const lines = logContent.split('\n').filter(Boolean);
      const events: any[] = [];
        for (const line of lines) {
          try {
            events.push(JSON.parse(line));
          } catch {
            console.error(`Skipping malformed log line: ${line}`);
          }
      }
      const lastEvent = events[events.length - 1];
      
      return {
        content: [{ 
          type: "text",
          text: JSON.stringify({
            sessionId,
            projectId,
            status: lastEvent.level === 'error' ? 'failed' : 
                    lastEvent.message?.includes('solution found') ? 'completed' : 'in_progress',            
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

server.tool(
  "cancel",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    // Sanitize sessionId for shell
    const sanitizedId = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
    
    const { stdout } = await execPromise(`pgrep -f ${sanitizedId}`);
    
    const pids = stdout
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter(pid => !isNaN(pid));

    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        // Already dead is fine
      }
    }

    return {
      content: [{
        type: "text",
        text: `Terminated ${pids.length} processes for session ${sanitizedId}`
      }]
    };
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
