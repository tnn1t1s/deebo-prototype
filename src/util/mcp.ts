// src/util/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

// Map to track active connections
const activeConnections: Map<string, Promise<Client>> = new Map();

export async function connectMcpTool(name: string, toolName: string, sessionId: string, repoPath: string): Promise<Client> {
  if (process.platform === 'win32') {
    await writeFile('C:/Users/ramna/Desktop/deebo-connect-start.txt', 
      `Starting connection for tool: ${toolName}`);
  }

  const connectionKey = `${name}-${toolName}-${sessionId}`;
  
  const existingConnection = activeConnections.get(connectionKey);
  if (existingConnection) {
    return existingConnection;
  }

  const connectionPromise = (async () => {
    const config = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
    const toolConfig = { ...config.tools[toolName] };

    // Build paths for placeholder replacement
    const projectId = getProjectId(repoPath);
    const memoryPath = join(DEEBO_ROOT, 'memory-bank', projectId);
    const memoryRoot = join(DEEBO_ROOT, 'memory-bank');
    
    // Replace placeholders in command path
    toolConfig.command = toolConfig.command
      .replace(/{npxPath}/g, process.env.DEEBO_NPX_PATH || '')
      .replace(/{uvxPath}/g, process.env.DEEBO_UVX_PATH || '');

    // Build transport using cross-spawn's native .cmd handling
    const transport = new StdioClientTransport({
      command: toolConfig.command,
      args: toolConfig.args
    });

    // Replace placeholders in arguments  
    toolConfig.args = toolConfig.args.map((arg: string) =>
      arg.replace(/{repoPath}/g, repoPath)
         .replace(/{memoryPath}/g, memoryPath)
         .replace(/{memoryRoot}/g, memoryRoot)
    );

    const client = new Client(
      { name, version: '1.0.0' },
      { capabilities: { tools: true } }
    );

    if (process.platform === 'win32') {
      await writeFile('C:/Users/ramna/Desktop/deebo-pre-connect.txt',
        `Tool: ${toolName}\nAbout to connect transport`);
    }

    await client.connect(transport);
    return client;
  })();

  activeConnections.set(connectionKey, connectionPromise);
  connectionPromise.catch(() => {
    activeConnections.delete(connectionKey);
  });

  return connectionPromise;
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