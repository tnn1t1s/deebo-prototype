import { DIRS } from './util/config.js';
import { createLogger } from './util/logger.js';
import { agentCoordinator } from './agents/coordinator.js';

// Create logger
const logger = await createLogger('system', 'main');
await logger.info('System initialized', { root: DIRS.root });

// Export coordinator
export const coordinate = agentCoordinator.coordinate;
