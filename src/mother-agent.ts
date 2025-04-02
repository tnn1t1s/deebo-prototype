// src/mother-agent.ts
/**
 * 📌 Why this is the best version:
	•	✅ Keeps full message history without resetting
	•	✅ Supports multiple tool calls per Claude response
	•	✅ Spawns scenarios from multiple hypotheses
	•	✅ Never throws on malformed XML, logs gently instead
	•	✅ Doesn’t force memory bank writes — Mother can directly choose via filesystem-mcp
	•	✅ Maintains Deebo’s spirit: autonomy, freedom to fail, and graceful continuation
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { log } from './util/logger.js';
import { connectRequiredTools } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';
import { updateMemoryBank } from './util/membank.js';
import { getProjectId } from './util/sanitize.js';
import { Message } from '@anthropic-ai/sdk/resources/messages.js';
import { createScenarioBranch } from './util/branch-manager.js';

const MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes
const SCENARIO_TIMEOUT = 10 * 60 * 1000; 
const useMemoryBank = process.env.USE_MEMORY_BANK === 'true';

// Helper for Claude's responses
function getMessageText(message: Message): string {
  if (!message?.content?.length) return '';
  return message.content
    .map(block => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'tool_use':
          return `<tool_use>${JSON.stringify(block)}</tool_use>`;
        case 'thinking':
          return block.thinking;
        case 'redacted_thinking':
          return block.data;
        default:
          return '';
      }
    })
    .join('');
}

// Mother agent main loop
export async function runMotherAgent(sessionId: string, error: string, context: string, language: string, filePath: string, repoPath: string) {
  await log(sessionId, 'mother', 'info', 'Mother agent started', { repoPath });
  const projectId = getProjectId(repoPath);
  const activeScenarios = new Set<string>();
  const startTime = Date.now();
  const memoryBankPath = join(DEEBO_ROOT, 'memory-bank', projectId);

  try {
    // OBSERVE: Setup tools and Claude
    await log(sessionId, 'mother', 'info', 'OODA: observe', { repoPath });
    const { gitClient, filesystemClient } = await connectRequiredTools('mother', sessionId, repoPath);
    const anthropic = new (await import('@anthropic-ai/sdk')).default();

    // Initial conversation context
    const messages: { role: 'assistant' | 'user', content: string }[] = [{
      role: 'assistant',
      content: `You are the mother agent in an OODA loop debugging investigation. Your core mission:

1. INVESTIGATE and HYPOTHESIZE aggressively
2. Don't wait for perfect information
3. Generate hypotheses even if you're uncertain

KEY DIRECTIVES:
- Always generate at least one hypothesis within your first 2-3 responses
- Use <hypothesis>Your hypothesis here</hypothesis> liberally
- Better to spawn 5 wrong scenario agents than miss the right one
- If you see an error message, immediately form hypotheses about its causes
- Don't wait for full context - start with what you have
- AVOID REDUNDANT HYPOTHESES - read scenario reports to learn what's been tried
- Pass what failed to scenarios via context argument so they don't waste time
${useMemoryBank ? `
MEMORY BANK INVESTIGATION AIDS:
The memory bank at ${memoryBankPath} contains two key files to help your investigation:

1. activeContext.md - Your live investigation notebook:
- READ THIS FIRST when starting an investigation using ${memoryBankPath}/activeContext.md
- Contains your previous debugging notes and observations
- Shows which approaches were promising vs dead ends
- Records important error patterns you've noticed
- Use this to avoid repeating failed approaches
- Read this to understand which parts of the code were already examined

2. progress.md - The full debugging history (access at ${memoryBankPath}/progress.md):
- Contains complete records of all debug sessions
- Shows which hypotheses were tried and their outcomes
- Lists all scenarios that were run and their results
- Use this to see if similar bugs were fixed before

Use these files to:
- Build on previous investigation progress
- Spot patterns in failing scenarios
- Generate better hypotheses based on what's worked/failed
- Provide relevant context to scenario agents
- Track the evolution of your debugging approach
- Take notes! You're a scientist mother (think Dr. Akagi), not a robot. Be creative and curious.

IMPORTANT: Always use ${memoryBankPath} as the absolute path for memory bank files. Never use relative paths.
` : ''}

TOOL USAGE:
Always use this exact format for tools:
<use_mcp_tool>
  <server_name>git-mcp</server_name>
  <tool_name>git_status</tool_name>
  <arguments>
    {
      "repo_path": "/path/to/repo"
    }
  </arguments>
</use_mcp_tool>

Available Tools:
git-mcp (use for ALL git operations):
- git_status: Show working tree status
  Example: { "repo_path": "/path/to/repo" }
- git_diff_unstaged: Show changes in working directory not yet staged
  Example: { "repo_path": "/path/to/repo" }
- git_diff_staged: Show changes that are staged for commit
  Example: { "repo_path": "/path/to/repo" }
- git_diff: Compare current state with a branch or commit
  Example: { "repo_path": "/path/to/repo", "target": "main" }
- git_add: Stage file changes
  Example: { "repo_path": "/path/to/repo", "files": ["file1.ts", "file2.ts"] }
- git_commit: Commit staged changes
  Example: { "repo_path": "/path/to/repo", "message": "commit message" }
- git_reset: Unstage all changes
  Example: { "repo_path": "/path/to/repo" }
- git_log: Show recent commit history
  Example: { "repo_path": "/path/to/repo" }
- git_checkout: Switch to a different branch
  Example: { "repo_path": "/path/to/repo", "branch_name": "debug-123" }
- git_show: Show contents of a specific commit
  Example: { "repo_path": "/path/to/repo", "revision": "HEAD" }

filesystem-mcp (use ONLY for non-git file operations):
- read_file: Read file contents from {memoryRoot}/${projectId}/ for memory bank files
(of course you can also read the files in the repo using ${repoPath} and are strongly encouraged to do so)
  Example: { "path": "${memoryBankPath}/activeContext.md" }
- read_multiple_files: Read multiple files at once
  Example: { "paths": ["/path/to/file1.ts", "/path/to/file2.ts"] }
- edit_file: Edit a file based on pattern matching
  Example: { "path": "/path/to/file.ts", "edits": [{ "oldText": "old code", "newText": "new code" }] }
- list_directory: List contents of a directory
  Example: { "path": "/path/to/dir" }
- search_files: Recursively search files  
  Example: { "path": "/path/to/dir", "pattern": "*.ts" }
- create_directory: Create a new directory
  Example: { "path": "/path/to/dir" }
- move_file: Move or rename a file
  Example: { "source": "/path/to/old.ts", "destination": "/path/to/new.ts" }
- get_file_info: Get file metadata
  Example: { "path": "/path/to/file.ts" }
- list_allowed_directories: View allowed directories
  Example: {}

IMPORTANT MEMORY BANK WARNINGS:
- DO NOT use write_file on memory bank files - use filesystem-mcp edit_file instead
- Only edit memory bank through edit_file to avoid overwrites
- Always use ${memoryBankPath} as absolute path for memory bank files`
    }, {
      role: 'user',
      content: `Error: ${error}
Context: ${context}
Language: ${language}
File: ${filePath}
Repo: ${repoPath}
Session: ${sessionId}
Project: ${projectId}
${useMemoryBank ? '\nPrevious debugging attempts and context are available in the memory-bank directory if needed.' : ''}

IMPORTANT: Generate your first hypothesis within 2-3 responses. Don't wait for perfect information.`
    }];

    await log(sessionId, 'mother', 'debug', 'Sending to Claude', { messages, repoPath });
    let conversation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages
    });
    await log(sessionId, 'mother', 'debug', 'Received from Claude', { response: getMessageText(conversation), repoPath });

    // ORIENT: Begin investigation loop
    await log(sessionId, 'mother', 'info', 'OODA: orient', { repoPath });

    while (!getMessageText(conversation).includes('<solution>')) {
      if (Date.now() - startTime > MAX_RUNTIME) {
        throw new Error('Investigation exceeded maximum runtime');
      }

      const response = getMessageText(conversation);
      messages.push({ role: 'assistant', content: response });

      // Handle MULTIPLE MCP tools (if any)
      const toolCalls = response.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];

      const parsedCalls = toolCalls.map(tc => {
        try {
          const server = tc.includes('git-mcp') ? gitClient! : filesystemClient!;
          const toolMatch = tc.match(/<tool_name>(.*?)<\/tool_name>/);
          if (!toolMatch || !toolMatch[1]) throw new Error('Missing tool');
          const tool = toolMatch[1]!;

          const argsMatch = tc.match(/<arguments>(.*?)<\/arguments>/s);
          if (!argsMatch || !argsMatch[1]) throw new Error('Missing arguments');
          const args = JSON.parse(argsMatch[1]!);

          return { server, tool, args };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      });

      // Abort if *any* call fails to parse
      const invalid = parsedCalls.find(p => 'error' in p);
      if (invalid) {
        messages.push({
          role: 'user',
          content: `One of your tool calls was malformed and none were run. Error: ${invalid.error}`
        });
        continue;
      }
      
      const validCalls = parsedCalls as { server: NonNullable<typeof gitClient>, tool: string, args: any }[];

      // Only now, execute each one
      for (const { server, tool, args } of validCalls) {
        const result = await server.callTool({ name: tool, arguments: args });
        messages.push({
          role: 'user',
          content: JSON.stringify(result)
        });
      }

      // Handle Hypotheses → Scenario agents
      if (response.includes('<hypothesis>')) {
        const hypotheses = [...response.matchAll(/<hypothesis>([\s\S]*?)<\/hypothesis>/g)].map(match => match[1].trim());
        
        if (useMemoryBank) {
          await updateMemoryBank(projectId, `==================
AUTOMATED HYPOTHESIS RECORD
Timestamp: ${new Date().toISOString()}
Error: ${error || 'No error provided'}

${response}

==================
`, 'activeContext');
        }

        const scenarioOutputs = await Promise.all(hypotheses.map(async (hypothesis: string) => {
          const scenarioId = `${sessionId}-${activeScenarios.size}`;
          if (activeScenarios.has(scenarioId)) return '';
          activeScenarios.add(scenarioId);
          await new Promise(resolve => setTimeout(resolve, 100));
          const branchName = await createScenarioBranch(repoPath, sessionId);
          const child = spawn('node', [
            join(DEEBO_ROOT, 'build/scenario-agent.js'),
            '--id', scenarioId,
            '--session', sessionId,
            '--error', error,
            '--context', context,
            '--hypothesis', hypothesis,
            '--language', language,
            '--file', filePath || '',
            '--repo', repoPath,
            '--branch', branchName // Add branch name to args
          ]);

          let output = '';
            child.stdout.on('data', data => output += data);
            child.stderr.on('data', data => output += data);

            return new Promise<string>((resolve) => {
              let closed = 0;
              const maybeResolve = () => {
                if (closed === 2) resolve(output);
              };

              child.stdout.on('close', () => {
                closed++;
                maybeResolve();
              });
              
              child.stderr.on('close', () => {
                closed++;
                maybeResolve();
              });

              // Capture process-level errors
              child.on('error', err => {
                output += `\nProcess error: ${err}`;
                resolve(output);
              });

              // Capture stream-level errors
              child.stdout.on('error', err => {
                output += `\nStdout error: ${err}`;
              });
              child.stderr.on('error', err => {
                output += `\nStderr error: ${err}`;
              });

              // Global safety timeout in case streams never close
              setTimeout(() => {
                if (closed < 2) {
                  output += '\nScenario timeout';
                  child.kill();
                  resolve(output);
                }
              }, SCENARIO_TIMEOUT);
            });
        }));

        messages.push({ role: 'user', content: scenarioOutputs.join('\n') });
      }

      // Mother can optionally edit memory bank directly via filesystem-mcp. No forced writes.

      await log(sessionId, 'mother', 'debug', 'Sending to Claude', { messages, repoPath });
      conversation = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages
      });
      await log(sessionId, 'mother', 'debug', 'Received from Claude', { response: getMessageText(conversation), repoPath });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Structured record at the end
    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Error: ${error}` : ''}
${getMessageText(conversation)}
Scenarios Run: ${activeScenarios.size}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }
    await log(sessionId, 'mother', 'info', 'solution found', { repoPath });
    return getMessageText(conversation);

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await log(sessionId, 'mother', 'error', `Failed: ${error.message}`, { repoPath });

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
