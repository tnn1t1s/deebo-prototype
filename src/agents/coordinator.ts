import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ProtocolErrorCodes } from "../protocol/index.js";
import { sessionManager } from "../resources/index.js";
import { createLogEntry } from "../util/log-validator.js";
import { runMotherAgent } from "../mother-agent.js";
import { isInitialized } from "./index.js";
import type { DebugSession } from "../types/mcp.d.js";

import type { LoggerLike } from '../types/logger.js';

// Safe logger initialization
let logger: LoggerLike;

async function getLogger(): Promise<LoggerLike> {
  if (logger) return logger;
  
  // Start with initLogger
  const { initLogger } = await import("../util/init-logger.js");
  
  try {
    if (!process.env.DEEBO_ROOT) {
      await initLogger.info('DEEBO_ROOT not set, initializing directories');
      const { initializeDirectories } = await import('../util/init.js');
      await initializeDirectories();
    }
    
    if (!isInitialized) {
      await initLogger.info('System not initialized, using initLogger');
      return initLogger;
    }
    
    // Now safe to create regular logger
    const { createLogger } = await import("../util/logger.js");
    logger = await createLogger('server', 'agent-coordinator');
    return logger;
  } catch (error) {
    await initLogger.error('Logger initialization failed, using initLogger', { error });
    return initLogger;
  }
}

/**
 * Agent state interface
 */
export interface AgentState {
  id: string;
  type: 'mother' | 'scenario';
  status: 'initializing' | 'running' | 'complete' | 'error';
  startTime: number;
  lastUpdate: number;
  error?: string;
  progress?: number;
  result?: any;
  metadata?: {
    parentAgent?: string;
    hypothesis?: string;
  };
}

/**
 * Agent coordinator class
 * Handles communication between agents and MCP server
 */
export class AgentCoordinator {
  private agents: Map<string, AgentState> = new Map();

  /**
   * Start a new debugging session with enhanced race condition handling
   */
  async startSession(params: {
    sessionId: string;
    error: string;
    context?: string;
    language?: string;
    filePath?: string;
    repoPath?: string;

  }): Promise<void> {
    const { sessionId, error, context, language, filePath, repoPath } = params;
    const log = await getLogger();
    await log.info('Starting new debug session', { 
      sessionId,
      hasFilePath: !!filePath,
      hasRepoPath: !!repoPath
    });

    try {
      // Log warnings for missing paths
      if (!repoPath) {
        await log.warn('No repository path provided, some features will be limited');
      }
      if (!filePath) {
        await log.warn('No file path provided, some features will be limited');
      }

      // Create mother agent state
      const motherAgent: AgentState = {
        id: `mother-${sessionId}`,
        type: 'mother',
        status: 'initializing',
        startTime: Date.now(),
        lastUpdate: Date.now()
      };
      
      this.agents.set(motherAgent.id, motherAgent);
      await log.debug('Created mother agent state', { agent: motherAgent });

      // Start mother agent
      runMotherAgent(
        sessionId,
        error,
        context || '',
        language || 'typescript',
        filePath || '',
        repoPath || ''
      ).then(async result => {
        motherAgent.status = 'complete';
        motherAgent.result = result;
        motherAgent.lastUpdate = Date.now();
        
        // Update session
        const session = sessionManager.get(sessionId);
        if (session) {
          const updatedSession: DebugSession = {
            ...session,
            status: 'complete',
            finalResult: result,
            logs: [...session.logs, createLogEntry('session_complete', 'Debug session completed successfully', { result })]
          };
          sessionManager.set(sessionId, updatedSession);
        }
        
        const log = await getLogger();
        await log.info('Mother agent completed successfully', { 
          sessionId,
          result 
        });
      }).catch(async error => {
        motherAgent.status = 'error';
        motherAgent.error = error instanceof Error ? error.message : String(error);
        motherAgent.lastUpdate = Date.now();
        
        // Update session
        const session = sessionManager.get(sessionId);
        if (session) {
          const updatedSession: DebugSession = {
            ...session,
            status: 'error',
            error: motherAgent.error,
            logs: [...session.logs, createLogEntry('session_error', 'Debug session failed', { error: motherAgent.error })]
          };
          sessionManager.set(sessionId, updatedSession);
        }
        
        const log = await getLogger();
        await log.error('Mother agent failed', { 
          sessionId,
          error: motherAgent.error 
        });
      });

    } catch (error) {
      const log = await getLogger();
      await log.error('Failed to start debug session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new McpError(
        ProtocolErrorCodes.AgentError,
        `Failed to start debug session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Register a new scenario agent
   */
  async registerScenarioAgent(params: {
    sessionId: string;
    scenarioId: string;
    hypothesis: string;
    debugType?: 'race-condition' | 'general';
  }): Promise<void> {
    const { sessionId, scenarioId, hypothesis, debugType } = params;
    const log = await getLogger();
    
    const agentId = `scenario-${scenarioId}`;
    await log.info('Registering scenario agent', { 
      sessionId, 
      scenarioId,
      hypothesis,
      debugType 
    });

    const agent: AgentState = {
      id: agentId,
      type: 'scenario',
      status: 'initializing',
      startTime: Date.now(),
      lastUpdate: Date.now(),
      metadata: {
        hypothesis
      }
    };

    this.agents.set(agentId, agent);
    await log.debug('Created scenario agent state', { agent });

    // Let Claude decide validation strategy through mother agent
    await log.debug('Created scenario agent state', { agent });
  }

  /**
   * Update agent state
   */
  async updateAgentState(agentId: string, update: Partial<AgentState>): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new McpError(
        ProtocolErrorCodes.AgentError,
        `Agent not found: ${agentId}`
      );
    }

    Object.assign(agent, update, { lastUpdate: Date.now() });
    const log = await getLogger();
    await log.debug('Updated agent state', { agentId, update });
  }

  /**
   * Get agent state
   */
  getAgentState(agentId: string): AgentState {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new McpError(
        ProtocolErrorCodes.AgentError,
        `Agent not found: ${agentId}`
      );
    }
    return agent;
  }

  /**
   * Get all agents for a session
   */
  getSessionAgents(sessionId: string): AgentState[] {
    return Array.from(this.agents.values())
      .filter(agent => agent.id.includes(sessionId));
  }

  /**
   * Clean up agents for a session
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const log = await getLogger();
    await log.info('Cleaning up session agents', { sessionId });
    
    // Clean up agents
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.id.includes(sessionId)) {
        this.agents.delete(agentId);
        await log.debug('Removed agent', { agentId });
      }
    }

    // Clean up tool config
    const { ToolConfigManager } = await import('../util/tool-config.js');
    const configManager = await ToolConfigManager.getInstance();
    await configManager.dispose();

    // Clean up MCP clients
    const { disposeMcpClients } = await import('../util/mcp.js');
    await disposeMcpClients();
  }
}

// Export singleton instance
export const agentCoordinator = new AgentCoordinator();
