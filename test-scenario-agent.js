import { join } from 'path';
import { mkdir } from 'fs/promises';
import { config } from 'dotenv';
import { connectMcpTool } from "./build/util/mcp.js";
import { log } from "./build/util/logger.js";

// Load environment variables
config();

// Verify required env vars
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

console.log('Running test scenario...\n');

// Create unique session ID and log start
const sessionId = `session-${Date.now()}`;
await log(sessionId, 'test', 'info', 'Test scenario started');

// Create basic directories (keep it minimal)
const sessionDir = join(process.cwd(), 'sessions', sessionId);
const logsDir = join(process.cwd(), 'logs');
const reportsDir = join(process.cwd(), 'reports');

try {
  // Create directories in parallel
  await Promise.all([
    mkdir(sessionDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(reportsDir, { recursive: true })
  ]);

  await log(sessionId, 'test', 'info', 'Connecting to tools');
  const gitClient = await connectMcpTool('test-git', 'git-mcp');
  const filesystemClient = await connectMcpTool('test-filesystem', 'filesystem-mcp');

  // Test error scenario
  const error = 'TypeError: Cannot read property "length" of undefined';
  const context = 'The error occurred while processing an array in the data transformation pipeline';
  const language = 'typescript';
  const filePath = join(process.cwd(), 'src/index.ts');
  const repoPath = process.cwd();

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
        pattern: '*.{js,ts}'
      }
    })
  };

  await log(sessionId, 'test', 'info', 'Gathering results');
  
  console.log('\nTest Results:');
  console.log(`Session ID: ${sessionId}`);
  console.log('-------------');
  
  // Git status
  console.log('\nGit Status:');
  if (observations.git?.status?.content?.[0]?.text) {
    console.log(observations.git.status.content[0].text);
  } else {
    console.log('No git status available');
  }

  // File content
  console.log('\nFile Content:');
  if (observations.files?.content?.[0]?.text) {
    console.log(observations.files.content[0].text);
  } else {
    console.log('No file content available');
  }

  // Context search results
  console.log('\nContext Search Results:');
  if (observations.context?.content?.[0]?.text) {
    console.log(observations.context.content[0].text);
  } else {
    console.log('No context search results available');
  }

  // Clean up and log completion
  try {
    await gitClient.close();
    await filesystemClient.close();
    await log(sessionId, 'test', 'info', 'Test scenario completed');
  } catch (err) {
    await log(sessionId, 'test', 'error', 'Cleanup failed', { error: err });
    process.exit(1);
  }
} catch (err) {
  await log(sessionId, 'test', 'error', 'Setup failed', { error: err });
  process.exit(1);
}
