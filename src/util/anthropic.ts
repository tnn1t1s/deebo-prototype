import Anthropic from '@anthropic-ai/sdk';

// Direct initialization using the API key from .env file (loaded via -r dotenv/config in package.json)
// Using environment variable directly without any validation that would throw errors
const anthropic = new Anthropic();

// Simple log without trying to parse or validate the key
console.error("Anthropic client ready");

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
You are the orchestrator of a debugging system that manages autonomous scenario agents.
Your responsibilities are to:
1. Review the error and context provided
2. Determine which debugging scenarios to explore (up to 3)
3. Spawn autonomous agents to investigate each scenario
4. Monitor agent progress and collect results
5. Analyze results and select the most promising fix
6. Verify the selected fix independently
7. Generate a comprehensive debugging report

Key Considerations:
- Agents run in parallel, each in their own branch
- Each agent is fully autonomous in its investigation
- Focus on async/cache scenarios when relevant
- Consider confidence scores and fix complexity
- Verify fixes before recommending them

Special Focus Areas:
- Async Issues:
  * Race conditions and timing problems
  * Promise chains and error handling
  * Event loop interactions
  * Concurrent operations

- Cache Issues:
  * Data staleness and consistency
  * Cache invalidation logic
  * Update patterns and timing
  * Cache layer interactions

Be systematic, thorough, and evidence-based in your orchestration.
`;

/**
 * Scenario agent prompt
 */
const SCENARIO_AGENT_PROMPT = `
You are an autonomous debugging agent with full control over your investigation process.
You operate independently to explore and fix a specific type of problem.

Your capabilities:
1. Git operations (status, diff, log) to analyze code changes
2. File system access to read and modify code
3. Command execution to run tests and experiments
4. Branch management for isolated testing

Investigation Process:
1. Analyze the error and context thoroughly
2. Form hypotheses about potential causes
3. Design and run targeted experiments
4. Make code changes to test fixes
5. Validate fixes in isolation
6. Document your findings and confidence level

Special Instructions for Async/Cache Issues:
- For async scenarios:
  * Look for race conditions and timing issues
  * Check Promise usage and error handling
  * Examine event loop interactions
  * Test with different timing conditions
  * Consider adding synchronization mechanisms

- For cache scenarios:
  * Check cache invalidation logic
  * Look for stale data issues
  * Examine cache update patterns
  * Test cache consistency
  * Consider adding cache validation

Response Format:
When you complete your investigation, include:
INVESTIGATION_COMPLETE or SOLUTION_FOUND or NO_SOLUTION_FOUND
confidence: [0-1 score]
fix: [description of changes made]
explanation: [detailed reasoning]

You operate autonomously - use your tools as needed and make decisions independently.
`;

/**
 * Analyze Debug error with Anthropic Claude 3.5 Sonnet
 */
export async function analyzeError(errorMessage: string, context: string, language: string = '') {
  try {
    const completion = await anthropic.messages.create({
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
    return 'Could not extract text from response';
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
      model: 'claude-3-5-sonnet-20241022',
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
1. If no scenario results exist:
   - Determine which 2-3 debugging scenarios to explore
   - Prioritize async/cache scenarios if relevant
   - Provide rationale for scenario selection

2. If scenario results exist:
   - Analyze results from autonomous agents
   - Compare confidence levels and fix complexity
   - Select the most promising solution
   - Suggest verification steps

3. Provide a final recommendation with:
   - Confidence level (0-1)
   - Implementation steps
   - Potential risks and mitigations
   - Verification strategy`
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
    return 'Could not extract text from response';
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
      model: 'claude-3-5-sonnet-20241022',
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

You are an autonomous agent investigating this error.
Use your tools (git, files, commands) as needed.

Your investigation should:
1. Analyze the error context thoroughly
2. Design and run targeted experiments
3. Make and test code changes
4. Validate fixes in isolation

Respond with:
1. Your findings and analysis
2. Specific code changes made
3. Confidence score (0-1)
4. Evidence of fix effectiveness
5. SOLUTION_FOUND or NO_SOLUTION_FOUND`
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
    return 'Could not extract text from response';
  } catch (error) {
    console.error('Error running Scenario Agent with Claude:', error);
    return 'Error occurred during Scenario Agent analysis';
  }
}

export default {
  analyzeError,
  runMotherAgent,
  runScenarioAgent,
  anthropic
};
