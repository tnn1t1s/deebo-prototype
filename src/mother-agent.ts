// External imports
import { spawn } from 'child_process';
import { AnthropicClient } from './util/anthropic.js';
import { join } from 'path';
import fs from 'fs/promises';

// MCP SDK imports
import { McpError } from '@modelcontextprotocol/sdk/types.js';

// Internal imports
import { createLogger } from './util/logger.js';
import { ensureDirectory } from './util/init.js';
import { getPathResolver } from './util/path-resolver-helper.js';
import { filesystemOperations, initMcpClients } from './util/mcp.js';
import { agentCoordinator } from './agents/coordinator.js';
import { ProtocolErrorCodes } from './protocol/index.js';
import { isInitialized } from './agents/index.js';
import { ScenarioAgentFactory, runAutonomousAgent } from './agents/factory.js';
import type { LoggerLike } from './types/logger.js';

// Types for Claude responses
interface ClaudeResponse {
  complete: boolean;
  result: {
    fix: string;
    confidence: number;
    explanation: string;
  } | null;
}

interface ClaudeMessage {
  content: Array<{
    type: string;
    text: string;
  }>;
}

interface AgentResult {
  id: string;
  sessionId: string;
  success: boolean;
  confidence: number;
  fix: string | null;
  explanation: string;
}

// Agent configurations aligned with agentic debugging vision
interface BaseAgentConfig {
  id: string;
  sessionId: string;
  startTime: number;
}

interface DebugEnvironment {
  // Required environment configuration
  deeboRoot: string;
  processIsolation: boolean;
  gitAvailable: boolean;
  validatedPaths: string[];
}

interface ValidationState {
  environmentChecked: boolean;
  pathsValidated: boolean;
  toolsValidated: boolean;
  errors: string[];
}

interface InitializationRequirements {
  requiredDirs: string[];
  requiredTools: string[];
  requiredCapabilities: string[];
}

// Standardized debug request that all agents can process
interface DebugRequest {
  error: string;
  context: string;
  codebase?: {
    filePath?: string;
    repoPath?: string;
  };
  // Required by type system but with safe defaults
  environment: DebugEnvironment;
  initRequirements: InitializationRequirements;
  validation: ValidationState;
}

// Specific configuration for scenario agents
interface ScenarioConfig extends BaseAgentConfig {
  branchName?: string;
  hypothesis: string;
  scenarioType: string;
  debugRequest: DebugRequest;
  timeout?: number;
}

// Complete agent configuration
interface AgentConfig extends BaseAgentConfig {
  branchName?: string;
  hypothesis: string;
  error: string;
  context: string;
  codebase?: {
    filePath?: string;
    repoPath?: string;
  };
  scenarioType: string;
  debugRequest: DebugRequest;
}

interface AgentResult {
  success: boolean;
  confidence: number;
  fix: string | null;
  explanation: string;
}

// Helper function to create logger with safe initialization
async function getLogger(sessionId: string, component: string) {
  // Start with initLogger
  const { initLogger } = await import('./util/init-logger.js');
  
  try {
    if (!process.env.DEEBO_ROOT) {
      initLogger.info('DEEBO_ROOT not set, initializing directories');
      const { initializeDirectories } = await import('./util/init.js');
      await initializeDirectories();
    }
    
    if (!isInitialized) {
      initLogger.info('System not initialized, using initLogger');
      return initLogger;
    }
    
    // Now safe to create regular logger
    return createLogger(sessionId, component);
  } catch (error) {
    initLogger.error('Logger initialization failed, using initLogger', { error });
    return initLogger;
  }
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
  // Initialize using PathResolver
  const { getPathResolver } = await import('./util/path-resolver-helper.js');
  const pathResolver = await getPathResolver();
  await pathResolver.ensureDirectory(`sessions/${sessionId}/logs`);
  
  const logger = await getLogger(sessionId, 'mother');
  
  // Initialize MCP clients
  logger.info('Initializing MCP clients');
  await initMcpClients().catch(error => {
    logger.error('Failed to initialize MCP clients', { error });
    throw new Error(`Failed to initialize required MCP clients: ${error}`);
  });
  
  // Log path configuration
  logger.info('Path configuration', {
    repoPath: repoPath || 'not provided',
    filePath: filePath || 'not provided'
  });

  logger.info('Mother agent started', {
    error: error.substring(0, 100), // Truncate long errors
    language,
    filePath: filePath || 'not provided',
    repoPath: repoPath || 'not provided'
  });

  const anthropicClient = await AnthropicClient.getClient();
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
      
      // ORIENT: Let Claude analyze error and suggest approaches
      logger.info('ORIENT: Analyzing error and generating investigation plan');
      const analysis = await anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are a master debugging strategist.
Given the error and observations, determine:
1. How many parallel investigations would be most effective (1-3)
2. What aspects of the error to focus on
3. What validation strategies are needed
4. Whether additional agents should be spawned for validation

Return JSON:
{
  "numAgents": number,
  "reasoning": string,
  "validationStrategy": {
    "needsValidation": boolean,
    "description": string,
    "suggestedAgents": number
  }
}`,
        messages: [{
          role: 'user',
          content: `Analyze this error and previous observations to determine the investigation approach:\nError: ${error}\n\nContext:${context}\n\nObservations: ${JSON.stringify(observations)}`
        }]
      });

      // Extract text content from Claude's response
      const content = analysis.content[0] as ClaudeMessage['content'][0];
      if (!content || !('text' in content)) {
        throw new Error('Expected text response from Claude');
      }
      
      // Sanitize and parse JSON response
      const sanitizedJson = content.text.trim().replace(/\n/g, '');
      const plan = JSON.parse(sanitizedJson) as { numAgents: number; reasoning: string };
      logger.debug('Investigation plan generated', { plan });
      
      // DECIDE: Create appropriate number of agents
      logger.info(`DECIDE: Creating ${plan.numAgents} investigation agents`);
      
      // Create agents in parallel
      const agents = await Promise.all(
        Array(plan.numAgents).fill(null).map(async () => {
          const agent = await ScenarioAgentFactory.createAgent(sessionId, {
            error,
            context,
            codebase: {
              filePath: filePath || '',
              repoPath: repoPath || ''
            },
            environment: {
              deeboRoot: repoPath || '',
              processIsolation: true,
              gitAvailable: true,
              validatedPaths: [repoPath || '']
            },
            initRequirements: {
              requiredDirs: ['reports', 'sessions'],
              requiredTools: ['git-mcp', 'filesystem-mcp'],
              requiredCapabilities: ['git', 'filesystem']
            },
            validation: {
              environmentChecked: false,
              pathsValidated: false,
              toolsValidated: false,
              errors: []
            }
          }) as AgentConfig;
          
          // Register with coordinator
          agentCoordinator.registerScenarioAgent({
            sessionId,
            scenarioId: agent.id,
            hypothesis: agent.hypothesis
          });
          
          logger.debug('Created investigation agent', {
            id: agent.id,
            branch: agent.branchName
          });
          
          return agent;
        })
      );
      
      // ACT: Run agents in parallel
      logger.info(`ACT: Running ${agents.length} investigation agents`);
      const results = await Promise.all(
        agents.map((agent: AgentConfig) => 
          runAutonomousAgent(agent).catch(error => ({
            success: false,
            confidence: 0,
            fix: null,
            explanation: `Agent failed: ${error.message}`
          }))
        )
      );
      logger.debug('Scenario agent results received', { results });
      
      // Evaluate results to determine if we're done
      logger.info('Evaluating scenario results');
      const evaluation = await evaluateResults(anthropicClient, results);
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

// Scenario spawn configuration
interface SpawnConfig {
  sessionId: string;
  scenarioId: string;
  scenario: {
    type: string;
    hypothesis: string;
    suggestedTools?: Array<{
      tool: 'git-mcp' | 'filesystem-mcp';
      name: string;
      args: Record<string, unknown>;
    }>;
  };
  error: string;
  context: string;
  language: string;
  filePath?: string;
  repoPath?: string;
}

async function spawnScenarioAgent(config: SpawnConfig) {
  // Initialize using PathResolver
  const { getPathResolver } = await import('./util/path-resolver-helper.js');
  const pathResolver = await getPathResolver();
  await pathResolver.ensureDirectory(`sessions/${config.sessionId}/logs`);
  await pathResolver.ensureDirectory('reports');
  
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
    
    // Get path to scenario agent safely
    const scenarioAgentPath = pathResolver.resolvePath('build/scenario-agent.js');
    
    // Validate the scenario agent exists
    try {
      const { access } = await import('fs/promises');
      await access(scenarioAgentPath);
    } catch (error) {
      throw new Error(`Scenario agent not found at: ${scenarioAgentPath}`);
    }
    
    logger.debug('Validated scenario agent path', { scenarioAgentPath });
    
    // Create a new environment object that includes DEEBO_ROOT
    // Use type assertion to help TypeScript understand the environment object
    const env = {
      ...process.env,
      DEEBO_ROOT: process.env.DEEBO_ROOT
    } as NodeJS.ProcessEnv;
    
    // Log environment variables safely
    const envPathValue = env['PATH'] || 'not set';
    const envNodePathValue = env['NODE_PATH'] || 'not set';
    
    logger.debug('Environment for child process', {
      PATH: typeof envPathValue === 'string' ? envPathValue.substring(0, 50) + '...' : envPathValue,
      DEEBO_ROOT: env.DEEBO_ROOT || 'not set',
      NODE_PATH: envNodePathValue
    });
    
    const result = await new Promise((resolve, reject) => {
      
      const childProcess = spawn('node', [
        scenarioAgentPath,
        '--id', config.scenarioId,
        '--session', config.sessionId,
        '--type', config.scenario.type,
        '--error', config.error,
        '--context', config.context,
        '--hypothesis', config.scenario.hypothesis,
        '--language', config.language,
        '--file', config.filePath ?? '',
        '--repo', config.repoPath ?? '',
        '--request', JSON.stringify({
          error: config.error,
          context: config.context,
          filePath: config.filePath,
          repoPath: config.repoPath,
          suggestedTools: config.scenario.suggestedTools || [] // Pass Claude's tool suggestions
        })
      ], {
        stdio: 'pipe',
        detached: true,
        cwd: process.cwd(),
        env: env // Pass the environment with DEEBO_ROOT
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
              (async () => {
                try {
                  // Import path module
                  const { join } = await import('path');
                  const { readdir } = await import('fs/promises');
                  
                  // Ensure we're using the proper root directory
                  const reportDir = process.env.DEEBO_ROOT 
                    ? join(process.env.DEEBO_ROOT, 'reports') 
                    : 'reports';
                  
                  // The scenario agent adds timestamp to filenames, so we need to find files matching the pattern
                  const reportPrefix = `${config.scenarioId}-report-`;
                  const files = await readdir(reportDir);
                  
                  // Find the report file that matches our scenario ID
                  const reportFile = files.find(file => file.startsWith(reportPrefix) && file.endsWith('.json'));
                  
                  if (!reportFile) {
                    throw new Error(`Report file not found for scenario: ${config.scenarioId}`);
                  }
                  
                  const reportPath = join(reportDir, reportFile);
                  logger.debug('Found report file', { reportPath });
                  
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

async function generateHypotheses(anthropicClient: any, data: any) {
  const logger = await getLogger(data.sessionId, 'mother-hypotheses');
  logger.info('Generating hypotheses', { iteration: data.iteration });
  try {
    const systemPrompt = `You are analyzing a bug report to generate debugging hypotheses.
    For a race condition in TypeScript, consider:
    1. Async operations and their timing
    2. Shared state management
    3. Cache invalidation patterns
    4. Error handling in async flows

    The following MCP tools are available:

    git-mcp:
    - git_status: Get repository status
    - git_diff: Get changes diff
    - git_log: View commit history
    - git_branch: Create/manage branches
    - git_commit: Commit changes

    filesystem-mcp:
    - read_file: Read file content
    - write_file: Write to file
    - create_directory: Create directories
    - list_directory: List contents
    - search_files: Search in files
    - get_file_info: Get file metadata
    - move_file: Move/rename files
    - edit_block: Make targeted text changes

    Return array of hypotheses as JSON:
    [{
      "type": "string", // Short type name
      "description": "string", // Detailed hypothesis
      "suggestedTools": [{ // Tools needed to investigate
        "tool": "git-mcp" | "filesystem-mcp",
        "name": string, // Tool name from above lists
        "args": object // Arguments for the tool
      }]
    }]`;

    const msg = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate debugging hypotheses for iteration ${data.iteration}:\n${data.error}\n\nContext: ${data.context}\n\nPrevious observations: ${JSON.stringify(data.observations)}`
      }]
    });

    const content = msg.content[0] as ClaudeMessage['content'][0];
    if (!content || !('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    // Sanitize and parse JSON response
    const sanitizedJson = content.text.trim().replace(/\n/g, '');
    const hypotheses = JSON.parse(sanitizedJson);
    logger.debug('Hypotheses generated', { hypotheses });
    return hypotheses;
  } catch (error: any) {
    logger.error('Failed to generate hypotheses', { error: error.message });
    throw error;
  } finally {
    logger.close();
  }
}

async function evaluateResults(anthropicClient: any, results: AgentResult[]) {
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

    const msg = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user', 
        content: `Evaluate debugging results and determine if we have a solution:\n${JSON.stringify(results)}`
      }]
    });

    const content = msg.content[0] as ClaudeMessage['content'][0];
    if (!content || !('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    // Sanitize and parse JSON response
    const sanitizedJson = content.text.trim().replace(/\n/g, '');
    const evaluation = JSON.parse(sanitizedJson) as ClaudeResponse;
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
