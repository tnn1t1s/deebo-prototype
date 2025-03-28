import { Logger } from "./logger.js";
import type { LoggerLike } from "../types/logger.js";

// Track initialization state
let isInitialized = false;
let logger: LoggerLike;
let client: any;

/**
 * Initialize Anthropic client
 */
async function init() {
  // Start with initLogger
  const { initLogger } = await import('./init-logger.js');
  logger = initLogger;

  try {
    // Get path resolver for proper logging
    const { PathResolver } = await import('./path-resolver.js');
    const pathResolver = await PathResolver.getInstance();
    if (!pathResolver.isInitialized()) {
      await pathResolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    
    // Validate root directory
    const rootDir = pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }

    // Now safe to use regular logger
    const { createLogger } = await import('./logger.js');
    logger = await createLogger('server', 'anthropic');

    // Mock anthropic client for testing
    client = {
      messages: {
        create: async ({ messages, system }: { messages: any[]; system: string }) => {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                actions: [],
                complete: true,
                success: true,
                explanation: "Mock response for testing"
              })
            }]
          };
        }
      }
    };

    isInitialized = true;
    await logger.info('Anthropic client initialized successfully');
    return client;
  } catch (error) {
    await logger.error('Failed to initialize Anthropic client', { error });
    throw error;
  }
}

export default class AnthropicClient {
  private static instance: typeof client;

  static async getClient() {
    if (!client) {
      await init();
    }
    return client;
  }
}
