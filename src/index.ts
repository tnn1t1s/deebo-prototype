#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeeboMcpServer } from "./types/mcp.d.js";
import { createTransport } from "./transports/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { initializeDirectories } from './util/init.js';
import { initLogger } from './util/init-logger.js';
import * as dotenv from "dotenv";

// Configure environment
dotenv.config();

// Server configuration
const CONFIG = {
  name: process.env.SERVER_NAME || "deebo-prototype",
  version: process.env.SERVER_VERSION || "0.1.0"
};

async function startServer() {
  try {
    // Set DEEBO_ROOT to current working directory
    process.env.DEEBO_ROOT = process.cwd();
    
    // Initialize directories
    await initializeDirectories();
    
    // Create logger
    const { createLogger } = await import('./util/logger.js');
    const logger = createLogger('server', 'mcp-server');
    
    // Initialize server with capabilities
    const server = new McpServer({
      name: CONFIG.name,
      version: CONFIG.version
    });
    
    // McpServer already has these capabilities built-in
    // No need to explicitly add them
    
    // Create transport with reconnection support
    const transport = await createTransport('stdio', server, {
      reconnect: {
        maxAttempts: 5,  // More retries for production
        initialDelay: 1000,
        maxDelay: 10000
      }
    });

    await server.connect(transport);

    // Import components
    const { initializeResources } = await import('./resources/index.js');
    const { initializeTools } = await import('./tools/index.js');
    const { initializeAgents } = await import('./agents/index.js');

    // Set up components
    await initializeResources(server as DeeboMcpServer, transport);
    await initializeTools(server as DeeboMcpServer);
    await initializeAgents(server as DeeboMcpServer);

    // Set up process handlers
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', { 
        error: error.message, 
        stack: error.stack 
      });
      process.exit(1);
    });

    process.on('SIGINT', async () => {
      logger.info('Server shutting down');
      await server.close();
      process.exit(0);
    });

    // Log server initialization
    logger.info('Deebo MCP server initialized successfully');

    logger.info('Server started successfully', {
      name: CONFIG.name,
      version: CONFIG.version
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    initLogger.error('Fatal error during server startup', {
      error: errorMessage,
      stack: errorStack
    });

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Server initialization failed: ${errorMessage}`
    );
  }
}

// Start the server
startServer().catch((error: Error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
