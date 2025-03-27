import { v4 as uuidv4 } from 'uuid';
import { ScenarioConfig, DebugRequest } from '../types.js';
import { filesystemOperations } from '../util/mcp.js';
import { AnthropicClient } from '../util/anthropic.js';
import { initLogger } from '../util/init-logger.js';

import type { LoggerLike } from '../types/logger.js';

/**
 * Factory for creating autonomous scenario agents
 */
export class ScenarioAgentFactory {
  private static logger: LoggerLike = initLogger;

  /**
   * Create a new scenario agent with Claude-generated hypothesis
   */
  static async createAgent(
    sessionId: string,
    debugRequest: DebugRequest
  ): Promise<ScenarioConfig> {
    // Start with initLogger
    let logger: LoggerLike = initLogger;
    
    try {
      if (process.env.DEEBO_ROOT) {
        // Try to switch to regular logger
        const { createLogger } = await import('../util/logger.js');
        logger = createLogger(sessionId, 'scenario-factory');
      }
    } catch (error) {
      // Keep using initLogger if createLogger fails
      initLogger.error('Failed to create logger, using initLogger', { error });
    }

    const id = uuidv4();
    const branchName = `deebo-${sessionId}-${id}`;
    
    logger.info('Creating new scenario agent', {
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
}

/**
 * Run an autonomous scenario agent
 */
export async function runAutonomousAgent(config: ScenarioConfig): Promise<any> {
  // Start with initLogger
  let logger: LoggerLike = initLogger;
  
  try {
    if (process.env.DEEBO_ROOT) {
      // Try to switch to regular logger
      const { createLogger } = await import('../util/logger.js');
      logger = createLogger(config.sessionId, `scenario-${config.id}`);
    }
  } catch (error) {
    // Keep using initLogger if createLogger fails
    initLogger.error('Failed to create logger, using initLogger', { error });
  }

  // Initialize agent context
  let context = config.debugRequest.context || '';
  const repoPath = config.debugRequest.codebase?.repoPath;
  
  // Create branch for this agent if we have a repo
  if (repoPath && config.branchName) {
    try {
      const { output } = await filesystemOperations.executeCommand(
        `cd ${repoPath} && git checkout -b ${config.branchName}`
      );
      logger.info(`Created branch for investigation`, { branchName: config.branchName });
    } catch (error) {
      logger.error(`Error creating branch`, { error, branchName: config.branchName });
    }
  }

  try {
    // Let Claude analyze and suggest next actions
    const analysis = await AnthropicClient.runScenarioAgent(
      config.id,
      config.hypothesis,
      config.debugRequest.error,
      context,
      config.debugRequest.codebase?.filePath?.split('.').pop() || ''
    );

    // Parse response and extract results
    return {
      success: analysis.includes('SOLUTION_FOUND'),
      confidence: extractConfidence(analysis),
      fix: extractFix(analysis),
      explanation: extractExplanation(analysis)
    };
  } finally {
    // Cleanup: Delete branch if it exists
    if (repoPath && config.branchName) {
      try {
        await filesystemOperations.executeCommand(
          `cd ${repoPath} && git checkout main || git checkout master && git branch -D ${config.branchName}`
        );
        logger.info(`Cleaned up branch`, { branchName: config.branchName });
      } catch (error) {
        logger.error(`Error cleaning up branch`, { error, branchName: config.branchName });
      }
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
