// Simple script to debug environment variables and path handling
import * as path from 'path';
import * as fs from 'fs/promises';

async function debugPaths() {
  console.log('======== DEBUGGING PATH ENVIRONMENT ========');
  console.log('Current working directory:', process.cwd());
  console.log('DEEBO_ROOT environment variable:', process.env.DEEBO_ROOT);
  console.log('NODE_PATH environment variable:', process.env.NODE_PATH);
  
  // Test reports directory
  const reportsDir = path.join(process.cwd(), 'reports');
  console.log('Reports directory path:', reportsDir);
  
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
