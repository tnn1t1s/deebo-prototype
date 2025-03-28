import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer as BaseMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServerResponse } from "http";
import { initLogger } from "../util/init-logger.js";

import type { LoggerLike } from '../types/logger.js';

// Start with initLogger and transition to regular logger when ready
let logger: LoggerLike = initLogger;

interface TransportOptions {
  port?: number;
  path?: string;
  reconnect?: {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
  };
}

/**
 * Create a transport with reconnection support
 */
export async function createTransport(
  type: 'stdio' | 'sse',
  server: BaseMcpServer,
  options: TransportOptions = {}
): Promise<StdioServerTransport | SSEServerTransport> {
  // Let MCP SDK handle transport cleanup

  try {
    // Use PathResolver for safe initialization
    const { PathResolver } = await import('../util/path-resolver.js');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    
    // Validate root directory
    const rootDir = await pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }
    
    // Try to switch to regular logger now that paths are validated
    try {
      const { createLogger } = await import("../util/logger.js");
      const newLogger = await createLogger('server', 'transport');
      
      // Test that the new logger works with validated paths
      const logsPath = await pathResolver.ensureDirectory('logs');
      await pathResolver.validateDirectory(logsPath);
      
      // If we got here, the new logger is safe to use
      logger = newLogger;
      await logger.info('Initialized transport logging', { 
        rootDir,
        logsPath
      });
    } catch (error) {
      // Keep using initLogger if regular logger fails
      await logger.error('Failed to initialize regular logger, continuing with initLogger', { 
        error: error instanceof Error ? error.message : String(error),
        rootDir: await pathResolver.getRootDir()
      });
    }

  } catch (error) {
    // If anything fails, keep using initLogger
    await logger.error('Error during logger initialization', { 
      error: error instanceof Error ? error.message : String(error) 
    });
  }

  let transport: StdioServerTransport | SSEServerTransport;
  let reconnectAttempts = 0;

  const handleDisconnect = async () => {
    const reconnectConfig = options.reconnect;
    if (!reconnectConfig || reconnectAttempts >= reconnectConfig.maxAttempts) {
      await logger.error('Transport disconnected and max reconnect attempts reached');
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(
      reconnectConfig.initialDelay * Math.pow(2, reconnectAttempts - 1),
      reconnectConfig.maxDelay
    );

    await logger.info(`Attempting reconnect in ${delay}ms`, {
      attempt: reconnectAttempts,
      maxAttempts: reconnectConfig.maxAttempts
    });

    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // Let MCP SDK handle transport creation and cleanup
      await server.connect(transport);
      reconnectAttempts = 0; // Reset on successful reconnect
    } catch (error) {
      await logger.error('Reconnection failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      // Don't recursively call handleDisconnect
      if (reconnectAttempts < reconnectConfig.maxAttempts) {
        setTimeout(handleDisconnect, delay);
      }
    }
  };

  if (type === 'stdio') {
    transport = new StdioServerTransport();
  } else if (type === 'sse') {
    if (!options?.port || !options?.path) {
      throw new Error('Port and path are required for SSE transport');
    }
    transport = new SSEServerTransport(options.path, undefined as unknown as ServerResponse);
  } else {
    throw new Error(`Unknown transport type: ${type}`);
  }

  transport.onclose = handleDisconnect;
  await logger.info('Transport created successfully', { type });
  return transport;
}
