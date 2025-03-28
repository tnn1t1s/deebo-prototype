import { v4 as uuidv4 } from 'uuid';
import { ScenarioConfig, DebugRequest } from '../types.js';
import { filesystemOperations } from '../util/mcp.js';
import AnthropicClient from '../util/anthropic.js';
import { initLogger } from '../util/init-logger.js';

import type { LoggerLike } from '../types/logger.js';

/**
 * Factory for creating autonomous scenario agents
 */
export class ScenarioAgentFactory {
  private static logger: LoggerLike;

  public static async getLogger(): Promise<LoggerLike> {
    if (!ScenarioAgentFactory.logger) {
      ScenarioAgentFactory.logger = initLogger;
    }
    return ScenarioAgentFactory.logger;
  }

  /**
   * Create a new scenario agent with Claude-generated hypothesis
   */
  static async createAgent(
    sessionId: string,
    debugRequest: DebugRequest
  ): Promise<ScenarioConfig> {
    let logger: LoggerLike = await ScenarioAgentFactory.getLogger();
    
    try {
      if (process.env.DEEBO_ROOT) {
        // Try to switch to regular logger
        const { createLogger } = await import('../util/logger.js');
        logger = await createLogger(sessionId, 'scenario-factory');
      }
    } catch (error) {
      // Keep using initLogger if createLogger fails
      await logger.error('Failed to create logger, using initLogger', { error });
    }

    const id = uuidv4();
    const branchName = `deebo-${sessionId}-${id}`;
    
    await logger.info('Creating new scenario agent', {
      sessionId,
      agentId: id,
      branchName
    });
    
    return {
      id,
      sessionId,
      scenarioType: 'autonomous',
      branchName,
      hypothesis: debugRequest.error,
      debugRequest,
      timeout: 60000,
      startTime: Date.now()
    };
  }
  
  /**
   * Run an autonomous scenario agent
   */
  static async runAutonomousAgent(config: ScenarioConfig): Promise<any> {
    let logger: LoggerLike = await ScenarioAgentFactory.getLogger();
    
    try {
      if (process.env.DEEBO_ROOT) {
        // Try to switch to regular logger
        const { createLogger } = await import('../util/logger.js');
        logger = await createLogger(config.sessionId, `scenario-${config.id}`);
      }
    } catch (error) {
      // Keep using initLogger if createLogger fails
      await logger.error('Failed to create logger, using initLogger', { error });
    }

    // Initialize agent context
    let context = config.debugRequest.context || '';
    const repoPath = config.debugRequest.codebase?.repoPath;
    
    // Create branch for this agent if we have a repo
    if (repoPath && config.branchName) {
      try {
        const { gitBranchOperations } = await import('../util/mcp.js');
        
        // Create and checkout new branch
        await gitBranchOperations.createBranch(repoPath, config.branchName);
        await gitBranchOperations.checkoutBranch(repoPath, config.branchName);
        
        await logger.info(`Created branch for investigation`, { branchName: config.branchName });
      } catch (error) {
        await logger.error(`Error creating branch`, { error, branchName: config.branchName });
      }
    }

    try {
      // Let Claude analyze and suggest next actions
      const client = await AnthropicClient.getClient();
      const response = await client.messages.create({
        system: `You are analyzing code to find bugs. Current context:

Hypothesis: ${config.hypothesis}
Error: ${config.debugRequest.error}
Language: ${config.debugRequest.codebase?.filePath?.split('.').pop() || ''}

Provide your analysis in this format:

SOLUTION_FOUND or ANALYSIS_NEEDED
confidence: [0-1]
fix: [description of fix]
explanation: [detailed explanation]`,
        messages: [{
          role: 'user',
          content: context || 'No additional context provided'
        }]
      });

      const analysis = response.content[0].text;


      // Parse response and extract results
      return {
        success: analysis.includes('SOLUTION_FOUND'),
        confidence: extractConfidence(analysis),
        fix: extractFix(analysis),
        explanation: extractExplanation(analysis)
      };
    } finally {
      // Each agent should handle its own cleanup
      await logger.info('Agent factory operation complete');
    }
  }
}

/**
 * Extract confidence score from analysis
 */
function extractConfidence(analysis: string): number {
  const match = analysis.match(/confidence:?\s*(\d+(\.\d+)?)/i);
  return match ? parseFloat(match[1]) : 0.5;
}

/**
 * Extract fix description from analysis
 */
function extractFix(analysis: string): string {
  const match = analysis.match(/fix:([^\n]+(\n[^\n]+)*)/i);
  return match ? match[1].trim() : 'No specific fix extracted';
}

/**
 * Extract explanation from analysis
 */
function extractExplanation(analysis: string): string {
  const match = analysis.match(/explanation:([^\n]+(\n[^\n]+)*)/i);
  return match ? match[1].trim() : 'No explanation provided';
}
