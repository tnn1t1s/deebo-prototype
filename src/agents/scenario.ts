import { runScenarioAgent } from '../util/anthropic.js';
import { gitOperations, commanderOperations } from '../util/mcp.js';
import { ScenarioConfig, ScenarioResult } from '../types.js';

/**
 * Run a debugging scenario
 */
export async function runScenario(config: ScenarioConfig): Promise<ScenarioResult> {
  console.error(`Running ${config.scenarioType} scenario for session ${config.sessionId}`);
  
  // Gather context for scenario
  let context = config.debugRequest.context || '';
  
  // Add language info
  const language = config.debugRequest.codebase?.filePath?.split('.').pop() || '';
  
  // Add git context if available
  if (config.debugRequest.codebase?.repoPath) {
    try {
      const repoPath = config.debugRequest.codebase.repoPath;
      
      // Ensure we're on the correct branch if specified
      if (config.branchName) {
        try {
          // Check if we're already on the branch
          const { output: branchOutput } = await commanderOperations.executeCommand(
            `cd ${repoPath} && git branch --show-current`
          );
          
          if (branchOutput.trim() !== config.branchName) {
            console.error(`Scenario agent switching to branch ${config.branchName}`);
            await commanderOperations.executeCommand(
              `cd ${repoPath} && git checkout ${config.branchName}`
            );
          }
        } catch (error) {
          console.error(`Error switching to branch ${config.branchName}:`, error);
        }
      }
      
      // Different context based on scenario type
      switch (config.scenarioType) {
        case 'dependency':
          // For dependency issues, check package files
          if (language === 'js' || language === 'ts') {
            try {
              const packageJson = await commanderOperations.readFile(`${repoPath}/package.json`);
              context += `\n\npackage.json:\n${packageJson}`;
              
              // Try to get package-lock.json or yarn.lock if they exist
              try {
                const lockFile = await commanderOperations.readFile(`${repoPath}/package-lock.json`);
                context += `\n\npackage-lock.json exists with size ${lockFile.length} bytes`;
              } catch (e) {
                try {
                  const yarnLock = await commanderOperations.readFile(`${repoPath}/yarn.lock`);
                  context += `\n\nyarn.lock exists with size ${yarnLock.length} bytes`;
                } catch (e) {
                  // No lock file found
                  context += '\n\nNo lock file (package-lock.json or yarn.lock) found.';
                }
              }
              
              // Also search for any import or require statements related to the error
              try {
                const errorTerms = config.debugRequest.error.split(/\s+/).filter(term => term.length > 3);
                for (const term of errorTerms) {
                  const searchResult = await commanderOperations.codeSearch(repoPath, `import.*${term}|require.*${term}`);
                  if (searchResult && searchResult.length > 0) {
                    context += `\n\nCode using "${term}":\n${searchResult}`;
                  }
                }
              } catch (e) {
                console.error('Error searching for imports:', e);
              }
            } catch (e) {
              console.error('Error reading package.json:', e);
            }
          } else if (language === 'py') {
            // For Python projects
            try {
              const requirementsFile = await commanderOperations.readFile(`${repoPath}/requirements.txt`);
              context += `\n\nrequirements.txt:\n${requirementsFile}`;
            } catch (e) {
              // Try setup.py instead
              try {
                const setupPy = await commanderOperations.readFile(`${repoPath}/setup.py`);
                context += `\n\nsetup.py:\n${setupPy}`;
              } catch (e) {
                console.error('Error reading Python dependency files:', e);
              }
            }
          }
          break;
          
        case 'syntax':
          // For syntax issues, get the specific file with error and related imports
          if (config.debugRequest.codebase?.filePath) {
            try {
              const fileContent = await commanderOperations.readFile(config.debugRequest.codebase.filePath);
              context += `\n\nFile Content (${config.debugRequest.codebase.filePath}):\n${fileContent}`;
              
              // Try to find related files (imports, etc.)
              const filename = config.debugRequest.codebase.filePath.split('/').pop() || '';
              const filenameWithoutExt = filename.split('.').slice(0, -1).join('.');
              
              // Search for related files
              try {
                const relatedFiles = await commanderOperations.codeSearch(
                  repoPath, 
                  `import.*${filenameWithoutExt}|require.*${filenameWithoutExt}`
                );
                if (relatedFiles && relatedFiles.length > 0) {
                  context += `\n\nFiles importing ${filenameWithoutExt}:\n${relatedFiles}`;
                }
              } catch (e) {
                console.error('Error searching for related files:', e);
              }
            } catch (e) {
              console.error('Error reading file with error:', e);
            }
          } else {
            // If no specific file, search for syntax patterns in the repo
            try {
              const syntaxSearchTerms = language === 'ts' ? ['interface', 'type', 'extends', 'implements'] :
                                       language === 'py' ? ['def', 'class', 'import', 'from'] :
                                       language === 'js' ? ['function', 'class', 'import', 'require'] :
                                       ['function', 'class'];
                                       
              for (const term of syntaxSearchTerms) {
                const searchResult = await commanderOperations.codeSearch(repoPath, term);
                if (searchResult && searchResult.length > 0) {
                  context += `\n\nCode using "${term}":\n${searchResult.substring(0, 500)}...`;
                  break; // Just get one example to avoid too much context
                }
              }
            } catch (e) {
              console.error('Error searching for syntax patterns:', e);
            }
          }
          break;
          
        case 'cache':
          // For cache issues, look for cache-related code
          try {
            const cacheSearchResults = await commanderOperations.codeSearch(repoPath, 'cache|Cache|caching');
            if (cacheSearchResults && cacheSearchResults.length > 0) {
              context += `\n\nCache-related code:\n${cacheSearchResults}`;
            }
            
            // Also try to find specific cache implementations
            const cacheImplResults = await commanderOperations.codeSearch(repoPath, 'NodeCache|CacheService|cacheService');
            if (cacheImplResults && cacheImplResults.length > 0) {
              context += `\n\nCache implementation:\n${cacheImplResults}`;
            }
          } catch (e) {
            console.error('Error searching for cache code:', e);
          }
          break;
          
        case 'async':
          // For async issues, look for promises, async/await, and callbacks
          try {
            const asyncSearchResults = await commanderOperations.codeSearch(repoPath, 'Promise|async|await|then|catch');
            if (asyncSearchResults && asyncSearchResults.length > 0) {
              context += `\n\nAsync code patterns:\n${asyncSearchResults}`;
            }
            
            // Look for potential race conditions
            const raceSearchResults = await commanderOperations.codeSearch(repoPath, 'setTimeout|setImmediate|process.nextTick');
            if (raceSearchResults && raceSearchResults.length > 0) {
              context += `\n\nPotential race condition code:\n${raceSearchResults}`;
            }
          } catch (e) {
            console.error('Error searching for async patterns:', e);
          }
          break;
          
        case 'environment':
          // For environment issues, look for config files
          try {
            // Check for common config files
            const configFiles = [
              '.env',
              '.env.local',
              '.env.development',
              'config.js',
              'config.json',
              'settings.json',
              'docker-compose.yml',
              'Dockerfile'
            ];
            
            for (const configFile of configFiles) {
              try {
                const content = await commanderOperations.readFile(`${repoPath}/${configFile}`);
                context += `\n\n${configFile}:\n${content}`;
              } catch (e) {
                // File doesn't exist or can't be read, continue to next one
              }
            }
            
            // Run environment check commands
            try {
              const { output } = await commanderOperations.executeCommand(`cd ${repoPath} && node -v && npm -v`);
              context += `\n\nNode environment:\n${output}`;
            } catch (e) {
              // Command failed
            }
          } catch (e) {
            console.error('Error checking environment:', e);
          }
          break;
          
        default:
          // For other scenarios, get basic git info
          const status = await gitOperations.status(repoPath);
          const diff = await gitOperations.diffUnstaged(repoPath);
          
          context += `\n\nGit Status:\n${status}\n\nRecent Changes:\n${diff}`;
          
          if (config.debugRequest.codebase?.filePath) {
            const fileContent = await commanderOperations.readFile(config.debugRequest.codebase.filePath);
            context += `\n\nFile Content (${config.debugRequest.codebase.filePath}):\n${fileContent}`;
          }
      }
    } catch (error) {
      console.error(`Error gathering context for ${config.scenarioType} scenario:`, error);
    }
  }
  
  // Run scenario analysis with Claude
  const analysis = await runScenarioAgent(
    config.scenarioType,
    config.hypothesis,
    config.debugRequest.error,
    context,
    language
  );
  
  // Try to implement fixes based on analysis
  let fixImplemented = false;
  let fixResults = "";
  
  if (config.debugRequest.codebase?.repoPath && config.branchName) {
    try {
      // Extract suggested code changes from the analysis
      const codeChanges = extractCodeChanges(analysis);
      
      if (codeChanges.length > 0) {
        fixResults = `Attempted ${codeChanges.length} code changes:\n`;
        
        // Apply each code change
        for (const change of codeChanges) {
          if (change.file && change.oldCode && change.newCode) {
            try {
              // Construct edit block for commanderOperations.editBlock
              const editBlock = `${change.file}\n<<<<<<< SEARCH\n${change.oldCode}\n=======\n${change.newCode}\n>>>>>>> REPLACE`;
              const result = await commanderOperations.editBlock(editBlock);
              
              fixResults += `- Modified ${change.file}: ${result.includes("SUCCESS") ? "SUCCESS" : "FAILED"}\n`;
              fixImplemented = fixImplemented || result.includes("SUCCESS");
            } catch (error) {
              console.error(`Error applying fix to ${change.file}:`, error);
              fixResults += `- Error modifying ${change.file}: ${error}\n`;
            }
          }
        }
      } else {
        fixResults = "No specific code changes were identified in the analysis.";
      }
    } catch (error) {
      console.error(`Error implementing fixes for ${config.scenarioType} scenario:`, error);
      fixResults = `Error implementing fixes: ${error}`;
    }
  }
  
  // Parse the result
  return parseScenarioResult(config, analysis, fixImplemented, fixResults);
}

/**
 * Extract code changes from scenario agent analysis
 */
function extractCodeChanges(analysis: string): Array<{file: string, oldCode: string, newCode: string}> {
  const changes: Array<{file: string, oldCode: string, newCode: string}> = [];
  
  // Look for code blocks with file path comments
  const filePathRegex = /(?:file|path|in):\s*([^\n]+)\s*```(?:[\w-]+)?\s*([\s\S]*?)```/gi;
  let match;
  
  while ((match = filePathRegex.exec(analysis)) !== null) {
    const file = match[1].trim();
    const code = match[2].trim();
    
    // Now look for before/after or old/new patterns
    if (analysis.includes("Before:") && analysis.includes("After:")) {
      const beforeRegex = /Before:\s*```(?:[\w-]+)?\s*([\s\S]*?)```/i;
      const afterRegex = /After:\s*```(?:[\w-]+)?\s*([\s\S]*?)```/i;
      
      const beforeMatch = beforeRegex.exec(analysis);
      const afterMatch = afterRegex.exec(analysis);
      
      if (beforeMatch && afterMatch) {
        changes.push({
          file,
          oldCode: beforeMatch[1].trim(),
          newCode: afterMatch[1].trim()
        });
      }
    } else if (analysis.includes("Old:") && analysis.includes("New:")) {
      const oldRegex = /Old:\s*```(?:[\w-]+)?\s*([\s\S]*?)```/i;
      const newRegex = /New:\s*```(?:[\w-]+)?\s*([\s\S]*?)```/i;
      
      const oldMatch = oldRegex.exec(analysis);
      const newMatch = newRegex.exec(analysis);
      
      if (oldMatch && newMatch) {
        changes.push({
          file,
          oldCode: oldMatch[1].trim(),
          newCode: newMatch[1].trim()
        });
      }
    }
  }
  
  // If no specific before/after patterns, try to identify individual code blocks
  if (changes.length === 0) {
    // Look for file paths followed by code blocks
    const simpleFileBlockRegex = /([^\n]+(?:\.js|\.ts|\.jsx|\.tsx|\.py|\.java|\.rb|\.php))\s*```(?:[\w-]+)?\s*([\s\S]*?)```/gi;
    
    while ((match = simpleFileBlockRegex.exec(analysis)) !== null) {
      const file = match[1].trim();
      const newCode = match[2].trim();
      
      changes.push({
        file,
        oldCode: "", // We'll have to retrieve the old code separately
        newCode
      });
    }
  }
  
  return changes;
}

/**
 * Parse scenario agent result
 */
function parseScenarioResult(
  config: ScenarioConfig, 
  analysis: string, 
  fixImplemented: boolean, 
  fixResults: string
): ScenarioResult {
  // Extract success indication
  const isSuccessful = fixImplemented || 
                      /hypothesis is correct|confirmed|verified|validated|correct hypothesis/i.test(analysis);
  
  // Extract confidence
  const confidenceMatch = analysis.match(/confidence:?\s*(\d+(\.\d+)?)/i);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : (isSuccessful ? 0.8 : 0.3);
  
  // Extract fix
  let fixAttempted = fixResults;
  if (!fixAttempted) {
    const fixMatch = analysis.match(/fix:([^\n]+(\n[^\n]+)*)/i);
    if (fixMatch) {
      fixAttempted = fixMatch[1].trim();
    } else if (analysis.includes('```')) {
      // Try to extract code blocks as the fix
      const codeBlocks = analysis.match(/```[^\n]*\n([\s\S]*?)```/g);
      if (codeBlocks && codeBlocks.length > 0) {
        fixAttempted = codeBlocks.map(block => block.replace(/```[^\n]*\n/, '').replace(/```$/, '')).join('\n\n');
      }
    } else {
      // Just take a portion of the analysis
      fixAttempted = analysis.substring(0, 500) + '...';
    }
  }
  
  // Extract explanation
  let explanation = '';
  const explanationMatch = analysis.match(/reasoning|rationale|explanation:([^\n]+(\n[^\n]+)*)/i);
  if (explanationMatch) {
    explanation = explanationMatch[1].trim();
  } else {
    // Take the last part of the analysis
    const lines = analysis.split('\n');
    explanation = lines.slice(Math.max(0, lines.length - 10)).join('\n');
  }
  
  return {
    id: config.id,
    scenarioType: config.scenarioType,
    hypothesis: config.hypothesis,
    fixAttempted,
    testResults: analysis,
    success: isSuccessful,
    confidence,
    explanation
  };
}