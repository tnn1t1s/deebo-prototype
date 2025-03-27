import { z } from 'zod';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { createLogger } from './logger.js';

// Tool configuration schema using Zod
const ToolConfigSchema = z.object({
  tools: z.record(z.object({
    path: z.string(),
    timeout: z.number().min(1000).default(10000),
    retries: z.number().min(0).default(3),
    baseDelay: z.number().min(100).default(1000),
    allowedActions: z.array(z.string()).optional()
  }))
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export class ToolConfigManager {
  private static instance: ToolConfigManager;
  private config: ToolConfig | null = null;
  private configPath: string;
  private logger: any;
  private watcher: fs.FileHandle | null = null;

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
    // Start with initLogger
    const { initLogger } = await import('./init-logger.js');
    this.logger = initLogger;
    
    try {
      // Get path resolver and ensure config directory exists
      const { getPathResolver } = await import('./path-resolver-helper.js');
      const pathResolver = await getPathResolver();
      
      // Ensure config directory exists
      const configDir = await pathResolver.ensureDirectory('config');
      this.logger.info('Config directory ensured', { path: configDir });
      
      // Now safe to switch to regular logger
      const { createLogger } = await import('./logger.js');
      this.logger = createLogger('system', 'tool-config');
      
      await this.loadConfig();
      await this.watchConfig();
    } catch (error) {
      this.logger.error('Tool config initialization failed', { error });
      throw error;
    }
  }

  private async loadConfig() {
    try {
      const fullPath = resolve(process.cwd(), this.configPath);
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
      const fullPath = resolve(process.cwd(), this.configPath);
      const dir = resolve(fullPath, '..');
      
      // Watch the directory for changes to the config file
      const watcher = fs.watch(dir);
      
      for await (const event of watcher) {
        if (event.filename === 'tools.json') {
          this.logger.info('Tool configuration file changed, reloading');
          await this.loadConfig();
        }
      }
    } catch (error: any) {
      this.logger.error('Failed to watch tool configuration', { 
        error: error.message 
      });
    }
  }

  getToolConfig(toolName: string) {
    if (!this.config) {
      throw new Error('Tool configuration not loaded');
    }

    const toolConfig = this.config.tools[toolName];
    if (!toolConfig) {
      throw new Error(`Tool not found in configuration: ${toolName}`);
    }

    return toolConfig;
  }

  isActionAllowed(toolName: string, action: string): boolean {
    try {
      const config = this.getToolConfig(toolName);
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
      const config = this.getToolConfig(toolName);
      const fullPath = resolve(process.cwd(), config.path);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getRetryConfig(toolName: string) {
    const config = this.getToolConfig(toolName);
    return {
      timeout: config.timeout,
      retries: config.retries,
      baseDelay: config.baseDelay
    };
  }
}
