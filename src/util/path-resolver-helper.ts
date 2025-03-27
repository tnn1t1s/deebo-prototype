import { PathResolver } from './path-resolver.js';

let resolverInstance: PathResolver | null = null;

/**
 * Get the singleton instance of PathResolver, ensuring it's initialized
 */
export async function getPathResolver(): Promise<PathResolver> {
  if (!resolverInstance) {
    // First check process.env.DEEBO_ROOT
    const rootDir = process.env.DEEBO_ROOT || process.cwd();
    
    resolverInstance = await PathResolver.getInstance();
    if (!resolverInstance.isInitialized()) {
      await resolverInstance.initialize(rootDir);
    }
    
    // Validate the root directory
    const currentRoot = await resolverInstance.getRootDir();
    if (currentRoot === '/' || !currentRoot) {
      throw new Error('Invalid root directory configuration');
    }
  }
  return resolverInstance;
}

/**
 * Ensure we have an initialized PathResolver instance
 * This is useful when you need to chain multiple operations
 */
export async function withPathResolver<T>(
  callback: (resolver: PathResolver) => Promise<T>
): Promise<T> {
  const resolver = await getPathResolver();
  return callback(resolver);
}
