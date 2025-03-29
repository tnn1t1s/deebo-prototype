import { join } from 'path';
import { log } from './util/logger.js';
import { connectMcpTool } from './util/mcp.js';

interface ScenarioArgs {
  id: string;
  session: string;
  error: string;
  context: string;
  hypothesis: string;
  language: string;
  repoPath: string;
  filePath?: string;
}

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

  const repoPath = result.repo;
  if (!repoPath) {
    throw new Error('Required argument missing: --repo');
  }

  return {
    id: result.id || '',
    session: result.session || '',
    error: result.error || '',
    context: result.context || '',
    hypothesis: result.hypothesis || '',
    language: result.language || 'typescript',
    repoPath,
    filePath: result.file || undefined
  };
}

export async function runScenarioAgent(args: ScenarioArgs) {
  await log(args.session, `scenario-${args.id}`, 'info', 'Scenario agent started', { hypothesis: args.hypothesis });

  try {
    // Set up tools
    const gitClient = await connectMcpTool('scenario-git', 'git-mcp');
    const filesystemClient = await connectMcpTool('scenario-filesystem', 'filesystem-mcp');

    // Create investigation branch
    const branchName = `debug-${args.session}-${Date.now()}`;
    await gitClient.callTool({
      name: 'git_create_branch',
      arguments: { repo_path: args.repoPath, branch_name: branchName }
    });
    await gitClient.callTool({
      name: 'git_checkout',
      arguments: { repo_path: args.repoPath, branch_name: branchName }
    });

    while (true) { // Let Claude decide when to stop
      const observations = {
        git: {
          status: await gitClient.callTool({
            name: 'git_status',
            arguments: { repo_path: args.repoPath }
          }),
          diff: await gitClient.callTool({
            name: 'git_diff',
            arguments: { repo_path: args.repoPath }
          })
        },
        files: args.filePath ? await filesystemClient.callTool({
          name: 'read_file',
          arguments: { path: args.filePath }
        }) : null
      };

      const anthropic = new (await import('@anthropic-ai/sdk')).default();
      const analysis = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are investigating this error: ${args.error}
Based on hypothesis: ${args.hypothesis}

You can think and explain naturally while using tools. Tools are available via XML:
<function_calls>
<invoke name="git_status|git_diff|etc">
<parameter name="repo_path">${args.repoPath}</parameter>
</invoke>
</function_calls>

When you want to report success, wrap the explanation in <debug_success> tags.
When you want to report failure, wrap the explanation in <debug_failure> tags.
Only use these tags when you're ready to conclude the investigation.`,
        messages: [{
          role: 'user', 
          content: `Current state: ${JSON.stringify(observations, null, 2)}\n\nContinue investigating based on your hypothesis.`
        }]
      });

      const content = analysis.content[0];
      if (!('text' in content)) {
        throw new Error('Expected text response from Claude');
      }

      // Log Claude's thinking
      await log(args.session, `scenario-${args.id}`, 'info', 'Investigation progress', {
        thinking: content.text
      });

      // Check for conclusion
      const successMatch = content.text.match(/<debug_success>(.*?)<\/debug_success>/);
      const failureMatch = content.text.match(/<debug_failure>(.*?)<\/debug_failure>/);

      if (successMatch) {
        const solution = successMatch[1].trim();
        // Get final git diff for the changes made
        const changes = await gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: args.repoPath }
        });

        // Write conclusion to stdout and exit
        console.log(JSON.stringify({
          success: true,
          explanation: solution,
          changes
        }));
        process.exit(0);
      }

      if (failureMatch) {
        const reason = failureMatch[1].trim();
        console.log(JSON.stringify({
          success: false,
          explanation: reason,
          changes: null
        }));
        process.exit(0);
      }

      // If no conclusion, continue investigation
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between iterations
    }
  } catch (error) {
    await log(args.session, `scenario-${args.id}`, 'error', 'Scenario agent failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    // Report error through stdout
    console.log(JSON.stringify({
      success: false,
      explanation: error instanceof Error ? error.message : String(error),
      changes: null
    }));
    process.exit(1);
  }
}

// Parse args and run
if (typeof process !== 'undefined') {
  const args = parseArgs(process.argv);
  runScenarioAgent(args).catch(err => {
    console.error(JSON.stringify({
      success: false,
      explanation: err instanceof Error ? err.message : String(err),
      changes: null
    }));
    process.exit(1);
  });
}