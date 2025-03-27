import { createWriteStream, WriteStream } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { ensureDirectory } from './init.js';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'debug' | 'warn';
  component: string;
  message: string;
  metadata?: Record<string, any>;
}

export class Logger {
  private stream!: WriteStream; // Using definite assignment assertion
  private component: string;
  private logPath: string;

  constructor(logPath: string, component: string) {
    this.component = component;
    this.logPath = logPath;
    
    // Initialize with a temporary stream that will be replaced
    this.stream = createWriteStream('/dev/null');
    
    // Use IIFE to handle async initialization
    (async () => {
      try {
        // Ensure the directory exists before creating the write stream
        const dir = dirname(logPath);
        await ensureDirectory(dir);
        
        // Create write stream after directory exists
        this.stream = createWriteStream(logPath, { flags: 'a' });

        // Handle stream errors
        this.stream.on('error', (error) => {
          this.fallbackToTemp();
        });
      } catch (error) {
        this.fallbackToTemp();
      }
    })();
  }

  private fallbackToTemp() {
    try {
      // Try to use the tmp directory in DEEBO_ROOT first
      if (process.env.DEEBO_ROOT) {
        const tmpPath = join(process.env.DEEBO_ROOT, 'tmp', `${this.component}.log`);
        this.stream = createWriteStream(tmpPath, { flags: 'a' });
        this.logPath = tmpPath;
        return;
      }
    } catch (error) {
      // Silently fail and try next fallback
    }

    // Final fallback to system temp directory
    try {
      const systemTmpPath = join(tmpdir(), 'deebo-prototype', `${this.component}.log`);
      ensureDirectory(dirname(systemTmpPath));
      this.stream = createWriteStream(systemTmpPath, { flags: 'a' });
      this.logPath = systemTmpPath;
    } catch (error) {
      throw new Error(`Could not create logger in any location: ${error}`);
    }
  }

  private writeEntry(entry: LogEntry) {
    try {
      // Write as properly formatted NDJSON with explicit formatting
      const jsonEntry = {
        timestamp: entry.timestamp,
        level: entry.level,
        component: entry.component,
        message: entry.message,
        path: this.logPath,
        ...(entry.metadata ? { metadata: entry.metadata } : {})
      };
      
      // Format with proper line endings and ensure complete JSON objects
      const formattedEntry = JSON.stringify(jsonEntry) + '\n';
      
      // Try to write to stream
      const writeSuccess = this.stream.write(formattedEntry);
      
      // Handle backpressure
      if (!writeSuccess) {
        this.stream.once('drain', () => {
          this.stream.write(formattedEntry);
        });
      }

      // Skip console logging for clean stdio transport
      
    } catch (error) {
      // Try to recover by switching to temp file
      try {
        this.fallbackToTemp();
        
        // Write simplified error entry to new location
        const timestamp = new Date().toISOString();
        const errorEntry = {
          timestamp,
          level: 'error',
          component: this.component,
          message: 'Failed to write log entry - switched to fallback location',
          error: String(error),
          original_path: this.logPath
        };
        
        this.stream.write(JSON.stringify(errorEntry) + '\n');
      } catch {
        // Silent fail - we can't log if logging itself fails
      }
    }
  }

  private log(level: LogEntry['level'], message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      metadata
    };
    this.writeEntry(entry);
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log('info', message, metadata);
  }

  error(message: string, metadata?: Record<string, any>) {
    this.log('error', message, metadata);
  }

  debug(message: string, metadata?: Record<string, any>) {
    this.log('debug', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>) {
    this.log('warn', message, metadata);
  }

  close() {
    this.stream.end();
  }
}

// Cache for loggers to prevent duplicate creation
const loggerCache = new Map<string, Logger>();

// Factory function to create loggers with consistent paths
export function createLogger(sessionId: string, component: string): Logger {
  const cacheKey = `${sessionId}:${component}`;
  
  // Return cached logger if it exists
  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }
  
  // Use the base directory from environment
  const baseDir = process.env.DEEBO_ROOT;
  if (!baseDir) {
    throw new Error('DEEBO_ROOT not set - directories not properly initialized');
  }
  
  // Determine log path
  const logPath = sessionId === 'server' 
    ? join(baseDir, 'sessions', 'server', `${component}.log`)
    : join(baseDir, 'sessions', sessionId, 'logs', `${component}.log`);

  try {
    // Create logger with original path
    const logger = new Logger(logPath, component);
    loggerCache.set(cacheKey, logger);
    return logger;
  } catch (error) {
    // Try fallback to tmp directory
    try {
      const tmpPath = join(baseDir, 'tmp', `${sessionId}-${component}.log`);
      const logger = new Logger(tmpPath, component);
      loggerCache.set(cacheKey, logger);
      return logger;
    } catch (tmpError) {
      // Final fallback to system temp directory
      const systemTmpPath = join(tmpdir(), 'deebo-prototype', `${sessionId}-${component}.log`);
      const logger = new Logger(systemTmpPath, component);
      loggerCache.set(cacheKey, logger);
      return logger;
    }
  }
}
