import { join } from 'path';
import { mkdir } from 'fs/promises';
import { createLogger } from '../util/logger.js';
import { DIRS } from '../util/config.js';
import { runMotherAgent } from '../mother-agent.js';

/**
 * Coordinator - keep it minimal
 * - Just creates session
 * - Runs mother agent
 * - Trusts process isolation
 */
export const agentCoordinator = {
  coordinate: async function(
    error: string,
    context: string,
    language: string,
    filePath: string,
    repoPath: string
  ): Promise<any> {
    // Create unique session
    const sessionId = `session-${Date.now()}`;
    await mkdir(join(DIRS.sessions, sessionId), { recursive: true });

    // Log session start
    const logger = await createLogger(sessionId, 'coordinator');
    await logger.info('Session started', { error, language });

    try {
      // Run mother agent and return result
      const result = await runMotherAgent(
        sessionId,
        error,
        context,
        language,
        filePath,
        repoPath
      );

      await logger.info('Session complete', { success: true });
      return result;
    } catch (error) {
      await logger.error('Session failed', { error });
      throw error;
    }
  }
};
