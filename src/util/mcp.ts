import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

export async function connectMcpTool(name: string, toolName: string): Promise<Client> {
  const config = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
  const toolConfig = config.tools[toolName];

  const client = new Client({
    name,
    version: '1.0.0'
  }, {
    capabilities: { 
      tools: true  // Enable tool discovery
    }
  });

  await client.connect(new StdioClientTransport({
    command: toolConfig.command,
    args: toolConfig.args
  }));

  return client;
}
