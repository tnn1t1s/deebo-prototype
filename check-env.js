#!/usr/bin/env node

// This script checks for proper environment setup and API keys
// Run with: node check-env.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

console.log('⚙️ Environment Check\n');

// Check if .env file exists
const envPath = path.join(process.cwd(), '.env');
console.log(`Checking for .env file at: ${envPath}`);
if (fs.existsSync(envPath)) {
  console.log('✅ .env file found');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n').filter(line => line.trim().length > 0 && !line.startsWith('#'));
    console.log(`ℹ️ .env file contains ${envLines.length} non-comment lines`);
  } catch (err) {
    console.log(`❌ Error reading .env file: ${err.message}`);
  }
} else {
  console.log('❌ .env file not found! Please create one with your API keys.');
}

// Check if ANTHROPIC_API_KEY is set
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
console.log(`ANTHROPIC_API_KEY: ${hasAnthropicKey ? '✅ Present' : '❌ Missing'}`);
if (hasAnthropicKey) {
  console.log(`ℹ️ API Key format: ${process.env.ANTHROPIC_API_KEY.substring(0, 12)}...`);
}

// Validate and test Anthropic client
console.log('\nValidating Anthropic client');
try {
  // First validate API key format
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment');
  }
  if (!apiKey.startsWith('sk-')) {
    throw new Error('Invalid ANTHROPIC_API_KEY format - should start with sk-');
  }
  if (apiKey.length < 30) {
    throw new Error('ANTHROPIC_API_KEY appears too short');
  }
  console.log('✅ API key format validated');

  // Initialize client
  const anthropic = new Anthropic({
    apiKey: apiKey.trim() // Remove any whitespace
  });
  
  // Test the client with minimal API call
  try {
    await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }]
    });
    console.log('✅ Anthropic client validated with test API call');
  } catch (error) {
    console.error('❌ Anthropic client API test failed:', error.message);
    throw error;
  }
} catch (error) {
  console.error(`❌ Anthropic client validation failed: ${error.message}`);
  process.exit(1);
}

// Display all environment variables available (excluding actual values)
console.log('\nAll available environment variables:');
const envVars = Object.keys(process.env);
console.log(envVars.join(', '));

console.log('\nEnvironment check complete.');
