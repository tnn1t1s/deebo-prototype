import type { DeeboMcpServer } from '../types/mcp.d.js';
import type { LoggerLike } from '../types/logger.js';

// Track initialization state
let isInitialized = false;

/**
 * Initialize agent capabilities for the MCP server
 * @param server The MCP server instance
 */
export async function initializeAgents(server: DeeboMcpServer) {
  // Start with initLogger
  const { initLogger } = await import('../util/init-logger.js');
  let logger: LoggerLike = initLogger;

  if (isInitialized) {
    logger.info('Agents already initialized');
    return;
  }

  try {
    // Get path resolver instance
    const { getPathResolver } = await import('../util/path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Initialize and validate key directories for agents
    const dirs = ['sessions', 'reports', 'tmp'];
    for (const dir of dirs) {
      const createdPath = await pathResolver.ensureDirectory(dir);
      const exists = await pathResolver.validateDirectory(createdPath);
      if (!exists) {
        throw new Error(`Failed to validate directory: ${dir}`);
      }
    }

    // Only create regular logger after directory validation
    const { createLogger } = await import('../util/logger.js');
    logger = createLogger('server', 'agents');
    
    // Validate Anthropic client early
    const { default: anthropic } = await import('../util/anthropic.js');
    const client = await anthropic.getClient();
    if (!client) {
      throw new Error('Failed to initialize Anthropic client');
    }

    // Only set initialized after all validations pass
    isInitialized = true;
    logger.info('Agent system initialized successfully', {
      paths: dirs.map(dir => pathResolver.resolvePath(dir))
    });

  } catch (error) {
    logger.error('Failed to initialize agent system', { error });
    throw error;
  }
}

export { isInitialized };
