import { Transport } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createLogger } from "../util/logger.js";

const logger = createLogger('server', 'transport');

/**
 * Configure reconnection settings for transports
 */
export interface ReconnectionConfig {
  maxAttempts: number;
  initialDelay: number;  // in milliseconds
  maxDelay: number;      // in milliseconds
  onMaxAttemptsReached?: () => void;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectionConfig = {
  maxAttempts: 3,
  initialDelay: 1000,  // 1 second
  maxDelay: 5000,     // 5 seconds
  onMaxAttemptsReached: () => {
    logger.error('Max reconnection attempts reached, transport will not attempt further reconnections');
  }
};

/**
 * Create an MCP transport with reconnection support
 */
export async function createTransport(
  type: 'stdio' | 'sse',
  server: Server,
  options?: {
    port?: number;
    path?: string;
    reconnect?: Partial<ReconnectionConfig>;
  }
): Promise<Transport> {
  const reconnectConfig = {
    ...DEFAULT_RECONNECT_CONFIG,
    ...options?.reconnect
  };

  let transport: Transport;

  if (type === 'stdio') {
    transport = new StdioServerTransport();
  } else if (type === 'sse') {
    if (!options?.port || !options?.path) {
      throw new Error('Port and path are required for SSE transport');
    }
    transport = new SSEServerTransport(options.path);
  } else {
    throw new Error(`Unknown transport type: ${type}`);
  }

  // Add reconnection handling
  let reconnectAttempts = 0;
  let reconnectTimeout: NodeJS.Timeout;
let isConnected = false;
let isReconnecting = false;
let cleanupHandlers: Array<() => void> = [];

  const cleanupTransport = () => {
    clearTimeout(reconnectTimeout);
    cleanupHandlers.forEach(handler => handler());
    cleanupHandlers = [];
    isConnected = false;
    isReconnecting = false;
};

const handleDisconnect = async () => {
    if (reconnectAttempts >= reconnectConfig.maxAttempts) {
      reconnectConfig.onMaxAttemptsReached?.();
      cleanupTransport();
      return;
    }

    if (isReconnecting) {
      logger.debug('Reconnection already in progress');
      return;
    }

    isReconnecting = true;

    reconnectAttempts++;
    const delay = Math.min(
      reconnectConfig.initialDelay * Math.pow(2, reconnectAttempts - 1),
      reconnectConfig.maxDelay
    );

    logger.info(`Attempting reconnection in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimeout = setTimeout(async () => {
      try {
        await server.connect(transport);
        reconnectAttempts = 0;
        isConnected = true;
        isReconnecting = false;
        logger.info('Reconnection successful');
      } catch (error) {
        logger.error('Reconnection failed', { error });
        handleDisconnect();
      }
    }, delay);
  };

  // Setup transport lifecycle handlers
  transport.onclose = () => {
    logger.info('Transport connection closed');
    handleDisconnect();
  };

  transport.onerror = (error: Error) => {
    logger.error('Transport error', { error });
    if (isConnected) {
      handleDisconnect();
    }
  };

  // Add cleanup handler
  cleanupHandlers.push(() => {
    transport.onclose = null;
    transport.onerror = null;
    transport.onmessage = null;
  });

  return transport;
}
