import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from './util/logger.js';
import { isInitialized } from './agents/index.js';
import { ToolConfigManager } from './util/tool-config.js';

// Retry utility for handling transient failures
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    operation?: string;
    logger?: any;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 500,
    operation: opName = 'operation',
    logger
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      
      if (logger) {
        logger.debug(`Retry attempt ${attempt}/${maxRetries} for ${opName}`, {
          error: error.message,
          nextDelay: delay,
          operation: opName
        });
      }

      if (attempt === maxRetries) {
        if (logger) {
          logger.error(`All retry attempts failed for ${opName}`, {
            error: error.message,
            attempts: maxRetries,
            operation: opName
          });
        }
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

// Log event interface for structured logging
interface LogEvent {
  timestamp: string;
  agent: string;
  event: string;
  status: 'info' | 'debug' | 'warn' | 'error';
  operation?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

// Timeout utility for wrapping promises
async function timeoutPromise<T>(
  promise: Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms)
    )
  ]);
}

// Zod schemas for validating Claude's output
const ActionSchema = z.object({
  tool: z.enum(['git-mcp', 'desktop-commander']),
  name: z.string(),
  args: z.record(z.unknown())
});

const ClaudeResponseSchema = z.object({
  actions: z.array(ActionSchema),
  complete: z.boolean(),
  success: z.boolean().optional(),
  explanation: z.string().optional()
});

// Helper function to create logger with initialization check
async function getLogger(sessionId: string, component: string) {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  const logger = createLogger(sessionId, component);
  
  // Enhance logger to include timestamps and structured data
  const enhancedLogger = {
    info: (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'info',
        metadata
      };
      logger.info(JSON.stringify(logEvent));
    },
    debug: (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'debug',
        metadata
      };
      logger.debug(JSON.stringify(logEvent));
    },
    error: (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'error',
        metadata
      };
      logger.error(JSON.stringify(logEvent));
    },
    close: () => logger.close()
  };
  
  return enhancedLogger;
}

// Parse command line arguments
function parseArgs(args: string[]): any {
  const result: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      result[key] = value;
      if (value !== true) i++;
    }
  }
  return result;
}

// OODA Loop: Scenario Agent explores a single hypothesis
import { OODALoop } from './agents/ooda-loop.js';

async function runScenarioAgent(args: any) {
  const logger = await getLogger(args.session, `scenario-${args.id}`);
  logger.info('Scenario agent started', {
    type: args.type,
    hypothesis: args.hypothesis,
    language: args.language
  });

  const anthropic = new Anthropic();
  const ooda = new OODALoop(args.session, args.hypothesis);
  
  // Initialize MCP clients for tools
  logger.info('Connecting to MCP tools');
  const gitClient = await connectMcpTool('git-mcp', logger);
  const filesystemClient = await connectMcpTool('filesystem-mcp', logger);
  
  try {
    logger.info('Creating isolated git branch');
    const branchName = `debug-${args.session}-${args.type}`;
    await gitClient.callTool({
      name: 'git_branch',
      arguments: {
        repo_path: args.repoPath,
        operation: 'create',
        branch_name: branchName
      }
    });
    logger.info('Git branch created', { branchName });
    
    // Prepare test cases and validation steps
    await ooda.prepareDefaultTestCases(args.request.error);
    await ooda.prepareDefaultValidationSteps();
    
    while (!ooda.isComplete()) {
      // OBSERVE phase
      await ooda.transitionTo('observe');
      const observations: any[] = await gatherObservations(args.repoPath, gitClient, desktopClient, logger);
      observations.forEach(obs => ooda.trackResource(obs.type));
      
      // ORIENT phase
      await ooda.transitionTo('orient');
      const analysis = await getNextAction(anthropic, {
        observations,
        iteration: ooda.getState().currentIteration,
        hypothesis: ooda.getState().currentHypothesis
      }, logger);
      
      // DECIDE phase
      await ooda.transitionTo('decide');
      const testsPassed = await ooda.runTestCases();
      const validationPassed = await ooda.runValidation();
      
      if (!testsPassed || !validationPassed) {
        ooda.recordFailedApproach(
          analysis.explanation || 'Unknown approach',
          'Failed validation or tests'
        );
        continue;
      }
      
      // ACT phase
      await ooda.transitionTo('act');
      for (const action of analysis.actions) {
        try {
          const result = await executeAction(action, args.repoPath, gitClient, desktopClient, logger);
          ooda.trackResource(`${action.tool}:${action.name}`);
          
          if (!result) {
            ooda.recordFailedApproach(
              `${action.tool}:${action.name}`,
              'Action execution failed'
            );
            break;
          }
        } catch (error: any) {
          ooda.recordFailedApproach(
            `${action.tool}:${action.name}`,
            error.message
          );
          break;
        }
      }
      
      // Check if we've found a solution
      if (analysis.complete && analysis.success) {
        logger.info('Solution found, preparing report');
        await writeReport(args.id, {
          success: true,
          explanation: analysis.explanation,
          metrics: ooda.getMetrics(),
          changes: await getChanges(args.repoPath, gitClient, logger)
        }, logger);
        logger.info('Report written successfully');
        return;
      }
    }
    
    // If we get here, we've hit max iterations without success
    logger.error('Max iterations reached without finding solution');
    await writeReport(args.id, {
      success: false,
      explanation: 'Max iterations reached without finding solution',
      metrics: ooda.getMetrics(),
      changes: await getChanges(args.repoPath, gitClient, logger)
    }, logger);
    
    throw new Error("Max iterations reached without conclusion");
    
  } catch (error: any) {
    logger.error('Scenario agent failed', { error: error.message });
    throw error;
  } finally {
    logger.info('Cleaning up resources');
    await gitClient.close();
    await desktopClient.close();
    logger.info('Scenario agent shutting down');
    logger.close();
  }
}

async function connectMcpTool(tool: string, logger: any) {
  logger.info(`Connecting to ${tool}`);
  try {
    // Get tool configuration
    const configManager = await ToolConfigManager.getInstance();
    const toolConfig = configManager.getToolConfig(tool);
    
    // Validate tool path
    if (!await configManager.validateToolPath(tool)) {
      throw new Error(`Tool path not found: ${toolConfig.path}`);
    }
    
    logger.info(`Loading tool from: ${toolConfig.path}`, { config: toolConfig });
    
    const client = new Client({
      name: `scenario-${tool}`,
      version: '1.0.0'
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [toolConfig.path]
    });
    
    // Initialize connection with capabilities check
    const requiredCapabilities = ['tools'];
    
    // Add specific capabilities based on tool type
    if (tool === 'git-mcp') {
      requiredCapabilities.push('git');
      requiredCapabilities.push('resources');
    } else if (tool === 'desktop-commander') {
      requiredCapabilities.push('filesystem');
    }

    await client.connect(transport);
    const serverCapabilities = await client.initialize();

    // Validate required capabilities
    const missingCapabilities = requiredCapabilities.filter(
      cap => !serverCapabilities.capabilities[cap]
    );

    if (missingCapabilities.length > 0) {
      throw new Error(`${tool} server missing required capabilities: ${missingCapabilities.join(', ')}`);
    }
    
    logger.info(`Connected to ${tool} successfully with capabilities:`, {
      capabilities: Object.keys(serverCapabilities.capabilities)
    });
    
    // Wrap client.callTool to enforce allowed actions
    const originalCallTool = client.callTool;
    client.callTool = async (request: any) => {
      if (!configManager.isActionAllowed(tool, request.name)) {
        throw new Error(`Action not allowed: ${request.name}`);
      }
      
      const { timeout, retries, baseDelay } = configManager.getRetryConfig(tool);
      
      return withRetry(
        () => timeoutPromise(
          originalCallTool.call(client, request),
          timeout,
          `${tool} action: ${request.name}`
        ),
        {
          maxRetries: retries,
          baseDelay,
          operation: `${tool} action: ${request.name}`,
          logger
        }
      );
    };
    
    return client;
  } catch (error: any) {
    logger.error(`Failed to connect to ${tool}`, { error: error.message, stack: error.stack });
    throw error;
  }
}

async function gatherObservations(repoPath: string, gitClient: any, desktopClient: any, logger: any): Promise<any[]> {
  const observations = [];
  logger.info('Starting observation gathering');
  
  try {
    // Git status
    logger.debug('Getting git status');
    const status = await withRetry(
      () => timeoutPromise(
        gitClient.callTool({
          name: 'git_status',
          arguments: { repo_path: repoPath }
        }),
        10000,
        'Git status'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Git status',
        logger
      }
    );
    observations.push({type: 'git_status', result: status});
    
    // Git diff
    logger.debug('Getting git diff');
    const diff = await withRetry(
      () => timeoutPromise(
        gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: repoPath }
        }),
        10000,
        'Git diff'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Git diff',
        logger
      }
    );
    observations.push({type: 'git_diff', result: diff});
    
    // List relevant files
    logger.debug('Listing directory contents');
    const files = await withRetry(
      () => timeoutPromise(
        desktopClient.callTool({
          name: 'list_directory',
          arguments: { 
            path: repoPath.startsWith('/') ? repoPath : `${process.cwd()}/${repoPath}`
          }
        }),
        10000,
        'List directory'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'List directory',
        logger
      }
    );
    observations.push({type: 'files', result: files});
    
    logger.info('Observation gathering complete', { numObservations: observations.length });
    return observations;
  } catch (error: any) {
    logger.error('Failed to gather observations', { error: error.message });
    throw error;
  }
}

async function executeAction(action: any, repoPath: string, gitClient: any, desktopClient: any, logger: any) {
  logger.info('Executing action', { tool: action.tool, name: action.name });
  try {
    switch (action.tool) {
      case 'git-mcp':
        return await executeGitAction(action, repoPath, gitClient, logger);
      case 'filesystem-mcp':
        return await executeFilesystemAction(action, repoPath, filesystemClient, logger);
      default:
        throw new Error(`Unknown tool: ${action.tool}`);
    }
  } catch (error: any) {
    logger.error('Action execution failed', { error: error.message, action });
    throw error;
  }
}

async function executeGitAction(action: any, repoPath: string, gitClient: any, logger: any) {
  logger.debug('Executing git action', { action });
  try {
    // Only allow available git-mcp tools
    const allowedGitActions = ['git_status', 'git_diff', 'git_log', 'git_branch', 'git_commit'];
    
    if (!allowedGitActions.includes(action.name)) {
      throw new Error(`Unsupported git action: ${action.name}`);
    }
    
    const result = await withRetry(
      () => timeoutPromise(
        gitClient.callTool({
          name: action.name,
          arguments: {
            repo_path: repoPath,
            ...action.args
          }
        }),
        10000, // 10 second timeout
        `Git action: ${action.name}`
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: `Git action: ${action.name}`,
        logger
      }
    );
    logger.debug('Git action completed', { result });
    return result;
  } catch (error: any) {
    logger.error('Git action failed', { error: error.message, action });
    throw error;
  }
}

async function executeFilesystemAction(action: any, repoPath: string, filesystemClient: any, logger: any) {
  logger.debug('Executing desktop action', { action });
  try {
    // Only allow available filesystem-mcp tools
    const allowedFilesystemActions = [
      'read_file',
      'write_file',
      'create_directory',
      'list_directory',
      'search_files',
      'get_file_info',
      'move_file',
      'edit_block'
    ];
    
    if (!allowedFilesystemActions.includes(action.name)) {
      throw new Error(`Unsupported filesystem action: ${action.name}`);
    }
    
    // Ensure paths are properly resolved for file operations
    let args = { ...action.args };
    if (['read_file', 'write_file', 'edit_block', 'list_directory', 'create_directory'].includes(action.name) && args.path) {
      args.path = args.path.startsWith('/') ? args.path : `${process.cwd()}/${args.path}`;
    }
    
    const result = await withRetry(
      () => timeoutPromise(
        desktopClient.callTool({
          name: action.name,
          arguments: args
        }),
        10000, // 10 second timeout
        `Desktop action: ${action.name}`
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: `Desktop action: ${action.name}`,
        logger
      }
    );
    logger.debug('Desktop action completed', { result });
    return result;
  } catch (error: any) {
    logger.error('Desktop action failed', { error: error.message, action });
    throw error;
  }
}

async function getChanges(repoPath: string, gitClient: any, logger: any) {
  logger.info('Getting final changes');
  try {
    // Get diff of all changes made
    const diff = await gitClient.callTool({
      name: 'git_diff',
      arguments: { repo_path: repoPath }
    });
    logger.debug('Changes retrieved', { diffLength: diff.length });
    return diff;
  } catch (error: any) {
    logger.error('Failed to get changes', { error: error.message });
    throw error;
  }
}

async function getNextAction(anthropic: any, data: any, logger: any) {
  logger.info('Getting next action from Claude');
  try {
    const systemPrompt = `You are a debugging scenario agent investigating a specific hypothesis.
    You can only use these tools:

    git-mcp tools:
    - git_status: Get repository status
    - git_diff: Get changes diff
    - git_log: View commit history
    - git_branch: Manage branches
    - git_commit: Commit changes

    desktop-commander tools:
    - read_file: Read file content
    - write_file: Write to file
    - edit_block: Make specific text replacements
    - list_directory: List directory contents
    - create_directory: Create new directory
    - execute_command: Run shell command
    - search_code: Search in files

    Based on observations, suggest next debugging actions using only these tools.
    Return JSON with actions array and complete/success flags.`;

    const msg = await withRetry(
      () => timeoutPromise<Anthropic.Message>(
        anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Based on these observations, what actions should I take next to investigate the hypothesis?\n\nHypothesis: ${data.hypothesis}\n\nObservations:\n${JSON.stringify(data.observations)}\n\nIteration: ${data.iteration}`
      }]
      }),
      30000, // 30 second timeout for Claude
      'Claude response'
      ),
      {
        maxRetries: 3,
        baseDelay: 2000, // Longer delay for Claude API
        operation: 'Claude API call',
        logger
      }
    );

    // Get text content from message
    const textContent = msg.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Expected text response from Claude');
    }
    
    const parsedJson = JSON.parse(textContent.text);
    logger.debug('Parsing Claude response', { raw: parsedJson });
    
    const validatedResponse = ClaudeResponseSchema.safeParse(parsedJson);
    if (!validatedResponse.success) {
      logger.error('Invalid Claude response format', { 
        error: validatedResponse.error.message,
        raw: parsedJson 
      });
      throw new Error(`Invalid Claude response: ${validatedResponse.error.message}`);
    }
    
    logger.debug('Claude response validated', { response: validatedResponse.data });
    return validatedResponse.data;
  } catch (error: any) {
    logger.error('Failed to get next action from Claude', { error: error.message });
    throw error;
  }
}

/**
 * Ensure a directory exists by creating it if necessary
 */
async function ensureDirectoryExists(directoryPath: string, client: any, logger: any): Promise<string> {
  if (!directoryPath) {
    throw new Error('Directory path cannot be undefined');
  }

  logger.debug('Ensuring directory exists', { directoryPath });
  
  await withRetry(
    () => timeoutPromise(
      client.callTool({
        name: 'create_directory',
        arguments: {
          path: directoryPath
        }
      }),
      5000,
      'Create directory'
    ),
    {
      maxRetries: 3,
      baseDelay: 1000,
      operation: 'Create directory',
      logger
    }
  );
  
  return directoryPath;
}

async function writeReport(agentId: string, data: any, logger: any) {
  if (!agentId) {
    logger.error('Agent ID is undefined', { data });
    throw new Error('Cannot write report: agent ID is undefined');
  }

  logger.info('Writing final report');
  const client = await connectMcpTool('desktop-commander', logger);
  
  try {
    // Import modules
    const { join } = await import('path');
    const { PathResolver } = await import('./util/path-resolver.js');
    
    // Get the path resolver instance and ensure it's initialized
    const pathResolver = PathResolver.getInstance();
    
    // Check if we need to initialize the path resolver
    if (!pathResolver.isInitialized()) {
      logger.debug('Initializing PathResolver');
      
      // Explicitly check and set DEEBO_ROOT if undefined
      if (!process.env.DEEBO_ROOT) {
        process.env.DEEBO_ROOT = process.cwd();
        logger.info('DEEBO_ROOT was not set, using current directory', { 
          DEEBO_ROOT: process.env.DEEBO_ROOT 
        });
      }
      
      // Initialize with the current DEEBO_ROOT
      await pathResolver.initialize(process.env.DEEBO_ROOT);
    }
    
    // Get the reports directory, ensuring it exists
    const reportDir = await pathResolver.getReportsDirectory();
    
    logger.debug('Using reports directory from PathResolver', { 
      reportDir,
      rootDir: pathResolver.getRootDir()
    });
    
    // Write a test file to verify write permissions
    const testFileName = `test-write-${Date.now()}.txt`;
    const testFilePath = pathResolver.joinPath(reportDir, testFileName);
    
    logger.debug('Writing test file for permission check', { testFilePath });
    
    // Use withRetry to handle transient failures
    await withRetry(
      () => timeoutPromise(
        client.callTool({
          name: 'write_file',
          arguments: {
            path: testFilePath,
            content: 'Test write permissions'
          }
        }),
        5000,
        'Test write permissions'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Test write permissions',
        logger
      }
    );
    
    logger.debug('Successfully wrote test file', { testFilePath });
    
    // Now write the actual report
    const timestamp = Date.now();
    const reportFile = `${agentId}-report-${timestamp}.json`;
    const reportPath = pathResolver.joinPath(reportDir, reportFile);
    
    logger.debug('Writing report file', { 
      reportPath,
      agentId,
      timestamp
    });
    
    // Use withRetry to handle transient failures
    await withRetry(
      () => timeoutPromise(
        client.callTool({
          name: 'write_file',
          arguments: {
            path: reportPath,
            content: JSON.stringify(data, null, 2)
          }
        }),
        10000,
        'Write report'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Write report',
        logger
      }
    );
    logger.info('Report written successfully', { reportPath });
    
    return reportPath; // Return the path for reference
  } catch (error: any) {
    logger.error('Failed to write report', { 
      error: error.message,
      stack: error.stack
    });
    
    // Try a simpler fallback approach with direct path handling
    try {
      logger.info('Attempting fallback report writing method');
      const fallbackDir = process.env.DEEBO_ROOT ? 
        path.join(process.env.DEEBO_ROOT, 'reports') : 
        path.join(process.cwd(), 'reports');
      
      // Ensure directory exists with direct fs calls
      await fs.mkdir(fallbackDir, { recursive: true });
      
      const timestamp = Date.now();
      const reportFile = `${agentId}-report-fallback-${timestamp}.json`;
      const reportPath = path.join(fallbackDir, reportFile);
      
      logger.debug('Writing report with fallback method', { reportPath });
      
      // Write directly with fs.writeFile
      await fs.writeFile(
        reportPath, 
        JSON.stringify({ ...data, _writtenWithFallback: true }, null, 2)
      );
      
      logger.info('Report written with fallback method', { reportPath });
      return reportPath;
    } catch (fallbackError: any) {
      logger.error('Fallback report writing also failed', { 
        error: fallbackError.message 
      });
      throw new Error(`Failed to write report: ${error.message}, fallback also failed: ${fallbackError.message}`);
    }
  } finally {
    await client.close();
  }
}

// Initialize vars for TypeScript compilation
let args: any;

// Parse args and run
if (typeof process !== 'undefined') {
  args = parseArgs(process.argv);
  runScenarioAgent(args).catch(err => {
    console.error('Scenario agent failed:', err);
    process.exit(1);
  });
}
