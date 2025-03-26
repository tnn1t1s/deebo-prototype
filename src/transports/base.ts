import { Transport } from "./types.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { 
  MiddlewareChain, 
  MiddlewareContext,
  createDefaultMiddlewareChain 
} from "../protocol/middleware.js";
import { isInitialized } from "./index.js";

// Lazy initialize logger when needed
let logger: any; // Type will be set when logger is created
async function getLogger() {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'base-transport');
  }
  return logger;
}

/**
 * Base transport class with middleware support
 */
export abstract class BaseTransport implements Transport {
  protected middleware: MiddlewareChain;
  protected clientCounter: number = 0;

  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  constructor() {
    this.middleware = createDefaultMiddlewareChain();
    // Initialize logger asynchronously in the constructor
    getLogger().then(log => {
      log.debug('Base transport initialized with middleware chain');
    });
  }

  /**
   * Add middleware to the chain
   */
  use(middleware: Parameters<MiddlewareChain['use']>[0]) {
    this.middleware.use(middleware);
    return this;
  }

  /**
   * Process an incoming message through the middleware chain
   */
  protected async processIncoming(message: unknown): Promise<void> {
    const context: MiddlewareContext = {
      clientId: `client-${++this.clientCounter}`,
      timestamp: Date.now()
    };

    try {
      await this.middleware.process(message, context);

      // If message passes middleware, forward to handler
      if (this.onmessage) {
        this.onmessage(message as JSONRPCMessage);
      }
    } catch (error) {
      const log = await getLogger();
      log.error('Error processing incoming message', {
        error: error instanceof Error ? error.message : String(error)
      });

      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Process an outgoing message through the middleware chain
   */
  protected async processOutgoing(message: JSONRPCMessage): Promise<JSONRPCMessage> {
    const context: MiddlewareContext = {
      clientId: `client-${++this.clientCounter}`,
      timestamp: Date.now(),
      direction: 'outgoing'
    };

    try {
      await this.middleware.process(message, context);
      return message;
    } catch (error) {
      const log = await getLogger();
      log.error('Error processing outgoing message', {
        error: error instanceof Error ? error.message : String(error)
      });

      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }

      throw error;
    }
  }

  // Abstract methods that must be implemented by concrete transports
  abstract start(): Promise<void>;
  abstract send(message: JSONRPCMessage): Promise<void>;
  abstract close(): Promise<void>;
}

/**
 * Create a transport with default configuration
 */
export async function createTransport(type: 'stdio' | 'sse', options?: { port?: number, path?: string }): Promise<Transport> {
  const log = await getLogger();
  log.info(`Creating ${type} transport`, options);
  
  try {
    // TODO: Implement SSE transport with proper server response handling
    if (type === 'sse') {
      log.warn('SSE transport not yet implemented, falling back to stdio');
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      return new StdioServerTransport();
    } else if (type === 'stdio') {
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      return new StdioServerTransport();
    }
    
    throw new Error(`Unknown transport type: ${type}`);
  } catch (error) {
    log.error('Failed to create transport', { 
      type,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
