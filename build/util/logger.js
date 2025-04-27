import { writeFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';
// Write logs to memory bank structure
export async function log(sessionId, name, level, message, data) {
    const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        agent: name,
        level,
        message,
        data
    }) + '\n';
    // Data will be written to memory-bank/projectId/sessions/sessionId/logs/agentName.log
    const projectId = getProjectId(data?.repoPath);
    if (projectId) {
        const logPath = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs', `${name}.log`);
        await writeFile(logPath, entry, { flag: 'a' });
    }
}
// Simple console logging
export function consoleLog(level, message, data) {
    console.log(`[${level}] ${message}`, data || '');
}
