import { join } from 'path';
import { readFile } from 'fs/promises';

// Basic infrastructure - keep it simple
export const DEEBO_ROOT = process.env.DEEBO_ROOT || process.cwd();

// Static paths - no getters, no validation
export const DIRS = {
  root: DEEBO_ROOT,
  sessions: join(DEEBO_ROOT, 'sessions'),
  logs: join(DEEBO_ROOT, 'logs'),
  reports: join(DEEBO_ROOT, 'reports'),
  config: join(DEEBO_ROOT, 'config')
} as const;

// Python configuration
interface PythonConfig {
  interpreter_path: string;
  venv_path: string;
}

/**
 * Load Python configuration - keep it simple
 * - Just read config file
 * - Trust git-mcp to validate paths
 */
export async function loadPythonConfig(): Promise<PythonConfig> {
  const configPath = join(DIRS.config, 'python-config.json');
  const content = await readFile(configPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Get Python environment variables
 * - Just basic env vars
 * - Trust process environment
 */
export function getPythonEnv(config: PythonConfig): Record<string, string> {
  return {
    VIRTUAL_ENV: config.venv_path,
    PYTHONPATH: join(config.venv_path, 'lib', 'python3.11', 'site-packages'),
    PATH: `${join(config.venv_path, 'bin')}:${process.env.PATH}`
  };
}
