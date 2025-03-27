import { mkdirSync, existsSync } from 'fs';
import path, { join } from 'path';
import { homedir, tmpdir } from 'os';
import { initLogger } from './init-logger.js';
import { PathResolver } from './path-resolver.js';

/**
 * Create a directory and its parents if they don't exist
 */
function createDirSafe(baseDir: string, dir: string): void {
  const fullPath = join(baseDir, dir);
  if (!existsSync(fullPath)) {
    try {
      mkdirSync(fullPath, { recursive: true, mode: 0o755 });
      initLogger.info('Created directory', { path: fullPath });
    } catch (error) {
      initLogger.error('Failed to create directory', { path: fullPath, error: String(error) });
      throw error;
    }
  }
}

/**
 * Initialize all required directories
 * This is a critical function that must complete successfully before the application can run
 * Returns a Promise that resolves with the root directory used
 */
export async function initializeDirectories(): Promise<string> {
  initLogger.info('Initializing required directories');
  
  // Emergency safety check - ensure we never try to use the system root as our base directory
  if (process.cwd() === '/') {
    const errMsg = 'CRITICAL SAFETY ISSUE: Current working directory is system root (/). This is not supported.';
    initLogger.error(errMsg);
    throw new Error(errMsg);
  }
  
  const pathResolver = PathResolver.getInstance();

  try {
    // Try project directory first - make sure it's not the system root
    const projectDir = process.cwd();
    if (projectDir === '/') {
      throw new Error('SAFETY ERROR: Current working directory is system root (/)');
    }
    
    initLogger.info('Initializing with project directory', { path: projectDir });
    
    // Initialize the path resolver with the project directory and await it
    await pathResolver.initialize(projectDir);
    
    // CRITICAL SAFETY CHECK - ensure we're not using system root
    if (pathResolver.getRootDir() === '/') {
      throw new Error('CRITICAL SAFETY ERROR: Path resolver root directory is system root (/)');
    }
    
    // Guarantee that DEEBO_ROOT is set and matches the resolver's root
    if (process.env.DEEBO_ROOT !== pathResolver.getRootDir()) {
      process.env.DEEBO_ROOT = pathResolver.getRootDir();
      initLogger.info('Updated DEEBO_ROOT environment variable', { path: process.env.DEEBO_ROOT });
    }
    
    // Create required directories, using relative paths only to avoid any absolute path issues
    initLogger.info('Creating required directories using relative paths only');
    
    // Use a consistent naming convention for all output paths
    const tmpDir = await pathResolver.ensureDirectory('tmp');
    initLogger.info('Created directory', { name: 'tmp', path: tmpDir });
    
    const sessionsDir = await pathResolver.ensureDirectory('sessions');
    initLogger.info('Created directory', { name: 'sessions', path: sessionsDir });
    
    const serverDir = await pathResolver.ensureDirectory('sessions/server');
    initLogger.info('Created directory', { name: 'sessions/server', path: serverDir });
    
    const reportsDir = await pathResolver.ensureDirectory('reports');
    initLogger.info('Created directory', { name: 'reports', path: reportsDir });
    
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

    const fallbackDir = join(home, '.deebo-prototype');
    initLogger.info('Falling back to home directory', { path: fallbackDir });

    // Create base fallback directory with traditional method first
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true, mode: 0o755 });
    }
    
    // Re-initialize the path resolver with the fallback directory
    await pathResolver.initialize(fallbackDir);
    
    // Create all required directories - using only relative paths for safety
    const tmpDir = await pathResolver.ensureDirectory('tmp');
    initLogger.info('Created directory in home fallback', { name: 'tmp', path: tmpDir });
    
    const sessionsDir = await pathResolver.ensureDirectory('sessions');
    initLogger.info('Created directory in home fallback', { name: 'sessions', path: sessionsDir });
    
    const serverDir = await pathResolver.ensureDirectory('sessions/server');
    initLogger.info('Created directory in home fallback', { name: 'sessions/server', path: serverDir });
    
    const reportsDir = await pathResolver.ensureDirectory('reports');
    initLogger.info('Created directory in home fallback', { name: 'reports', path: reportsDir });
    
    initLogger.info('Directory initialization complete', { location: 'home directory', path: fallbackDir });
    return fallbackDir;
  } catch (error) {
    initLogger.error('Failed to create directories in home directory', { error: String(error) });
  }

  // Final fallback to system temp directory
  try {
    const tempDir = join(tmpdir(), 'deebo-prototype');
    initLogger.info('Falling back to temp directory', { path: tempDir });

    // Create base fallback directory with traditional method first
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true, mode: 0o755 });
    }
    
    // Re-initialize the path resolver with the temp directory
    await pathResolver.initialize(tempDir);
    
    // Create all required directories - using only relative paths for safety
    const tmpDir = await pathResolver.ensureDirectory('tmp');
    initLogger.info('Created directory in temp fallback', { name: 'tmp', path: tmpDir });
    
    const sessionsDir = await pathResolver.ensureDirectory('sessions');
    initLogger.info('Created directory in temp fallback', { name: 'sessions', path: sessionsDir });
    
    const serverDir = await pathResolver.ensureDirectory('sessions/server');
    initLogger.info('Created directory in temp fallback', { name: 'sessions/server', path: serverDir });
    
    const reportsDir = await pathResolver.ensureDirectory('reports');
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
  
  // CRITICAL SAFETY CHECK: Never attempt to create directories at system root level
  if (dirPath === '/' || dirPath.match(/^\/[^/]+$/)) {
    const errorMsg = `CRITICAL SAFETY ERROR: Attempted to create system root-level directory: ${dirPath}`;
    initLogger.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  const pathResolver = PathResolver.getInstance();
  
  // Ensure the PathResolver is properly initialized
  if (!pathResolver.isInitialized()) {
    initLogger.info('Initializing PathResolver before directory creation');
    await pathResolver.initialize();
  }
  
  // CRITICAL SAFETY CHECK: Ensure the root directory is not the system root
  if (pathResolver.getRootDir() === '/') {
    const errorMsg = 'CRITICAL SAFETY ERROR: Path resolver root directory is system root (/)';
    initLogger.error(errorMsg);
    
    // Emergency override - use home directory
    const home = homedir();
    const fallbackDir = join(home, '.deebo-prototype');
    
    initLogger.info('Emergency override: re-initializing with home directory', { path: fallbackDir });
    
    // Create the fallback directory
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true, mode: 0o755 });
    }
    
    // Re-initialize the path resolver with this safe directory
    await pathResolver.initialize(fallbackDir);
  }
  
  // Log the operation with clear input information
  initLogger.info('Ensuring directory exists', { 
    dirPath,
    rootDir: pathResolver.getRootDir()
  });
  
  try {
    // Convert any absolute path to relative for safety
    let normalizedPath = dirPath;
    if (path.isAbsolute(dirPath)) {
      normalizedPath = dirPath.replace(/^\/+/, '');
      initLogger.info('Converted absolute path to relative for safety', {
        original: dirPath,
        normalized: normalizedPath
      });
    }
    
    // Use the improved path resolver to ensure the directory exists
    const absolutePath = await pathResolver.ensureDirectory(normalizedPath);
    
    // Verify the directory exists after creation
    const exists = await pathResolver.validateDirectory(absolutePath);
    if (!exists) {
      throw new Error(`Directory creation succeeded but verification failed: ${absolutePath}`);
    }
    
    initLogger.info('Directory creation successful', { 
      requestedPath: dirPath,
      normalizedPath,
      createdPath: absolutePath
    });
    
    return absolutePath;
  } catch (error) {
    initLogger.error('Failed to ensure directory via path resolver', { 
      error: String(error),
      dirPath
    });
    
    // As a last resort, try system temp directory
    try {
      // For the fallback approach, remove any leading slashes for consistency
      const normalizedPath = dirPath.replace(/^\/+/, '');
      const systemTmpPath = join(tmpdir(), 'deebo-prototype', normalizedPath);
      
      initLogger.info('Attempting to create directory in system temp as last resort', { 
        originalPath: dirPath,
        normalizedPath,
        systemTmpPath
      });
      
      mkdirSync(systemTmpPath, { recursive: true, mode: 0o755 });
      
      initLogger.info('Successfully created directory in system temp', { path: systemTmpPath });
      return systemTmpPath;
    } catch (fallbackError) {
      initLogger.error('Failed to create directory even in system temp', { 
        error: String(fallbackError),
        originalPath: dirPath 
      });
      throw new Error(`Failed to create directory ${dirPath} in any location: ${error}`);
    }
  }
}
