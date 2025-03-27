import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';

/**
 * Simple path resolver that separates infrastructure files from target files
 */
export class PathResolver {
  private static instance: PathResolver;
  private infrastructureRoot: string;
  private targetRoot: string | null = null;
  private _isInitialized = false;

  private constructor() {
    this.infrastructureRoot = path.join(homedir(), '.local', 'share', 'deebo-prototype');
  }

  public static async getInstance(): Promise<PathResolver> {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
      await PathResolver.instance.init();
    }
    return PathResolver.instance;
  }

  private async init(): Promise<void> {
    if (this._isInitialized) return;
    
    // Create infrastructure directories
    await fs.mkdir(this.infrastructureRoot, { recursive: true });
    process.env.DEEBO_ROOT = this.infrastructureRoot;
    
    this._isInitialized = true;
  }

  public async initialize(targetRoot?: string): Promise<void> {
    if (!this._isInitialized) {
      await this.init();
    }
    
    if (targetRoot) {
      this.targetRoot = targetRoot;
    }
  }

  public resolvePath(inputPath: string): string {
    // Infrastructure paths go to ~/.local/share/deebo-prototype
    if (inputPath.startsWith('sessions/') || 
        inputPath.startsWith('logs/') || 
        inputPath.startsWith('reports/')) {
      return path.join(this.infrastructureRoot, inputPath);
    }
    
    // Everything else goes to target directory if set
    return path.join(this.targetRoot || this.infrastructureRoot, inputPath);
  }

  public async validateDirectory(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  public async ensureDirectory(dirPath: string): Promise<string> {
    const fullPath = this.resolvePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  public getRootDir(): string {
    return this.targetRoot || this.infrastructureRoot;
  }

  public async getReportsDirectory(): Promise<string> {
    return this.ensureDirectory('reports');
  }

  public isInitialized(): boolean {
    return this._isInitialized;
  }
}
