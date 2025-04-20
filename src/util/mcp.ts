// src/util/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

// Map to track active connections
const activeConnections: Map<string, Promise<Client>> = new Map();

export async function connectMcpTool(name: string, toolName: string, sessionId: string, repoPath: string) {
  const rawConfig = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
  const def = rawConfig.tools[toolName];
  const memoryPath = join(DEEBO_ROOT, 'memory-bank', getProjectId(repoPath));
  const memoryRoot = join(DEEBO_ROOT, 'memory-bank');

  let command = def.command;
  let args = [...def.args];

  if (process.platform === 'win32') {
    // Substitute the actual npxPath/uvxPath into a single execPath
    const execPath = command
      .replace(/{npxPath}/g, process.env.DEEBO_NPX_PATH!)
      .replace(/{uvxPath}/g, process.env.DEEBO_UVX_PATH!);

    // Wrap in cmd /c
    command = 'cmd';
    args = ['/d', '/s', '/c', `"${execPath}"`, ...args];
  } else {
    // On mac/linux, substitute the binary paths directly
    command = command
      .replace(/{npxPath}/g, process.env.DEEBO_NPX_PATH!)
      .replace(/{uvxPath}/g, process.env.DEEBO_UVX_PATH!);
  }

  // **Now** replace {repoPath}, {memoryPath}, {memoryRoot} on every arg
  args = args.map(arg =>
    arg
      .replace(/{repoPath}/g, repoPath)
      .replace(/{memoryPath}/g, memoryPath)
      .replace(/{memoryRoot}/g, memoryRoot)
  );

  // Shell options only for Windows
  const options = process.platform === 'win32'
    ? { shell: true, windowsVerbatimArguments: true }
    : {};

  const transport = new StdioClientTransport({ command, args, ...options });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: { tools: true } });
  await client.connect(transport);
  return client;
}

export async function connectRequiredTools(agentName: string, sessionId: string, repoPath: string): Promise<{
  gitClient: Client;
  filesystemClient: Client;
}> {
  const [gitClient, filesystemClient] = await Promise.all([
    connectMcpTool(`${agentName}-git`, 'git-mcp', sessionId, repoPath),
    // Switch from "filesystem-mcp" to "desktop-commander"
    connectMcpTool(`${agentName}-desktop-commander`, 'desktopCommander', sessionId, repoPath)
  ]);

  return { gitClient, filesystemClient };
}
