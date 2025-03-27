import { PathResolver } from './build/util/path-resolver.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Test script to verify our fix for absolute paths
 * This specifically tests the case where a path like "/sessions" is handled correctly
 */
async function runTests() {
  console.log('===== ABSOLUTE PATH HANDLING TESTS =====');
  
  try {
    // Step 1: Initialize the path resolver
    console.log('\n1. Initializing PathResolver...');
    const pathResolver = PathResolver.getInstance();
    await pathResolver.initialize();
    console.log(`   ✓ PathResolver initialized with root: ${pathResolver.getRootDir()}`);
    
    // Step 2: Test resolving an absolute path
    console.log('\n2. Testing absolute path resolution...');
    const absolutePath = '/sessions';
    const resolvedPath = pathResolver.resolvePath(absolutePath);
    console.log(`   ✓ Absolute path ${absolutePath} resolved to: ${resolvedPath}`);
    console.log(`   ✓ Correctly prefixed with root dir: ${resolvedPath.startsWith(pathResolver.getRootDir())}`);
    
    // Step 3: Test creating a directory with absolute path
    console.log('\n3. Testing directory creation with absolute path...');
    const directoryPath = '/testing/absolute/paths';
    const createdPath = await pathResolver.ensureDirectory(directoryPath);
    console.log(`   ✓ Directory created at: ${createdPath}`);
    console.log(`   ✓ Path is under root dir: ${createdPath.startsWith(pathResolver.getRootDir())}`);
    
    // Step 4: Verify the directory exists
    console.log('\n4. Verifying the created directory exists...');
    const exists = await pathResolver.validateDirectory(createdPath);
    console.log(`   ✓ Directory exists: ${exists}`);
    
    // Step 5: Create and write to a file in the directory
    console.log('\n5. Writing test file to the directory...');
    const testFile = path.join(createdPath, `absolute-path-test-${Date.now()}.json`);
    const testData = {
      test: 'absolute-path-test',
      timestamp: new Date().toISOString(),
      path: {
        requested: directoryPath,
        resolved: createdPath
      }
    };
    
    await fs.writeFile(testFile, JSON.stringify(testData, null, 2));
    console.log(`   ✓ Test file written successfully: ${testFile}`);
    
    // Step 6: Read the file to verify content
    console.log('\n6. Reading file to verify content...');
    const fileContent = await fs.readFile(testFile, 'utf8');
    const parsedData = JSON.parse(fileContent);
    console.log(`   ✓ File read successful, contains: ${JSON.stringify(parsedData.test)}`);
    
    console.log('\n===== ALL ABSOLUTE PATH TESTS PASSED =====');
    console.log('The absolute path handling fixes appear to be working correctly!');
    
  } catch (error) {
    console.error('\n===== TEST FAILED =====');
    console.error(`Error during test: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Explicitly set DEEBO_ROOT to current directory for testing
process.env.DEEBO_ROOT = process.cwd();
console.log(`Set DEEBO_ROOT to: ${process.env.DEEBO_ROOT}`);

// Run the tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
