import { createWriteStream, WriteStream } from 'fs';
import { tmpdir } from 'os';
import { PathResolver } from './path-resolver.js';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'debug' | 'warn';
  component: string;
  message: string;
  metadata?: Record<string, any>;
}

export class Logger {
  private stream: WriteStream | null = null;
  private component: string;
  private logPath: string;
  private initPromise: Promise<void>;

  constructor(logPath: string, component: string) {
    this.component = component;
    this.logPath = logPath;
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const resolver = await PathResolver.getInstance();
      if (!resolver.isInitialized()) {
        await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
      }
      const resolvedPath = resolver.resolvePath(this.logPath);
      
      // Create write stream
      this.stream = createWriteStream(resolvedPath, { flags: 'a' });

      // Handle stream errors
      this.stream.on('error', async (error) => {
        await this.fallbackToTemp();
      });
    } catch (error) {
      await this.fallbackToTemp();
    }
  }

  private async fallbackToTemp(): Promise<void> {
    try {
      const resolver = await PathResolver.getInstance();
    if (!resolver.isInitialized()) {
      await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
      const tmpPath = resolver.resolvePath(`tmp/${this.component}.log`);
      this.stream?.end(); // Close existing stream if any
      this.stream = createWriteStream(tmpPath, { flags: 'a' });
      this.logPath = tmpPath;
    } catch (error) {
      // Final fallback to system temp directory
      const systemTmpPath = `${tmpdir()}/deebo-prototype/${this.component}.log`;
      this.stream?.end(); // Close existing stream if any
      this.stream = createWriteStream(systemTmpPath, { flags: 'a' });
      this.logPath = systemTmpPath;
    }
  }

  private async writeEntry(entry: LogEntry): Promise<void> {
    await this.initPromise; // Ensure initialization is complete

    if (!this.stream) {
      throw new Error('Logger stream not initialized');
    }

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
      
      // Write to stream with Promise wrapper for proper async handling
      await new Promise<void>((resolve, reject) => {
        if (!this.stream) {
          reject(new Error('Logger stream not initialized'));
          return;
        }

        const writeSuccess = this.stream.write(formattedEntry, (error) => {
          if (error) reject(error);
          else resolve();
        });
        
        // Handle backpressure
        if (!writeSuccess) {
          this.stream.once('drain', resolve);
        }
      });
    } catch (error) {
      // Try to recover by switching to temp file
      try {
        await this.fallbackToTemp();
        
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
        
        if (this.stream) {
          await new Promise<void>((resolve, reject) => {
            this.stream!.write(JSON.stringify(errorEntry) + '\n', (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      } catch {
        // Silent fail - we can't log if logging itself fails
      }
    }
  }

  private async log(level: LogEntry['level'], message: string, metadata?: Record<string, any>): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      metadata
    };
    await this.writeEntry(entry);
  }

  async info(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log('info', message, metadata);
  }

  async error(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log('error', message, metadata);
  }

  async debug(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log('debug', message, metadata);
  }

  async warn(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log('warn', message, metadata);
  }

  async close(): Promise<void> {
    await this.initPromise;
    if (this.stream) {
      await new Promise<void>((resolve) => {
        this.stream!.end(() => resolve());
      });
    }
  }
}

// Factory function to create loggers with consistent paths
export async function createLogger(sessionId: string, component: string): Promise<Logger> {
  try {
    const resolver = await PathResolver.getInstance();
    if (!resolver.isInitialized()) {
      await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    
    // Determine log path
    const logPath = sessionId === 'server' 
      ? `sessions/server/${component}.log`
      : `sessions/${sessionId}/logs/${component}.log`;

    // Create logger with original path
    return new Logger(logPath, component);
  } catch (error) {
    // Try fallback to tmp directory
    const resolver = await PathResolver.getInstance();
    if (!resolver.isInitialized()) {
      await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
    }
    const tmpPath = `tmp/${sessionId}-${component}.log`;
    return new Logger(tmpPath, component);
  }
}
