// Simple script to debug environment variables and path handling
import * as path from 'path';
import * as fs from 'fs/promises';

import * as os from 'os';

async function validatePath(testPath) {
  // Never allow root directory
  if (testPath === '/' || testPath.match(/^\/[^/]+$/)) {
    throw new Error(`CRITICAL SAFETY ERROR: Attempted to access system root level: ${testPath}`);
  }
  
  // If absolute path, ensure it's under a valid root
  if (path.isAbsolute(testPath)) {
    const validRoots = [
      process.cwd(),
      path.join(os.homedir(), '.deebo-prototype'),
      path.join(os.tmpdir(), 'deebo-prototype')
    ];
    const isUnderValidRoot = validRoots.some(root => testPath.startsWith(root));
    if (!isUnderValidRoot) {
      throw new Error(`Path not under valid root directory: ${testPath}`);
    }
  }
  return true;
}

async function debugPaths() {
  console.log('======== DEBUGGING PATH ENVIRONMENT ========');
  
  // Validate working directory isn't root
  const cwd = process.cwd();
  if (cwd === '/') {
    throw new Error('CRITICAL: Working directory is system root');
  }
  console.log('Current working directory:', cwd);
  
  // Validate DEEBO_ROOT
  const deeboRoot = process.env.DEEBO_ROOT;
  if (!deeboRoot) {
    throw new Error('DEEBO_ROOT not set');
  }
  await validatePath(deeboRoot);
  console.log('DEEBO_ROOT validated:', deeboRoot);
  
  console.log('NODE_PATH environment variable:', process.env.NODE_PATH);
  
  // Test reports directory with validation
  const reportsDir = path.join(deeboRoot, 'reports');
  await validatePath(reportsDir);
  console.log('Reports directory path validated:', reportsDir);
  
  try {
    const reportsStat = await fs.stat(reportsDir);
    console.log('Reports directory exists:', reportsStat.isDirectory());
    
    // List files in reports
    const files = await fs.readdir(reportsDir);
    console.log('Files in reports directory:', files);
    
    // Create a test file
    const testFile = path.join(reportsDir, `test-${Date.now()}.json`);
    await fs.writeFile(testFile, JSON.stringify({ test: 'data' }));
    console.log('Test file created at:', testFile);
    
    // Read it back
    const content = await fs.readFile(testFile, 'utf8');
    console.log('Test file content:', content);
    
    console.log('All path tests completed successfully!');
  } catch (error) {
    console.error('Error during path testing:', error);
  }
}

// Create environment for testing
process.env.DEEBO_ROOT = process.cwd();
console.log('Set DEEBO_ROOT to:', process.env.DEEBO_ROOT);

// Run the tests
debugPaths().catch(err => {
  console.error('Fatal error in debugging script:', err);
});
