import { appendFile } from 'fs/promises';
import { join } from 'path';
import { DIRS } from './config.js';

export interface LoggerLike {
  debug: (message: string, data?: any) => Promise<void>;
  info: (message: string, data?: any) => Promise<void>;
  warn: (message: string, data?: any) => Promise<void>;
  error: (message: string, data?: any) => Promise<void>;
}

/**
 * Create a simple logger that writes to a file
 */
export async function createLogger(type: string, name: string): Promise<LoggerLike> {
  const logFile = join(DIRS.logs, `${type}-${name}.log`);

  const log = async (level: string, message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({
      timestamp,
      level,
      message,
      data
    }) + '\n';

    await appendFile(logFile, entry);
  };

  return {
    debug: (message: string, data?: any) => log('debug', message, data),
    info: (message: string, data?: any) => log('info', message, data),
    warn: (message: string, data?: any) => log('warn', message, data),
    error: (message: string, data?: any) => log('error', message, data)
  };
}

/**
 * Simple console logger for initialization
 */
export const initLogger: LoggerLike = {
  debug: async (message: string, data?: any) => console.debug(message, data),
  info: async (message: string, data?: any) => console.info(message, data),
  warn: async (message: string, data?: any) => console.warn(message, data),
  error: async (message: string, data?: any) => console.error(message, data)
};
