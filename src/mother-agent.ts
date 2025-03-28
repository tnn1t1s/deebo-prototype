// External imports
import { spawn } from 'child_process';
import AnthropicClient from './util/anthropic.js';
import { join } from 'path';
import fs from 'fs/promises';

// MCP SDK imports
import { McpError } from '@modelcontextprotocol/sdk/types.js';

// Internal imports
import { createLogger } from './util/logger.js';
import { ensureDirectory } from './util/init.js';
import { PathResolver } from './util/path-resolver.js';
import { filesystemOperations, initMcpClients } from './util/mcp.js';
import { agentCoordinator } from './agents/coordinator.js';
import { ProtocolErrorCodes } from './protocol/index.js';
import { isInitialized } from './agents/index.js';
import { ScenarioAgentFactory } from './agents/factory.js';
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
  const pathResolver = await PathResolver.getInstance();
  await pathResolver.ensureDirectory(`sessions/${sessionId}/logs`);
  
  const logger = await getLogger(sessionId, 'mother');
  
  // Initialize MCP clients
  await logger.info('Initializing MCP clients');
  await initMcpClients().catch(error => {
    logger.error('Failed to initialize MCP clients', { error });
    throw new Error(`Failed to initialize required MCP clients: ${error}`);
  });
  
  // Log path configuration
  await logger.info('Path configuration', {
    repoPath: repoPath || 'not provided',
    filePath: filePath || 'not provided'
  });

  await logger.info('Mother agent started', {
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
      await logger.info(`Starting OODA iteration ${iteration + 1}`);
      
      // Update progress
      agentCoordinator.updateAgentState(motherAgentId, {
        progress: (iteration / maxIterations) * 100
      });

      // OBSERVE: Analyze error and results from previous iteration
      await logger.info('OBSERVE: Gathering observations');
      const observations = await gatherObservations(sessionId, iteration);
      await logger.debug('Observations gathered', { observations });
      
      // ORIENT: Let Claude analyze error and suggest approaches
      await logger.info('ORIENT: Analyzing error and generating investigation plan');
      const analysis = await anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are a master debugging strategist. You must respond with a JSON object in exactly this format:

{
  "numAgents": 2,  // Number between 1-3
  "reasoning": "Detailed explanation of why this number of agents is needed",
  "validationStrategy": {
    "needsValidation": true,  // Boolean
    "description": "Detailed description of validation approach",
    "suggestedAgents": 1  // Number of additional validation agents needed
  }
}

Do not include any other text or explanation outside of this JSON structure.`,
        messages: [{
          role: 'user',
          content: `Analyze this error and previous observations to determine the investigation approach:

Error: ${error}

Context: ${context}

Observations: ${JSON.stringify(observations)}

Remember to respond with only the JSON object, no other text.`
        }]
      });

      // Extract text content from response
      const content = analysis.content[0];
      if (!('text' in content)) {
        throw new Error('Expected text response from Claude');
      }
      const plan = JSON.parse(content.text) as { numAgents: number; reasoning: string };
      await logger.debug('Investigation plan generated', { plan });
      
      // DECIDE: Create appropriate number of agents
      await logger.info(`DECIDE: Creating ${plan.numAgents} investigation agents`);
      
      // Generate hypotheses for investigation
      const hypotheses = await generateHypotheses(anthropicClient, {
        sessionId,
        iteration,
        error,
        context,
        observations
      });

      // Create and run agents in parallel
      await logger.info(`Creating ${plan.numAgents} investigation agents`);
      const results = await Promise.all(
        hypotheses.slice(0, plan.numAgents).map(async (hypothesis) => {
          try {
            const result = await spawnScenarioAgent({
              sessionId,
              scenarioId: `scenario-${sessionId}-${iteration}-${hypothesis.type}`,
              scenario: {
                type: hypothesis.type,
                hypothesis: hypothesis.description,
                suggestedTools: hypothesis.suggestedTools
              },
              error,
              context,
              language,
              filePath,
              repoPath
            });
            return result as AgentResult;
          } catch (error) {
            await logger.error('Agent failed', { 
              error: error instanceof Error ? error.message : String(error),
              hypothesis: hypothesis.type
            });
            return {
              id: `failed-${hypothesis.type}`,
              sessionId: sessionId,
              success: false,
              confidence: 0,
              fix: null,
              explanation: `Agent failed: ${error instanceof Error ? error.message : String(error)}`
            } as AgentResult;
          }
        })
      ) as AgentResult[];
      await logger.debug('Scenario agent results received', { results });
      
      // Evaluate results to determine if we're done
      await logger.info('Evaluating scenario results');
      const evaluation = await evaluateResults(anthropicClient, results);
      await logger.debug('Evaluation complete', { evaluation });
      
      complete = evaluation.complete;
      iteration++;
      
      if (complete) {
        await logger.info('Solution found', { solution: evaluation.result });
        
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.error('Mother agent failed', { error: errorMessage });
    
    // Update mother agent status
    agentCoordinator.updateAgentState(`mother-${sessionId}`, {
      status: 'error',
      error: errorMessage
    });
    
    throw error;
  } finally {
    await logger.info('Mother agent shutting down');
    await logger.close();
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
  const pathResolver = await PathResolver.getInstance();
  await pathResolver.ensureDirectory(`sessions/${config.sessionId}/logs`);
  await pathResolver.ensureDirectory('reports');
  
  const logger = await getLogger(config.sessionId, `mother-spawn-${config.scenarioId}`);
  
  await logger.info('Spawning scenario agent', {
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
    
    await logger.debug('Validated scenario agent path', { scenarioAgentPath });
    
    // Get Python environment configuration
    const { PythonPathResolver } = await import('./util/python-path-resolver.js');
    const pythonResolver = await PythonPathResolver.getInstance(process.env.DEEBO_ROOT);
    
    // Validate Python setup
    await pythonResolver.validate();
    
    // Create environment with Python configuration
    const env = {
      ...process.env,
      DEEBO_ROOT: process.env.DEEBO_ROOT,
      ...pythonResolver.getEnv()
    } as NodeJS.ProcessEnv;
    
    // Log environment variables safely
    await logger.debug('Environment for child process', {
      DEEBO_ROOT: env.DEEBO_ROOT || 'not set',
      VIRTUAL_ENV: env.VIRTUAL_ENV || 'not set',
      PYTHONPATH: env.PYTHONPATH || 'not set',
      PATH: env.PATH ? env.PATH.substring(0, 50) + '...' : 'not set'
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
      childProcess.stdout.on('data', async (data: any) => {
        await logger.debug(`Agent stdout: ${data}`);
      });
      
      childProcess.stderr.on('data', async (data: any) => {
        await logger.error(`Agent stderr: ${data}`);
      });
      
      childProcess.on('exit', async (code: number) => {
        if (code === 0) {
          await logger.info('Agent completed successfully');
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
                  await logger.debug('Found report file', { reportPath });
                  
                  const reportContent = await fs.readFile(reportPath, 'utf8');
                  const report = JSON.parse(reportContent);
                  await logger.debug('Agent report loaded', { report });
                  resolve({
                    id: config.scenarioId,
                    type: config.scenario.type,
                    ...report
                  });
                } catch (err) {
                  const error = `Failed to read agent report: ${err}`;
                  await logger.error(error);
                  reject(new Error(error));
                }
              })();
        } else {
          const error = `Agent exited with code ${code}`;
          await logger.error(error);
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
  await logger.info('Generating hypotheses', { iteration: data.iteration });
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
      system: `You are analyzing a bug report to generate debugging hypotheses. You must respond with a JSON array in exactly this format:

[
  {
    "type": "hypothesis-type",  // Short type name
    "description": "Detailed explanation of the hypothesis",
    "suggestedTools": [
      {
        "tool": "git-mcp",  // Must be either "git-mcp" or "filesystem-mcp"
        "name": "tool-name",  // Name of the specific tool to use
        "args": {  // Arguments for the tool
          "key": "value"
        }
      }
    ]
  }
]

Do not include any other text or explanation outside of this JSON array.`,
      messages: [{
        role: 'user',
        content: `Generate debugging hypotheses for iteration ${data.iteration}:

Error: ${data.error}

Context: ${data.context}

Previous observations: ${JSON.stringify(data.observations)}

Remember to respond with only the JSON array, no other text.`
      }]
    });

    // Extract text content from response
    const content = msg.content[0];
    if (!('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    const hypotheses = JSON.parse(content.text) as Array<{
      type: string;
      description: string;
      suggestedTools: Array<{
        tool: 'git-mcp' | 'filesystem-mcp';
        name: string;
        args: Record<string, unknown>;
      }>;
    }>;
    await logger.debug('Hypotheses generated', { hypotheses });
    return hypotheses;
  } catch (error: unknown) {
    await logger.error('Failed to generate hypotheses', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  } finally {
    await logger.close();
  }
}

async function evaluateResults(anthropicClient: any, results: AgentResult[]) {
  const logger = await getLogger(results[0]?.sessionId, 'mother-evaluate');
  await logger.info('Evaluating results', { numResults: results.length });
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
      system: `You are evaluating debugging results to determine if a solution has been found. You must respond with a JSON object in exactly this format:

{
  "complete": true,  // Boolean indicating if a solution was found
  "result": {  // Can be null if complete is false
    "fix": "Detailed description of the fix",
    "confidence": 0.95,  // Number between 0 and 1
    "explanation": "Detailed explanation of why this fix works"
  }
}

Do not include any other text or explanation outside of this JSON structure.`,
      messages: [{
        role: 'user', 
        content: `Evaluate these debugging results and determine if we have a solution:

${JSON.stringify(results)}

Remember to respond with only the JSON object, no other text.`
      }]
    });

    // Extract text content from response
    const content = msg.content[0];
    if (!('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    const evaluation = JSON.parse(content.text) as ClaudeResponse;
    await logger.debug('Evaluation complete', { evaluation });
    return evaluation;
  } catch (error: unknown) {
    await logger.error('Failed to evaluate results', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  } finally {
    await logger.close();
  }
}

async function gatherObservations(sessionId: string, iteration: number): Promise<any> {
  const logger = await getLogger(sessionId, 'mother-observe');
  await logger.info('Gathering observations', { iteration });

  try {
    // For now, just return iteration number
    // This will be expanded when we implement report reading
    const observations = { iteration };
    await logger.debug('Observations gathered', { observations });
    return observations;
  } catch (error: unknown) {
    await logger.error('Failed to gather observations', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  } finally {
    await logger.close();
  }
}
