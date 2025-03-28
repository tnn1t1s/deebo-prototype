import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from './logger.js';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

// Client type definition
type McpClient = Client & {
  callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
};

/**
 * Connect to MCP tool - trust it to handle its own setup
 */
export async function connectMcpTool(name: string, tool: string): Promise<McpClient> {
  // Create client with proper capabilities
  const client = new Client({
    name,
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {}  // We only use tools
    }
  }) as McpClient;

  // Trust the tools but handle errors properly
  try {
    const transport = new StdioClientTransport({
      command: tool === 'git-mcp' ? '/Users/sriram/.local/share/deebo-prototype/venv/bin/python' : 'npx',
      args: tool === 'git-mcp' 
        ? ['-m', 'mcp_server_git', '--verbose']
        : ['-y', '@modelcontextprotocol/server-filesystem', '.']
    });

    await client.connect(transport);
    await log('system', 'mcp', 'info', `Connected to ${tool}`);
    return client;
  } catch (error) {
    await log('system', 'mcp', 'error', `Failed to connect to ${tool}`, { error });
    throw error;
  }
}

/**
 * Get text content from tool response
 */
export function getTextContent(result: unknown): string {
  const response = result as { content?: Array<{ type: string; text?: string }> };
  if (!response?.content?.length) return '';
  const content = response.content[0];
  return (content?.type === 'text' && content.text) ? content.text : '';
}
