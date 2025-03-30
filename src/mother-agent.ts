// src/mother-agent.ts
import { spawn } from 'child_process';
import { join } from 'path';
import { log } from './util/logger.js';
import { connectRequiredTools } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';
import { updateMemoryBank } from './util/membank.js';
import { getProjectId } from './util/sanitize.js';
import { Message } from '@anthropic-ai/sdk/resources/messages.js';

const MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes
const startTime = Date.now();
const useMemoryBank = process.env.USE_MEMORY_BANK === 'true';

// Helper for type narrowing Claude's responses
function getMessageText(message: Message): string {
  const content = message.content[0];
  return 'text' in content ? content.text : '';
}
// Helper to connect to MCP tools
export async function runMotherAgent(sessionId: string, error: string, context: string, language: string, filePath: string, repoPath: string) {
  await log(sessionId, 'mother', 'info', 'Mother agent started');
  const projectId = getProjectId(repoPath);
  const activeScenarios = new Set<string>();

  try {
    // OBSERVE: Environment setup
    await log(sessionId, 'mother', 'info', 'OODA: observe');
    const { gitClient, filesystemClient } = await connectRequiredTools('mother', sessionId);

    const anthropic = new (await import('@anthropic-ai/sdk')).default();
    let conversation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'assistant',  // Claude needs to be the assistant
        content: `You are the mother agent in an OODA loop debugging investigation. 

You have access to these tools:

git-mcp:
- git_status: Show working tree status
- git_diff: Show changes in working directory
- git_diff_staged: Show staged changes
- git_log: Show commit history

filesystem-mcp:
- read_file: Read file contents
- search_files: Search for files
- write_file: Write file contents

Use tools by wrapping requests in XML tags like:
<use_mcp_tool>
  <server_name>git-mcp</server_name>
  <tool_name>git_status</tool_name>
  <arguments>
    {
      "repo_path": "/path/to/repo"
    }
  </arguments>
</use_mcp_tool>`
      }, {
        role: 'user',
        content: `Error: ${error}
Context: ${context}
Language: ${language}
File: ${filePath}
Repo: ${repoPath}
Session: ${sessionId}
Project: ${projectId}
${useMemoryBank ? '\nPrevious debugging attempts and context are available in the memory-bank directory if needed.' : ''}`
      }]
    });

    // ORIENT: Watch for tools and hypotheses
    await log(sessionId, 'mother', 'info', 'OODA: orient');

    while (!getMessageText(conversation).includes('<solution>')) {
      const response = getMessageText(conversation);

      // Handle any tool requests
      if (response.includes('<use_mcp_tool>')) {
        const toolCall = response.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/)?.[0];
        if (!toolCall) continue;

        const server = toolCall.includes('git-mcp') ? gitClient : filesystemClient;
        const tool = toolCall.match(/git_\w+|read_file|write_file|search_files/)?.[0];
        const argsMatch = toolCall.match(/{[\s\S]*?}/)?.[0];
        if (!tool || !argsMatch) continue;

        const result = await server.callTool({
          name: tool,
          arguments: JSON.parse(argsMatch)
        });

        // Give Claude raw tool output
        conversation = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: JSON.stringify(result)
          }]
        });
      }

// Handle any hypotheses
if (response.includes('<hypothesis>')) {
  const hypotheses = response.split('<hypothesis>').slice(1);
  
  if (useMemoryBank) {
    await updateMemoryBank(projectId, response, 'activeContext');
  }
  
  // Spawn scenarios for new hypotheses
  const results = await Promise.all(hypotheses.map(async (hypothesis: string) => {
    const scenarioId = `${sessionId}-${activeScenarios.size}`;
    if (activeScenarios.has(scenarioId)) return '';
    activeScenarios.add(scenarioId);

    const child = spawn('node', [
      join(DEEBO_ROOT, 'build/scenario-agent.js'),
      '--id', scenarioId,
      '--session', sessionId,
      '--error', error,
      '--context', context,
      '--hypothesis', hypothesis,
      '--language', language,
      '--file', filePath || '',
      '--repo', repoPath
    ]);

    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);

    return new Promise<string>((resolve) => {
      child.on('exit', () => resolve(output));
    });
  }));

  // Give Claude raw output - no mapping/structuring needed
  conversation = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: results.join('\n')
    }]
  });
}

      if (Date.now() - startTime > MAX_RUNTIME) {
        throw new Error('Investigation exceeded maximum runtime');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Structured record for our logs
    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Error: ${error}` : ''}
${getMessageText(conversation)}
Scenarios Run: ${activeScenarios.size}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }

    return getMessageText(conversation);

  } catch (err) {
    const error = err as Error;
    await log(sessionId, 'mother', 'error', `Failed: ${error.message}`);

    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Error: ${error}` : ''}
Failed: ${error.message}
Scenarios Run: ${activeScenarios.size}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }

    throw error;
  }
}