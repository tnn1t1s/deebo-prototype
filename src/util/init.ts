import { mkdir } from 'fs/promises';
import { DIRS } from './config.js';
import { createLogger } from './logger.js';

/**
 * Initialize core systems - keep it minimal
 * - Just make basic directories
 * - Trust OS for process isolation
 * - Trust tools to handle their own setup
 */
export async function initializeCore(): Promise<void> {
  const logger = await createLogger('system', 'init');
  await logger.info('Initializing core systems');

  // Create basic directories
  await Promise.all([
    mkdir(DIRS.sessions, { recursive: true }),
    mkdir(DIRS.logs, { recursive: true }),
    mkdir(DIRS.reports, { recursive: true }),
    mkdir(DIRS.config, { recursive: true })
  ]);

  await logger.info('Core directories created');
}
