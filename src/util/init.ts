import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

/**
 * Create a directory and its parents if they don't exist
 */
function createDirSafe(baseDir: string, dir: string): void {
  const fullPath = join(baseDir, dir);
  if (!existsSync(fullPath)) {
    try {
      mkdirSync(fullPath, { recursive: true, mode: 0o755 });
      console.log(`Created directory: ${fullPath}`);
    } catch (error) {
      console.error(`Failed to create directory ${fullPath}:`, error);
      throw error;
    }
  }
}

/**
 * Initialize all required directories
 */
export function initializeDirectories(): string {
  console.log('Initializing required directories');

  // Try project directory first
  const projectDir = process.cwd();
  try {
    // Create tmp directory first as fallback location
    createDirSafe(projectDir, 'tmp');

    // Create main directories
    createDirSafe(projectDir, 'sessions');
    createDirSafe(projectDir, 'sessions/server');
    createDirSafe(projectDir, 'reports');

    // Set the root directory for other parts of the app
    process.env.DEEBO_ROOT = projectDir;
    console.log('Directory initialization complete in project directory');
    return projectDir;
  } catch (error) {
    console.error('Failed to create directories in project directory:', error);
  }

  // Fallback to user's home directory
  try {
    const home = homedir();
    if (!home) {
      throw new Error('Could not determine home directory');
    }

    const fallbackDir = join(home, '.deebo-prototype');
    console.log(`Falling back to home directory: ${fallbackDir}`);

    // Create base fallback directory
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true, mode: 0o755 });
    }

    // Create required directories in fallback location
    createDirSafe(fallbackDir, 'tmp');
    createDirSafe(fallbackDir, 'sessions');
    createDirSafe(fallbackDir, 'sessions/server');
    createDirSafe(fallbackDir, 'reports');

    // Set the root directory for other parts of the app
    process.env.DEEBO_ROOT = fallbackDir;
    console.log('Directory initialization complete in home directory');
    return fallbackDir;
  } catch (error) {
    console.error('Failed to create directories in home directory:', error);
  }

  // Final fallback to system temp directory
  try {
    const tempDir = join(tmpdir(), 'deebo-prototype');
    console.log(`Falling back to temp directory: ${tempDir}`);

    // Create required directories in temp location
    createDirSafe(tempDir, 'tmp');
    createDirSafe(tempDir, 'sessions');
    createDirSafe(tempDir, 'sessions/server');
    createDirSafe(tempDir, 'reports');

    // Set the root directory for other parts of the app
    process.env.DEEBO_ROOT = tempDir;
    console.log('Directory initialization complete in temp directory');
    return tempDir;
  } catch (error) {
    console.error('Failed to create directories in temp directory:', error);
    throw new Error('Could not initialize directories in any location');
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDirectory(dirPath: string): string {
  // Use the established root directory
  const baseDir = process.env.DEEBO_ROOT;
  if (!baseDir) {
    throw new Error('DEEBO_ROOT not set - directories not properly initialized');
  }

  // Normalize the path to handle both absolute and relative paths
  const normalizedPath = dirPath.startsWith('/')
    ? dirPath.slice(1) // Remove leading '/'
    : dirPath;

  const fullPath = join(baseDir, normalizedPath);

  try {
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true, mode: 0o755 });
      console.log(`Created directory: ${fullPath}`);
    }
    return fullPath;
  } catch (error) {
    console.error(`Failed to create directory ${fullPath}:`, error);
    
    // Try fallback to tmp directory within our base directory
    try {
      const tmpPath = join(baseDir, 'tmp', normalizedPath);
      mkdirSync(tmpPath, { recursive: true, mode: 0o755 });
      console.log(`Created fallback directory: ${tmpPath}`);
      return tmpPath;
    } catch (tmpError) {
      console.error(`Failed to create fallback directory:`, tmpError);
      
      // Final fallback to system temp directory
      const systemTmpPath = join(tmpdir(), 'deebo-prototype', normalizedPath);
      mkdirSync(systemTmpPath, { recursive: true, mode: 0o755 });
      console.log(`Created system temp directory: ${systemTmpPath}`);
      return systemTmpPath;
    }
  }
}
