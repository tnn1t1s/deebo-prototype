#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
// Create server with explicit capabilities
const server = new McpServer({
    name: "deebo-guide",
    version: "1.0.0",
    capabilities: {
        tools: {},
        resources: {},
        prompts: {}
    }
});
// Get guide path with reliable resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const homeDir = homedir();
const deeboGuidePath = join(homeDir, '.deebo-guide');
const deeboPath = join(homeDir, '.deebo');
// Always use .deebo-guide for the guide file
let guidePath = join(deeboGuidePath, 'deebo_guide.md');
// Register the guide tool with proper schema
server.tool("read_deebo_guide", 
// Empty schema since this tool takes no parameters
{}, async () => {
    try {
        const guide = readFileSync(guidePath, 'utf8');
        return {
            content: [{
                    type: "text",
                    text: guide
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: `Failed to read guide: ${error instanceof Error ? error.message : String(error)}`
                }],
            isError: true // Properly indicate error state
        };
    }
});
// Also expose the guide as a static resource
server.resource("guide", "guide://deebo", async (uri) => {
    try {
        const guide = readFileSync(guidePath, 'utf8');
        return {
            contents: [{
                    uri: uri.href,
                    text: guide
                }]
        };
    }
    catch (error) {
        throw new Error(`Failed to read guide: ${error instanceof Error ? error.message : String(error)}`);
    }
});
// Connect server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Deebo Guide MCP Server running");
