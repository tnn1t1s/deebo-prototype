import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ProtocolErrorCodes } from "../protocol/index.js";
import { activeSessions } from "../resources/index.js";
import { runMotherAgent } from "../mother-agent.js";
import { isInitialized } from "./index.js";

// Lazy initialize logger when needed
let logger: any; // Type will be set when logger is created
async function getLogger() {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'agent-coordinator');
  }
  return logger;
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
}

/**
 * Agent coordinator class
 * Handles communication between agents and MCP server
 */
export class AgentCoordinator {
  private agents: Map<string, AgentState> = new Map();

  /**
   * Start a new debugging session
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
    log.info('Starting new debug session', { sessionId });

    try {
      // Create mother agent state
      const motherAgent: AgentState = {
        id: `mother-${sessionId}`,
        type: 'mother',
        status: 'initializing',
        startTime: Date.now(),
        lastUpdate: Date.now()
      };
      
      this.agents.set(motherAgent.id, motherAgent);
      log.debug('Created mother agent state', { agent: motherAgent });

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
        const session = activeSessions.get(sessionId);
        if (session) {
          session.status = 'complete';
          session.finalResult = result;
          session.logs.push('Debug session completed successfully');
        }
        
        const log = await getLogger();
        log.info('Mother agent completed successfully', { 
          sessionId,
          result 
        });
      }).catch(async error => {
        motherAgent.status = 'error';
        motherAgent.error = error instanceof Error ? error.message : String(error);
        motherAgent.lastUpdate = Date.now();
        
        // Update session
        const session = activeSessions.get(sessionId);
        if (session) {
          session.status = 'error';
          session.error = motherAgent.error;
          session.logs.push(`Error: ${motherAgent.error}`);
        }
        
        const log = await getLogger();
        log.error('Mother agent failed', { 
          sessionId,
          error: motherAgent.error 
        });
      });

    } catch (error) {
      const log = await getLogger();
      log.error('Failed to start debug session', {
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
  }): Promise<void> {
    const { sessionId, scenarioId, hypothesis } = params;
    const log = await getLogger();
    
    const agentId = `scenario-${scenarioId}`;
    log.info('Registering scenario agent', { 
      sessionId, 
      scenarioId,
      hypothesis 
    });

    const agent: AgentState = {
      id: agentId,
      type: 'scenario',
      status: 'initializing',
      startTime: Date.now(),
      lastUpdate: Date.now()
    };

    this.agents.set(agentId, agent);
    log.debug('Created scenario agent state', { agent });
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
    log.debug('Updated agent state', { agentId, update });
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
    log.info('Cleaning up session agents', { sessionId });
    
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.id.includes(sessionId)) {
        this.agents.delete(agentId);
        log.debug('Removed agent', { agentId });
      }
    }
  }
}

// Export singleton instance
export const agentCoordinator = new AgentCoordinator();
