import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { createLogger } from './logger.js';

interface PythonConfig {
  interpreter_path: string;
  venv_path: string;
  git_mcp_version: string;
  python_version: string;
}

export class PythonPathResolver {
  private static instance: PythonPathResolver;
  private config: PythonConfig | null = null;
  private logger: any;
  private configPath: string;

  private constructor(infrastructureRoot: string) {
    this.configPath = path.join(infrastructureRoot, 'python-config.json');
  }

  public static async getInstance(infrastructureRoot?: string): Promise<PythonPathResolver> {
    if (!this.instance) {
      if (!infrastructureRoot) {
        throw new Error('Infrastructure root required for first initialization');
      }
      this.instance = new PythonPathResolver(infrastructureRoot);
      await this.instance.init();
    }
    return this.instance;
  }

  private async init(): Promise<void> {
    this.logger = await createLogger('system', 'python-path-resolver');
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configContent);
      await this.validate();
      if (this.config) {
        await this.logger.info('Python configuration loaded successfully', {
          interpreter: this.config.interpreter_path,
          venv: this.config.venv_path,
          version: this.config.python_version
        });
      }
    } catch (error) {
      await this.logger.error('Failed to load Python configuration', { error });
      throw new Error(`Python configuration error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async validate(): Promise<void> {
    if (!this.config) throw new Error('Python configuration not loaded');

    const required = ['interpreter_path', 'venv_path', 'git_mcp_version', 'python_version'];
    const missing = required.filter(key => !(key in this.config!));
    
    if (missing.length > 0) {
      throw new Error(`Missing required Python configuration: ${missing.join(', ')}`);
    }

    await this.validatePaths();
    await this.validatePythonVersion();
    await this.validateGitMcp();
  }

  private async validatePaths(): Promise<void> {
    if (!this.config) throw new Error('Python configuration not loaded');

    try {
      await fs.access(this.config.interpreter_path);
      await fs.access(this.config.venv_path);
    } catch (error) {
      throw new Error(`Invalid Python paths: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate venv structure
    const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
    const venvPython = path.join(this.config.venv_path, venvBin, process.platform === 'win32' ? 'python.exe' : 'python');
    
    try {
      await fs.access(venvPython);
    } catch {
      throw new Error(`Virtual environment Python not found at: ${venvPython}`);
    }
  }

  private async validatePythonVersion(): Promise<void> {
    if (!this.config) throw new Error('Python configuration not loaded');

    const { spawn } = await import('child_process');
    const python = spawn(this.config.interpreter_path, ['--version']);
    
    let version = '';
    for await (const chunk of python.stdout) {
      version += chunk;
    }

    // Version format: "Python 3.x.y"
    const match = version.match(/Python (\d+\.\d+\.\d+)/);
    if (!match) {
      throw new Error('Could not determine Python version');
    }

    const installedVersion = match[1];
    if (installedVersion !== this.config.python_version) {
      throw new Error(`Python version mismatch: expected ${this.config.python_version}, found ${installedVersion}`);
    }
  }

  private async validateGitMcp(): Promise<void> {
    if (!this.config) throw new Error('Python configuration not loaded');

    const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
    const gitMcpPath = path.join(this.config.venv_path, venvBin, 'mcp-server-git');
    
    try {
      await fs.access(gitMcpPath);
    } catch {
      throw new Error('git-mcp server not found in virtual environment');
    }

    // Validate version
    const { spawn } = await import('child_process');
    const python = spawn(this.config.interpreter_path, ['-m', 'pip', 'show', 'mcp-server-git']);
    
    let output = '';
    for await (const chunk of python.stdout) {
      output += chunk;
    }

    const versionMatch = output.match(/Version: (.+)/);
    if (!versionMatch || versionMatch[1] !== this.config.git_mcp_version) {
      throw new Error(`git-mcp version mismatch: expected ${this.config.git_mcp_version}`);
    }
  }

  public getInterpreterPath(): string {
    if (!this.config) throw new Error('Python configuration not loaded');
    return this.config.interpreter_path;
  }

  public getVenvPath(): string {
    if (!this.config) throw new Error('Python configuration not loaded');
    return this.config.venv_path;
  }

  public getGitMcpVersion(): string {
    if (!this.config) throw new Error('Python configuration not loaded');
    return this.config.git_mcp_version;
  }

  public getEnv(): Record<string, string> {
    if (!this.config) throw new Error('Python configuration not loaded');

    // Start with a clean environment object that's type-safe
    const safeEnv: Record<string, string> = {};
    
    // Process environment variables to ensure all values are strings
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        safeEnv[key] = String(value);
      }
    });
    
    // Add Python-specific variables
    const venvBin = process.platform === 'win32' ? 'Scripts' : 'bin';
    safeEnv['VIRTUAL_ENV'] = this.config.venv_path;
    safeEnv['PATH'] = `${path.join(this.config.venv_path, venvBin)}${path.delimiter}${safeEnv['PATH'] || ''}`;
    delete safeEnv['PYTHONHOME'];
    
    // Add extra variables that could help with debugging
    safeEnv['PYTHONUNBUFFERED'] = '1';
    safeEnv['DEEBO_PYTHON_VERSION'] = this.config.python_version;
    
    return safeEnv;
  }
}
