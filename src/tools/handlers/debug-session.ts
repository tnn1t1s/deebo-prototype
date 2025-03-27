import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { activeSessions } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, StartDebugSessionParams, ToolResponse } from "../../types/mcp.d.js";

import { startDebugSessionSchema, debugSessionResponseSchema } from '../schemas.js';
import type { z } from 'zod';

export type StartDebugSessionParams = z.infer<typeof startDebugSessionSchema>;

/**
 * Handler for the start_debug_session tool
 * Creates a new debug session and launches the mother agent to coordinate debugging
 */

/**
 * Handler for the start_debug_session tool
 * Creates a new debug session and launches the mother agent to coordinate debugging
 */
export async function handleStartDebugSession(
  { error_message, code_context, language, file_path, repo_path }: StartDebugSessionParams
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
    // Ensure DEEBO_ROOT is set properly
    if (!process.env.DEEBO_ROOT) {
      process.env.DEEBO_ROOT = process.cwd();
      sessionLogger.info('Setting DEEBO_ROOT to current directory', { 
        DEEBO_ROOT: process.env.DEEBO_ROOT 
      });
    }
    
    // Ensure reports directory exists
    const { join } = await import('path');
    const { ensureDirectory } = await import('../../util/init.js');
    const reportsDir = ensureDirectory('reports');
    sessionLogger.info('Ensured reports directory exists', { 
      reportsDir
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
    activeSessions.set(sessionId, session);
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
