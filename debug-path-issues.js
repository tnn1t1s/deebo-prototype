import * as fs from 'fs/promises';
import * as path from 'path';

// Monkey-patch fs.readdir and fs.readFile with more verbose error handling
const originalReaddir = fs.readdir;
fs.readdir = async function(path, options) {
  console.error('DEBUG: readdir called with path:', path);
  if (path === undefined) {
    console.error('ERROR: readdir called with undefined path!');
    console.error('Stack trace:', new Error().stack);
    throw new Error('readdir called with undefined path');
  }
  return originalReaddir(path, options);
};

const originalReadFile = fs.readFile;
fs.readFile = async function(path, options) {
  console.error('DEBUG: readFile called with path:', path);
  if (path === undefined) {
    console.error('ERROR: readFile called with undefined path!');
    console.error('Stack trace:', new Error().stack);
    throw new Error('readFile called with undefined path');
  }
  return originalReadFile(path, options);
};

// Monkey-patch path.join with verbose error handling
const originalJoin = path.join;
path.join = function(...paths) {
  console.error('DEBUG: path.join called with args:', paths);
  if (paths.some(p => p === undefined)) {
    console.error('ERROR: path.join called with undefined argument!');
    console.error('Arguments:', paths);
    console.error('Stack trace:', new Error().stack);
    throw new Error('path.join called with undefined argument');
  }
  return originalJoin(...paths);
};

// Simple test function
async function runTest() {
  // Test directory existence
  const reportDir = process.env.DEEBO_ROOT 
    ? path.join(process.env.DEEBO_ROOT, 'reports') 
    : 'reports';
  
  console.error('DEBUG: Report directory:', reportDir);
  console.error('DEBUG: DEEBO_ROOT:', process.env.DEEBO_ROOT);
  console.error('DEBUG: Current directory:', process.cwd());
  
  try {
    // List files in reports directory
    console.error('DEBUG: Listing files in reports directory');
    const files = await fs.readdir(reportDir);
    console.error('Files in reports directory:', files);
    
    // Create a test report file
    const testReport = {
      id: 'test-debug-report',
      success: true,
      message: 'This is a test debug report'
    };
    
    const testFile = path.join(reportDir, `debug-report-${Date.now()}.json`);
    console.error('DEBUG: Writing test report to:', testFile);
    await fs.writeFile(testFile, JSON.stringify(testReport, null, 2));
    
    console.error('DEBUG: Test report written successfully');
    
    // Read the test report back
    console.error('DEBUG: Reading test report');
    const fileContent = await fs.readFile(testFile, 'utf8');
    console.error('DEBUG: Test report content:', fileContent);
    
    console.error('DEBUG: All tests passed!');
  } catch (error) {
    console.error('ERROR during test:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the tests
console.error('Starting path debugging tests...');
process.env.DEEBO_ROOT = process.cwd(); // Explicitly set DEEBO_ROOT for testing
runTest().catch(err => console.error('Fatal error:', err));
