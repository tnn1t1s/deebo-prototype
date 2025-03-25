import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

/**
 * Debug analysis prompt
 */
const DEBUG_ANALYSIS_PROMPT = `
You are an expert debugging assistant specialized in analyzing code errors and suggesting fixes.
You have access to:
1. Error information
2. Code context from the repository
3. Git metadata about the codebase
4. Dependencies and environment information

Your task is to:
1. Analyze the error and identify potential causes
2. Consider multiple hypotheses for what might be causing the issue
3. Suggest specific fixes with clear explanations
4. Rate your confidence in each fix suggestion
5. Provide rationale for your analysis

Be specific, practical, and actionable in your response.
`;

/**
 * Mother agent prompt
 */
const MOTHER_AGENT_PROMPT = `
You are the orchestrator of a debugging system that manages multiple scenario agents.
Your responsibilities are to:
1. Review the error and context provided
2. Determine which debugging scenarios to explore
3. Prioritize scenarios based on error type and context
4. Analyze results from scenario agents
5. Select the most promising fix
6. Generate a comprehensive debugging report

You have these scenario agents available:
- Dependency issues: Analyzes and fixes dependency-related errors
- Syntax errors: Identifies and resolves syntax and type errors
- Environment issues: Resolves configuration and environment-related problems
- API integration: Resolves issues with external API calls and integrations
- Performance: Addresses performance bottlenecks and optimization issues

Be systematic, thorough, and evidence-based in your orchestration.
`;

/**
 * Scenario agent prompt
 */
const SCENARIO_AGENT_PROMPT = `
You are a specialized debugging agent focusing on a specific type of problem.
Your responsibilities are to:
1. Test a specific hypothesis about the cause of the error
2. Run experiments to validate your hypothesis
3. Generate a proposed fix
4. Test the fix to verify it resolves the issue
5. Document your process and findings

You have access to:
1. Git tools to inspect code and history
2. Command execution to run tests and experiments
3. File system access to make changes

Provide practical and specific fixes with clear evidence of their effectiveness.
`;

/**
 * Analyze Debug error with Anthropic Claude 3.5 Sonnet
 */
export async function analyzeError(errorMessage: string, context: string, language: string = '') {
  try {
    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240229',
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
    
    return completion.content[0].text;
  } catch (error) {
    console.error('Error analyzing with Claude:', error);
    return 'Error occurred during analysis';
  }
}

/**
 * Run Mother Agent with Anthropic Claude
 */
export async function runMotherAgent(
  errorMessage: string, 
  context: string, 
  scenarioResults: any[] = [], 
  language: string = ''
) {
  try {
    const scenarioResultsText = scenarioResults.length > 0 
      ? `\n\nScenario Agent Results:\n${scenarioResults.map(r => 
          `- ${r.scenarioType}: ${r.hypothesis}\n  Success: ${r.success}\n  Confidence: ${r.confidence}\n  Results: ${r.testResults}\n  Fix: ${r.fixAttempted}`
        ).join('\n\n')}`
      : '\n\nNo scenario agent results available yet.';
    
    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240229',
      max_tokens: 2000,
      temperature: 0.2,
      system: MOTHER_AGENT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Error Message: ${errorMessage}
          
Language: ${language}

Code Context:
${context}
${scenarioResultsText}

Please analyze this error and:
1. If no scenario results exist, determine which 2-3 debugging scenarios should be explored first
2. If scenario results exist, analyze them and determine the best fix
3. Provide a final recommendation with confidence level and implementation steps`
        }
      ]
    });
    
    return completion.content[0].text;
  } catch (error) {
    console.error('Error running Mother Agent with Claude:', error);
    return 'Error occurred during Mother Agent analysis';
  }
}

/**
 * Run Scenario Agent with Anthropic Claude
 */
export async function runScenarioAgent(
  scenarioType: string,
  hypothesis: string,
  errorMessage: string,
  context: string,
  language: string = ''
) {
  try {
    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240229',
      max_tokens: 1500,
      temperature: 0.2,
      system: SCENARIO_AGENT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Scenario Type: ${scenarioType}
          
Hypothesis: ${hypothesis}

Error Message: ${errorMessage}
          
Language: ${language}

Code Context:
${context}

Please test this hypothesis and:
1. Design a specific experiment to test it
2. Determine if this hypothesis is correct
3. If correct, develop a detailed fix with specific code changes
4. Rate your confidence in this fix (0-1 scale)
5. Explain your reasoning and provide evidence`
        }
      ]
    });
    
    return completion.content[0].text;
  } catch (error) {
    console.error('Error running Scenario Agent with Claude:', error);
    return 'Error occurred during Scenario Agent analysis';
  }
}

export default {
  analyzeError,
  runMotherAgent,
  runScenarioAgent
};
