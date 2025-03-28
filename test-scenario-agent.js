import { join } from 'path';
import { config } from 'dotenv';
import { coordinate } from './build/index.js';

// Load environment variables
config();

// Verify required env vars
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

if (!process.env.DEEBO_ROOT) {
  console.log('Note: DEEBO_ROOT not set, using current directory');
}

console.log('Running test scenario...');

// Test error scenario
const error = 'TypeError: Cannot read property "length" of undefined';
const context = 'The error occurred while processing an array in the data transformation pipeline';
const language = 'typescript';
const filePath = join(process.cwd(), 'src/index.ts');
const repoPath = process.cwd();

// Run test
coordinate(error, context, language, filePath, repoPath).catch(err => {
  console.error('Scenario agent failed:', err);
  process.exit(1);
});
