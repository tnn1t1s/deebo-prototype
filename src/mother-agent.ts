import { spawn } from 'child_process';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from './util/logger.js';
import { DIRS } from './util/config.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadPythonConfig, getPythonEnv } from './util/config.js';

type OodaState = 'observe' | 'orient' | 'decide' | 'act';

interface McpClient {
  callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
}

/**
 * Connect to MCP tool - trust the tool to handle its own setup
 */
async function connectMcpTool(tool: string): Promise<McpClient> {
  const client = new Client({
    name: `mother-${tool}`,
    version: '1.0.0'
  });

  let transport;
  if (tool === 'git-mcp') {
    // Git needs Python setup
    const config = await loadPythonConfig();
    transport = new StdioClientTransport({
      command: config.interpreter_path,
      args: ['-m', 'mcp_server_git'],
      env: getPythonEnv(config)
    });
  } else {
    // Filesystem just uses NPX
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      env: Object.entries(process.env).reduce<Record<string, string>>((acc, [key, val]) => {
        if (val !== undefined) {
          acc[key] = val;
        }
        return acc;
      }, {})
    });
  }

  await client.connect(transport);
  return client;
}

/**
 * Mother agent - keep it simple
 * - Has both git-mcp and filesystem-mcp
 * - Trusts OS for process isolation
 * - Trusts Claude for strategy
 * - One-way OODA state logging
 */
export async function runMotherAgent(
  sessionId: string,
  error: string,
  context: string,
  language: string,
  filePath: string,
  repoPath: string
): Promise<any> {
  // Create session directory
  await mkdir(join(DIRS.sessions, sessionId), { recursive: true });
  
  const logger = await createLogger(sessionId, 'mother');
  await logger.info('Mother agent started', { error, language });

  try {
    // OBSERVE: Connect to tools and analyze error
    await logger.info('OODA transition', { state: 'observe' as OodaState });
    const gitClient = await connectMcpTool('git-mcp');
    const filesystemClient = await connectMcpTool('filesystem-mcp');

    // Get initial context
    const observations = {
      git: repoPath ? {
        status: await gitClient.callTool({
          name: 'git_status',
          arguments: { repo_path: repoPath }
        }),
        diff: await gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: repoPath }
        })
      } : null,
      files: filePath ? await filesystemClient.callTool({
        name: 'read_file',
        arguments: { path: filePath }
      }) : null,
      context: await filesystemClient.callTool({
        name: 'search_files',
        arguments: { 
          path: repoPath || process.cwd(),
          pattern: '*.{js,ts,json}'
        }
      })
    };

    // ORIENT: Let Claude analyze and suggest hypotheses
    await logger.info('OODA transition', { state: 'orient' as OodaState });
    const anthropic = new (await import('@anthropic-ai/sdk')).default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const analysis = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are analyzing a bug to determine investigation strategy. Return JSON array of hypotheses:
[{
  "type": string,
  "description": string,
  "suggestedTools": [{
    "tool": "git-mcp" | "filesystem-mcp",
    "name": string,
    "args": object
  }]
}]`,
      messages: [{
        role: 'user',
        content: `Error: ${error}\nContext: ${context}\nObservations: ${JSON.stringify(observations, null, 2)}`
      }]
    });

    const content = analysis.content[0];
    if (!('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    const hypotheses = JSON.parse(content.text);

    // DECIDE: Create scenario agents
    await logger.info('OODA transition', { state: 'decide' as OodaState });
    const scenarioIds = hypotheses.map((h: { type: string }) => `scenario-${sessionId}-${h.type}`);
    await logger.info('Creating scenario agents', { scenarioIds });

    // ACT: Run scenario agents in parallel
    await logger.info('OODA transition', { state: 'act' as OodaState });
    const results = await Promise.all(hypotheses.map(async (hypothesis: any) => {
      const scenarioId = `scenario-${sessionId}-${hypothesis.type}`;
      const scenarioPath = join(process.cwd(), 'build/scenario-agent.js');

      try {
        // Spawn scenario agent as isolated process
        const childProcess = spawn('node', [
          scenarioPath,
          '--id', scenarioId,
          '--session', sessionId,
          '--error', error,
          '--context', context,
          '--hypothesis', hypothesis.description,
          '--language', language,
          '--file', filePath,
          '--repo', repoPath
        ], {
          stdio: 'pipe',
          detached: true
        });

        // Wait for result
        return new Promise((resolve, reject) => {
          childProcess.on('exit', async (code) => {
            if (code === 0) {
              try {
                // Let scenario agent finish writing report
                await new Promise(r => setTimeout(r, 100));

                // Find report file
                const reportFile = (await filesystemClient.callTool({
                  name: 'list_directory',
                  arguments: { path: DIRS.reports }
                }) as string[]).find(f => f.startsWith(`${scenarioId}-report-`));
                
                if (!reportFile) {
                  reject(new Error('Report file not found'));
                  return;
                }

                // Read report
                const report = JSON.parse(
                  (await filesystemClient.callTool({
                    name: 'read_file',
                    arguments: { path: join(DIRS.reports, reportFile) }
                  })) as string
                );

                resolve({ id: scenarioId, ...report });
              } catch (error) {
                reject(error);
              }
            } else {
              reject(new Error(`Agent exited with code ${code}`));
            }
          });

          // Let OS handle cleanup
          childProcess.unref();
        });
      } catch (error) {
        logger.error('Scenario agent failed', { scenarioId, error });
        return {
          id: scenarioId,
          success: false,
          confidence: 0,
          fix: null,
          explanation: String(error)
        };
      }
    }));

    // OBSERVE results
    await logger.info('OODA transition', { state: 'observe' as OodaState });
    await logger.info('Scenario results', { 
      total: results.length,
      successful: results.filter((r: any) => r.success).length
    });

    // ORIENT: Let Claude evaluate results
    await logger.info('OODA transition', { state: 'orient' as OodaState });
    const evaluation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are evaluating debugging results. Return JSON:
{
  "complete": boolean,
  "result": {
    "fix": string,
    "confidence": number,
    "explanation": string
  }
}`,
      messages: [{
        role: 'user',
        content: JSON.stringify(results)
      }]
    });

    const evalContent = evaluation.content[0];
    if (!('text' in evalContent)) {
      throw new Error('Expected text response from Claude');
    }
    const { complete, result } = JSON.parse(evalContent.text);

    // DECIDE & ACT on evaluation
    await logger.info('OODA transition', { state: 'decide' as OodaState });
    if (complete && result) {
      await logger.info('OODA transition', { state: 'act' as OodaState, action: 'complete' });
      return result;
    }

    await logger.info('OODA transition', { state: 'act' as OodaState, action: 'fail' });
    throw new Error('No solution found');
  } catch (error) {
    logger.error('Mother agent failed', { error });
    throw error;
  }
}
