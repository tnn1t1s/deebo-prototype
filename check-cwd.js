import { chdir } from 'process';
import { mkdir } from 'fs/promises';
import { join } from 'path';

// Test absolute path
const absolutePath = '/sessions';
console.log('\nTrying absolute path:', absolutePath);
try {
  await mkdir(absolutePath, { recursive: true });
  console.log('Success!');
} catch (err) {
  console.log('Error:', err.message);
}

// Test relative path
const relativePath = 'sessions';
console.log('\nTrying relative path:', relativePath);
try {
  await mkdir(relativePath, { recursive: true });
  console.log('Success!');
} catch (err) {
  console.log('Error:', err.message);
}
