import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import AnthropicClient from './util/anthropic.js';
import { PathResolver } from './util/path-resolver.js';
import { createLogger } from './util/logger.js';
import { getInitialized } from './util/init.js';
import { ToolConfigManager } from './util/tool-config.js';

// Basic type definitions
interface McpClient {
  callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
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

// Zod schemas for validating actions and tools
const GitActionSchema = z.object({
  tool: z.literal('git-mcp'),
  name: z.enum([
    'git_status',
    'git_diff',
    'git_diff_unstaged',
    'git_diff_staged',
    'git_commit',
    'git_add',
    'git_reset',
    'git_log',
    'git_create_branch',
    'git_checkout',
    'git_show',
    'git_init'
  ]),
  args: z.record(z.unknown())
});

const FilesystemActionSchema = z.object({
  tool: z.literal('filesystem-mcp'),
  name: z.enum([
    'read_file',
    'write_file',
    'create_directory',
    'list_directory',
    'search_files',
    'get_file_info',
    'move_file',
    'edit_file'
  ]),
  args: z.record(z.unknown())
});

// Combined action schema
const ActionSchema = z.discriminatedUnion('tool', [
  GitActionSchema,
  FilesystemActionSchema
]);

const ClaudeResponseSchema = z.object({
  actions: z.array(ActionSchema),
  complete: z.boolean(),
  success: z.boolean().optional(),
  explanation: z.string().optional()
});

// Helper function to create logger with initialization check
async function getLogger(sessionId: string, component: string) {
  if (!getInitialized()) {
    throw new Error('Cannot create logger - system not initialized');
  }
  const logger = await createLogger(sessionId, component);
  
  // Enhance logger to include timestamps and structured data
  const enhancedLogger = {
    info: async (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'info',
        metadata
      };
      await logger.info(JSON.stringify(logEvent));
    },
    debug: async (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'debug',
        metadata
      };
      await logger.debug(JSON.stringify(logEvent));
    },
    warn: async (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'warn',
        metadata
      };
      await logger.info(JSON.stringify(logEvent)); // Use info since base logger doesn't have warn
    },
    error: async (event: string, metadata?: Record<string, unknown>) => {
      const logEvent: LogEvent = {
        timestamp: new Date().toISOString(),
        agent: `${sessionId}/${component}`,
        event,
        status: 'error',
        metadata
      };
      await logger.error(JSON.stringify(logEvent));
    },
    close: async () => await logger.close()
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

// Custom error class for Python-related errors
class PythonToolError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'PythonToolError';
  }
}

async function connectMcpTool(tool: string, logger: any) {
  await logger.info(`Connecting to ${tool}`);
  try {
    // Get tool configuration
    const configManager = await ToolConfigManager.getInstance();
    const toolConfig = await configManager.getToolConfig(tool);
    
    // For Python-based tools, validate Python environment
    if (tool === 'git-mcp' && toolConfig.python?.usePythonResolver) {
      try {
        const { PythonPathResolver } = await import('./util/python-path-resolver.js');
        const pythonResolver = await PythonPathResolver.getInstance();
        await pythonResolver.validate();
      } catch (error) {
        throw new PythonToolError(
          `Failed to validate Python environment for ${tool}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }
    }
    
    await logger.info(`Loading tool: ${tool}`, { config: toolConfig });
    
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
      command: toolConfig.command,
      args: toolConfig.args,
      env: toolConfig.env
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
    await logger.info(`Connected to ${tool} successfully with tools:`, {
      availableTools: tools.tools.map(t => t.name)
    });
    
    // Wrap client.callTool to enforce allowed actions
    const originalCallTool = client.callTool;
    client.callTool = async (request: any) => {
      if (!(await configManager.isActionAllowed(tool, request.name))) {
        throw new Error(`Action not allowed: ${request.name}`);
      }
      
      const { timeout, retries, baseDelay } = await configManager.getRetryConfig(tool);
      
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
    // Enhanced error handling with Python-specific context
    if (error instanceof PythonToolError) {
      await logger.error(`Python environment error for ${tool}`, {
        error: error.message,
        cause: error.cause?.message,
        stack: error.stack
      });
    } else {
      await logger.error(`Failed to connect to ${tool}`, {
        error: error.message,
        stack: error.stack,
        toolType: tool
      });
    }
    throw error;
  }
}

async function gatherObservations(repoPath: string, gitClient: any, filesystemClient: any, logger: any): Promise<any[]> {
  const observations = [];
  const pathResolver = await PathResolver.getInstance();
  await logger.info('Starting observation gathering');
  
  try {
    // Git observations with all available git-mcp tools
    const gitOps = [
      { name: 'git_status', args: { repo_path: repoPath }, type: 'git_status' },
      { name: 'git_diff', args: { repo_path: repoPath }, type: 'git_diff' },
      { name: 'git_diff_unstaged', args: { repo_path: repoPath }, type: 'unstaged_changes' },
      { name: 'git_diff_staged', args: { repo_path: repoPath }, type: 'staged_changes' },
      { name: 'git_log', args: { repo_path: repoPath, max_count: 5 }, type: 'recent_commits' }
    ];

    // Execute all git operations
    for (const op of gitOps) {
      await logger.debug(`Getting ${op.type}`);
      try {
        const result = await withRetry(
          () => timeoutPromise(
            gitClient.callTool({
              name: op.name,
              arguments: op.args
            }),
            10000,
            op.type
          ),
          {
            maxRetries: 3,
            baseDelay: 1000,
            operation: op.type,
            logger
          }
        );
        observations.push({ type: op.type, result });
      } catch (error) {
        await logger.warn(`Failed to gather ${op.type}`, { error });
        // Continue with other observations
      }
    }

    // Filesystem observations using all relevant filesystem-mcp tools
    const resolvedPath = await pathResolver.resolvePath(repoPath);
    const fsOps = [
      { 
        name: 'list_directory', 
        args: { path: resolvedPath }, 
        type: 'files' 
      },
      { 
        name: 'search_files', 
        args: { path: resolvedPath, pattern: '*.{js,ts,json}' }, 
        type: 'source_files' 
      },
      { 
        name: 'search_code', 
        args: { 
          path: resolvedPath, 
          pattern: 'error|warning|debug|async|await', 
          contextLines: 3 
        }, 
        type: 'code_analysis' 
      }
    ];

    // Execute all filesystem operations
    for (const op of fsOps) {
      await logger.debug(`Getting ${op.type}`);
      try {
        const result = await withRetry(
          () => timeoutPromise(
            filesystemClient.callTool({
              name: op.name,
              arguments: op.args
            }),
            10000,
            op.type
          ),
          {
            maxRetries: 3,
            baseDelay: 1000,
            operation: op.type,
            logger
          }
        );
        observations.push({ type: op.type, result });
      } catch (error) {
        await logger.warn(`Failed to gather ${op.type}`, { error });
        // Continue with other observations
      }
    }
    
    await logger.info('Observation gathering complete', { numObservations: observations.length });
    return observations;
  } catch (error: any) {
    await logger.error('Failed to gather observations', { error: error.message });
    throw error;
  }
}

async function executeAction(action: any, repoPath: string, gitClient: any, filesystemClient: any, logger: any) {
  await logger.info('Executing action', { 
    tool: action.tool,
    name: action.name
  });

  try {
    // Validate action first
    if (!action.tool || !action.name) {
      throw new Error('Invalid action: missing tool or name');
    }

    const client = action.tool === 'git-mcp' ? gitClient : filesystemClient;
    if (!client) {
      throw new Error(`Client not available for tool: ${action.tool}`);
    }

    // Get tool configuration to validate action
    const configManager = await ToolConfigManager.getInstance();
    if (!configManager.isActionAllowed(action.tool, action.name)) {
      throw new Error(`Action ${action.name} not allowed for tool ${action.tool}`);
    }

    // Initialize path resolver for path handling
    const pathResolver = await PathResolver.getInstance();

    // Prepare arguments based on tool type
    let args = { ...action.args };
    
    if (action.tool === 'git-mcp') {
      // Git operations always need resolved repo path
      args = {
        ...args,
        repo_path: await pathResolver.resolvePath(repoPath)
      };
    } else if (action.tool === 'filesystem-mcp') {
      // Resolve all path arguments for filesystem operations
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string' && (key.includes('path') || key.includes('dir'))) {
          args[key] = await pathResolver.resolvePath(value);
        }
      }
    }

    // Execute the action with retries
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

    await logger.debug('Action completed', { 
      tool: action.tool,
      name: action.name,
      result 
    });

    return result;
  } catch (error: any) {
    await logger.error('Action failed', {
      tool: action.tool,
      name: action.name,
      error: error.message
    });
    throw error;
  }
}

async function getChanges(repoPath: string, gitClient: any, logger: any) {
  await logger.info('Getting final changes');
  try {
    const pathResolver = await PathResolver.getInstance();
    const resolvedPath = await pathResolver.resolvePath(repoPath);
    
    // Get both staged and unstaged changes
    const [unstaged, staged] = await Promise.all([
      withRetry(
        () => timeoutPromise(
          gitClient.callTool({
            name: 'git_diff_unstaged',
            arguments: { repo_path: resolvedPath }
          }),
          10000,
          'Get unstaged changes'
        ),
        { maxRetries: 3, baseDelay: 1000, operation: 'Get unstaged changes', logger }
      ),
      withRetry(
        () => timeoutPromise(
          gitClient.callTool({
            name: 'git_diff_staged',
            arguments: { repo_path: resolvedPath }
          }),
          10000,
          'Get staged changes'
        ),
        { maxRetries: 3, baseDelay: 1000, operation: 'Get staged changes', logger }
      )
    ]);
    
    // Get status for a complete picture
    const status = await withRetry(
      () => timeoutPromise(
        gitClient.callTool({
          name: 'git_status',
          arguments: { repo_path: resolvedPath }
        }),
        10000,
        'Get git status'
      ),
      { maxRetries: 3, baseDelay: 1000, operation: 'Get git status', logger }
    );
    
    const changes = {
      status,
      unstaged,
      staged
    };
    
    await logger.debug('Changes retrieved', {
      hasUnstaged: !!unstaged,
      hasStaged: !!staged,
      hasStatus: !!status
    });
    
    return changes;
  } catch (error: any) {
    await logger.error('Failed to get changes', { error: error.message });
    throw error;
  }
}

async function getNextAction(anthropicClient: any, data: any, logger: any) {
  await logger.info('Getting next actions from Claude');
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
    await logger.debug('Parsing Claude response', { raw: parsedJson });
    
    const validatedResponse = ClaudeResponseSchema.safeParse(parsedJson);
    if (!validatedResponse.success) {
      await logger.error('Invalid Claude response format', { 
        error: validatedResponse.error.message,
        raw: parsedJson 
      });
      throw new Error(`Invalid Claude response: ${validatedResponse.error.message}`);
    }
    
    await logger.debug('Claude response validated', { response: validatedResponse.data });
    return validatedResponse.data;
  } catch (error: any) {
    await logger.error('Failed to get next action from Claude', { error: error.message });
    throw error;
  }
}

async function writeReport(agentId: string, data: any, logger: any) {
  if (!agentId) {
    await logger.error('Agent ID is undefined', { data });
    throw new Error('Cannot write report: agent ID is undefined');
  }

  await logger.info('Writing final report');
  const client = await connectMcpTool('filesystem-mcp', logger);
  const pathResolver = await PathResolver.getInstance();
  
  try {
    // First ensure the reports directory exists
    const reportsDir = await pathResolver.resolvePath('reports');
    await withRetry(
      () => timeoutPromise(
        client.callTool({
          name: 'create_directory',
          arguments: { path: reportsDir }
        }),
        10000,
        'Create reports directory'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Create reports directory',
        logger
      }
    );
    
    // Generate report path
    const timestamp = Date.now();
    const reportFile = `${agentId}-report-${timestamp}.json`;
    const reportPath = await pathResolver.resolvePath(`reports/${reportFile}`);
    
    await logger.debug('Writing report file', { reportPath });
    
    // Write the report with retries
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
        'Write report file'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Write report file',
        logger
      }
    );
    
    // Verify the report was written correctly
    await withRetry(
      () => timeoutPromise(
        client.callTool({
          name: 'read_file',
          arguments: { path: reportPath }
        }),
        10000,
        'Verify report file'
      ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        operation: 'Verify report file',
        logger
      }
    );
    
    await logger.info('Report written and verified successfully', { reportPath });
    return reportPath;
  } catch (error: any) {
    await logger.error('Failed to write report', { error: error.message });
    throw error;
  }
  // Removed client.close() since coordinator handles cleanup
}

export async function runScenarioAgent(args: any) {
  const logger = await getLogger(args.session, `scenario-${args.id}`);
  let branchName: string | undefined;
  await logger.info('Scenario agent started', {
    hypothesis: args.hypothesis,
    language: args.language
  });

  const anthropic = await AnthropicClient.getClient();
  
  // Initialize MCP clients for tools
  await logger.info('Connecting to MCP tools');
  const gitClient = await connectMcpTool('git-mcp', logger);
  const filesystemClient = await connectMcpTool('filesystem-mcp', logger);
  
  try {
    // Create isolated branch for investigation
    await logger.info('Creating isolated git branch');
    branchName = `debug-${args.session}-${Date.now()}`;
    
    if (args.repoPath) {
      // Create and checkout new branch using the correct tool names
      await gitClient.callTool({
        name: 'git_create_branch',
        arguments: {
          repo_path: args.repoPath,
          branch_name: branchName
        }
      });
      
      await gitClient.callTool({
        name: 'git_checkout',
        arguments: {
          repo_path: args.repoPath,
          branch_name: branchName
        }
      });
      await logger.info('Git branch created', { branchName });
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
      await logger.info(`Starting iteration ${investigation.iteration + 1}`);

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
        await logger.info('Investigation complete, writing report');
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
      await logger.warn('Investigation timed out');
      await writeReport(args.id, {
        success: false,
        explanation: 'Investigation timed out without finding solution',
        changes: await getChanges(args.repoPath, gitClient, logger)
      }, logger);
    }
    
  } catch (error: any) {
    await logger.error('Scenario agent failed', { error: error.message });
    throw error;
  } finally {
    // Cleanup branch if we created one
    if (args.repoPath && branchName) {
      try {
        // First try to checkout main
        try {
          await gitClient.callTool({
            name: "git_checkout",
            arguments: {
              repo_path: args.repoPath,
              branch_name: "main"
            }
          });
        } catch {
          // If main doesn't exist, try master
          await gitClient.callTool({
            name: "git_checkout",
            arguments: {
              repo_path: args.repoPath,
              branch_name: "master"
            }
          });
        }

        // Since git-mcp doesn't have a direct branch delete,
        // we need to use filesystem operation for this specific command
        const { filesystemOperations } = await import('./util/mcp.js');
        await filesystemOperations.executeCommand(
          `cd ${args.repoPath} && git branch -D ${branchName}`
        );
        
        await logger.info('Cleaned up investigation branch', { branchName });
      } catch (error) {
        await logger.error('Failed to cleanup investigation branch', { error, branchName });
      }
    }

    // Clean up session through coordinator
    const { agentCoordinator } = await import('./agents/coordinator.js');
    await agentCoordinator.cleanupSession(args.session);
    await logger.close();
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
