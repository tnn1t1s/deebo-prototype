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

// Try to initialize Anthropic client
console.log('\nTesting Anthropic client initialization');
try {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ''
  });
  console.log('✅ Anthropic client initialized successfully');
} catch (error) {
  console.error(`❌ Anthropic client initialization failed: ${error.message}`);
}

// Display all environment variables available (excluding actual values)
console.log('\nAll available environment variables:');
const envVars = Object.keys(process.env);
console.log(envVars.join(', '));

console.log('\nEnvironment check complete.');
