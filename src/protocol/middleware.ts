import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { validateMessage, rateLimiter, ProtocolErrorCodes } from "./index.js";

import { isInitialized } from "./index.js";

// Lazy initialize logger when needed
let logger: any; // Type will be set when logger is created
async function getLogger() {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'protocol-middleware');
  }
  return logger;
}

/**
 * Middleware function type
 */
export type Middleware = (
  message: JSONRPCMessage,
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void>;

/**
 * Context passed to middleware functions
 */
export interface MiddlewareContext {
  clientId: string;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Middleware chain for processing messages
 */
export class MiddlewareChain {
  private middlewares: Middleware[] = [];

  /**
   * Add middleware to the chain
   */
  use(middleware: Middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Process a message through the middleware chain
   */
  async process(message: unknown, context: MiddlewareContext) {
    // Start with message validation
    validateMessage(message);

    // Create middleware chain
    let index = 0;
    const validatedMessage = message as JSONRPCMessage;

    const next = async (): Promise<void> => {
      // Get next middleware
      const middleware = this.middlewares[index++];
      
      // If no more middleware, we're done
      if (!middleware) {
        return;
      }
      
      // Execute middleware
      await middleware(validatedMessage, context, next);
    };

    // Start chain execution
    await next();
  }
}

/**
 * Built-in middleware functions
 */

/**
 * Logging middleware
 */
export const loggingMiddleware: Middleware = async (message, context, next) => {
  const start = Date.now();
  const log = await getLogger();
  
  try {
    log.debug('Processing message', {
      clientId: context.clientId,
      method: 'method' in message ? message.method : undefined,
      id: 'id' in message ? message.id : undefined
    });
    
    await next();
    
    const duration = Date.now() - start;
    log.debug('Message processed', {
      clientId: context.clientId,
      duration,
      success: true
    });
  } catch (error) {
    const duration = Date.now() - start;
    log.error('Message processing failed', {
      clientId: context.clientId,
      duration,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

/**
 * Rate limiting middleware
 */
export const rateLimitingMiddleware: Middleware = async (message, context, next) => {
  // Only rate limit requests, not responses
  if ('method' in message) {
    await rateLimiter.checkRateLimit(context.clientId);
  }
  await next();
};

/**
 * Timeout middleware
 */
export const timeoutMiddleware = (timeoutMs: number): Middleware => {
  return async (message, context, next) => {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([
      next(),
      timeout
    ]);
  };
};

/**
 * Error handling middleware
 */
export const errorHandlingMiddleware: Middleware = async (message, context, next) => {
  const log = await getLogger();
  try {
    await next();
  } catch (error) {
    log.error('Error in middleware chain', {
      clientId: context.clientId,
      error: error instanceof Error ? error.message : String(error)
    });

    // Add error context
    if (error instanceof Error) {
      error.message = `[Client ${context.clientId}] ${error.message}`;
    }

    throw error;
  }
};

/**
 * Create default middleware chain
 */
export function createDefaultMiddlewareChain(): MiddlewareChain {
  const chain = new MiddlewareChain();
  
  // Add built-in middleware
  chain
    .use(errorHandlingMiddleware)
    .use(loggingMiddleware)
    .use(rateLimitingMiddleware)
    .use(timeoutMiddleware(30000)); // 30 second timeout
  
  return chain;
}
