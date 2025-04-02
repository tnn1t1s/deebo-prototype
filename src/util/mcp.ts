import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';
import { validateMemoryBankAccess } from './validation.js';

// Map to track active connections
const activeConnections: Map<string, Promise<Client>> = new Map();

export async function connectMcpTool(name: string, toolName: string, sessionId: string, repoPath: string): Promise<Client> {
  const connectionKey = `${name}-${toolName}-${sessionId}`;
  
  const existingConnection = activeConnections.get(connectionKey);
  if (existingConnection) {
    return existingConnection;
  }

  const connectionPromise = (async () => {
    const config = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
    const toolConfig = {...config.tools[toolName]};  // Clone to avoid modifying original

    // Build paths
    const projectId = getProjectId(repoPath);
    //validation blocks scenario agents from accessing memory bank files
    const memoryPath = validateMemoryBankAccess(name, join(DEEBO_ROOT, 'memory-bank', projectId)); 
    const memoryRoot = validateMemoryBankAccess(name, join(DEEBO_ROOT, 'memory-bank')); // Add root path
    
    // Replace all occurrences of placeholders
    toolConfig.args = toolConfig.args.map((arg: string | any) => 
      typeof arg === 'string' 
        ? arg.replace(/{repoPath}/g, repoPath)
           .replace(/{memoryPath}/g, memoryPath)
           .replace(/{memoryRoot}/g, memoryRoot)
        : arg
    );

    const transport = new StdioClientTransport({
      command: toolConfig.command,
      args: toolConfig.args
    });

    const client = new Client({
      name,
      version: '1.0.0'
    }, {
      capabilities: { 
        tools: true
      }
    });

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
    connectMcpTool(`${agentName}-filesystem`, 'filesystem-mcp', sessionId, repoPath)
  ]);

  return {
    gitClient,
    filesystemClient
  };
}