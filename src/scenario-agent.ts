import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { AnthropicClient } from './util/anthropic.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { join } from 'path';
import { getPathResolver } from './util/path-resolver-helper.js';
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
  tool: z.enum(['git-mcp', 'filesystem-mcp']),
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
    warn: (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'warn',
        metadata
      };
      logger.info(JSON.stringify(logEvent)); // Use info since base logger doesn't have warn
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

async function runScenarioAgent(args: any) {
  const logger = await getLogger(args.session, `scenario-${args.id}`);
  logger.info('Scenario agent started', {
    hypothesis: args.hypothesis,
    language: args.language
  });

  const anthropic = await AnthropicClient.getClient();
  
  // Initialize MCP clients for tools
  logger.info('Connecting to MCP tools');
  const gitClient = await connectMcpTool('git-mcp', logger);
  const filesystemClient = await connectMcpTool('filesystem-mcp', logger);
  
  try {
    // Create isolated branch for investigation
    logger.info('Creating isolated git branch');
    const branchName = `debug-${args.session}-${Date.now()}`;
    
    if (args.repoPath) {
      await gitClient.callTool({
        name: 'git_branch',
        arguments: {
          repo_path: args.repoPath,
          operation: 'create',
          branch_name: branchName
        }
      });
      logger.info('Git branch created', { branchName });
    }

    // Start investigation
    let investigation = {
      complete: false,
      iteration: 0,
      maxIterations: 3
    };
    
    // Gather initial context
    const initialContext = {
      error: args.error,
      hypothesis: args.hypothesis,
      observations: await gatherObservations(args.repoPath, gitClient, filesystemClient, logger)
    };

    while (!investigation.complete && investigation.iteration < investigation.maxIterations) {
      logger.info(`Starting iteration ${investigation.iteration + 1}`);

      // Let Claude analyze and suggest next actions
      const analysis = await getNextAction(anthropic, {
        ...initialContext,
        iteration: investigation.iteration
      }, logger);

      // Execute suggested actions
      if (analysis.actions && analysis.actions.length > 0) {
        for (const action of analysis.actions) {
          try {
            await executeAction(action, args.repoPath, gitClient, filesystemClient, logger);
          } catch (error: any) {
            logger.error('Action failed', { 
              action: action.name,
              error: error.message 
            });
            // Continue to next action - let Claude decide if this is fatal
          }
        }
      }

      // Write report if investigation complete
      if (analysis.complete) {
        logger.info('Investigation complete, writing report');
        await writeReport(args.id, {
          success: !!analysis.success,
          explanation: analysis.explanation || 'No explanation provided',
          changes: analysis.success ? await getChanges(args.repoPath, gitClient, logger) : []
        }, logger);
        investigation.complete = true;
      } else {
        investigation.iteration++;
      }
    }

    // Handle timeout 
    if (!investigation.complete) {
      logger.warn('Investigation timed out');
      await writeReport(args.id, {
        success: false,
        explanation: 'Investigation timed out without finding solution',
        changes: await getChanges(args.repoPath, gitClient, logger)
      }, logger);
    }
    
  } catch (error: any) {
    logger.error('Scenario agent failed', { error: error.message });
    throw error;
  } finally {
    logger.info('Cleaning up resources');
    await gitClient.close();
    await filesystemClient.close();
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
      version: '1.0.0',
      capabilities: {
        tools: {},
        ...(tool === 'git-mcp' ? { git: {}, resources: {} } : {}),
        ...(tool === 'filesystem-mcp' ? { filesystem: {} } : {})
      }
    });

    const transport = new StdioClientTransport({
      command: 'node',
      args: [toolConfig.path]
    });

    await client.connect(transport);

    // Validate required capabilities
    const requiredCapabilities = ['tools'];
    if (tool === 'git-mcp') {
      requiredCapabilities.push('git', 'resources');
    } else if (tool === 'filesystem-mcp') {
      requiredCapabilities.push('filesystem');
    }

    // List available tools to verify connection
    const tools = await client.listTools();
    logger.info(`Connected to ${tool} successfully with tools:`, {
      availableTools: tools.tools.map(t => t.name)
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

async function gatherObservations(repoPath: string, gitClient: any, filesystemClient: any, logger: any): Promise<any[]> {
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
        filesystemClient.callTool({
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

async function executeAction(action: any, repoPath: string, gitClient: any, filesystemClient: any, logger: any) {
  const client = action.tool === 'git-mcp' ? gitClient : filesystemClient;
  logger.info('Executing action', { 
    tool: action.tool,
    name: action.name
  });

  try {
    // Add repo path for git actions
    const args = action.tool === 'git-mcp' 
      ? { ...action.args, repo_path: repoPath }
      : action.args;

    // Ensure absolute paths for filesystem actions
    if (action.tool === 'filesystem-mcp' && args.path && !args.path.startsWith('/')) {
      args.path = `${process.cwd()}/${args.path}`;
    }

    const result = await withRetry(
      () => timeoutPromise(
        client.callTool({
          name: action.name,
          arguments: args
        }),
        10000,
        `${action.tool} action: ${action.name}`
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: `${action.tool} action: ${action.name}`,
        logger
      }
    );

    logger.debug('Action completed', { 
      tool: action.tool,
      name: action.name,
      result 
    });

    return result;
  } catch (error: any) {
    logger.error('Action failed', {
      tool: action.tool,
      name: action.name,
      error: error.message
    });
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

async function getNextAction(anthropicClient: any, data: any, logger: any) {
  logger.info('Getting next actions from Claude');
  try {
    const systemPrompt = `You are an autonomous debugging agent investigating a software error.
You have these capabilities:

Git Operations (via git-mcp):
- Examining repository state
- Creating and managing branches
- Viewing and making changes
- Committing changes

Filesystem Operations (via filesystem-mcp):
- Reading and writing files
- Searching through code
- Making targeted edits
- Running commands

You are investigating this error:
${data.error}

Based on your hypothesis:
${data.hypothesis}

Analyze the situation and determine what actions to take. You can:
1. Examine code and repository state
2. Make targeted changes to fix issues
3. Run commands to verify fixes
4. Declare when you've found a solution

Return a JSON response in this format:
{
  "actions": [{
    "tool": "git-mcp" | "filesystem-mcp",
    "name": string, // Tool action name
    "args": object  // Arguments for the action
  }],
  "complete": boolean,  // True if investigation is complete
  "success": boolean,   // True if solution was found
  "explanation": string // Explanation of findings
}`;

    const msg = await withRetry(
      () => timeoutPromise<any>(
        anthropicClient.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          temperature: 0.7,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: `Investigating iteration ${data.iteration}:\n\nCurrent observations:\n${JSON.stringify(data.observations, null, 2)}\n\nWhat actions should I take next?`
          }]
        }),
        30000, // 30 second timeout for Claude
        'Claude response'
      ),
      {
        maxRetries: 3,
        baseDelay: 2000,
        operation: 'Claude API call',
        logger
      }
    );

    // Get text content from message
    const textContent = msg.content.find((block: { type: string; text?: string }) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Expected text response from Claude');
    }
    
    // Sanitize and parse JSON response
    const sanitizedJson = textContent.text.trim().replace(/\n/g, '');
    const parsedJson = JSON.parse(sanitizedJson);
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

async function writeReport(agentId: string, data: any, logger: any) {
  if (!agentId) {
    logger.error('Agent ID is undefined', { data });
    throw new Error('Cannot write report: agent ID is undefined');
  }

  logger.info('Writing final report');
  const client = await connectMcpTool('filesystem-mcp', logger);
  
  try {
    const { join } = await import('path');
    const { getPathResolver } = await import('./util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Write report directly to reports directory
    const timestamp = Date.now();
    const reportFile = `${agentId}-report-${timestamp}.json`;
    const reportPath = await pathResolver.resolvePath(join('reports', reportFile));
    
    logger.debug('Writing report file', { reportPath });
    
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
    return reportPath;
  } catch (error: any) {
    logger.error('Failed to write report', { error: error.message });
    throw error;
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
