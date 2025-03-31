import { log } from './util/logger.js';
import { connectMcpTool } from './util/mcp.js';
import { writeReport } from './util/reports.js';  // System infrastructure for capturing output
import { Message } from '@anthropic-ai/sdk/resources/messages.js';

const MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes

function getMessageText(message: Message): string {
  const content = message.content[0];
  return 'text' in content ? content.text : '';
}

interface ScenarioArgs {
  id: string;
  session: string;
  error: string;
  context: string;
  hypothesis: string;
  language: string;
  repoPath: string;
  filePath?: string;
  branch: string;
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
    filePath: result.file || undefined,
    branch: result.branch || '' 
  };
}

export async function runScenarioAgent(args: ScenarioArgs) {
  await log(args.session, `scenario-${args.id}`, 'info', 'Scenario agent started', { hypothesis: args.hypothesis });

  try {
    // Set up tools
    await log(args.session, `scenario-${args.id}`, 'info', 'Connecting to git-mcp...');
    const gitClient = await connectMcpTool('scenario-git', 'git-mcp');
    await log(args.session, `scenario-${args.id}`, 'info', 'Connected to git-mcp successfully');

    await log(args.session, `scenario-${args.id}`, 'info', 'Connecting to filesystem-mcp...');
    const filesystemClient = await connectMcpTool('scenario-filesystem', 'filesystem-mcp');
    await log(args.session, `scenario-${args.id}`, 'info', 'Connected to filesystem-mcp successfully');

    // Branch creation is handled by system infrastructure before this agent is spawned.

    // Start Claude conversation with initial context
    const startTime = Date.now();
    const messages: { role: 'assistant' | 'user', content: string }[] = [{
      role: 'assistant',
      content: `You are a scenario agent investigating a bug based on a specific hypothesis.
A dedicated Git branch '${args.branch}' has been created for your investigation.
First, switch to your branch using git_checkout before making any changes.
You are allowed to edit files, run tests, and make commits to this branch.
You have access to these tools:

git-mcp:
- git_status: Show working tree status
- git_diff_unstaged: Show changes in working directory not yet staged
- git_diff_staged: Show changes that are staged for commit
- git_diff: Compare current state with a branch or commit
- git_add: Stage file changes
- git_commit: Commit staged changes
- git_reset: Unstage all changes
- git_log: Show recent commit history
- git_create_branch: Create a new branch
- git_checkout: Switch to a different branch
- git_show: Show contents of a specific commit
- git_init: Initialize a Git repository

filesystem-mcp:
- read_file: Read file contents
- read_multiple_files: Read multiple files at once
- write_file: Write or overwrite a file
- edit_file: Edit a file based on pattern matching
- create_directory: Create a new directory
- list_directory: List contents of a directory
- move_file: Move or rename a file
- search_files: Recursively search files
- get_file_info: Get file metadata
- list_allowed_directories: View directories this agent can access
Remember to:
1. First checkout your dedicated branch '${args.branch}'
2. Make all your changes in this branch
3. Use git tools to investigate and make changes as needed
Use tools by wrapping requests in XML tags like:
<use_mcp_tool>
  <server_name>git-mcp</server_name>
  <tool_name>git_status</tool_name>
  <arguments>
    {
      "repo_path": "/path/to/repo"
    }
  </arguments>
</use_mcp_tool>

When you've completed your investigation, wrap your final report in <report> </report> tags.`
    }, {
      role: 'user',
      content: `Error: ${args.error}
Context: ${args.context}
Language: ${args.language}
File: ${args.filePath}
Repo: ${args.repoPath}
Hypothesis: ${args.hypothesis}`
    }];

    const anthropic = new (await import('@anthropic-ai/sdk')).default();    
    let conversation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages
    });

    while (!getMessageText(conversation).includes('<report>')) {
      if (Date.now() - startTime > MAX_RUNTIME) {
        await writeReport(args.repoPath, args.session, args.id, 'Investigation exceeded maximum runtime');
        console.log('Investigation exceeded maximum runtime');
        process.exit(1);
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

      // Extract report if present
      const reportMatch = response.match(/<report>(.*?)<\/report>/s);
      if (reportMatch) {
        await writeReport(args.repoPath, args.session, args.id, reportMatch[1]);
        console.log(reportMatch[1]);
        process.exit(0);
      }

      // Continue the conversation
      conversation = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    await writeReport(args.repoPath, args.session, args.id, `SCENARIO ERROR: ${errorText}`);
    console.log(`SCENARIO ERROR: ${errorText}`);
    process.exit(1);
  }
}

// Parse args and run
const args = parseArgs(process.argv);
runScenarioAgent(args).catch(err => {
  const errorText = err instanceof Error ? err.message : String(err);
  console.log(`SCENARIO ERROR: ${errorText}`);
  process.exit(1);
});