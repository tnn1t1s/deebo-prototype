import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Anthropic } from '@anthropic-ai/sdk';
import { createLogger } from './util/logger.js';
import { agentCoordinator } from './agents/coordinator.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ProtocolErrorCodes } from './protocol/index.js';
import { isInitialized } from './agents/index.js';
import fs from 'fs/promises';

// Helper function to create logger with initialization check
async function getLogger(sessionId: string, component: string) {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  return createLogger(sessionId, component);
}

// OODA Loop: Mother Agent orchestrates macro debugging cycle
export async function runMotherAgent(
  sessionId: string,
  error: string, 
  context: string,
  language: string,
  filePath: string | undefined,
  repoPath: string | undefined
) {
  const logger = await getLogger(sessionId, 'mother');

  // Validate paths early
  if (!repoPath) {
    logger.warn('No repository path provided, some features will be limited');
  }
  if (!filePath) {
    logger.warn('No file path provided, some features will be limited');
  }

  logger.info('Mother agent started', {
    error: error.substring(0, 100), // Truncate long errors
    language,
    filePath: filePath || 'not provided',
    repoPath: repoPath || 'not provided'
  });

  const anthropic = new Anthropic();
  let complete = false;
  let iteration = 0;
  const maxIterations = 3;
  
  try {
    const motherAgentId = `mother-${sessionId}`;

    // Update mother agent status
    agentCoordinator.updateAgentState(motherAgentId, {
      status: 'running',
      progress: 0
    });

    while (!complete && iteration < maxIterations) {
      logger.info(`Starting OODA iteration ${iteration + 1}`);
      
      // Update progress
      agentCoordinator.updateAgentState(motherAgentId, {
        progress: (iteration / maxIterations) * 100
      });

      // OBSERVE: Analyze error and results from previous iteration
      logger.info('OBSERVE: Gathering observations');
      const observations = await gatherObservations(sessionId, iteration);
      logger.debug('Observations gathered', { observations });
      
      // ORIENT: Determine possible hypotheses based on observations
      logger.info('ORIENT: Generating hypotheses');
      const hypotheses: any[] = await generateHypotheses(anthropic, {
        error,
        context,
        observations, 
        iteration
      });
      logger.debug('Hypotheses generated', { hypotheses });
      
      // DECIDE: Which hypotheses to investigate
      logger.info('DECIDE: Creating scenarios from hypotheses');
      const scenarios = hypotheses.map((h: any) => ({
        type: h.type,
        hypothesis: h.description
      }));
      logger.debug('Scenarios created', { scenarios });
      
      // Register scenario agents
      scenarios.forEach((scenario, index) => {
        const scenarioId = `${sessionId}-${index}`;
        agentCoordinator.registerScenarioAgent({
          sessionId,
          scenarioId,
          hypothesis: scenario.hypothesis
        });
      });
      
      // ACT: Spawn scenario agents to test hypotheses
      logger.info(`ACT: Spawning ${scenarios.length} scenario agents`);
      const results = await Promise.all(scenarios.map((scenario: any, index) => 
        spawnScenarioAgent({
          sessionId,
          scenario,
          error,
          context,
          language,
          filePath,
          repoPath,
          scenarioId: `${sessionId}-${index}`
        })
      ));
      logger.debug('Scenario agent results received', { results });
      
      // Evaluate results to determine if we're done
      logger.info('Evaluating scenario results');
      const evaluation = await evaluateResults(anthropic, results);
      logger.debug('Evaluation complete', { evaluation });
      
      complete = evaluation.complete;
      iteration++;
      
      if (complete) {
        logger.info('Solution found', { solution: evaluation.result });
        
        // Update mother agent status
        agentCoordinator.updateAgentState(motherAgentId, {
          status: 'complete',
          progress: 100,
          result: evaluation.result
        });
        
        return evaluation.result;
      }
    }
    
    const maxIterationsError = new McpError(
      ProtocolErrorCodes.AgentError,
      "Failed to find solution after max iterations"
    );
    
    // Update mother agent status
    agentCoordinator.updateAgentState(motherAgentId, {
      status: 'error',
      error: maxIterationsError.message
    });
    
    throw maxIterationsError;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Mother agent failed', { error: errorMessage });
    
    // Update mother agent status
    agentCoordinator.updateAgentState(`mother-${sessionId}`, {
      status: 'error',
      error: errorMessage
    });
    
    throw error;
  } finally {
    logger.info('Mother agent shutting down');
    logger.close();
  }
}

interface ScenarioConfig {
  sessionId: string;
  scenarioId: string;
  scenario: {
    type: string;
    hypothesis: string;
  };
  error: string;
  context: string;
  language: string;
  filePath?: string;
  repoPath?: string;
}

async function spawnScenarioAgent(config: ScenarioConfig) {
  const logger = await getLogger(config.sessionId, `mother-spawn-${config.scenarioId}`);
  
  logger.info('Spawning scenario agent', {
    type: config.scenario.type,
    hypothesis: config.scenario.hypothesis
  });

  // Update scenario agent status
  agentCoordinator.updateAgentState(config.scenarioId, {
    status: 'running',
    progress: 0
  });
  
  try {
    // Store the current working directory before spawning
    const currentDir = global.process.cwd();

    const result = await new Promise((resolve, reject) => {
      const childProcess = spawn('node', [
        'build/scenario-agent.js',
        '--id', config.scenarioId,
        '--session', config.sessionId,
        '--type', config.scenario.type,
        '--error', config.error,
        '--context', config.context,
        '--hypothesis', config.scenario.hypothesis,
        '--language', config.language,
        '--file', config.filePath || '',
        '--repo', config.repoPath || '',
        '--request', JSON.stringify({
          error: config.error,
          context: config.context,
          filePath: config.filePath,
          repoPath: config.repoPath
        })
      ], {
        stdio: 'pipe',
        detached: true,
        cwd: currentDir
      });
      
      // Log process output
      childProcess.stdout.on('data', (data: any) => {
        logger.debug(`Agent stdout: ${data}`);
      });
      
      childProcess.stderr.on('data', (data: any) => {
        logger.error(`Agent stderr: ${data}`);
      });
      
      childProcess.on('exit', (code: number) => {
        if (code === 0) {
          logger.info('Agent completed successfully');
          // Read agent's report file
          const reportPath = `reports/${config.scenarioId}.json`;
          (async () => {
            try {
              const reportContent = await fs.readFile(reportPath, 'utf8');
              const report = JSON.parse(reportContent);
              logger.debug('Agent report loaded', { report });
              resolve({
                id: config.scenarioId,
                type: config.scenario.type,
                ...report
              });
            } catch (err) {
              const error = `Failed to read agent report: ${err}`;
              logger.error(error);
              reject(new Error(error));
            }
          })();
        } else {
          const error = `Agent exited with code ${code}`;
          logger.error(error);
          reject(new Error(error));
        }
      });
    });

    // Update scenario agent status
    agentCoordinator.updateAgentState(config.scenarioId, {
      status: 'complete',
      progress: 100,
      result
    });

    return result;
  } catch (error) {
    // Update scenario agent status
    agentCoordinator.updateAgentState(config.scenarioId, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  } finally {
    logger.close();
  }
}

async function generateHypotheses(anthropic: any, data: any) {
  const logger = await getLogger(data.sessionId, 'mother-hypotheses');
  logger.info('Generating hypotheses', { iteration: data.iteration });
  try {
    const systemPrompt = `You are analyzing a bug report to generate debugging hypotheses.
    For a race condition in TypeScript, consider:
    1. Async operations and their timing
    2. Shared state management
    3. Cache invalidation patterns
    4. Error handling in async flows

    Return array of hypotheses as JSON:
    [{
      "type": "string", // Short type name
      "description": "string" // Detailed hypothesis
    }]`;

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate debugging hypotheses for iteration ${data.iteration}:\n${data.error}\n\nContext: ${data.context}\n\nPrevious observations: ${JSON.stringify(data.observations)}`
      }]
    });

    const hypotheses = JSON.parse(msg.content[0].text);
    logger.debug('Hypotheses generated', { hypotheses });
    return hypotheses;
  } catch (error: any) {
    logger.error('Failed to generate hypotheses', { error: error.message });
    throw error;
  } finally {
    logger.close();
  }
}

async function evaluateResults(anthropic: any, results: any) {
  const logger = await getLogger(results[0]?.sessionId, 'mother-evaluate');
  logger.info('Evaluating results', { numResults: results.length });
  try {
    const systemPrompt = `You are evaluating debugging results to determine if a solution has been found.
    Consider:
    1. Did any hypothesis fully explain the bug?
    2. Were proposed fixes validated?
    3. Is more investigation needed?

    Return JSON:
    {
      "complete": boolean,
      "result": object | null // Solution details if complete
    }`;

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user', 
        content: `Evaluate debugging results and determine if we have a solution:\n${JSON.stringify(results)}`
      }]
    });

    const evaluation = JSON.parse(msg.content[0].text);
    logger.debug('Evaluation complete', { evaluation });
    return evaluation;
  } catch (error: any) {
    logger.error('Failed to evaluate results', { error: error.message });
    throw error;
  } finally {
    logger.close();
  }
}

async function gatherObservations(sessionId: string, iteration: number): Promise<any> {
  const logger = await getLogger(sessionId, 'mother-observe');
  logger.info('Gathering observations', { iteration });

  try {
    // For now, just return iteration number
    // This will be expanded when we implement report reading
    const observations = { iteration };
    logger.debug('Observations gathered', { observations });
    return observations;
  } catch (error: any) {
    logger.error('Failed to gather observations', { error: error.message });
    throw error;
  } finally {
    logger.close();
  }
}
