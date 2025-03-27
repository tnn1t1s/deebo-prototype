import type { LoggerLike } from '../types/logger.js';

let logger: LoggerLike;

/**
 * Get or initialize the logger for the tools module
 * Uses safe initialization with fallback to initLogger
 */
export async function getLogger(): Promise<LoggerLike> {
  if (!logger) {
    // Start with initLogger
    const { initLogger } = await import('../util/init-logger.js');
    logger = initLogger;
    
    try {
      // Get PathResolver for safe initialization
      const { getPathResolver } = await import('../util/path-resolver-helper.js');
      const pathResolver = await getPathResolver();
      
      // Validate root directory
      const rootDir = pathResolver.getRootDir();
      if (!rootDir || rootDir === '/') {
        throw new Error('Invalid root directory configuration');
      }
      
      // Only switch to regular logger if paths are valid
      const { createLogger } = await import('../util/logger.js');
      logger = createLogger('server', 'tools');
      
      logger.info('Tools logger initialized', { rootDir });
    } catch (error) {
      initLogger.error('Failed to initialize regular logger, using initLogger', { error });
      logger = initLogger;
    }
  }
  return logger;
}