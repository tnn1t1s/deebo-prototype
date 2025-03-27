import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeeboMcpServer, DebugSession } from "../types/mcp.d.js";
import {
  ErrorCode,
  McpError,
  ReadResourceResult,
  Resource,
  LogLevel
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Manages active debugging sessions and their resources with proper notification handling
 */
class SessionManager {
  private sessions: Map<string, DebugSession>;
  private server: McpServer;
  private logger: any;

  constructor(server: McpServer) {
    this.sessions = new Map();
    this.server = server;
    this.initializeLogger();
  }

  private async initializeLogger() {
    const { createLogger } = await import("../util/logger.js");
    this.logger = createLogger('server', 'session-manager');
  }

  set(sessionId: string, session: DebugSession): void {
    this.sessions.set(sessionId, session);
    this.notifyResourceChange();
  }

  delete(sessionId: string): boolean {
    const result = this.sessions.delete(sessionId);
    if (result) {
      this.notifyResourceChange();
    }
    return result;
  }

  get(sessionId: string): DebugSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  private notifyResourceChange(): void {
    try {
      // Use the standard MCP notification method
      this.server.sendNotification({
        method: "notifications/resources/list_changed",
        params: {}
      });
    } catch (error) {
      this.logger?.error('Failed to notify resource change', { error });
    }
  }
}

export let sessionManager: SessionManager;

/**
 * Initialize all resource capabilities for the MCP server
 */
export async function initializeResources(server: DeeboMcpServer): Promise<void> {
  const { createLogger } = await import("../util/logger.js");
  const logger = createLogger('server', 'resources');
  
  logger.info('Initializing resource handlers');

  // Initialize session manager
  sessionManager = new SessionManager(server);

  // System status resource
  server.resource({
    name: "System Status",
    description: "Current status of the Deebo debugging system",
    uri: "deebo://system/status",
    mimeType: "application/json",
    read: async (uri: URL): Promise<ReadResourceResult> => {
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
  });

  // Session resources template
  const sessionTemplate = new ResourceTemplate("deebo://sessions/{sessionId}/{resourceType}");

  // Dynamic session resources
  server.resource({
    name: "Session Resources",
    description: "Access debug session status and logs",
    template: sessionTemplate,
    mimeType: "application/json",
    read: async (uri: URL, params: { sessionId: string; resourceType: string }): Promise<ReadResourceResult> => {
      const { sessionId, resourceType } = params;

      if (!sessionId) {
        throw new McpError(ErrorCode.InvalidRequest, "Session ID is required");
      }

      if (!['status', 'logs'].includes(resourceType)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid resource type: ${resourceType}. Must be 'status' or 'logs'`
        );
      }

      const session = sessionManager.get(sessionId);
      if (!session) {
        throw new McpError(ErrorCode.InvalidRequest, `Session not found: ${sessionId}`);
      }

      switch (resourceType) {
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
            `Unsupported resource type: ${resourceType}`
          );
      }
    }
  });

  // Debug scenario resources template
  const scenarioTemplate = new ResourceTemplate("deebo://sessions/{sessionId}/scenarios/{scenarioId}");
  
  // Scenario resources
  server.resource({
    name: "Scenario Resources",
    description: "Access debug scenario details and results",
    template: scenarioTemplate,
    mimeType: "application/json",
    read: async (uri: URL, params: { sessionId: string; scenarioId: string }): Promise<ReadResourceResult> => {
      const { sessionId, scenarioId } = params;

      const session = sessionManager.get(sessionId);
      if (!session) {
        throw new McpError(ErrorCode.InvalidRequest, `Session not found: ${sessionId}`);
      }

      const scenario = session.scenarioResults.find(s => s.id === scenarioId);
      if (!scenario) {
        throw new McpError(ErrorCode.InvalidRequest, `Scenario not found: ${scenarioId}`);
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
  });

  logger.info('Resource handlers initialized');
}