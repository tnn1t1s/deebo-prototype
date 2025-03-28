import { mkdir } from 'fs/promises';
import { join } from 'path';
import { createLogger } from './util/logger.js';
import { gitOperations, gitBranchOperations, filesystemOperations } from './util/mcp.js';

type MicroOodaState = 'investigate' | 'analyze' | 'validate' | 'report';

interface ScenarioArgs {
  id: string;
  session: string;
  error: string;
  context: string;
  hypothesis: string;
  language: string;
  repoPath?: string;
  filePath?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): ScenarioArgs {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
      result[key] = value;
      if (value) i++;
    }
  }
  return {
    id: result.id || '',
    session: result.session || '',
    error: result.error || '',
    context: result.context || '',
    hypothesis: result.hypothesis || '',
    language: result.language || 'typescript',
    repoPath: result.repo || undefined,
    filePath: result.file || undefined
  };
}


/**
 * Main scenario agent function
 * - Free to explore its hypothesis
 * - Has both git-mcp and filesystem-mcp
 * - Follows micro-OODA naturally
 */
export async function runScenarioAgent(args: ScenarioArgs) {
  const logger = await createLogger(args.session, `scenario-${args.id}`);
  await logger.info('Scenario agent started', { hypothesis: args.hypothesis });

  try {
    // INVESTIGATE: Connect to tools
    await logger.info('Micro OODA cycle', { state: 'investigate' as MicroOodaState });
    // Create investigation branch if we have a repo
    if (args.repoPath) {
      const branchName = `debug-${args.session}-${Date.now()}`;
      await gitBranchOperations.createBranch(args.repoPath, branchName);
      await gitBranchOperations.checkoutBranch(args.repoPath, branchName);
    }

    let complete = false;
    while (!complete) {
      // INVESTIGATE: Gather current state
      await logger.info('Micro OODA cycle', { state: 'investigate' as MicroOodaState });
      const observations = {
        git: args.repoPath ? {
          status: await gitOperations.status(args.repoPath),
          diff: await gitOperations.diffUnstaged(args.repoPath)
        } : null,
        files: args.filePath ? 
          await filesystemOperations.readFile(args.filePath) : null,
        context: await filesystemOperations.searchCode(
          '*.{js,ts,json}',
          args.repoPath || process.env.DEEBO_ROOT || process.cwd()
        )
      };

      // ANALYZE: Let Claude determine next actions
      await logger.info('Micro OODA cycle', { state: 'analyze' as MicroOodaState });
      // Trust process environment - no need to handle API key
      const anthropic = new (await import('@anthropic-ai/sdk')).default();

      const analysis = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are investigating this error: ${args.error}
Based on hypothesis: ${args.hypothesis}
Return JSON with:
{
  "actions": [{
    "tool": "git-mcp" | "filesystem-mcp",
    "name": string,
    "args": object
  }],
  "complete": boolean,
  "success": boolean,
  "explanation": string
}`,
        messages: [{
          role: 'user',
          content: `Current observations:\n${JSON.stringify(observations, null, 2)}\n\nWhat actions should I take next?`
        }]
      });

      const content = analysis.content[0];
      if (!('text' in content)) {
        throw new Error('Expected text response from Claude');
      }
      const { actions, complete: shouldComplete, success, explanation } = JSON.parse(content.text);

      // VALIDATE: Execute suggested actions
      await logger.info('Micro OODA cycle', { state: 'validate' as MicroOodaState });
      if (actions?.length) {
        // Define which operations need different argument handling
        const GIT_REPO_OPS = ['git_status', 'git_diff', 'git_checkout', 'git_create_branch'];
        const CACHE_OPS = ['get_cached_tasks', 'set_cached_tasks', 'invalidate_task_cache'];

        for (const action of actions) {
          if (action.tool === 'git-mcp') {
            if (GIT_REPO_OPS.includes(action.name) && args.repoPath) {
              switch (action.name) {
                case 'git_status':
                  await gitOperations.status(args.repoPath);
                  break;
                case 'git_diff':
                  await gitOperations.diffUnstaged(args.repoPath);
                  break;
                case 'git_checkout':
                  await gitBranchOperations.checkoutBranch(args.repoPath, action.args.branch_name);
                  break;
                case 'git_create_branch':
                  await gitBranchOperations.createBranch(args.repoPath, action.args.branch_name);
                  break;
              }
            }
          } else {
            // Handle filesystem operations
            switch (action.name) {
              case 'read_file':
                await filesystemOperations.readFile(action.args.path);
                break;
              case 'write_file':
                await filesystemOperations.writeFile(action.args.path, action.args.content);
                break;
              case 'search_files':
                await filesystemOperations.searchCode(action.args.pattern, action.args.path);
                break;
            }
          }
        }
      }

      // Should we continue exploring?
      if (shouldComplete) {
        complete = true;
        // REPORT: Write findings
        await logger.info('Micro OODA cycle', { state: 'report' as MicroOodaState });
        // Create reports directory
        const reportsDir = join(process.env.DEEBO_ROOT || process.cwd(), 'reports');
        await mkdir(reportsDir, { recursive: true });
        
        const reportPath = join(process.env.DEEBO_ROOT || process.cwd(), 'reports', `${args.id}-report-${Date.now()}.json`);
        const report = {
          success,
          explanation,
          changes: success && args.repoPath ? 
            await gitOperations.diffUnstaged(args.repoPath) : null
        };

        await filesystemOperations.writeFile(
          reportPath,
          JSON.stringify(report, null, 2)
        );
      }
    }
  } catch (error) {
    await logger.error('Scenario agent failed', { error });
    throw error;
  }
}

// Parse args and run
if (typeof process !== 'undefined') {
  const args = parseArgs(process.argv);
  runScenarioAgent(args).catch(err => {
    console.error('Scenario agent failed:', err);
    process.exit(1);
  });
}
