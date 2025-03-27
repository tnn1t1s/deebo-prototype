import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Centralized path validation and resolution utility
 * Ensures all path operations are safe and validated
 */
export class PathResolver {
  private static instance: PathResolver;
  private rootDir: string;
  private _isInitialized = false;

  private constructor() {
    // Initialize with a sensible default - ensure it's an absolute valid path
    const currentDir = process.cwd();
    
    // Safety check - never allow root directory to be system root
    if (currentDir === '/' || !currentDir || currentDir.trim() === '') {
      console.error('[PathResolver] WARNING: Invalid working directory detected, using fallback');
      // Use a safe fallback directory (user's home directory)
      const os = require('os');
      this.rootDir = require('path').join(os.homedir(), '.deebo-prototype');
    } else {
      this.rootDir = currentDir;
    }
    
    console.error(`[PathResolver] Created with default root directory: ${this.rootDir}`);
    
    // Set environment variable immediately and make sure it's properly quoted
    process.env.DEEBO_ROOT = this.rootDir;
    
    // Set initialized flag to true to prevent additional initialization attempts
    this._isInitialized = true;
  }

  /**
   * Get the singleton instance of the path resolver
   */
  public static getInstance(): PathResolver {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
    }
    return PathResolver.instance;
  }

  /**
   * Initialize the path resolver with the root directory
   * This should be called early in the application lifecycle
   */
  public async initialize(rootOverride?: string): Promise<void> {
    if (this._isInitialized) {
      console.error('[PathResolver] Already initialized, skipping re-initialization');
      return;
    }

    // Set root dir with strict validation
    if (rootOverride && rootOverride !== '/' && rootOverride.trim() !== '') {
      this.rootDir = rootOverride;
      console.error(`[PathResolver] Using provided root override: ${this.rootDir}`);
    } else if (process.env.DEEBO_ROOT && process.env.DEEBO_ROOT !== '/' && process.env.DEEBO_ROOT.trim() !== '') {
      this.rootDir = process.env.DEEBO_ROOT;
      console.error(`[PathResolver] Using DEEBO_ROOT from environment: ${this.rootDir}`);
    } else {
      // Double-check current directory is valid
      const currentDir = process.cwd();
      if (currentDir === '/' || !currentDir || currentDir.trim() === '') {
        console.error('[PathResolver] WARNING: Invalid working directory detected, using fallback');
        // Use a safe fallback directory
        const os = require('os');
        this.rootDir = require('path').join(os.homedir(), '.deebo-prototype');
      } else {
        this.rootDir = currentDir;
      }
      console.error(`[PathResolver] Using current directory: ${this.rootDir}`);
    }

    // Safety check - guard against root directory being system root
    if (this.rootDir === '/' || !this.rootDir || this.rootDir.trim() === '') {
      const os = require('os');
      const newRootDir = require('path').join(os.homedir(), '.deebo-prototype');
      console.error(`[PathResolver] CRITICAL SAFETY OVERRIDE: Root directory "${this.rootDir}" was invalid, using safe fallback: ${newRootDir}`);
      this.rootDir = newRootDir;
    }
    
    // Ensure we never have a trailing slash on the root dir to avoid path joining issues
    if (this.rootDir.endsWith('/') && this.rootDir !== '/') {
      this.rootDir = this.rootDir.slice(0, -1);
    }

    // Set the environment variable for child processes
    process.env.DEEBO_ROOT = this.rootDir;

    console.error(`[PathResolver] Initialized with root directory: ${this.rootDir}`);
    this._isInitialized = true;
    
    // Ensure the root directory exists
    try {
      await fs.mkdir(this.rootDir, { recursive: true });
      console.error(`[PathResolver] Ensured root directory exists: ${this.rootDir}`);
    } catch (error) {
      console.error(`[PathResolver] WARNING: Could not create root directory: ${error}`);
    }
  }

  /**
   * Validate that a path exists and is a directory
   */
  public async validateDirectory(dirPath: string): Promise<boolean> {
    if (!dirPath) {
      console.error('[PathResolver] validateDirectory called with empty path');
      return false;
    }

    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a path contains the root directory
   * Helps detect when we're dealing with a path that includes the project root already
   */
  private pathContainsRoot(inputPath: string): boolean {
    return inputPath.includes(this.rootDir);
  }

  /**
   * Normalize path to ensure it's safe to use
   * This is a critical method that handles absolute vs relative paths properly
   */
  private normalizePath(inputPath: string): string {
    if (!inputPath) {
      throw new Error('normalizePath called with empty path');
    }

    // Special handling for paths that already contain the root directory
    if (this.pathContainsRoot(inputPath)) {
      // If the path already has our root dir in it, extract the part after the root
      const relativePart = inputPath.substring(inputPath.indexOf(this.rootDir) + this.rootDir.length);
      // Strip any leading slashes from the relative part
      const cleanedPath = relativePart.replace(/^\/+/, '');
      console.error(`[PathResolver] Path contains root, extracted relative part: '${inputPath}' → '${cleanedPath}'`);
      return cleanedPath;
    }

    // Normal handling for absolute paths
    if (path.isAbsolute(inputPath)) {
      // Strip all leading slashes to make it a proper relative path
      const strippedPath = inputPath.replace(/^\/+/, '');
      console.error(`[PathResolver] Normalized absolute path '${inputPath}' to relative path '${strippedPath}'`);
      return strippedPath;
    }

    // Remove any "./" prefix for consistency
    if (inputPath.startsWith('./')) {
      return inputPath.substring(2);
    }

    // It's already a clean relative path
    return inputPath;
  }

  /**
   * Validate that a path is within the project root directory
   * This is a safety check to prevent operations outside our project
   */
  private validateSafePath(absolutePath: string): boolean {
    // Normalize both paths for consistent comparison
    const normalizedAbsPath = path.normalize(absolutePath);
    const normalizedRootDir = path.normalize(this.rootDir);
    
    // The path is safe if it starts with our project root
    const isSafe = normalizedAbsPath.startsWith(normalizedRootDir);
    
    if (!isSafe) {
      console.error(`[PathResolver] SECURITY WARNING: Attempted to access path outside project boundary: ${absolutePath}`);
    }
    
    return isSafe;
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * Uses exponential backoff retry strategy for race condition handling
   */
  public async ensureDirectory(inputPath: string, maxRetries = 3): Promise<string> {
    if (!inputPath) {
      throw new Error('ensureDirectory called with empty path');
    }

    // Ensure we're initialized
    if (!this._isInitialized) {
      await this.initialize();
      console.error(`[PathResolver] Initialized with root directory: ${this.rootDir}`);
    }

    // Emergency validation check - we should never have root directory as /
    if (this.rootDir === '/') {
      const os = require('os');
      const newRootDir = require('path').join(os.homedir(), '.deebo-prototype');
      console.error(`[PathResolver] EMERGENCY ROOT DIRECTORY FIX: Root directory was '/' at runtime! Using ${newRootDir} instead.`);
      this.rootDir = newRootDir;
      
      // Ensure this directory exists
      try {
        await fs.mkdir(this.rootDir, { recursive: true });
      } catch (error) {
        console.error(`[PathResolver] Error creating emergency fallback directory: ${error}`);
      }
    }

    // First normalize the path (strip any leading slashes)
    const normalizedPath = this.normalizePath(inputPath);
    
    // Then resolve to get the full absolute path relative to root
    const absolutePath = path.join(this.rootDir, normalizedPath);
    
    // Safety check - prevent operations outside project directory
    if (!this.validateSafePath(absolutePath)) {
      throw new Error(`Security violation: Attempted to access path outside project boundary: ${absolutePath}`);
    }
    
    // Log the path we're trying to create with clear before/after visualization
    console.error(`[PathResolver] Ensuring directory exists: ${absolutePath} (input path: ${inputPath} → normalized: ${normalizedPath})`);

    // Triple check that the absolutePath isn't the system root or a direct child of root
    if (absolutePath === '/' || absolutePath.match(/^\/[^/]+$/)) {
      throw new Error(`CRITICAL SAFETY ERROR: Attempted to create system root-level directory: ${absolutePath}`);
    }

    // Try to create directory with retries
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        // Use recursive option to create all parent directories
        await fs.mkdir(absolutePath, { recursive: true });
        
        // Verify directory exists after creation
        const exists = await this.validateDirectory(absolutePath);
        if (exists) {
          console.error(`[PathResolver] Successfully created directory: ${absolutePath}`);
          return absolutePath;
        }
        
        // If verification fails, retry
        console.error(`[PathResolver] Directory verification failed after creation: ${absolutePath}`);
      } catch (error) {
        // Check if directory already exists (which is fine)
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          // Directory exists, which is what we want
          console.error(`[PathResolver] Directory already exists: ${absolutePath}`);
          return absolutePath;
        }
        
        console.error(`[PathResolver] Error creating directory (attempt ${attempt + 1}/${maxRetries}):`, error);
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 100;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }

    // One final check in case the directory exists now
    const exists = await this.validateDirectory(absolutePath);
    if (exists) {
      return absolutePath;
    }
    
    throw new Error(`Failed to create directory after ${maxRetries} attempts: ${absolutePath}`);
  }

  /**
   * Get the reports directory path, ensuring it exists
   */
  public async getReportsDirectory(): Promise<string> {
    // Ensure we're initialized
    if (!this._isInitialized) {
      await this.initialize();
    }
    
    return this.ensureDirectory('reports');
  }

  /**
   * Resolve a path to an absolute path based on the root directory
   * This method handles normalization of absolute paths to be relative to root
   */
  public resolvePath(inputPath: string): string {
    if (!inputPath) {
      throw new Error('resolvePath called with empty path');
    }
    
    // Ensure we're initialized
    if (!this._isInitialized) {
      this.rootDir = process.env.DEEBO_ROOT || process.cwd();
      process.env.DEEBO_ROOT = this.rootDir;
      this._isInitialized = true;
    }

    // First normalize the path (strip any leading slashes if absolute)
    const normalizedPath = this.normalizePath(inputPath);
    
    // Then join with the root directory to get the absolute path
    const fullPath = path.join(this.rootDir, normalizedPath);
    
    // Safety check - prevent operations outside project directory
    if (!this.validateSafePath(fullPath)) {
      throw new Error(`Security violation: Attempted to access path outside project boundary: ${fullPath}`);
    }
    
    if (inputPath !== normalizedPath) {
      console.error(`[PathResolver] Resolved path '${inputPath}' to '${fullPath}'`);
    }
    
    return fullPath;
  }

  /**
   * Safely join path segments with validation
   */
  public joinPath(...segments: string[]): string {
    // Validate segments
    for (const segment of segments) {
      if (segment === undefined || segment === null) {
        throw new Error(`Invalid path segment: ${segment}`);
      }
    }

    return path.join(...segments);
  }

  /**
   * Get the absolute path for a report file
   */
  public async getReportPath(reportId: string, timestamp: number): Promise<string> {
    if (!reportId) {
      throw new Error('getReportPath called with empty reportId');
    }
    
    const reportsDir = await this.getReportsDirectory();
    const reportFile = `${reportId}-report-${timestamp}.json`;
    return this.joinPath(reportsDir, reportFile);
  }

  /**
   * Get the root directory
   */
  public getRootDir(): string {
    return this.rootDir;
  }

  /**
   * Check if the path resolver is initialized
   */
  public isInitialized(): boolean {
    return this._isInitialized;
  }
}
