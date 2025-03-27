import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { sessionManager } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, ToolResponse } from "../../types/mcp.d.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { startDebugSessionSchema, debugSessionResponseSchema } from '../schemas.js';

export type StartDebugSessionParams = z.infer<typeof startDebugSessionSchema>;

/**
 * Handler for the start_debug_session tool
 * Creates a new debug session and launches the mother agent to coordinate debugging
 */
export async function handleStartDebugSession(
  { error_message, code_context, language, file_path, repo_path }: StartDebugSessionParams,
  extra: RequestHandlerExtra
): Promise<ToolResponse> {
  const logger = await getLogger();
  logger.info(`Executing start_debug_session tool`, { error_message });
  
  const sessionId = uuidv4();
  const { createLogger } = await import("../../util/logger.js");
  const sessionLogger = createLogger(sessionId, 'mcp-session');
  
  sessionLogger.info('Starting new debug session', {
    error: error_message.substring(0, 100), // Truncate long errors
    language,
    file_path,
    repo_path
  });
  
  try {
    // Use PathResolver for safe directory handling
    const { getPathResolver } = await import('../../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Validate root directory
    const rootDir = pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }
    
    // Ensure required directories exist with validation
    const reportsDir = await pathResolver.ensureDirectory('reports');
    if (!(await pathResolver.validateDirectory(reportsDir))) {
      throw new Error('Failed to create and validate reports directory');
    }
    
    // Log successful initialization
    sessionLogger.info('Session directories initialized', {
      reportsDir,
      rootDir
    });
  
    // Create session
    const session = {
      id: sessionId,
      status: "running",
      logs: [
        "Deebo debugging session initialized",
        `Received error: ${error_message}`,
        `Language: ${language || "Not specified"}`,
        repo_path ? `Repository path: ${repo_path}` : "No repository path provided",
        file_path ? `File path: ${file_path}` : "No file path provided",
        `DEEBO_ROOT set to: ${process.env.DEEBO_ROOT}`,
        `Reports directory initialized at: ${reportsDir}`,
        "Deebo will analyze your error through the following process:",
        "1. Mother agent will analyze the error and codebase to identify potential causes",
        "2. Scenario agents will be created to test different hypotheses in isolation", 
        "3. Each scenario agent will create its own Git branch for investigation",
        "4. Results from all scenario agents will be collected and evaluated",
        "5. The mother agent will select the best fix and verify it works",
        "6. A final recommendation will be provided with implementation details"
      ],
      startTime: Date.now(),
      lastChecked: Date.now(),
      scenarioResults: [],
      request: {
        error: error_message,
        context: code_context,
        codebase: repo_path ? { repoPath: repo_path, filePath: file_path } : undefined
      }
    };

    // Add to active sessions for resource access
    sessionManager.set(sessionId, session);
    sessionLogger.debug('Session object created', { session });

    // Start debug session with agent coordinator
    await agentCoordinator.startSession({
      sessionId,
      error: error_message,
      context: code_context,
      language,
      filePath: file_path,
      repoPath: repo_path
    });

    sessionLogger.info('Debug session started successfully');
    const response = debugSessionResponseSchema.parse({
      session_id: sessionId,
      status: "running",
      message: "Debug session started successfully",
      result: null,
      timestamp: new Date().toISOString()
    });
    
    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(response)
      }]
    };
  } catch (error: any) {
    sessionLogger.error('Failed to start debug session', { error: error.message });
    sessionLogger.close();
    
    // Construct error response
    const errorResponse = debugSessionResponseSchema.parse({
      session_id: sessionId,
      status: "error",
      message: `Failed to start debug session: ${error.message}`,
      result: null,
      timestamp: new Date().toISOString()
    });

    return {
      content: [{ 
        type: "text" as const,
        text: JSON.stringify(errorResponse)
      }],
      isError: true
    };
  }
}
