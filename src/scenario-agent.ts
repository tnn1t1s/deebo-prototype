import { log } from './util/logger.js';
import { connectMcpTool } from './util/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { writeReport } from './util/reports.js';

interface ToolCall {
  serverName: string;
  toolName: string;
  arguments: Record<string, any>;
}

function parseToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const regex = /<use_mcp_tool>\s*<server_name>(.*?)<\/server_name>\s*<tool_name>(.*?)<\/tool_name>\s*<arguments>(.*?)<\/arguments>\s*<\/use_mcp_tool>/gs;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const [_, serverName, toolName, argsStr] = match;
      const args = JSON.parse(argsStr);
      toolCalls.push({
        serverName: serverName.trim(),
        toolName: toolName.trim(),
        arguments: args
      });
    } catch (err) {
      console.error('Failed to parse tool call:', err);
    }
  }
  
  return toolCalls;
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
    await log(args.session, `scenario-${args.id}`, 'info', 'Connecting to git-mcp...');
    const gitClient = await connectMcpTool('scenario-git', 'git-mcp');
    await log(args.session, `scenario-${args.id}`, 'info', 'Connected to git-mcp successfully');

    await log(args.session, `scenario-${args.id}`, 'info', 'Connecting to filesystem-mcp...');
    const filesystemClient = await connectMcpTool('scenario-filesystem', 'filesystem-mcp');
    await log(args.session, `scenario-${args.id}`, 'info', 'Connected to filesystem-mcp successfully');

    // Map of MCP clients
    const clients: Record<string, Client<any, any, any>> = {
      'git-mcp': gitClient,
      'filesystem-mcp': filesystemClient
    };

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

    // Initialize cumulative report to carry context over iterations
    let cumulativeReport = "";

    const maxIterations = 10;
    let iteration = 0;
    while (iteration < maxIterations) { // Let Claude decide when to stop
      iteration++;
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

      // Inject cumulative context into the prompt along with current observations
      const promptContent = `Previous attempts:
${cumulativeReport}

Current state: ${JSON.stringify(observations, null, 2)}

Continue investigating based on your hypothesis.`;

      const anthropic = new (await import('@anthropic-ai/sdk')).default();
      const analysis = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are investigating this error: ${args.error}
Based on hypothesis: ${args.hypothesis}

You have access to the following MCP tools:

git-mcp:
- git_status: Show working tree status
- git_diff: Show changes in working directory
- git_create_branch: Create a new branch
- git_checkout: Switch branches

filesystem-mcp:
- read_file: Read file contents
- create_directory: Create directory
- search_files: Search for files

To use a tool, wrap your request in XML tags like this:

<use_mcp_tool>
  <server_name>git-mcp</server_name>
  <tool_name>git_status</tool_name>
  <arguments>
    {
      "repo_path": "/path/to/repo"
    }
  </arguments>
</use_mcp_tool>

Replace the server_name, tool_name, and arguments with the appropriate values.
The arguments must be valid JSON.

When you want to report success, wrap the explanation in <debug_success> tags.
When you want to report failure, wrap the explanation in <debug_failure> tags.
Only use these tags when you're ready to conclude the investigation.`,
        messages: [{
          role: 'user', 
          content: promptContent
        }]
      });

      const content = analysis.content[0];
      if (!('text' in content)) {
        throw new Error('Expected text response from Claude');
      }

      const responseText = content.text;

      // Log Claude's thinking for this iteration
      await log(args.session, `scenario-${args.id}`, 'info', 'Investigation progress', {
        thinking: responseText
      });

      // Append Claude's raw output to the cumulative report
      cumulativeReport += "\n" + responseText;

      // Execute any tool calls Claude suggested and capture outcomes
      const toolCalls = parseToolCalls(responseText);
      for (const call of toolCalls) {
        const client = clients[call.serverName];
        if (!client) {
          cumulativeReport += `\nUnknown MCP server: ${call.serverName}`;
          continue;
        }
        try {
          const result = await client.callTool({
            name: call.toolName,
            arguments: call.arguments
          });
          // Append the raw outcome of the successful tool call
          cumulativeReport += `\nTool call SUCCESS for ${call.serverName}.${call.toolName}: ${JSON.stringify(result)}`;
        } catch (err) {
          // Append the error details if the tool call fails
          cumulativeReport += `\nTool call ERROR for ${call.serverName}.${call.toolName}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // Check for conclusion tags
      const successMatch = responseText.match(/<debug_success>(.*?)<\/debug_success>/);
      const failureMatch = responseText.match(/<debug_failure>(.*?)<\/debug_failure>/);

      if (successMatch) {
        const solution = successMatch[1].trim();
        // Get final git diff for the changes made
        const changes = await gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: args.repoPath }
        });

        // Write conclusion to stdout and exit
        const finalReport = {
                   success: true,
                 explanation: solution,
                changes
             };
          // Write report to memory bank under memory-bank/<projectId>/sessions/<sessionId>/reports/
          await writeReport(args.repoPath, args.session, args.id, finalReport);
          console.log(JSON.stringify(finalReport));
          process.exit(0);
      }

      if (failureMatch) {
        const reason = failureMatch[1].trim();
        const finalReport = {
          success: false,
           explanation: reason,
           changes: null
          };
          await writeReport(args.repoPath, args.session, args.id, finalReport);
          console.log(JSON.stringify(finalReport));
          process.exit(0);
      }
      if (iteration === maxIterations) {
        console.log(JSON.stringify({
          success: false,
          explanation: `Terminated after ${maxIterations} iterations.`,
          changes: null
        }));
        process.exit(1);
      }
      // Delay between iterations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    await log(args.session, `scenario-${args.id}`, 'error', 'Scenario agent failed', {
      error: error instanceof Error ? error.message : String(error)
    });

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