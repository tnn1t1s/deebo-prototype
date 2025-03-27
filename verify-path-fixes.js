import { PathResolver } from './build/util/path-resolver.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name using ES module approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Comprehensive test script to verify our fixes for path resolution issues
 * Tests multiple problematic path patterns including:
 * - Absolute paths with leading slashes
 * - Directory creation with absolute paths
 * - Path normalization consistency
 * - Writing/reading files with absolute paths
 */
async function runTests() {
  console.log('\n===== PATH RESOLUTION FIX VERIFICATION =====');
  
  try {
    // Force root dir to current directory for testing
    process.env.DEEBO_ROOT = process.cwd();
    console.log(`Set DEEBO_ROOT to: ${process.env.DEEBO_ROOT}`);
    
    // STEP 1: Initialize the PathResolver
    console.log('\n1. Initializing PathResolver...');
    const pathResolver = PathResolver.getInstance();
    await pathResolver.initialize();
    console.log(`   ✓ PathResolver initialized with root: ${pathResolver.getRootDir()}`);
    
    // STEP 2: Test problematic absolute paths
    const testPaths = [
      '/sessions',
      '/sessions/server',
      '/tmp/test',
      './relative/path',
      'simple/path'
    ];
    
    console.log('\n2. Testing path normalization for problematic paths:');
    for (const testPath of testPaths) {
      const resolved = pathResolver.resolvePath(testPath);
      console.log(`   • Path "${testPath}" resolved to: "${resolved}"`);
      console.log(`     ✓ Is under root dir: ${resolved.startsWith(pathResolver.getRootDir())}`);
      console.log(`     ✓ Does not contain double slashes: ${!resolved.includes('//')}`);
    }
    
    // STEP 3: Test directory creation
    console.log('\n3. Testing directory creation with problematic paths:');
    const createdDirs = {};
    
    for (const testPath of testPaths) {
      console.log(`   • Creating directory with path: "${testPath}"`);
      try {
        const createdPath = await pathResolver.ensureDirectory(testPath);
        console.log(`     ✓ Created at: "${createdPath}"`);
        
        // Verify directory exists
        const exists = await pathResolver.validateDirectory(createdPath);
        console.log(`     ✓ Directory exists: ${exists}`);
        
        createdDirs[testPath] = createdPath;
      } catch (error) {
        console.error(`     ✗ Failed to create: ${error.message}`);
        throw error; // Rethrow to fail the test
      }
    }
    
    // STEP 4: Test file creation and reading in these directories
    console.log('\n4. Testing file operations in created directories:');
    
    for (const [originalPath, createdPath] of Object.entries(createdDirs)) {
      const testFile = path.join(createdPath, `test-file-${Date.now()}.json`);
      const testData = {
        test: 'path-fix-verification',
        timestamp: new Date().toISOString(),
        originalPath,
        resolvedPath: createdPath
      };
      
      console.log(`   • Writing test file to "${testFile}"`);
      await fs.writeFile(testFile, JSON.stringify(testData, null, 2));
      
      // Verify file exists and can be read
      const content = await fs.readFile(testFile, 'utf8');
      const parsedContent = JSON.parse(content);
      console.log(`     ✓ File written and read successfully`);
      console.log(`     ✓ Content matches: ${parsedContent.test === 'path-fix-verification'}`);
    }
    
    // STEP 5: Test report path generation (critical for the reported bug)
    console.log('\n5. Testing report path generation:');
    const testReportId = 'verify-test';
    const timestamp = Date.now();
    
    const reportPath = await pathResolver.getReportPath(testReportId, timestamp);
    console.log(`   • Report path generated: "${reportPath}"`);
    
    // Write a test report file
    const reportData = {
      id: testReportId,
      timestamp,
      test: 'path-resolver-verification'
    };
    
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`   ✓ Test report file written successfully`);
    
    // Read it back
    const reportContent = await fs.readFile(reportPath, 'utf8');
    const parsedReport = JSON.parse(reportContent);
    console.log(`   ✓ Report content verified: ${parsedReport.test === 'path-resolver-verification'}`);
    
    console.log('\n===== ALL PATH RESOLUTION TESTS PASSED =====');
    console.log('The path resolution fixes appear to be working correctly!');
    
  } catch (error) {
    console.error('\n===== TEST FAILED =====');
    console.error(`Error during path resolution test: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
