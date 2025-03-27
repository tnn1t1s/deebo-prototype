import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer as BaseMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServerResponse } from "http";
import { initLogger } from "../util/init-logger.js";

// Type that works for both loggers
interface LoggerLike {
  info(message: string, metadata?: Record<string, any>): void;
  error(message: string, metadata?: Record<string, any>): void;
}

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

let transport: StdioServerTransport | SSEServerTransport;
let reconnectAttempts = 0;

/**
 * Create a transport with reconnection support
 */
export async function createTransport<T extends BaseMcpServer>(
  type: 'stdio' | 'sse',
  server: T,
  options: TransportOptions = {}
): Promise<StdioServerTransport | SSEServerTransport> {
  try {
    // Use PathResolver for safe initialization
    const { getPathResolver } = await import('../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Validate root directory
    const rootDir = await pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }
    
    // Try to switch to regular logger now that paths are validated
    try {
      const { createLogger } = await import("../util/logger.js");
      const newLogger = createLogger('server', 'transport');
      
      // Test that the new logger works with validated paths
      const logsPath = await pathResolver.ensureDirectory('logs');
      await pathResolver.validateDirectory(logsPath);
      
      // If we got here, the new logger is safe to use
      logger = newLogger;
      logger.info('Initialized transport logging', { 
        rootDir,
        logsPath
      });
    } catch (error) {
      // Keep using initLogger if regular logger fails
      logger.error('Failed to initialize regular logger, continuing with initLogger', { 
        error,
        rootDir: await pathResolver.getRootDir() 
      });
    }

  } catch (error) {
    // If anything fails, keep using initLogger
    logger.error('Error during logger initialization', { error });
  }

  const handleDisconnect = async () => {
    const reconnectConfig = options.reconnect;
    if (!reconnectConfig || reconnectAttempts >= reconnectConfig.maxAttempts) {
      logger.error('Transport disconnected and max reconnect attempts reached');
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(
      reconnectConfig.initialDelay * Math.pow(2, reconnectAttempts - 1),
      reconnectConfig.maxDelay
    );

    logger.info(`Attempting reconnect in ${delay}ms`, {
      attempt: reconnectAttempts,
      maxAttempts: reconnectConfig.maxAttempts
    });

    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await createTransport(type, server, options);
      reconnectAttempts = 0; // Reset on successful reconnect
    } catch (error) {
      logger.error('Reconnection failed', { error });
      handleDisconnect();
    }
  };

  if (type === 'stdio') {
    transport = new StdioServerTransport();
  } else if (type === 'sse') {
    if (!options?.port || !options?.path) {
      throw new Error('Port and path are required for SSE transport');
    }
    // Note: SSEServerTransport requires response object which should be passed
    // when actually handling an SSE request. This is just initialization.
    transport = new SSEServerTransport(options.path, undefined as unknown as ServerResponse);
  } else {
    throw new Error(`Unknown transport type: ${type}`);
  }

  transport.onclose = handleDisconnect;
  
  logger.info('Transport created successfully', { type });
  return transport;
}
