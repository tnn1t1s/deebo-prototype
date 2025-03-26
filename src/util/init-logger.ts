import { WriteStream, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, existsSync } from 'fs';

class InitLogger {
  private stream: WriteStream | null = null;
  private logPath: string;

  constructor() {
    // Try to use system temp directory for initialization logs
    const tempDir = join(tmpdir(), 'deebo-prototype', 'init');
    
    try {
      // Ensure temp directory exists
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      
      this.logPath = join(tempDir, 'init.log');
      this.stream = createWriteStream(this.logPath, { flags: 'a' });
      
      // Handle stream errors silently - we don't want to interfere with stdio
      this.stream.on('error', () => {
        this.stream = null;
      });
    } catch {
      // If we can't create the file logger, we'll operate in silent mode
      this.logPath = '';
      this.stream = null;
    }
  }

  private writeToFile(level: string, message: string, metadata?: Record<string, any>) {
    if (!this.stream) return;

    try {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(metadata ? { metadata } : {})
      };

      this.stream.write(JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail - we don't want to interfere with stdio
    }
  }

  info(message: string, metadata?: Record<string, any>) {
    this.writeToFile('info', message, metadata);
  }

  error(message: string, metadata?: Record<string, any>) {
    this.writeToFile('error', message, metadata);
  }

  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

// Export a singleton instance
export const initLogger = new InitLogger();
