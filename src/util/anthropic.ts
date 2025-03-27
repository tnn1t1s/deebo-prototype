import Anthropic from '@anthropic-ai/sdk';
import type { LoggerLike } from '../types/logger.js';

// Track initialization state
let anthropicClient: Anthropic | null = null;
let logger: LoggerLike;

async function initializeAnthropicClient(): Promise<Anthropic> {
  if (anthropicClient) {
    return anthropicClient;
  }

  // Start with initLogger
  const { initLogger } = await import('./init-logger.js');
  logger = initLogger;

  try {
    // Get path resolver for proper logging
    const { getPathResolver } = await import('./path-resolver-helper.js');
    const pathResolver = await getPathResolver();
    
    // Validate root directory
    const rootDir = pathResolver.getRootDir();
    if (!rootDir || rootDir === '/') {
      throw new Error('Invalid root directory configuration');
    }

    // Validate API key exists and format
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not found in environment');
    }
    if (!apiKey.startsWith('sk-')) {
      throw new Error('Invalid ANTHROPIC_API_KEY format');
    }

    // Initialize client
    anthropicClient = new Anthropic({
      apiKey: apiKey.trim() // Remove any whitespace
    });

    // Test client with minimal API call
    try {
      await anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }]
      });
    } catch (error) {
      throw new Error(`Failed to validate Anthropic client: ${error}`);
    }

    // Now safe to use regular logger after validation
    const { createLogger } = await import('./logger.js');
    logger = createLogger('system', 'anthropic');
    logger.info('Anthropic client initialized and validated successfully', {
      clientReady: true,
      rootDir
    });

    return anthropicClient;
  } catch (error) {
    logger.error('Failed to initialize Anthropic client', { error });
    throw error;
  }
}

/**
 * Debug analysis prompt
 */
const DEBUG_ANALYSIS_PROMPT = `...`; // Keep existing prompts

/**
 * Mother agent prompt
 */
const MOTHER_AGENT_PROMPT = `...`; // Keep existing prompts

/**
 * Scenario agent prompt
 */
const SCENARIO_AGENT_PROMPT = `...`; // Keep existing prompts

/**
 * Analyze Debug error with Anthropic Claude 3.5 Sonnet
 */
async function analyzeErrorImpl(errorMessage: string, context: string, language: string = '') {
  const client = await initializeAnthropicClient();
  
  try {
    const completion = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      temperature: 0.2,
      system: DEBUG_ANALYSIS_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Error Message: ${errorMessage}
          
Language: ${language}

Code Context:
${context}

Please analyze this error and provide:
1. What is likely causing this error?
2. What are possible fixes?
3. Which fix do you recommend most highly?`
        }
      ]
    });
    
    // Access text content safely
    if (completion.content && completion.content.length > 0) {
      const content = completion.content[0];
      if ('text' in content) {
        return content.text;
      }
    }
    
    logger.error('Invalid response format from Anthropic');
    return 'Could not extract text from response';
  } catch (error) {
    logger.error('Error analyzing with Claude', { error });
    throw error;
  }
}

// Update other functions similarly...

// Add missing function definition
async function runScenarioAgentImpl(
  id: string,
  hypothesis: string,
  error: string,
  context: string,
  language: string = ''
): Promise<string> {
  const client = await initializeAnthropicClient();
  
  try {
    const completion = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.7,
      system: SCENARIO_AGENT_PROMPT,
      messages: [{
        role: 'user',
        content: `Investigating scenario (${id}):

Hypothesis: ${hypothesis}
Error: ${error}
Language: ${language}

Context:
${context}

Please analyze and take actions to validate this hypothesis.`
      }]
    });
    
    // Access text content safely
    if (completion.content && completion.content.length > 0) {
      const content = completion.content[0];
      if ('text' in content) {
        return content.text;
      }
    }
    
    logger.error('Invalid response format from Anthropic');
    return 'Could not extract text from response';
  } catch (error) {
    logger.error('Error running scenario agent with Claude', { error });
    throw error;
  }
}

// Single export point for all functionality
export const AnthropicClient = {
  analyzeError: analyzeErrorImpl,
  runScenarioAgent: runScenarioAgentImpl,
  getClient: initializeAnthropicClient
};

// Default export for backward compatibility
export default AnthropicClient;
