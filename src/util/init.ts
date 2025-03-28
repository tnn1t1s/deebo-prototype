let isInitialized = false;

// Track initialization state
export function getInitialized() {
  console.log('getInitialized called, current state:', isInitialized);
  return isInitialized;
}

// Initialize all core systems
export async function initializeCore(server?: any) {
  console.log('Starting core initialization');

  // Initialize key directories first
  await initializeDirectories();

  // Initialize protocol layer
  const { initializeProtocol } = await import('../protocol/index.js');
  await initializeProtocol();

  // Initialize agents if server provided
  if (server) {
    const { initializeAgents } = await import('../agents/index.js');
    await initializeAgents(server);
  }

  isInitialized = true;
  console.log('Core initialization complete');
}

import { homedir, tmpdir } from 'os';
import { initLogger } from './init-logger.js';

/**
 * Initialize all required directories
 * This is a critical function that must complete successfully before the application can run
 * Returns a Promise that resolves with the root directory used
 */
export async function initializeDirectories(): Promise<string> {
  initLogger.info('Initializing required directories');
  
  // Get path resolver for safety checks
  const { PathResolver } = await import('./path-resolver.js');
  const resolver = await PathResolver.getInstance();
  if (!resolver.isInitialized()) {
    await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
  }
  
  // Strict validation of current directory
  const currentDir = process.cwd();
  if (currentDir === '/' || currentDir.split('/').length < 3) {
    const errMsg = 'CRITICAL SAFETY ISSUE: Current working directory is system root or unsafe path. This is not supported.';
    initLogger.error(errMsg);
    // Instead of throwing, try to use a safe fallback
    const safeDir = `${homedir()}/.local/share/deebo-prototype`;
    
    initLogger.info('Using safe fallback directory', { path: safeDir });
    await resolver.initialize(safeDir);
    
    // Create core directories under the safe path
    const paths = ['logs', 'tmp', 'sessions', 'reports'];
    for (const dir of paths) {
      const dirPath = await resolver.ensureDirectory(dir);
      initLogger.info('Created core directory', { dir, path: dirPath });
    }
    
    return safeDir;
  }
  
  try {
    // Try project directory first - make sure it's not the system root
    const projectDir = process.cwd();
    if (projectDir === '/') {
      throw new Error('SAFETY ERROR: Current working directory is system root (/)');
    }
    
    initLogger.info('Initializing with project directory', { path: projectDir });
    
    // Initialize the path resolver with the project directory
    await resolver.initialize(projectDir);
    
    // CRITICAL SAFETY CHECK - ensure we're not using system root
    if (resolver.getRootDir() === '/') {
      throw new Error('CRITICAL SAFETY ERROR: Path resolver root directory is system root (/)');
    }
    
    // Guarantee that DEEBO_ROOT is set and matches the resolver's root
    if (process.env.DEEBO_ROOT !== resolver.getRootDir()) {
      process.env.DEEBO_ROOT = resolver.getRootDir();
      initLogger.info('Updated DEEBO_ROOT environment variable', { path: process.env.DEEBO_ROOT });
    }
    
    initLogger.info('Creating required directories using relative paths only');
    
    const dirs = ['tmp', 'sessions', 'sessions/server', 'reports'];
    await Promise.all(
      dirs.map(async (dir) => {
        const dirPath = await resolver.ensureDirectory(dir);
        initLogger.info('Created directory', { name: dir, path: dirPath });
      })
    );
    
    initLogger.info('Directory initialization complete', { location: 'project directory', path: projectDir });
    return projectDir;
  } catch (error) {
    initLogger.error('Failed to create directories in project directory', { error: String(error) });
  }

  // If project directory initialization failed, try home directory
  try {
    const home = homedir();
    if (!home) {
      throw new Error('Could not determine home directory');
    }

    const fallbackDir = `${home}/.deebo-prototype`;
    initLogger.info('Falling back to home directory', { path: fallbackDir });
    
    // Initialize resolver with fallback directory
    await resolver.initialize(fallbackDir);
    
    // Create required directories in parallel
    const dirs = ['tmp', 'sessions', 'sessions/server', 'reports'];
    await Promise.all(
      dirs.map(async (dir) => {
        const dirPath = await resolver.ensureDirectory(dir);
        initLogger.info('Created directory in home fallback', { name: dir, path: dirPath });
      })
    );
    
    initLogger.info('Directory initialization complete', { location: 'home directory', path: fallbackDir });
    return fallbackDir;
  } catch (error) {
    initLogger.error('Failed to create directories in home directory', { error: String(error) });
  }

  // Final fallback to system temp directory
  try {
    const tempDir = `${tmpdir()}/deebo-prototype`;
    initLogger.info('Falling back to temp directory', { path: tempDir });
    
    // Initialize resolver with temp directory
    await resolver.initialize(tempDir);
    
    // Create all required directories - using only relative paths for safety
    const tmpDir = await resolver.ensureDirectory('tmp');
    initLogger.info('Created directory in temp fallback', { name: 'tmp', path: tmpDir });
    
    const sessionsDir = await resolver.ensureDirectory('sessions');
    initLogger.info('Created directory in temp fallback', { name: 'sessions', path: sessionsDir });
    
    const serverDir = await resolver.ensureDirectory('sessions/server');
    initLogger.info('Created directory in temp fallback', { name: 'sessions/server', path: serverDir });
    
    const reportsDir = await resolver.ensureDirectory('reports');
    initLogger.info('Created directory in temp fallback', { name: 'reports', path: reportsDir });
    
    initLogger.info('Directory initialization complete', { location: 'temp directory', path: tempDir });
    return tempDir;
  } catch (error) {
    initLogger.error('Failed to create directories in temp directory', { error: String(error) });
    throw new Error('Could not initialize directories in any location');
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 * This is a critical function for ensuring consistent directory paths across the application
 * @param dirPath The path to ensure exists (can be absolute or relative)
 * @returns The absolute path to the directory
 */
export async function ensureDirectory(dirPath: string): Promise<string> {
  if (!dirPath) {
    const errorMsg = 'ensureDirectory called with empty path';
    initLogger.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  // Get path resolver instance for safe path handling
  const { PathResolver } = await import('./path-resolver.js');
  const resolver = await PathResolver.getInstance();
if (!resolver.isInitialized()) {
  await resolver.initialize(process.env.DEEBO_ROOT || process.cwd());
}
  
  try {
    // Use the path resolver to ensure the directory exists
    const absolutePath = await resolver.ensureDirectory(dirPath);
    
    initLogger.info('Directory creation successful', { 
      requestedPath: dirPath,
      createdPath: absolutePath
    });
    
    return absolutePath;
  } catch (error) {
    initLogger.error('Failed to ensure directory', { 
      error: String(error),
      dirPath
    });
    throw error;
  }
}
