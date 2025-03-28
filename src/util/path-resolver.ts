import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { createLogger, Logger } from './logger.js';
import { PythonPathResolver } from './python-path-resolver.js';

/**
 * Simple path resolver that separates infrastructure files from target files
 */
export class PathResolver {
  private static instance: PathResolver;
  private infrastructureRoot: string;
  private targetRoot: string | null = null;
  private _isInitialized = false;
  private pythonResolver: PythonPathResolver | null = null;

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
    
    const logger = await createLogger('system', 'path-resolver');
    await logger.info('Initializing PathResolver');

    // Initialize Python resolver
    try {
      this.pythonResolver = await PythonPathResolver.getInstance(this.infrastructureRoot);
      await logger.info('Python path resolver initialized');
    } catch (error) {
      await logger.warn('Python initialization failed, git-mcp features will be limited', { error });
    }
    
    try {
      // Create infrastructure root and config directory
      await fs.mkdir(this.infrastructureRoot, { recursive: true });
      await fs.mkdir(path.join(this.infrastructureRoot, 'config'), { recursive: true });
      
      // Copy tools.json from current directory to infrastructure root
      const sourceToolsPath = path.join(process.cwd(), 'config', 'tools.json');
      const targetToolsPath = path.join(this.infrastructureRoot, 'config', 'tools.json');
      
      let toolsConfig: string;
      try {
        toolsConfig = await fs.readFile(sourceToolsPath, 'utf-8');
      } catch (error) {
        // If source doesn't exist, use default config
        const defaultConfig = {
          "tools": {
            "filesystem-mcp": {
              "command": "node",
              "args": [
                "--experimental-specifier-resolution=node",
                "node_modules/@modelcontextprotocol/server-filesystem/dist/esm/index.js",
                process.cwd()
              ],
              "timeout": 10000,
              "retries": 3,
              "baseDelay": 1000,
              "allowedActions": [
                "read_file",
                "write_file",
                "create_directory",
                "list_directory",
                "search_files",
                "get_file_info",
                "move_file",
                "edit_file"
              ]
            },
            "git-mcp": {
              "command": "python",
              "args": [
                "-m",
                "mcp_server_git"
              ],
              "timeout": 10000,
              "retries": 3,
              "baseDelay": 1000,
              "allowedActions": [
                "git_status",
                "git_diff",
                "git_diff_unstaged",
                "git_diff_staged",
                "git_commit",
                "git_add",
                "git_reset",
                "git_log",
                "git_create_branch",
                "git_checkout",
                "git_show",
                "git_init"
              ]
            }
          }
        };
        await fs.writeFile(targetToolsPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
        toolsConfig = JSON.stringify(defaultConfig);
      }
      
      await fs.writeFile(targetToolsPath, toolsConfig, 'utf-8');
      
      // DEEBO_ROOT is always the infrastructure root
      process.env.DEEBO_ROOT = this.infrastructureRoot;
      
      await logger.info('PathResolver initialization complete');
      this._isInitialized = true;
    } catch (error) {
      await logger.error('Failed to initialize PathResolver', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  public async initialize(targetRoot?: string): Promise<void> {
    if (!this._isInitialized) {
      await this.init();
    }
    
    if (targetRoot) {
      this.targetRoot = targetRoot;
      // Store target root for Git/filesystem operations
      process.env.TARGET_ROOT = targetRoot;
    }
  }

  public resolvePath(inputPath: string): string {
    // Infrastructure paths (including config) go to ~/.local/share/deebo-prototype
    if (inputPath.startsWith('sessions/') || 
        inputPath.startsWith('logs/') || 
        inputPath.startsWith('reports/') ||
        inputPath.startsWith('config/')) {
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

  /**
   * Get Python environment configuration
   */
  public getPythonEnv(): Record<string, string> {
    if (!this.pythonResolver) {
      // Create a type-safe environment record with only string values
      const safeEnv: Record<string, string> = {};
      Object.entries(process.env).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          safeEnv[key] = String(value);
        }
      });
      return safeEnv;
    }
    // Convert returned environment to safe Record<string, string>
    const env = this.pythonResolver.getEnv();
    const safeEnv: Record<string, string> = {};
    Object.entries(env).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        safeEnv[key] = String(value);
      }
    });
    return safeEnv;
  }

  public getPythonInterpreterPath(): string | null {
    try {
      return this.pythonResolver?.getInterpreterPath() ?? null;
    } catch {
      return null;
    }
  }

  public getVenvPath(): string | null {
    try {
      return this.pythonResolver?.getVenvPath() ?? null;
    } catch {
      return null;
    }
  }

  public async validatePythonSetup(): Promise<boolean> {
    if (!this.pythonResolver) return false;
    try {
      await this.pythonResolver.validate();
      return true;
    } catch {
      return false;
    }
  }

  public async getReportsDirectory(): Promise<string> {
    return this.ensureDirectory('reports');
  }

  public isInitialized(): boolean {
    return this._isInitialized;
  }
}
