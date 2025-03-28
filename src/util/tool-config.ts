import { z } from 'zod';
import { promises as fs } from 'fs';
import { FSWatcher, watch } from 'fs';
import { resolve } from 'path';
import { createLogger } from './logger.js';
import { PathResolver } from './path-resolver.js';

// Tool configuration schema using Zod
const PythonToolConfigSchema = z.object({
  usePythonResolver: z.boolean().default(false),
  pythonEnvVars: z.record(z.string()).optional()
});

const ToolConfigSchema = z.object({
  tools: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()),
    timeout: z.number().min(1000).default(10000),
    retries: z.number().min(0).default(3),
    baseDelay: z.number().min(100).default(1000),
    allowedActions: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    python: PythonToolConfigSchema.optional()
  }))
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export class ToolConfigManager {
  private static instance: ToolConfigManager;
  private config: ToolConfig | null = null;
  private configPath: string;
  private logger: any;
  private watcher: FSWatcher | null = null;

  private constructor(configPath: string) {
    this.configPath = configPath;
  }

  static async getInstance(configPath = 'config/tools.json'): Promise<ToolConfigManager> {
    if (!ToolConfigManager.instance) {
      ToolConfigManager.instance = new ToolConfigManager(configPath);
      await ToolConfigManager.instance.initialize();
    }
    return ToolConfigManager.instance;
  }

  private async initialize() {
    try {
      // Initialize logger first
      const { createLogger } = await import('./logger.js');
      this.logger = await createLogger('system', 'tool-config');
      
      // Get path resolver and ensure config directory exists
      const pathResolver = await PathResolver.getInstance();
      
      // Ensure config directory exists
      const configDir = await pathResolver.ensureDirectory('config');
      await this.logger.info('Config directory ensured', { path: configDir });
      
      await this.loadConfig();
      await this.watchConfig();
    } catch (error) {
      this.logger.error('Tool config initialization failed', { error });
      throw error;
    }
  }

  private async loadConfig() {
    try {
      // Get resolver for safe path handling
      const resolver = await PathResolver.getInstance();
      
      // Use resolver to get safe config path
      const fullPath = resolver.resolvePath(this.configPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const json = JSON.parse(content);
      
      const result = ToolConfigSchema.safeParse(json);
      
      if (!result.success) {
        this.logger.error('Invalid tool configuration', { 
          errors: result.error.errors 
        });
        throw new Error('Invalid tool configuration');
      }

      this.config = result.data;
      this.logger.info('Tool configuration loaded successfully', {
        toolCount: Object.keys(this.config.tools).length
      });
    } catch (error: any) {
      this.logger.error('Failed to load tool configuration', { 
        error: error.message 
      });
      throw error;
    }
  }

  private async watchConfig() {
    try {
      // Clean up existing watcher if any
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }

      const fullPath = resolve(process.cwd(), this.configPath);
      const dir = resolve(fullPath, '..');
      
      // Store watcher reference for cleanup
      const watcher = watch(dir, (eventType: string, filename: string | null) => {
        if (filename && filename === 'tools.json') {
          this.logger.info('Tool configuration file changed, reloading');
          this.loadConfig().catch(error => {
            this.logger.error('Failed to reload config', { error });
          });
        }
      });
      
      this.watcher = watcher;
    } catch (error: any) {
      this.logger.error('Failed to watch tool configuration', { 
        error: error.message 
      });
    }
  }

  public async dispose() {
    try {
      // Log before cleanup
      await this.logger?.info('Disposing tool config manager');

      // Clean up watcher
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }

      // Reset singleton instance only if this is the current instance
      if (ToolConfigManager.instance === this) {
        ToolConfigManager.instance = null as unknown as ToolConfigManager;
      }

      // Clean up config state last
      this.config = null;
      this.logger = null;

    } catch (error) {
      // Log error before nulling logger
      await this.logger?.error('Error during tool config manager disposal', { error });
      
      // Clean up even on error
      this.config = null;
      this.logger = null;
      
      throw error;
    }
  }

  async getToolConfig(toolName: string) {
    if (!this.config) {
      throw new Error('Tool configuration not loaded');
    }

    const toolConfig = this.config.tools[toolName];
    if (!toolConfig) {
      throw new Error(`Tool not found in configuration: ${toolName}`);
    }

    // If tool uses Python resolver, merge Python environment
    if (toolConfig.python?.usePythonResolver) {
      const { PythonPathResolver } = await import('./python-path-resolver.js');
      const pythonResolver = await PythonPathResolver.getInstance();
      
      // Update command to use resolved Python interpreter
      toolConfig.command = pythonResolver.getInterpreterPath();
      
      // Merge Python environment variables
      toolConfig.env = {
        ...toolConfig.env,
        ...pythonResolver.getEnv(),
        ...toolConfig.python.pythonEnvVars
      };
    }

    return toolConfig;
  }

  async isActionAllowed(toolName: string, action: string): Promise<boolean> {
    try {
      const config = await this.getToolConfig(toolName);
      if (!config.allowedActions) {
        return true; // If no allowed actions specified, allow all
      }
      return config.allowedActions.includes(action);
    } catch {
      return false;
    }
  }

  async validateToolPath(toolName: string): Promise<boolean> {
    try {
      const config = await this.getToolConfig(toolName);
      // Just check if the command exists, since we're using external tools
      return config.command !== undefined && config.args !== undefined;
    } catch {
      return false;
    }
  }

  async getRetryConfig(toolName: string) {
    const config = await this.getToolConfig(toolName);
    return {
      timeout: config.timeout,
      retries: config.retries,
      baseDelay: config.baseDelay
    };
  }
}
