import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { createLogger } from './util/logger.js';
import { isInitialized } from './agents/index.js';

// Helper function to create logger with initialization check
async function getLogger(sessionId: string, component: string) {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  return createLogger(sessionId, component);
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
async function runScenarioAgent(args: any) {
  const logger = await getLogger(args.session, `scenario-${args.id}`);
  logger.info('Scenario agent started', {
    type: args.type,
    hypothesis: args.hypothesis,
    language: args.language
  });

  const anthropic = new Anthropic();
  let complete = false;
  let iteration = 0;
  const maxIterations = 5;
  
  // Initialize MCP clients for tools
  logger.info('Connecting to MCP tools');
  const gitClient = await connectMcpTool('git-mcp', logger);
  const desktopClient = await connectMcpTool('desktop-commander', logger);
  
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
    
    while (!complete && iteration < maxIterations) {
      logger.info(`Starting OODA iteration ${iteration + 1}`);
      // OBSERVE: Use tools to gather information
      logger.info('OBSERVE: Gathering information');
      const observations: any[] = await gatherObservations(args.repoPath, gitClient, desktopClient, logger);
      logger.debug('Observations gathered', { observations });
      
      // ORIENT: Have Claude analyze observations
      logger.info('ORIENT: Analyzing observations');
      const analysis = await getNextAction(anthropic, {
        observations,
        iteration,
        hypothesis: args.hypothesis
      }, logger);
      logger.debug('Analysis complete', { analysis });
      
      // DECIDE & ACT: Execute each suggested action using available tools
      logger.info(`ACT: Executing ${analysis.actions.length} actions`);
      for (const action of analysis.actions) {
        logger.debug('Executing action', { action });
        const result = await executeAction(action, args.repoPath, gitClient, desktopClient, logger);
        logger.debug('Action result', { result });
        observations.push({
          action,
          result,
          timestamp: new Date().toISOString()
        });
      }
      
      complete = analysis.complete;
      iteration++;
      
      if (complete) {
        logger.info('Solution found, preparing report');
        // Write final report
        await writeReport(args.id, {
          success: analysis.success,
          explanation: analysis.explanation,
          observations,
          changes: await getChanges(args.repoPath, gitClient, logger)
        }, logger);
        logger.info('Report written successfully');
        return;
      }
    }
    
    logger.error('Max iterations reached without finding solution');
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
    // Use path.join to ensure correct path resolution
    const path = await import('path');
    const toolPath = path.resolve(process.cwd(), 'tools', `${tool}.js`);
    
    logger.info(`Loading tool from: ${toolPath}`);
    
    const transport = new StdioClientTransport({
      command: 'node',
      args: [toolPath]
    });
    
    const client = new Client({
      name: `scenario-${tool}`,
      version: '1.0.0'
    });
    
    await client.connect(transport);
    logger.info(`Connected to ${tool} successfully`);
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
    const status = await gitClient.callTool({
      name: 'git_status',
      arguments: { repo_path: repoPath }
    });
    observations.push({type: 'git_status', result: status});
    
    // Git diff
    logger.debug('Getting git diff');
    const diff = await gitClient.callTool({
      name: 'git_diff',
      arguments: { repo_path: repoPath }
    });
    observations.push({type: 'git_diff', result: diff});
    
    // List relevant files
    logger.debug('Listing directory contents');
    const files = await desktopClient.callTool({
      name: 'list_directory',
      arguments: { path: repoPath }
    });
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
      case 'desktop-commander':
        return await executeDesktopAction(action, repoPath, desktopClient, logger);
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
    
    const result = await gitClient.callTool({
      name: action.name,
      arguments: {
        repo_path: repoPath,
        ...action.args
      }
    });
    logger.debug('Git action completed', { result });
    return result;
  } catch (error: any) {
    logger.error('Git action failed', { error: error.message, action });
    throw error;
  }
}

async function executeDesktopAction(action: any, repoPath: string, desktopClient: any, logger: any) {
  logger.debug('Executing desktop action', { action });
  try {
    // Only allow available desktop-commander tools
    const allowedDesktopActions = [
      'read_file',
      'write_file', 
      'edit_block',
      'list_directory',
      'create_directory',
      'execute_command',
      'search_code'
    ];
    
    if (!allowedDesktopActions.includes(action.name)) {
      throw new Error(`Unsupported desktop action: ${action.name}`);
    }
    
    const result = await desktopClient.callTool({
      name: action.name,
      arguments: action.args
    });
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

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Based on these observations, what actions should I take next to investigate the hypothesis?\n\nHypothesis: ${data.hypothesis}\n\nObservations:\n${JSON.stringify(data.observations)}\n\nIteration: ${data.iteration}`
      }]
    });

    const nextAction = JSON.parse(msg.content[0].text);
    logger.debug('Claude suggested next action', { nextAction });
    return nextAction;
  } catch (error: any) {
    logger.error('Failed to get next action from Claude', { error: error.message });
    throw error;
  }
}

async function writeReport(agentId: string, data: any, logger: any) {
  logger.info('Writing final report');
  const client = await connectMcpTool('desktop-commander', logger);
  try {
    const reportPath = `reports/${agentId}.json`;
    await client.callTool({
      name: 'write_file',
      arguments: {
        path: reportPath,
        content: JSON.stringify(data, null, 2)
      }
    });
    logger.info('Report written successfully', { reportPath });
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
