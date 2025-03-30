// src/util/mcp.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

// Map to track active connections
const activeConnections: Map<string, Promise<Client>> = new Map();

export async function connectMcpTool(name: string, toolName: string): Promise<Client> {
  const connectionKey = `${name}-${toolName}`;
  
  // Check if we already have a connection promise
  const existingConnection = activeConnections.get(connectionKey);
  if (existingConnection) {
    return existingConnection;
  }

  // Create new connection promise
  const connectionPromise = (async () => {
    const config = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
    const toolConfig = config.tools[toolName];

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

  // Store the promise
  activeConnections.set(connectionKey, connectionPromise);

  // Remove from map if connection fails
  connectionPromise.catch(() => {
    activeConnections.delete(connectionKey);
  });

  return connectionPromise;
}

export async function connectRequiredTools(agentName: string, sessionId: string): Promise<{
  gitClient: Client;
  filesystemClient: Client;
}> {
  const [gitClient, filesystemClient] = await Promise.all([
    connectMcpTool(`${agentName}-git`, 'git-mcp'),
    connectMcpTool(`${agentName}-filesystem`, 'filesystem-mcp')
  ]);

  return {
    gitClient,
    filesystemClient
  };
}