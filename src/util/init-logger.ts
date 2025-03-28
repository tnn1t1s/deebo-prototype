import { WriteStream, createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DIRS } from './config.js';

class InitLogger {
  private stream: WriteStream | null = null;
  private logPath: string = '';
  private fallbackDirectory: string;
  private initialized: boolean = false;
  private logEntries: Array<{
    timestamp: string;
    level: string; 
    message: string;
    metadata?: Record<string, any>;
  }> = [];

  constructor() {
    // Start with memory buffer until filesystem is ready
    this.fallbackDirectory = join(tmpdir(), 'deebo-prototype', 'init');
    this.ensureInitialized().catch(() => {
      // Silent catch - we'll operate in memory-only mode if initialization fails
    });
  }

  private async ensureInitialized() {
    if (this.initialized) return;

    try {
      // Use logs directory from config
      this.fallbackDirectory = DIRS.logs;
      
      // Create logs directory
      await mkdir(this.fallbackDirectory, { recursive: true });

      this.logPath = join(this.fallbackDirectory, 'init.log');
      
      // Create stream with proper error handling
      const stream = createWriteStream(this.logPath, { flags: 'a' });
      
      // Set up error handler before any operations
      stream.on('error', () => {
        this.initialized = false;
        // Let Node handle stream cleanup
      });

      // Write buffered entries after error handler is set up
      for (const entry of this.logEntries) {
        stream.write(JSON.stringify(entry) + '\n');
      }
      this.logEntries = [];

      // Only set stream and initialized after successful setup
      this.stream = stream;
      this.initialized = true;
    } catch {
      // Silent failure - operate in memory-only mode
      this.stream = null;
      this.logPath = '';
    }
  }

  private async writeToFile(level: string, message: string, metadata?: Record<string, any>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(metadata ? { metadata } : {})
    };

    // Try to initialize if needed
    if (!this.initialized) {
      await this.ensureInitialized();
    }

    // Write to file if stream exists
    if (this.stream) {
      // Let Node handle the write operation naturally
      this.stream.write(JSON.stringify(entry) + '\n');
    } else {
      // Only buffer if no stream available
      this.logEntries.push(entry);
    }
  }

  async info(message: string, metadata?: Record<string, any>) {
    await this.writeToFile('info', message, metadata);
  }

  async error(message: string, metadata?: Record<string, any>) {
    await this.writeToFile('error', message, metadata);
  }

  async debug(message: string, metadata?: Record<string, any>) {
    await this.writeToFile('debug', message, metadata);
  }

  async warn(message: string, metadata?: Record<string, any>) {
    await this.writeToFile('warn', message, metadata);
  }

  async close() {
    // Write any remaining entries without waiting
    if (this.stream && this.logEntries.length > 0) {
      for (const entry of this.logEntries) {
        this.stream.write(JSON.stringify(entry) + '\n');
      }
    }

    // Let Node handle stream cleanup naturally
    if (this.stream) {
      this.stream.end();
      // Don't null out the stream - let Node's GC handle it
    }
    
    this.initialized = false;
    this.logEntries = [];
  }
}

// Export a singleton instance
export const initLogger = new InitLogger();
