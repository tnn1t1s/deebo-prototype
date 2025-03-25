import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";

// Session storage
interface DebugSession {
  id: string;
  process: ChildProcess;
  logs: string[];
  status: "running" | "complete" | "error";
  result: any | null;
  lastChecked: number;
}

const sessions = new Map<string, DebugSession>();

// Create MCP server
const server = new McpServer({
  name: "deebo-prototype",
  version: "0.1.0",
  capabilities: {
    tools: {},
  },
});

// Tool 1: Start Debug Session
server.tool(
  "start_debug_session",
  "Start a simulated debugging session",
  {
    error_message: z.string().describe("Error message from the code to debug"),
    code_context: z.string().optional().describe("Code surrounding the error"),
    language: z.string().optional().describe("Programming language"),
    file_path: z.string().optional().describe("Path to the file with error"),
  },
  async ({ error_message, code_context, language, file_path }) => {
    const sessionId = uuidv4();
    
    // Construct a more detailed debugging script based on available info
    const langInfo = language ? `in ${language}` : '';
    const fileInfo = file_path ? `in ${file_path}` : '';
    const contextInfo = code_context ? `with surrounding context` : 'without context';
    
    const process = spawn("bash", ["-c", `
      echo "Debug log 1: Starting analysis of error ${langInfo} ${fileInfo}"
      sleep 2
      echo "Debug log 2: Examining error: ${error_message}"
      sleep 2
      echo "Debug log 3: Loading code context ${contextInfo}"
      sleep 2
      ${code_context ? `echo "Debug log 4: Examining code fragment: ${code_context.substring(0, 50)}..."` : 'echo "Debug log 4: No code context provided, proceeding with error analysis only"'}
      sleep 2
      echo "Debug log 5: Running static analysis tools"
      sleep 2
      echo "Debug log 6: Checking for common patterns matching this error"
      sleep 2
      echo "Debug log 7: Analyzing dependency versions"
      sleep 2
      echo "Debug log 8: Testing potential fixes"
      sleep 2
      echo "Debug log 9: Verifying solution"
      sleep 2
      echo "Debug log 10: Finalizing debug report"
      sleep 2
      echo "COMPLETE: Fixed issue '${error_message}' by updating dependencies and correcting syntax ${langInfo}"
    `]);
    
    const session: DebugSession = {
      id: sessionId,
      process,
      logs: [],
      status: "running",
      result: null,
      lastChecked: Date.now(),
    };
    
    process.stdout.on("data", (data) => {
      const text = data.toString().trim();
      if (text.startsWith("COMPLETE:")) {
        session.status = "complete";
        const fixText = text.substring("COMPLETE: ".length);
        session.result = {
          fix: fixText,
          confidence: 0.95,
          changes_required: [
            {
              type: "dependency_update",
              description: "Update package versions",
              priority: "high"
            },
            {
              type: "code_fix",
              description: "Fix syntax in affected files",
              priority: "medium"
            }
          ],
          affected_files: file_path ? [file_path] : [],
          estimated_time_to_fix: "5 minutes"
        };
      } else {
        session.logs.push(text);
      }
    });
    
    process.on("error", (err) => {
      session.status = "error";
      session.logs.push(`Error: ${err.message}`);
    });
    
    process.on("exit", (code) => {
      if (code !== 0 && session.status !== "complete") {
        session.status = "error";
        session.logs.push(`Process exited with code ${code}`);
      }
    });
    
    sessions.set(sessionId, session);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session_id: sessionId,
            message: "Debug session started successfully",
          }),
        },
      ],
    };
  }
);

// Tool 2: Check Debug Status
server.tool(
  "check_debug_status",
  "Check the status of a debugging session",
  {
    session_id: z.string().describe("Session ID to check"),
  },
  async ({ session_id }) => {
    const session = sessions.get(session_id);
    
    if (!session) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Session not found",
            }),
          },
        ],
      };
    }
    
    session.lastChecked = Date.now();
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session_id: session.id,
            status: session.status,
            logs: session.logs,
            result: session.result,
          }),
        },
      ],
    };
  }
);

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastChecked > 30 * 60 * 1000) {
      if (session.process.connected) {
        session.process.kill();
      }
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Deebo prototype MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
