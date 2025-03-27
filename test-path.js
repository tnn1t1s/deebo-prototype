import * as path from 'path';
import * as fs from 'fs/promises';

const testPaths = async () => {
  console.log('Current working directory:', process.cwd());
  console.log('DEEBO_ROOT environment variable:', process.env.DEEBO_ROOT);
  
  // Test directory creation
  try {
    const reportDir = process.env.DEEBO_ROOT 
      ? path.join(process.env.DEEBO_ROOT, 'reports') 
      : 'reports';
    
    console.log('Report directory path:', reportDir);
    
    const exists = await fs.stat(reportDir).catch(e => false);
    console.log('Reports directory exists:', !!exists);
    
    if (!exists) {
      await fs.mkdir(reportDir, { recursive: true });
      console.log('Created reports directory');
    }
    
    // Test file writing
    const testFile = path.join(reportDir, `test-file-${Date.now()}.json`);
    console.log('Writing test file to:', testFile);
    await fs.writeFile(testFile, JSON.stringify({ test: 'data' }));
    console.log('Test file written successfully');
    
    // Test file reading
    console.log('Reading test file');
    const data = await fs.readFile(testFile, 'utf8');
    console.log('Test file content:', data);
    
    // Test listing directory
    console.log('Listing files in reports directory');
    const files = await fs.readdir(reportDir);
    console.log('Files in reports directory:', files);
  } catch (error) {
    console.error('Error during path test:', error);
  }
};

testPaths();
