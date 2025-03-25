import { v4 as uuidv4 } from 'uuid';
import { ScenarioConfig, DebugRequest } from '../types.js';
import { gitOperations, commanderOperations } from '../util/mcp.js';
import { runScenarioAgent } from '../util/anthropic.js';

/**
 * Factory for creating autonomous scenario agents
 */
export class ScenarioAgentFactory {
  /**
   * Create a new scenario agent
   */
  static createAgent(
    sessionId: string,
    scenarioType: string,
    debugRequest: DebugRequest
  ): ScenarioConfig {
    const id = uuidv4();
    const branchName = `deebo-${sessionId}-${scenarioType}-${Date.now()}`;
    
    return {
      id,
      sessionId,
      scenarioType,
      branchName,
      hypothesis: generateHypothesis(scenarioType, debugRequest.error),
      debugRequest,
      timeout: 60000, // 1 minute timeout
      startTime: Date.now()
    };
  }
}

/**
 * Generate a hypothesis for a scenario type
 */
function generateHypothesis(scenarioType: string, errorMessage: string): string {
  switch (scenarioType) {
    case 'dependency':
      return `The error "${errorMessage}" may be caused by a missing or incompatible dependency.`;
    case 'syntax':
      return `The error "${errorMessage}" may be caused by a syntax or type error in the code.`;
    case 'environment':
      return `The error "${errorMessage}" may be caused by an environment configuration issue.`;
    case 'api':
      return `The error "${errorMessage}" may be caused by an issue with API integration or usage.`;
    case 'performance':
      return `The error "${errorMessage}" may be related to performance issues or resource constraints.`;
    case 'runtime':
      return `The error "${errorMessage}" may be a runtime exception that occurs during execution.`;
    case 'cache':
      return `The error "${errorMessage}" may be related to caching issues or stale data.`;
    case 'async':
      return `The error "${errorMessage}" may be caused by race conditions or asynchronous timing issues.`;
    default:
      return `The error "${errorMessage}" requires investigation.`;
  }
}

/**
 * Run an autonomous scenario agent
 */
export async function runAutonomousAgent(config: ScenarioConfig): Promise<any> {
  console.error(`Running autonomous ${config.scenarioType} agent for session ${config.sessionId}`);
  
  // Initialize agent context
  let context = config.debugRequest.context || '';
  const repoPath = config.debugRequest.codebase?.repoPath;
  
  // Create branch for this agent if we have a repo
  if (repoPath && config.branchName) {
    try {
      const { output } = await commanderOperations.executeCommand(
        `cd ${repoPath} && git checkout -b ${config.branchName}`
      );
      console.error(`Created branch ${config.branchName} for investigation`);
    } catch (error) {
      console.error(`Error creating branch: ${error}`);
    }
  }

  try {
    // Agent investigation loop
    while (true) {
      // Get next action from Claude
      const analysis = await runScenarioAgent(
        config.scenarioType,
        config.hypothesis,
        config.debugRequest.error,
        context,
        config.debugRequest.codebase?.filePath?.split('.').pop() || ''
      );

      // Parse Claude's response for actions
      if (analysis.includes('git') && repoPath) {
        // Execute git operations
        try {
          if (analysis.includes('status')) {
            const status = await gitOperations.status(repoPath);
            context += `\n\nGit Status:\n${status}`;
          }
          if (analysis.includes('diff')) {
            const diff = await gitOperations.diffUnstaged(repoPath);
            context += `\n\nUnstaged Changes:\n${diff}`;
          }
          if (analysis.includes('log')) {
            const log = await gitOperations.log(repoPath);
            context += `\n\nRecent Commits:\n${log}`;
          }
        } catch (error) {
          console.error('Error executing git operation:', error);
          context += `\n\nGit Error: ${error}`;
        }
      }

      if (analysis.includes('read file') || analysis.includes('examine file')) {
        // Read file contents
        try {
          const filePath = analysis.match(/file[:\s]+([^\n]+)/i)?.[1].trim();
          if (filePath) {
            const content = await commanderOperations.readFile(filePath);
            context += `\n\nFile Content (${filePath}):\n${content}`;
          }
        } catch (error) {
          console.error('Error reading file:', error);
          context += `\n\nFile Read Error: ${error}`;
        }
      }

      if (analysis.includes('edit file') || analysis.includes('modify file')) {
        // Apply code changes
        try {
          const editBlock = analysis.match(/```[\s\S]*?```/)?.[0];
          if (editBlock) {
            const result = await commanderOperations.editBlock(editBlock);
            context += `\n\nEdit Result: ${result}`;
          }
        } catch (error) {
          console.error('Error applying changes:', error);
          context += `\n\nEdit Error: ${error}`;
        }
      }

      if (analysis.includes('run') || analysis.includes('execute')) {
        // Execute commands
        try {
          const command = analysis.match(/run command[:\s]+([^\n]+)/i)?.[1].trim();
          if (command) {
            const { output } = await commanderOperations.executeCommand(command);
            context += `\n\nCommand Output:\n${output}`;
          }
        } catch (error) {
          console.error('Error executing command:', error);
          context += `\n\nCommand Error: ${error}`;
        }
      }

      // Check if investigation is complete
      if (analysis.includes('INVESTIGATION_COMPLETE') || 
          analysis.includes('SOLUTION_FOUND') ||
          analysis.includes('NO_SOLUTION_FOUND')) {
        return {
          success: analysis.includes('SOLUTION_FOUND'),
          confidence: extractConfidence(analysis),
          fix: extractFix(analysis),
          explanation: extractExplanation(analysis)
        };
      }

      // Check timeout
      if (config.timeout && Date.now() - config.startTime > config.timeout) {
        return {
          success: false,
          confidence: 0,
          fix: 'Investigation timed out',
          explanation: 'The investigation exceeded the maximum allowed time'
        };
      }
    }
  } finally {
    // Cleanup: Delete branch if it exists
    if (repoPath && config.branchName) {
      try {
        await commanderOperations.executeCommand(
          `cd ${repoPath} && git checkout main || git checkout master && git branch -D ${config.branchName}`
        );
        console.error(`Cleaned up branch ${config.branchName}`);
      } catch (error) {
        console.error(`Error cleaning up branch: ${error}`);
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
