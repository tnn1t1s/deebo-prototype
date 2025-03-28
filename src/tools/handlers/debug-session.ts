import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { 
  ErrorCode, 
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { createLogEntry } from "../../util/log-validator.js";
import { sessionManager } from "../../resources/index.js";
import { agentCoordinator } from "../../agents/coordinator.js";
import { getLogger } from "../logger.js";
import type { DeeboMcpServer, ToolResponse, DebugSession } from "../../types/mcp.d.js";
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
  logger.info('Debug session request received', { 
    error_short: error_message.substring(0, 100),
    language,
    hasFilePath: !!file_path,
    hasRepoPath: !!repo_path,
    hasContext: !!code_context
  });
  
  const sessionId = uuidv4();
  const { createLogger } = await import("../../util/logger.js");
  const sessionLogger = await createLogger(sessionId, 'mcp-session');
  
  await sessionLogger.info('Starting new debug session', {
    error: error_message.substring(0, 100), // Truncate long errors
    language,
    file_path,
    repo_path
  });
  
  try {
    // Initialize directories using PathResolver
    const { PathResolver } = await import('../../util/path-resolver.js');
    await sessionLogger.info('Initializing PathResolver');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    
    // Validate environment setup
    await sessionLogger.info('Validating environment setup');
    const deeboRoot = process.env.DEEBO_ROOT;
    
    if (!deeboRoot) {
      throw new Error('DEEBO_ROOT environment variable not set');
    }
    
    await sessionLogger.info('Environment validated', {
      DEEBO_ROOT: deeboRoot
    });
    
    // Ensure required directories exist
    await sessionLogger.info('Creating required directories');
    await pathResolver.ensureDirectory('reports');
    await pathResolver.ensureDirectory(`sessions/${sessionId}/logs`);
    await pathResolver.ensureDirectory(`sessions/${sessionId}/workspace`);
    await sessionLogger.info('Directories created successfully');
    
    // Validate repository path if provided
    if (repo_path) {
      await sessionLogger.info('Validating repository path', { repo_path });
      const isValidDir = await pathResolver.validateDirectory(repo_path);
      if (!isValidDir) {
        throw new Error(`Invalid repository path: ${repo_path}`);
      }
      await sessionLogger.info('Repository path validated');
    }
    
    // Create session with structured logging
    const session: DebugSession = {
      id: sessionId,
      status: "running",
      startTime: Date.now(),
      lastChecked: Date.now(),
      logs: [
        createLogEntry('session_start', 'Debug session started', {
          sessionId,
          config: {
            language: language || "Not specified",
            filePath: file_path || "Not provided",
            repoPath: repo_path || "Not provided",
            contextSize: code_context?.length || 0
          },
          error: error_message
        })
      ],
      scenarioResults: [],
      request: {
        error: error_message,
        context: code_context,
        codebase: repo_path ? {
          repoPath: repo_path,
          filePath: file_path
        } : undefined
      }
    };

    // Add to active sessions for resource access
    sessionManager.set(sessionId, session);
    await sessionLogger.debug('Session object created', { 
      sessionId,
      status: session.status,
      startTime: new Date(session.startTime).toISOString()
    });

    // Initialize MCP clients
    await sessionLogger.info('Initializing MCP clients');
    const { initMcpClients } = await import('../../util/mcp.js');
    await initMcpClients().catch(error => {
      throw new Error(`Failed to initialize MCP clients: ${error}`);
    });
    await sessionLogger.info('MCP clients initialized successfully');

    // Start debug session with agent coordinator
    await agentCoordinator.startSession({
      sessionId,
      error: error_message,
      context: code_context,
      language,
      filePath: file_path,
      repoPath: repo_path
    });

    await sessionLogger.info('Debug session started successfully', {
      sessionId,
      startTime: new Date().toISOString(),
      config: {
        language,
        filePath: file_path || 'not provided',
        repoPath: repo_path || 'not provided',
        contextSize: code_context?.length || 0
      }
    });
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorContext = {
      sessionId,
      language,
      hasFilePath: !!file_path,
      hasRepoPath: !!repo_path,
      environmentState: {
        DEEBO_ROOT: process.env.DEEBO_ROOT || 'not set',
        PYTHONPATH: process.env.PYTHONPATH ? 'set' : 'not set',
        PATH: process.env.PATH ? 'set' : 'not set'
      }
    };

    // Log detailed error information
    await sessionLogger.error('Failed to start debug session', { 
      error: errorMessage,
      ...errorContext,
      stack: error instanceof Error ? error.stack : undefined
    });

    try {
      // Clean up session gracefully
      await sessionLogger.info('Cleaning up session resources');
      await agentCoordinator.cleanupSession(sessionId);
      
      await sessionLogger.info('Session cleanup completed');
    } catch (cleanupError) {
      await sessionLogger.error('Failed to clean up session resources', {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      });
    }

    await sessionLogger.close();
    
    // Determine appropriate error code
    let errorCode = ErrorCode.InternalError;
    if (errorMessage.includes('DEEBO_ROOT')) {
      errorCode = ErrorCode.InvalidParams;
    } else if (errorMessage.includes('repository path')) {
      errorCode = ErrorCode.InvalidRequest;
    }

    // Construct detailed error response
    const errorResponse = debugSessionResponseSchema.parse({
      session_id: sessionId,
      status: "error",
      message: `Failed to start debug session: ${errorMessage}`,
      result: {
        error: {
          code: errorCode,
          message: errorMessage,
          context: errorContext
        }
      },
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
