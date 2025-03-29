import { spawn } from 'child_process';
import { join } from 'path';
import { log } from './util/logger.js';
import { connectMcpTool } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';

type OodaState = 'observe' | 'orient' | 'decide' | 'act';

export async function runMotherAgent(
  sessionId: string,
  error: string,
  context: string,
  language: string,
  filePath: string,
  repoPath: string
): Promise<any> {
  await log(sessionId, 'mother', 'info', 'Mother agent started', { error, language });

  try {
    // Connect to tools and get initial observations
    const gitClient = await connectMcpTool('mother-git', 'git-mcp');
    const filesystemClient = await connectMcpTool('mother-filesystem', 'filesystem-mcp');

    const observations = {
      git: {
        status: await gitClient.callTool({
          name: 'git_status',
          arguments: { repo_path: repoPath }
        }),
        diff: await gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: repoPath }
        })
      },
      files: filePath ? await filesystemClient.callTool({
        name: 'read_file',
        arguments: { path: filePath }
      }) : null
    };

    // Let Claude analyze and suggest hypotheses
    const anthropic = new (await import('@anthropic-ai/sdk')).default();
    const analysis = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are analyzing a bug to determine debugging strategies. Think naturally about different hypotheses and explain your reasoning.

Tools are available via XML tags:
<function_calls>
<invoke name="git_status|git_diff|etc">
<parameter name="repo_path">${repoPath}</parameter>
</invoke>
</function_calls>

When you identify a promising hypothesis, wrap it in <debug_hypothesis> tags.
You can have multiple hypotheses and explain your thinking between them.`,
      messages: [{
        role: 'user',
        content: `Error: ${error}\nContext: ${context}\nObservations: ${JSON.stringify(observations, null, 2)}\n\nAnalyze this issue and suggest debugging approaches.`
      }]
    });

    const content = analysis.content[0];
    if (!('text' in content)) {
      throw new Error('Expected text response from Claude');
    }

    // Extract hypotheses from natural text
    const hypothesesMatches = content.text.match(/<debug_hypothesis>(.*?)<\/debug_hypothesis>/gs) || [];
    const hypotheses = hypothesesMatches.map(match => 
      match.replace(/<\/?debug_hypothesis>/g, '').trim()
    );

    await log(sessionId, 'mother', 'info', 'Creating scenario agents', { 
      count: hypotheses.length,
      hypotheses 
    });

    // Run scenarios
    const results = await Promise.all(hypotheses.map(async (hypothesis): Promise<any> => {
      const scenarioPath = join(DEEBO_ROOT, 'build/scenario-agent.js');
      const childProcess = spawn('node', [
        scenarioPath,
        '--id', `scenario-${sessionId}-${Date.now()}`,
        '--session', sessionId,
        '--error', error,
        '--context', context,
        '--hypothesis', hypothesis,
        '--language', language,
        '--file', filePath,
        '--repo', repoPath
      ]);

      let stdout = '';
      let stderr = '';
      childProcess.stdout.on('data', data => stdout += data);
      childProcess.stderr.on('data', data => stderr += data);

      return new Promise((resolve, reject) => {
        childProcess.on('exit', code => {
          if (code === 0 && stdout) {
            try {
              const report = JSON.parse(stdout);
              resolve({ id: hypothesis, ...report });
            } catch (err) {
              reject(new Error(`Invalid report format: ${err}`));
            }
          } else {
            reject(new Error(`Scenario failed: ${stderr || `Exit code ${code}`}`));
          }
        });
      });
    }));

    await log(sessionId, 'mother', 'info', 'Scenario results', {
      total: results.length,
      successful: results.filter(r => r.success).length,
      results
    });

    // Let Claude evaluate results naturally
    const evaluation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are evaluating debugging results. Think through the evidence and explain your conclusions.
If you identify a solution, wrap it in <debug_solution> tags.`,
      messages: [{
        role: 'user',
        content: `Here are the results from our debugging attempts:\n\n${results.map(r => 
          `Scenario attempted: ${r.id}\nOutcome: ${r.explanation}\n${r.changes ? `Changes made:\n${r.changes}` : ''}\n`
        ).join('\n\n')}`
      }]
    });

    const evalContent = evaluation.content[0];
    if (!('text' in evalContent)) {
      throw new Error('Expected text response from Claude');
    }

    // Look for solution in natural text
    const solutionMatch = evalContent.text.match(/<debug_solution>(.*?)<\/debug_solution>/);
    if (solutionMatch) {
      const solution = solutionMatch[1].trim();
      await log(sessionId, 'mother', 'info', 'Solution found', { solution });
      return { solution };
    }

    await log(sessionId, 'mother', 'info', 'No solution found', { evaluation: evalContent.text });
    return null;

  } catch (error) {
    await log(sessionId, 'mother', 'error', 'Mother agent failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}