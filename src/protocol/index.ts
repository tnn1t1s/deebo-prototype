import { 
  ErrorCode, 
  McpError, 
  JSONRPCMessage 
} from "@modelcontextprotocol/sdk/types.js";

import type { LoggerLike } from '../types/logger.js';

// Track initialization state
export let isInitialized = false;
let logger: LoggerLike;

export async function initializeProtocol(): Promise<void> {
  if (isInitialized) {
    return;
  }

  // Start with initLogger
  const { initLogger } = await import('../util/init-logger.js');
  logger = initLogger;

  try {
    // Initialize path resolver for safe path handling
    const { getPathResolver } = await import('../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Validate root directory is set correctly
    const rootDir = pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }
    
    // Now safe to use regular logger
    const { createLogger } = await import('../util/logger.js');
    logger = createLogger('server', 'protocol');
    
    isInitialized = true;
    logger.info('Protocol system initialized');
  } catch (error) {
    logger.error('Failed to initialize protocol system', { error });
    throw error;
  }
}

async function getLogger(): Promise<LoggerLike> {
  if (!logger) {
    // Start with initLogger
    const { initLogger } = await import('../util/init-logger.js');
    logger = initLogger;
  }
  return logger;
}

/**
 * Protocol error codes beyond standard JSON-RPC errors
 */
export const ProtocolErrorCodes = {
  // Standard JSON-RPC error codes
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  
  // Custom error codes (must be above -32000)
  SessionNotFound: -31000,
  SessionAlreadyExists: -31001,
  InvalidSessionState: -31002,
  ValidationError: -31003,
  RateLimitExceeded: -31004,
  Unauthorized: -31005,
  ResourceNotFound: -31006,
  ResourceAccessDenied: -31007,
  OperationTimeout: -31008,
  AgentError: -31009
} as const;

/**
 * Validate a JSON-RPC message
 * @param message Message to validate
 * @throws {McpError} If message is invalid
 */
export function validateMessage(message: unknown): asserts message is JSONRPCMessage {
  if (!message || typeof message !== 'object') {
    throw new McpError(
      ErrorCode.ParseError,
      'Invalid message: must be an object'
    );
  }

  // Check jsonrpc version
  if (!('jsonrpc' in message) || message.jsonrpc !== '2.0') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid jsonrpc version: must be "2.0"'
    );
  }

  // For requests
  if ('method' in message) {
    if (typeof message.method !== 'string') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Invalid method: must be a string'
      );
    }

    if ('params' in message && typeof message.params !== 'object') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Invalid params: must be an object'
      );
    }
  }
  // For responses
  else if ('id' in message) {
    if (typeof message.id !== 'string' && typeof message.id !== 'number') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Invalid id: must be a string or number'
      );
    }

    if (!('result' in message) && !('error' in message)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Response must have either result or error'
      );
    }
  }
  // Neither request nor response
  else {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Message must be either a request or response'
    );
  }
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(id: string | number | null, error: McpError) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error.code,
      message: error.message,
      data: error.data
    }
  };
}

/**
 * Create a JSON-RPC success response
 */
export function createSuccessResponse(id: string | number, result: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

/**
 * Create a JSON-RPC notification
 */
export function createNotification(method: string, params?: unknown) {
  return {
    jsonrpc: '2.0',
    method,
    params
  };
}

/**
 * Rate limiting configuration and state
 */
export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, { count: number, resetTime: number }>;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  /**
   * Check if a client has exceeded their rate limit
   * @param clientId Client identifier (e.g. session ID)
   * @throws {McpError} If rate limit exceeded
   */
  async checkRateLimit(clientId: string) {
    const now = Date.now();
    const clientState = this.requests.get(clientId);

    // Clean up expired entries
    if (clientState && now > clientState.resetTime) {
      this.requests.delete(clientId);
    }

    // Get or create client state
    const state = this.requests.get(clientId) || {
      count: 0,
      resetTime: now + this.windowMs
    };

    // Check limit
    if (state.count >= this.maxRequests) {
      const waitTime = Math.ceil((state.resetTime - now) / 1000);
      throw new McpError(
        ProtocolErrorCodes.RateLimitExceeded,
        `Rate limit exceeded. Please wait ${waitTime} seconds.`
      );
    }

    // Update state
    state.count++;
    this.requests.set(clientId, state);

    // Log rate limit check
    const log = await getLogger();
    log.debug('Rate limit check', {
      clientId,
      count: state.count,
      resetTime: state.resetTime
    });
  }

  /**
   * Reset rate limit for a client
   * @param clientId Client identifier
   */
  async resetLimit(clientId: string) {
    this.requests.delete(clientId);
    const log = await getLogger();
    log.debug('Rate limit reset', { clientId });
  }
}

// Export singleton rate limiter instance
export const rateLimiter = new RateLimiter();
