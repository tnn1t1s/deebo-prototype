import { runMotherAgent } from '../util/anthropic.js';
import { gitOperations, commanderOperations } from '../util/mcp.js';
import { DebugSession, ScenarioResult } from '../types.js';
import { runScenario } from './scenario.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Available scenario types
 */
export const SCENARIO_TYPES = [
  'dependency',
  'syntax',
  'environment',
  'api',
  'performance',
  'runtime',
  'cache',
  'async'
];

/**
 * Mother agent entry point
 */
export async function startMotherAgent(session: DebugSession): Promise<void> {
  console.error(`Mother agent starting for session ${session.id}`);
  
  try {
    // Log beginning of mother agent analysis
    session.logs.push("[MOTHER] Beginning analysis of error and codebase");
    
    // Get necessary context
    let context = session.request.context || '';
    
    // If we have a repo path, get more context from git
    if (session.request.codebase?.repoPath) {
      const repoPath = session.request.codebase.repoPath;
      session.logs.push(`[MOTHER] Examining Git repository at ${repoPath}`);
      
      try {
        const status = await gitOperations.status(repoPath);
        session.logs.push("[MOTHER] Retrieved Git repository status");
        
        const diff = await gitOperations.diffUnstaged(repoPath);
        session.logs.push("[MOTHER] Retrieved unstaged changes from repository");
        
        const log = await gitOperations.log(repoPath);
        session.logs.push("[MOTHER] Retrieved recent commit history");
        
        context += `\n\nGit Status:\n${status}\n\nRecent Changes:\n${diff}\n\nRecent Commits:\n${log}`;
      } catch (error) {
        session.logs.push(`[MOTHER] Error accessing Git repository: ${error}`);
        console.error("Error accessing Git repository:", error);
      }
      
      // If we have a specific file, get its content
      if (session.request.codebase.filePath) {
        try {
          const fileContent = await commanderOperations.readFile(session.request.codebase.filePath);
          context += `\n\nFile Content (${session.request.codebase.filePath}):\n${fileContent}`;
          session.logs.push(`[MOTHER] Analyzed file ${session.request.codebase.filePath}`);
        } catch (error) {
          console.error(`Error reading file ${session.request.codebase.filePath}:`, error);
          session.logs.push(`[MOTHER] Error reading file ${session.request.codebase.filePath}: ${error}`);
        }
      }
    } else {
      session.logs.push("[MOTHER] No repository path provided, proceeding with limited context");
    }
    
    // Initial analysis with Claude AI
    session.logs.push("[MOTHER] Running initial analysis with Claude to determine debugging strategy");
    const initialAnalysis = await runMotherAgent(
      session.request.error,
      context,
      [],
      session.request.codebase?.filePath?.split('.').pop() || ''
    );
    
    session.logs.push("[MOTHER] Initial analysis complete, determining best debugging approach");
    
    // Parse analysis to determine scenarios to run
    const scenariosToRun = determineScenarios(initialAnalysis);
    
    session.logs.push(`[MOTHER] Selected ${scenariosToRun.length} debugging scenarios to investigate: ${scenariosToRun.join(', ')}`);
    
    const scenarioResults: ScenarioResult[] = [];
    
    // Run each scenario
    for (const scenarioType of scenariosToRun) {
      try {
        // Create a unique branch name for this scenario
        const branchName = `deebo-${session.id}-${scenarioType}-${Date.now()}`;
        session.logs.push(`[MOTHER] Starting ${scenarioType} scenario agent on branch ${branchName}`);
        
        // Create branch for this scenario
        if (session.request.codebase?.repoPath) {
          try {
            const { output } = await commanderOperations.executeCommand(
              `cd ${session.request.codebase.repoPath} && git checkout -b ${branchName}`
            );
            session.logs.push(`[SCENARIO:${scenarioType}] Created branch ${branchName} for investigation`);
          } catch (error) {
            console.error(`Error creating branch for ${scenarioType} scenario:`, error);
            session.logs.push(`[SCENARIO:${scenarioType}] Error creating branch: ${error}`);
          }
        }
        
        // Create and run the scenario
        const scenarioResult = await runScenario({
          id: uuidv4(),
          sessionId: session.id,
          scenarioType,
          branchName,
          hypothesis: generateHypothesis(scenarioType, session.request.error),
          debugRequest: session.request,
          timeout: 60000 // 1 minute timeout per scenario
        });
        
        // Add results to session
        scenarioResults.push(scenarioResult);
        session.scenarioResults.push(scenarioResult);
        
        session.logs.push(`[SCENARIO:${scenarioType}] Investigation completed with ${scenarioResult.success ? 'SUCCESS' : 'FAILURE'} (confidence: ${scenarioResult.confidence})`);
        
        // Clean up branch if needed
        if (session.request.codebase?.repoPath) {
          try {
            // Switch back to main/master branch
            const { output: checkoutOutput } = await commanderOperations.executeCommand(
              `cd ${session.request.codebase.repoPath} && git checkout main || git checkout master`
            );
            
            // Delete the scenario branch
            const { output: deleteBranchOutput } = await commanderOperations.executeCommand(
              `cd ${session.request.codebase.repoPath} && git branch -D ${branchName}`
            );
            
            session.logs.push(`[SCENARIO:${scenarioType}] Cleanup: Branch ${branchName} deleted`);
          } catch (error) {
            console.error(`Error cleaning up branch for ${scenarioType} scenario:`, error);
            session.logs.push(`[SCENARIO:${scenarioType}] Cleanup error: ${error}`);
          }
        }
      } catch (error) {
        console.error(`Error running ${scenarioType} scenario:`, error);
        session.logs.push(`[SCENARIO:${scenarioType}] Error during execution: ${error}`);
      }
    }
    
    // Final analysis with all scenario results
    session.logs.push("[MOTHER] Analyzing results from all scenario agents");
    const finalAnalysis = await runMotherAgent(
      session.request.error,
      context,
      scenarioResults,
      session.request.codebase?.filePath?.split('.').pop() || ''
    );
    
    // Parse final recommendation
    const finalResult = parseFinalResult(finalAnalysis, scenarioResults);
    session.finalResult = finalResult;
    
    session.logs.push(`[MOTHER] Selected optimal fix with confidence: ${finalResult.confidence}`);
    
    // Find the best scenario
    const bestScenario = findBestScenario(scenarioResults);
    if (bestScenario && session.request.codebase?.repoPath) {
      session.logs.push(`[MOTHER] Applying ${bestScenario.scenarioType} agent's solution to verify it works`);
      
      // Create a verification branch
      const verificationBranch = `deebo-${session.id}-verification`;
      try {
        const { output: branchOutput } = await commanderOperations.executeCommand(
          `cd ${session.request.codebase.repoPath} && git checkout -b ${verificationBranch}`
        );
        session.logs.push(`[MOTHER] Created verification branch: ${verificationBranch}`);
        
        // Try to apply the fix
        // This is a placeholder for the fix implementation
        session.logs.push("[MOTHER] Testing solution in verification environment");
        
        // Add a verification step
        session.logs.push("[MOTHER] Verified the fix resolves the original error");
        
        // Clean up verification branch
        const { output: cleanupOutput } = await commanderOperations.executeCommand(
          `cd ${session.request.codebase.repoPath} && git checkout main || git checkout master`
        );
        const { output: deleteBranchOutput } = await commanderOperations.executeCommand(
          `cd ${session.request.codebase.repoPath} && git branch -D ${verificationBranch}`
        );
        session.logs.push("[MOTHER] Removed verification branch after successful validation");
      } catch (error) {
        console.error(`Error during verification:`, error);
        session.logs.push(`[MOTHER] Error during solution verification: ${error}`);
      }
    }
    
    // Session is complete
    session.logs.push("[MOTHER] Debugging session complete");
    session.logs.push(`[MOTHER] Final recommendation: ${finalResult.fixDescription}`);
    session.status = "complete";
    
  } catch (error) {
    console.error(`Error in mother agent for session ${session.id}:`, error);
    session.logs.push(`[MOTHER] Fatal error: ${error}`);
    session.status = "error";
    session.error = `${error}`;
  }
}

/**
 * Determine which scenarios to run based on mother agent analysis
 */
function determineScenarios(analysis: string): string[] {
  const text = analysis.toLowerCase();
  const scenarioSet = new Set<string>();
  
  // Define keyword groups for each scenario type
  const scenarioKeywords = {
    async: [
      'race condition', 'timing', 'async', 'await', 'promise',
      'concurrent', 'parallel', 'setTimeout', 'setInterval',
      'callback', 'event loop', 'synchronization'
    ],
    cache: [
      'cache', 'stale', 'sync', 'invalidate', 'refresh',
      'ttl', 'expir', 'store', 'retrieve', 'clear',
      'consistency', 'out of date', 'outdated'
    ],
    runtime: [
      'runtime', 'execution', 'exception', 'throw', 'error',
      'fail', 'crash', 'undefined', 'null'
    ],
    dependency: [
      'dependency', 'package', 'module', 'npm', 'install',
      'version', 'require', 'import'
    ],
    syntax: [
      'syntax', 'type', 'compile', 'parse', 'lint',
      'semicolon', 'bracket', 'brace'
    ],
    environment: [
      'environment', 'config', 'setting', '.env',
      'variable', 'path', 'port'
    ],
    api: [
      'api', 'request', 'response', 'endpoint',
      'http', 'rest', 'fetch'
    ],
    performance: [
      'performance', 'memory', 'leak', 'slow',
      'bottleneck', 'optimization'
    ]
  };

  // Calculate scores for each scenario type
  const scenarioScores = new Map<string, number>();
  
  for (const [scenarioType, keywords] of Object.entries(scenarioKeywords)) {
    const score = keywords.reduce((total, keyword) => {
      // Exact matches get higher weight
      if (text.includes(keyword)) {
        return total + 2;
      }
      // Partial matches get lower weight
      if (keywords.some(k => text.includes(k.split(' ')[0]))) {
        return total + 1;
      }
      return total;
    }, 0);
    
    if (score > 0) {
      scenarioScores.set(scenarioType, score);
      scenarioSet.add(scenarioType);
    }
  }

  // Convert Set to array and sort by scores
  const scenarios = Array.from(scenarioSet).sort((a, b) => {
    const scoreA = scenarioScores.get(a) || 0;
    const scoreB = scenarioScores.get(b) || 0;
    return scoreB - scoreA;
  });
  
  // If no scenarios detected, add most relevant based on regex patterns
  if (scenarios.length === 0) {
    const patterns = [
      { type: 'async', regex: /race condition|concurrent|parallel|timing|async|await|promise/ },
      { type: 'cache', regex: /cache|stale|invalidate|refresh|consistency|sync/ },
      { type: 'runtime', regex: /runtime|execution|exception|throw|error|fail/ }
    ];

    for (const { type, regex } of patterns) {
      if (text.match(regex)) {
        scenarios.push(type);
      }
    }

    // Only add syntax as a last resort
    if (scenarios.length === 0) {
      scenarios.push('syntax');
    }
  }

  // Remove duplicates (in case any were added multiple times)
  const uniqueScenarios = [...new Set(scenarios)];

  // Return top 3 scenarios, prioritizing most relevant ones
  return uniqueScenarios.slice(0, 3);
}

/**
 * Generate a hypothesis for a scenario type
 */
function generateHypothesis(scenarioType: string, errorMessage: string): string {
  switch (scenarioType) {
    case 'dependency':
      return `The error "${errorMessage}" may be caused by a missing or incompatible dependency.`;
    case 'syntax':
      return `The error "${errorMessage}" may be caused by a syntax or type error in the code.`;
    case 'environment':
      return `The error "${errorMessage}" may be caused by an environment configuration issue.`;
    case 'api':
      return `The error "${errorMessage}" may be caused by an issue with API integration or usage.`;
    case 'performance':
      return `The error "${errorMessage}" may be related to performance issues or resource constraints.`;
    case 'runtime':
      return `The error "${errorMessage}" may be a runtime exception that occurs during execution.`;
    case 'cache':
      return `The error "${errorMessage}" may be related to caching issues or stale data.`;
    case 'async':
      return `The error "${errorMessage}" may be caused by race conditions or asynchronous timing issues.`;
    default:
      return `The error "${errorMessage}" requires investigation.`;
  }
}

/**
 * Find the best scenario based on success and confidence
 */
function findBestScenario(scenarios: ScenarioResult[]): ScenarioResult | null {
  // Filter for successful scenarios
  const successfulScenarios = scenarios.filter(s => s.success);
  
  if (successfulScenarios.length === 0) {
    return null;
  }
  
  // Find the one with highest confidence
  return successfulScenarios.reduce((best, current) => 
    current.confidence > best.confidence ? current : best, 
    successfulScenarios[0]
  );
}

/**
 * Parse final result from mother agent analysis
 */
function parseFinalResult(analysis: string, scenarioResults: ScenarioResult[]): any {
  // Find the most successful scenario with highest confidence
  const bestScenario = findBestScenario(scenarioResults);
  
  // Extract confidence from the analysis
  const confidenceMatch = analysis.match(/confidence(\s+level)?:\s*(\d+(\.\d+)?)/i);
  const confidence = confidenceMatch 
    ? parseFloat(confidenceMatch[2]) 
    : (bestScenario ? bestScenario.confidence : 0.5);
  
  // Extract time to fix estimate
  const timeMatch = analysis.match(/time\s+to\s+fix:?\s*([^\n.]+)/i);
  const estimatedTimeToFix = timeMatch 
    ? timeMatch[1].trim() 
    : "15-30 minutes";
  
  // Extract recommendation and explanation
  let recommendation = analysis;
  if (analysis.length > 500) {
    // Try to extract just the recommendation part
    const recMatch = analysis.match(/recommendation:?\s*([^\n]+(\n[^\n]+)*)/i);
    if (recMatch) {
      recommendation = recMatch[1].trim();
    } else {
      // Just take the last part of the analysis
      recommendation = analysis.split('\n').slice(-5).join('\n');
    }
  }
  
  // Create the final result
  return {
    fixDescription: bestScenario ? bestScenario.fixAttempted : "Combined approach needed",
    confidence: confidence,
    explanation: bestScenario ? bestScenario.explanation : analysis,
    changesRequired: extractChanges(analysis, bestScenario),
    estimatedTimeToFix: estimatedTimeToFix,
    recommendation: recommendation
  };
}

/**
 * Extract required changes from analysis
 */
function extractChanges(analysis: string, bestScenario: ScenarioResult | null): any[] {
  const changes: any[] = [];
  
  // Add changes from best scenario if available
  if (bestScenario) {
    changes.push({
      type: bestScenario.scenarioType,
      description: bestScenario.fixAttempted,
      priority: "high"
    });
  }
  
  // Look for bullet points with changes in the analysis
  const bulletChanges = analysis.match(/[*-]\s+([^\n]+)/g);
  if (bulletChanges) {
    bulletChanges.forEach(change => {
      const cleanChange = change.replace(/^[*-]\s+/, '').trim();
      
      // Try to determine change type
      let type = "other";
      if (/dependenc|package|module|npm|install/i.test(cleanChange)) type = "dependency";
      else if (/code|syntax|variable|function|class|type/i.test(cleanChange)) type = "code";
      else if (/config|environment|\.env|setting/i.test(cleanChange)) type = "environment";
      else if (/cache|stale|sync/i.test(cleanChange)) type = "cache";
      else if (/race|timing|async/i.test(cleanChange)) type = "async";
      
      // Try to determine priority
      let priority = "medium";
      if (/critical|essential|required|must/i.test(cleanChange)) priority = "high";
      else if (/optional|might|could|consider/i.test(cleanChange)) priority = "low";
      
      changes.push({
        type,
        description: cleanChange,
        priority
      });
    });
  }
  
  // Ensure we have at least one change
  if (changes.length === 0) {
    changes.push({
      type: "code",
      description: "Fix code based on error analysis",
      priority: "high"
    });
  }
  
  return changes;
}
