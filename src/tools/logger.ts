// Lazy initialize logger when needed
let logger: any; // Type will be set when logger is created

/**
 * Get or initialize the logger for the tools module
 * Uses lazy loading to ensure logger is initialized only when needed
 */
export async function getLogger() {
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'tools');
  }
  return logger;
}
