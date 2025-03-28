import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

// Just write to files - one log per session
export async function log(sessionId: string, name: string, level: string, message: string, data?: any) {
  const logsDir = join(DEEBO_ROOT, 'logs');
  await mkdir(logsDir, { recursive: true });

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    agent: name,
    level,
    message,
    data
  }) + '\n';

  await writeFile(
    join(logsDir, `${sessionId}.log`),
    entry,
    { flag: 'a' }
  );
}

// Simple console logging
export function consoleLog(level: string, message: string, data?: any) {
  console.log(`[${level}] ${message}`, data || '');
}
