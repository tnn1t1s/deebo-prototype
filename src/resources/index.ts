import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeeboMcpServer, DebugSession } from "../types/mcp.d.js";
import {
  ErrorCode,
  McpError,
  ReadResourceResult,
  Resource
} from "@modelcontextprotocol/sdk/types.js";
import { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { Logger } from "../util/logger.js";

/**
 * Manages active debugging sessions and their resources with proper notification handling
 */
import type { LoggerLike } from '../types/logger.js';

class SessionManager {
  private sessions: Map<string, DebugSession>;
  private server: McpServer;
  private logger!: LoggerLike;
  private initialized = false;

  constructor(server: McpServer) {
    this.sessions = new Map();
    this.server = server;
    // Logger will be properly initialized in initialize()
    this.logger = {
      debug: async (...args) => console.debug(...args),
      info: async (...args) => console.info(...args),
      warn: async (...args) => console.warn(...args),
      error: async (...args) => console.error(...args),
      close: async () => {}
    };
  }

  private async initLogger(): Promise<void> {
    try {
      // Start with initLogger
      const { initLogger } = await import('../util/init-logger.js');
      this.logger = initLogger;
      
      // Only switch to regular logger if system is properly initialized
      if (process.env.DEEBO_ROOT) {
        const { createLogger } = await import('../util/logger.js');
        this.logger = await createLogger('server', 'session-manager');
      }
    } catch (error) {
      console.error('Failed to initialize logger', error);
      // Keep using console as fallback
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      await this.logger.debug('Session manager already initialized');
      return;
    }

    try {
      // Initialize logger first
      await this.initLogger();
      
      // Get path resolver instance
      const { PathResolver } = await import('../util/path-resolver.js');
      const pathResolver = await PathResolver.getInstance();
      if (!pathResolver.isInitialized()) {
        await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
      }
      
      // Validate root directory is set correctly
      const rootDir = pathResolver.getRootDir();
      if (!rootDir || rootDir === '/') {
        throw new Error('Invalid root directory configuration');
      }
      
      // Ensure session directory exists
      const sessionDir = await pathResolver.ensureDirectory('sessions');
      await this.logger.info('Session directory ensured', { path: sessionDir });
      
      this.initialized = true;
      await this.logger.info('Session manager initialized successfully');
    } catch (error: unknown) {
      await this.logger.error('Failed to initialize session manager', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async set(sessionId: string, session: DebugSession): Promise<void> {
    this.sessions.set(sessionId, session);
    await this.notifyResourceChange();
  }

  async delete(sessionId: string): Promise<boolean> {
    const result = this.sessions.delete(sessionId);
    if (result) {
      await this.notifyResourceChange();
    }
    return result;
  }

  get(sessionId: string): DebugSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  private async notifyResourceChange(): Promise<void> {
    try {
      // Use the standard MCP notification method
      this.server.server.notification({
        method: "resources/list_changed",
        params: {}
      });
    } catch (error) {
      await this.logger?.error('Failed to notify resource change', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}

export let sessionManager: SessionManager;

/**
 * Initialize all resource capabilities for the MCP server
 */
export async function initializeResources(server: DeeboMcpServer): Promise<void> {
  // Start with initLogger
  const { initLogger } = await import("../util/init-logger.js");
  let logger: LoggerLike = initLogger;
  
  try {
    // Initialize and validate path resolver
    const { PathResolver } = await import('../util/path-resolver.js');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }

    // Now safe to use regular logger
    const { createLogger } = await import("../util/logger.js");
    logger = await createLogger('server', 'resources');
    
    await logger.info('Initializing resource handlers');

    // Initialize session manager with proper setup
    sessionManager = new SessionManager(server);
    await sessionManager.initialize();
    
    await logger.info('Session manager initialized successfully');

    // System status resource
    server.resource(
      "System Status",
      "deebo://system/status",
      {
        description: "Current status of the Deebo debugging system",
        mimeType: "application/json"
      },
      async (uri: URL): Promise<ReadResourceResult> => {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              status: "online",
              version: "0.1.0",
              activeSessions: sessionManager.getSessionIds(),
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    );

    // Session resources template
    const sessionTemplate = new ResourceTemplate(
      "deebo://sessions/{sessionId}/{resourceType}",
      { list: undefined }
    );

    // Dynamic session resources
    server.resource(
      "Session Resources",
      sessionTemplate,
      {
        description: "Access debug session status and logs",
        mimeType: "application/json"
      },
      async (uri: URL, variables: Variables): Promise<ReadResourceResult> => {
        if (!variables.sessionId || typeof variables.sessionId !== 'string') {
          throw new McpError(ErrorCode.InvalidRequest, "Session ID is required");
        }

        if (!variables.resourceType || typeof variables.resourceType !== 'string' || 
            !['status', 'logs'].includes(variables.resourceType)) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Invalid resource type: ${variables.resourceType}. Must be 'status' or 'logs'`
          );
        }

        const session = sessionManager.get(variables.sessionId);
        if (!session) {
          throw new McpError(ErrorCode.InvalidRequest, `Session not found: ${variables.sessionId}`);
        }

        switch (variables.resourceType) {
          case 'status':
            return {
              contents: [{
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  id: session.id,
                  status: session.status,
                  startTime: new Date(session.startTime).toISOString(),
                  lastChecked: new Date(session.lastChecked).toISOString(),
                  scenarioCount: session.scenarioResults.length,
                  error: session.error || null
                }, null, 2)
              }]
            };

          case 'logs':
            return {
              contents: [{
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({
                  id: session.id,
                  logs: session.logs,
                  timestamp: new Date().toISOString()
                }, null, 2)
              }]
            };

          default:
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Unsupported resource type: ${variables.resourceType}`
            );
        }
      }
    );

    // Debug scenario resources template
    const scenarioTemplate = new ResourceTemplate(
      "deebo://sessions/{sessionId}/scenarios/{scenarioId}",
      { list: undefined }
    );
    
    // Scenario resources
    server.resource(
      "Scenario Resources",
      scenarioTemplate,
      {
        description: "Access debug scenario details and results",
        mimeType: "application/json"
      },
      async (uri: URL, variables: Variables): Promise<ReadResourceResult> => {
        if (!variables.sessionId || typeof variables.sessionId !== 'string') {
          throw new McpError(ErrorCode.InvalidRequest, "Session ID is required");
        }

        if (!variables.scenarioId || typeof variables.scenarioId !== 'string') {
          throw new McpError(ErrorCode.InvalidRequest, "Scenario ID is required");
        }

        const session = sessionManager.get(variables.sessionId);
        if (!session) {
          throw new McpError(ErrorCode.InvalidRequest, `Session not found: ${variables.sessionId}`);
        }

        const scenario = session.scenarioResults.find(s => s.id === variables.scenarioId);
        if (!scenario) {
          throw new McpError(ErrorCode.InvalidRequest, `Scenario not found: ${variables.scenarioId}`);
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              id: scenario.id,
              hypothesis: scenario.hypothesis,
              steps: scenario.steps,
              result: scenario.result,
              confidence: scenario.confidence,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    );

    await logger.info('Resource handlers initialized');
  } catch (error: unknown) {
    await logger.error('Failed to initialize resources', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
}
