import { mkdir } from 'fs/promises';
import { join } from 'path';
import { log } from './util/logger.js';
import { connectMcpTool } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';

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
  await log(args.session, `scenario-${args.id}`, 'info', 'Scenario agent started', { hypothesis: args.hypothesis });

  try {
    // INVESTIGATE: Connect to tools
    await log(args.session, `scenario-${args.id}`, 'info', 'Micro OODA cycle', { state: 'investigate' as MicroOodaState });
    const gitClient = await connectMcpTool('scenario-git', 'git-mcp');
    const filesystemClient = await connectMcpTool('scenario-filesystem', 'filesystem-mcp');

    // Create investigation branch if we have a repo
    if (args.repoPath) {
      const branchName = `debug-${args.session}-${Date.now()}`;
      await gitClient.callTool({
        name: 'git_create_branch',
        arguments: { repo_path: args.repoPath, branch_name: branchName }
      });
      await gitClient.callTool({
        name: 'git_checkout',
        arguments: { repo_path: args.repoPath, branch_name: branchName }
      });
    }

    let complete = false;
    while (!complete) {
      // INVESTIGATE: Gather current state
      await log(args.session, `scenario-${args.id}`, 'info', 'Micro OODA cycle', { state: 'investigate' as MicroOodaState });
      const observations = {
        git: args.repoPath ? {
          status: await gitClient.callTool({
            name: 'git_status',
            arguments: { repo_path: args.repoPath }
          }),
          diff: await gitClient.callTool({
            name: 'git_diff',
            arguments: { repo_path: args.repoPath }
          })
        } : null,
        files: args.filePath ? await filesystemClient.callTool({
          name: 'read_file',
          arguments: { path: args.filePath }
        }) : null,
        context: await filesystemClient.callTool({
          name: 'search_files',
          arguments: { 
            path: args.repoPath || DEEBO_ROOT,
            pattern: '*.{js,ts,json}'
          }
        })
      };

      // ANALYZE: Let Claude determine next actions
      await log(args.session, `scenario-${args.id}`, 'info', 'Micro OODA cycle', { state: 'analyze' as MicroOodaState });
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
      await log(args.session, `scenario-${args.id}`, 'info', 'Micro OODA cycle', { state: 'validate' as MicroOodaState });
      if (actions?.length) {
        for (const action of actions) {
          const client = action.tool === 'git-mcp' ? gitClient : filesystemClient;
          const toolArgs = action.tool === 'git-mcp' ? { ...action.args, repo_path: args.repoPath } : action.args;

          await client.callTool({
            name: action.name,
            arguments: toolArgs
          });
        }
      }

      // Should we continue exploring?
      if (shouldComplete) {
        complete = true;
        // REPORT: Write findings
        await log(args.session, `scenario-${args.id}`, 'info', 'Micro OODA cycle', { state: 'report' as MicroOodaState });
        // Create reports directory
        const reportsDir = join(DEEBO_ROOT, 'reports');
        await mkdir(reportsDir, { recursive: true });
        
        const reportPath = join(DEEBO_ROOT, 'reports', `${args.id}-report-${Date.now()}.json`);
        const report = {
          success,
          explanation,
          changes: success ? await gitClient.callTool({
            name: 'git_diff',
            arguments: { repo_path: args.repoPath }
          }) : null
        };

        await filesystemClient.callTool({
          name: 'write_file',
          arguments: {
            path: reportPath,
            content: JSON.stringify(report, null, 2)
          }
        });
      }
    }
  } catch (error) {
    await log(args.session, `scenario-${args.id}`, 'error', 'Scenario agent failed', { error });
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
