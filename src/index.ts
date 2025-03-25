import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { initMcpClients } from './util/mcp.js';
import { startMotherAgent } from './agents/mother.js';
import { DebugSession, OriginalDebugSession, ScenarioResult } from './types.js';

// Session storage - using Map for backward compatibility
const sessions = new Map<string, OriginalDebugSession>();

// Enhanced sessions storage for advanced debugging
const enhancedSessions = new Map<string, DebugSession>();

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
  "Start a debugging session with an error and optional repository path",
  {
    error_message: z.string().describe("Error message from the code to debug"),
    code_context: z.string().optional().describe("Code surrounding the error"),
    language: z.string().optional().describe("Programming language"),
    file_path: z.string().optional().describe("Path to the file with error"),
    repo_path: z.string().optional().describe("Path to Git repository (recommended)")
  },
  async ({ error_message, code_context, language, file_path, repo_path }) => {
    const sessionId = uuidv4();
    
    try {
      // Initialize MCP clients if not already done
      await initMcpClients();
      
      // Create the enhanced debug session with actual system events
      const enhancedSession: DebugSession = {
        id: sessionId,
        status: "initializing",
        logs: [
          "Deebo debugging session initialized",
          `Received error: ${error_message}`,
          `Language: ${language || "Not specified"}`,
          repo_path ? `Repository path: ${repo_path}` : "No repository path provided",
          file_path ? `File path: ${file_path}` : "No file path provided",
        ],
        startTime: Date.now(),
        lastChecked: Date.now(),
        request: {
          error: error_message,
          context: code_context || "",
          codebase: {
            repoPath: repo_path || (file_path ? file_path.substring(0, file_path.lastIndexOf('/')) : ""),
            filePath: file_path,
          }
        },
        scenarioResults: []
      };
      
      // Add explanation of the debugging process
      enhancedSession.logs.push(
        "Deebo will analyze your error through the following process:",
        "1. Mother agent will analyze the error and codebase to identify potential causes",
        "2. Scenario agents will be created to test different hypotheses in isolation",
        "3. Each scenario agent will create its own Git branch for investigation",
        "4. Results from all scenario agents will be collected and evaluated",
        "5. The mother agent will select the best fix and verify it works",
        "6. A final recommendation will be provided with implementation details"
      );
      
      enhancedSessions.set(sessionId, enhancedSession);
      
      // Update session status to running
      enhancedSession.status = "running";
      enhancedSession.logs.push("Starting mother agent for error analysis...");
      
      // Start the advanced mother agent debugging in the background
      startMotherAgent(enhancedSession).catch(error => {
        console.error("Error in mother agent:", error);
        enhancedSession.logs.push(`Error in mother agent: ${error}`);
        enhancedSession.status = "error";
        enhancedSession.error = `${error}`;
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              session_id: sessionId,
              message: "Debug session started successfully. The Deebo debugging system will analyze your error using specialized scenario agents working in isolated Git branches.",
            }),
          },
        ],
      };
    } catch (error) {
      console.error("Error starting debug session:", error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Failed to start debug session: ${error}`,
            }),
          },
        ],
      };
    }
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
    const enhancedSession = enhancedSessions.get(session_id);
    
    if (!session && !enhancedSession) {
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
    
    // Update last checked timestamp
    if (session) {
      session.lastChecked = Date.now();
    }
    
    if (enhancedSession) {
      enhancedSession.lastChecked = Date.now();
      
      // Prioritize enhanced session if available
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              session_id: enhancedSession.id,
              status: mapEnhancedSessionStatus(enhancedSession.status),
              logs: enhancedSession.logs,
              result: enhancedSession.finalResult 
                ? convertToLegacyResult(enhancedSession.finalResult, enhancedSession) 
                : null,
            }),
          },
        ],
      };
    }
    
    // Fall back to traditional session
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session_id: session!.id,
            status: session!.status,
            logs: session!.logs,
            result: session!.result,
          }),
        },
      ],
    };
  }
);

// Tool 3: List Debugging Scenarios
server.tool(
  "list_scenarios",
  "Get a list of available debugging scenario types",
  {},
  async () => {
    const scenarios = [
      {
        type: "dependency",
        description: "Investigates dependency-related issues like missing or incompatible packages"
      },
      {
        type: "syntax",
        description: "Examines syntax errors, type errors, and other code correctness issues"
      },
      {
        type: "environment",
        description: "Checks environment configuration, settings, and deployment issues"
      },
      {
        type: "cache",
        description: "Analyzes caching problems, stale data, and cache invalidation issues"
      },
      {
        type: "async",
        description: "Investigates race conditions, timing issues, and async operation bugs"
      },
      {
        type: "api",
        description: "Examines API integration, request/response handling, and data formatting"
      },
      {
        type: "performance",
        description: "Analyzes performance bottlenecks, memory leaks, and optimization opportunities"
      },
      {
        type: "runtime",
        description: "Investigates runtime exceptions and unexpected behavior during execution"
      }
    ];
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scenarios: scenarios
          }),
        },
      ],
    };
  }
);

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  
  // Clean up enhanced sessions
  for (const [id, session] of enhancedSessions.entries()) {
    if (now - session.lastChecked > 30 * 60 * 1000) {
      enhancedSessions.delete(id);
      console.error(`Session ${id} deleted due to inactivity`);
    }
  }
}, 5 * 60 * 1000);

/**
 * Map enhanced session status to legacy status
 */
function mapEnhancedSessionStatus(status: string): "running" | "complete" | "error" {
  switch (status) {
    case "initializing":
    case "running":
      return "running";
    case "complete":
      return "complete";
    case "error":
      return "error";
    default:
      return "running";
  }
}

/**
 * Convert enhanced session result to legacy format
 */
function convertToLegacyResult(result: any, session: DebugSession): any {
  return {
    fix: result.fixDescription,
    confidence: result.confidence,
    changes_required: result.changesRequired.map((change: any) => ({
      type: `${change.type}_update`,
      description: change.description,
      priority: change.priority
    })),
    affected_files: session.request.codebase?.filePath ? [session.request.codebase.filePath] : [],
    estimated_time_to_fix: result.estimatedTimeToFix,
    scenario_results: session.scenarioResults.map((scenario: ScenarioResult) => ({
      type: scenario.scenarioType,
      hypothesis: scenario.hypothesis,
      success: scenario.success,
      confidence: scenario.confidence
    }))
  };
}

// Start server
async function main() {
  try {
    // Check environment variables
    console.error("Environment check:");
    console.error("- Current working directory:", process.cwd());
    console.error("- ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY);
    console.error("- NODE_ENV:", process.env.NODE_ENV);
    
    // Environment is already loaded by -r dotenv/config in npm start
    console.error("- ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY);
    
    // Initialize MCP clients
    await initMcpClients();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Deebo prototype MCP Server running on stdio");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});