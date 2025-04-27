// src/mother-agent.ts
/**
 * 📌 Why this is the best version:
    • ✅ Keeps full message history without resetting
    • ✅ Supports multiple tool calls per Claude response
    • ✅ Spawns scenarios from multiple hypotheses
    • ✅ Never throws on malformed XML, logs gently instead
    • ✅ Doesn't force memory bank writes — Mother can directly choose via filesystem-mcp
    • ✅ Maintains Deebo's spirit: autonomy, freedom to fail, and graceful continuation
    • ✅ FIXED: Processes tool calls before hypotheses from the same LLM turn.
 */

    import { spawn } from 'child_process';
    import { join } from 'path';
    import { getAgentObservations } from './util/observations.js';
    import { log } from './util/logger.js';
    import { connectRequiredTools } from './util/mcp.js';
    import { DEEBO_ROOT } from './index.js';
    import { updateMemoryBank } from './util/membank.js';
    import { getProjectId } from './util/sanitize.js';
    import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'; // Keep structure type
    import { createScenarioBranch } from './util/branch-manager.js';
    import { callLlm, getMotherAgentPrompt } from './util/agent-utils.js';
    
    const MAX_RUNTIME = 60 * 60 * 1000; // 60 minutes
    const SCENARIO_TIMEOUT = 5 * 60 * 1000;
    const useMemoryBank = process.env.USE_MEMORY_BANK === 'true';
    
    // Mother agent main loop
    export async function runMotherAgent(
      sessionId: string,
      error: string,
      context: string,
      language: string,
      filePath: string,
      repoPath: string,
      signal: AbortSignal, // Added: Cancellation signal
      scenarioPids: Set<number> // Added: Set to track scenario PIDs
    ) {
      await log(sessionId, 'mother', 'info', 'Mother agent started', { repoPath });
      const projectId = getProjectId(repoPath);
      let scenarioCounter = 0; // Simple counter for unique scenario IDs within the session
      const startTime = Date.now();
      const memoryBankPath = join(DEEBO_ROOT, 'memory-bank', projectId);
      let lastObservationCheck = 0; // Removed unused variable
    
      try {
        // OBSERVE: Setup tools and LLM Client
        await log(sessionId, 'mother', 'info', 'OODA: observe', { repoPath });
        const { gitClient, filesystemClient } = await connectRequiredTools('mother', sessionId, repoPath);
    
        // Read LLM configuration from environment variables
        const motherProvider = process.env.MOTHER_HOST;
        const motherModel = process.env.MOTHER_MODEL;
        const openrouterApiKey = process.env.OPENROUTER_API_KEY;
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const openaiBaseUrl = process.env.OPENAI_BASE_URL;
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
        // Create the config object to pass to callLlm
        const llmConfig = {
          provider: motherProvider,
          model: motherModel,
          apiKey: openrouterApiKey, // Keep for backward compatibility/other uses
          openrouterApiKey: openrouterApiKey,
          openaiApiKey: openaiApiKey,
          baseURL: openaiBaseUrl,
          geminiApiKey: geminiApiKey,
          anthropicApiKey: anthropicApiKey
        };
    
        // Initial conversation context
        const messages: ChatCompletionMessageParam[] = [{
          role: 'assistant',
          content: getMotherAgentPrompt(useMemoryBank, memoryBankPath)
        }, {
          role: 'user',
          content: `Error: ${error}
        Context: ${context}
        Language: ${language}
        File: ${filePath}
        Repo: ${repoPath}
        Session: ${sessionId}
        Project: ${projectId}
        ${useMemoryBank ? '\nPrevious debugging attempts and context are available in the memory-bank directory if needed.' : ''}
    
        IMPORTANT: Generate your first hypothesis within 2-3 responses. Don't wait for perfect information.`
        }];
    
        // Check for initial observations
        let observations = await getAgentObservations(repoPath, sessionId, 'mother');
        if (observations.length > 0) {
          messages.push(...observations.map(obs => ({
            role: 'user' as const,
            content: `Scientific observation: ${obs}`
          })));
        }
    
        // Initial LLM call
        await log(sessionId, 'mother', 'debug', 'Sending to LLM', { model: llmConfig.model, provider: llmConfig.provider, messages, repoPath });
        let replyText = await callLlm(messages, llmConfig);
        if (!replyText) {
          // Handle initial LLM failure more gracefully
          const initFailMsg = 'Initial LLM call returned empty or malformed response. Cannot proceed.';
          await log(sessionId, 'mother', 'error', initFailMsg, { provider: llmConfig.provider, model: llmConfig.model, repoPath });
          throw new Error(initFailMsg); // Throw to be caught by outer handler
        } else {
          // Add the valid response to messages history
          messages.push({ role: 'assistant', content: replyText });
          await log(sessionId, 'mother', 'debug', 'Received from LLM', { response: { content: replyText }, repoPath });
        }
    
        // ORIENT: Begin investigation loop
        await log(sessionId, 'mother', 'info', 'OODA: orient', { repoPath });
    
        // Loop while the last reply exists, doesn't contain a valid solution, AND cancellation hasn't been requested
        while (replyText && !(replyText.includes('<solution>') && replyText.match(/<solution>([\s\S]*?)<\/solution>/)?.[1]?.trim()) && !signal.aborted) {
          if (Date.now() - startTime > MAX_RUNTIME) {
            await log(sessionId, 'mother', 'warn', 'Investigation exceeded maximum runtime', { repoPath });
            throw new Error('Investigation exceeded maximum runtime');
          }
    
          // Check for cancellation signal before processing response
          if (signal.aborted) {
            await log(sessionId, 'mother', 'info', 'Cancellation signal received, stopping loop.', { repoPath });
            break; // Exit loop if cancelled
          }
    
          // Use the latest replyText from the end of the previous loop iteration (or the initial call)
          const responseText = replyText;
    
          // --- Check for Tools and Hypotheses ---
          const toolCalls = responseText.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];
          const containsHypothesis = responseText.includes('<hypothesis>'); // Check for hypothesis presence
    
          let executeToolsThisTurn = false;
          let processHypothesesThisTurn = false;
    
          if (toolCalls.length > 0 && containsHypothesis) {
              // LLM included both - prioritize executing tools, ignore hypotheses this turn
              messages.push({
                  role: 'user',
                  content: `Instructions conflict: You provided tool calls and hypotheses in the same message. I will execute the tool calls now. Please provide hypotheses ONLY after analyzing the tool results in the next turn.`
              });
              executeToolsThisTurn = true; // Signal to execute tools below
              // DO NOT set processHypothesesThisTurn = true
              await log(sessionId, 'mother', 'warn', 'LLM provided tools and hypotheses simultaneously. Executing tools, ignoring hypotheses for this turn.', { repoPath });
    
          } else if (containsHypothesis) {
              // Only hypotheses found - process them
              processHypothesesThisTurn = true; // Signal to process hypotheses below
              executeToolsThisTurn = false; // Ensure tools aren't run if none were requested
    
          } else if (toolCalls.length > 0) {
               // Only tool calls found - execute them
               executeToolsThisTurn = true; // Signal to execute tools below
               processHypothesesThisTurn = false; // Ensure hypotheses aren't processed
          }
          // If neither tools nor hypotheses found, the loop continues to the next LLM call
    
    
          // --- Execute Tools if Flagged ---
          if (executeToolsThisTurn) {
              await log(sessionId, 'mother', 'debug', `Executing ${toolCalls.length} tool calls.`, { repoPath });
              const parsedCalls = toolCalls.map((tc: string) => {
                // Use try-catch for robust parsing
                try {
                  const serverNameMatch = tc.match(/<server_name>(.*?)<\/server_name>/);
                  if (!serverNameMatch || !serverNameMatch[1]) throw new Error('Missing server_name');
                  const serverName = serverNameMatch[1].trim(); // Trim whitespace
                  const server = serverName === 'git-mcp' ? gitClient! : filesystemClient!;
                  if (!server) throw new Error(`Invalid server_name: ${serverName}`);
    
                  const toolMatch = tc.match(/<tool_name>(.*?)<\/tool_name>/);
                  if (!toolMatch || !toolMatch[1]) throw new Error('Missing tool_name');
                  const tool = toolMatch[1].trim();
    
                  const argsMatch = tc.match(/<arguments>([\s\S]*?)<\/arguments>/); // Use [\s\S]*? for multiline args
                  if (!argsMatch || !argsMatch[1]) throw new Error('Missing arguments block');
                  const argsJson = argsMatch[1].trim();
                  if (!argsJson) throw new Error('Empty arguments block');
                  const args = JSON.parse(argsJson);
    
                  return { server, tool, args };
                } catch (err) {
                  log(sessionId, 'mother', 'error', `Failed to parse tool call: ${err instanceof Error ? err.message : String(err)}`, { toolCall: tc, repoPath });
                  return { error: err instanceof Error ? err.message : String(err) };
                }
              });
    
              // Process each parsed call
              for (const parsed of parsedCalls) {
                if ('error' in parsed) {
                  messages.push({
                    role: 'user',
                    content: `One of your tool calls was malformed and skipped. Error: ${parsed.error}`
                  });
                  continue; // Skip this malformed call
                }
    
                try {
                  await log(sessionId, 'mother', 'debug', `Executing tool: ${parsed.tool}`, { args: parsed.args, repoPath });
                  const result = await parsed.server.callTool({ name: parsed.tool, arguments: parsed.args });
                  messages.push({
                    role: 'user',
                    content: JSON.stringify(result) // Add tool result to history
                  });
                  await log(sessionId, 'mother', 'debug', `Tool result for ${parsed.tool}`, { result: result, repoPath });
                } catch (err) {
                  const errorMsg = `Tool call failed for '${parsed.tool}': ${err instanceof Error ? err.message : String(err)}`;
                  messages.push({
                    role: 'user',
                    content: errorMsg // Add tool error to history
                  });
                  await log(sessionId, 'mother', 'error', `Tool call execution failed: ${parsed.tool}`, { error: err instanceof Error ? err.message : String(err), repoPath });
                }
              }
              await log(sessionId, 'mother', 'debug', 'Finished executing tools for this turn.', { repoPath });
          } // End of tool execution block
    
    
          // --- Process Hypotheses and Spawn Scenarios if Flagged ---
          if (processHypothesesThisTurn) { // Use the flag here
            await log(sessionId, 'mother', 'debug', 'Processing hypotheses and spawning scenarios.', { repoPath });
            const hypotheses = [...responseText.matchAll(/<hypothesis>([\s\S]*?)<\/hypothesis>/g)].map(match => match[1].trim());
    
            if (hypotheses.length > 0) {
                 if (useMemoryBank) {
                   // Log hypotheses to memory bank (consider making this async and not awaiting if performance is key)
                   await updateMemoryBank(projectId, `==================
    AUTOMATED HYPOTHESIS RECORD
    Timestamp: ${new Date().toISOString()}
    Error: ${error || 'No error provided'}
    
    ${hypotheses.map(h => `<hypothesis>${h}</hypothesis>`).join('\n\n')}
    
    Context provided by LLM:
    ${responseText}
    ==================
    `, 'activeContext').catch(err => log(sessionId, 'mother', 'error', 'Failed to update memory bank hypothesis record', { error: err }));
                 }
    
                 const scenarioPromises = hypotheses.map(async (hypothesis: string) => {
                   const scenarioId = `${sessionId}-${scenarioCounter++}`; // Use counter for unique ID
    
                   // Create branch first
                   const branchName = await createScenarioBranch(repoPath, scenarioId);
    
                   const scenarioArgs = [ // Define args for spawn
                     join(DEEBO_ROOT, 'build/scenario-agent.js'),
                     '--id', scenarioId,
                     '--session', sessionId,
                     '--error', error,
                     '--context', context, // Pass original context or maybe updated? Check requirement.
                     '--hypothesis', hypothesis,
                     '--language', language,
                     '--file', filePath || '',
                     '--repo', repoPath,
                     '--branch', branchName
                   ];
    
                   const child = spawn('node', scenarioArgs, {
                      cwd: repoPath,
                      env: { ...process.env }
                   });
                   let output = '';
                   const scenarioPid = child.pid; // Capture PID early
    
                   if (scenarioPid) {
                     scenarioPids.add(scenarioPid);
                     await log(sessionId, 'mother', 'info', `Spawned Scenario ${scenarioId} with PID ${scenarioPid}`, { repoPath, hypothesis, args: scenarioArgs });
                   } else {
                     await log(sessionId, 'mother', 'warn', `Spawned Scenario ${scenarioId} but PID was unavailable`, { repoPath, hypothesis, args: scenarioArgs });
                   }
    
                   child.stdout.on('data', data => output += data);
                   child.stderr.on('data', data => output += data); // Capture stderr too
    
                   return new Promise<string>((resolve) => {
                     let resolved = false;
    
                     const cleanupAndResolve = (exitInfo: string) => {
                       if (resolved) return;
                       resolved = true;
                       if (scenarioPid) {
                         scenarioPids.delete(scenarioPid);
                         log(sessionId, 'mother', 'debug', `Removed scenario PID ${scenarioPid} from registry`, { repoPath });
                       }
                       output += `\n${exitInfo}`; // Append exit info to the captured output
                       resolve(output); // Resolve with the full output + exit info
                     };
    
                     child.on('exit', (code, signal) => {
                       cleanupAndResolve(`Scenario ${scenarioId} (PID: ${scenarioPid ?? 'N/A'}) exited with code ${code}, signal ${signal}`);
                     });
    
                     child.on('error', err => {
                       // Handle spawn errors specifically
                       const spawnErrorMsg = `Scenario ${scenarioId} (PID: ${scenarioPid ?? 'N/A'}) process spawn error: ${err.message}`;
                       output += `\n${spawnErrorMsg}`; // Add spawn error to output
                       cleanupAndResolve(spawnErrorMsg); // Resolve immediately
                     });
    
                      // Capture stream-level errors (don't resolve promise, just log)
                      child.stdout.on('error', err => { output += `\nScenario ${scenarioId} Stdout error: ${err.message}`; });
                      child.stderr.on('error', err => { output += `\nScenario ${scenarioId} Stderr error: ${err.message}`; });
    
    
                     const timeoutHandle = setTimeout(() => {
                       if (!resolved) {
                         log(sessionId, 'mother', 'warn', `Scenario ${scenarioId} (PID: ${scenarioPid}) timed out after ${SCENARIO_TIMEOUT / 1000}s. Killing...`, { repoPath });
                         child.kill('SIGTERM'); // Attempt graceful termination first
                         // Give it a moment, then force kill if needed
                         setTimeout(() => {
                             if (!resolved) {
                                 child.kill('SIGKILL');
                                 cleanupAndResolve(`Scenario ${scenarioId} (PID: ${scenarioPid}) timed out and was force killed.`);
                             }
                         }, 2000); // Wait 2s before SIGKILL
                       }
                     }, SCENARIO_TIMEOUT);
    
                     // Ensure timeout is cleared if process exits/errors cleanly
                     child.on('exit', () => clearTimeout(timeoutHandle));
                     child.on('error', () => clearTimeout(timeoutHandle));
                   });
                 });
    
                 // Wait for all spawned scenarios for this turn to complete
                 const scenarioOutputs = await Promise.all(scenarioPromises);
                 await log(sessionId, 'mother', 'debug', `All ${hypotheses.length} scenarios for this turn completed.`, { repoPath });
    
                 // Add combined scenario outputs as a single user message
                 messages.push({ role: 'user', content: scenarioOutputs.join('\n\n---\n\n') });
            } else {
                await log(sessionId, 'mother', 'debug', 'Hypothesis tag found, but no hypotheses extracted.', { repoPath });
            }
          } // End of hypothesis processing block
    
    
          // --- Observation Check ---
          // Check for new observations periodically or based on logic
          // Example: check every few seconds or after specific events
          // if (Date.now() - lastObservationCheck > 10000) { // Check every 10s
              const newObservations = await getAgentObservations(repoPath, sessionId, 'mother');
              if (newObservations.length > observations.length) {
                const latestObservations = newObservations.slice(observations.length);
                messages.push(...latestObservations.map(obs => ({
                  role: 'user' as const,
                  content: `Scientific observation: ${obs}`
                })));
                observations = newObservations; // Update the baseline observation list
                await log(sessionId, 'mother', 'debug', `Added ${latestObservations.length} new observations.`, { repoPath });
              }
            //   lastObservationCheck = Date.now();
          // }
    
    
          // --- Prepare for Next LLM Call ---
          // Check for cancellation signal again before the next LLM call
          if (signal.aborted) {
            await log(sessionId, 'mother', 'info', 'Cancellation signal received before next LLM call.', { repoPath });
            break; // Exit loop if cancelled
          }
    
          // Make next LLM call using the updated message history
          await log(sessionId, 'mother', 'debug', `Sending message history (${messages.length} items) to LLM`, { model: llmConfig.model, provider: llmConfig.provider, repoPath });
          replyText = await callLlm(messages, llmConfig); // Update replyText for the next loop iteration
    
          if (!replyText) {
            // Log the failure and let the loop condition handle termination
            await log(sessionId, 'mother', 'warn', 'Received empty/malformed response from LLM', { provider: llmConfig.provider, model: llmConfig.model, repoPath });
            // Push a message indicating the failure, maybe helps LLM recover?
            messages.push({ role: 'user', content: 'INTERNAL_NOTE: Previous LLM call failed to return valid content.' });
          } else {
            // Add the valid response to messages history for the *next* turn
            messages.push({ role: 'assistant', content: replyText });
            await log(sessionId, 'mother', 'debug', 'Received response from LLM', { response: replyText, provider: llmConfig.provider, model: llmConfig.model, repoPath });
          }
    
          // Optional delay between cycles
          await new Promise(resolve => setTimeout(resolve, 1000));
        } // End of while loop
    
        // --- Loop Finished ---
        // Determine final status based on why the loop ended
        let finalStatusMessage: string;
        if (signal.aborted) {
          finalStatusMessage = 'Session cancelled by user request.';
          await log(sessionId, 'mother', 'info', finalStatusMessage, { repoPath });
        } else if (replyText?.includes('<solution>')) {
          const match = replyText.match(/<solution>([\s\S]*?)<\/solution>/);
          if (match && match[1].trim()) {
            finalStatusMessage = 'Solution found or investigation concluded.';
            await log(sessionId, 'mother', 'info', finalStatusMessage, { repoPath });
          } else {
            // Empty solution tag, treat as error
            finalStatusMessage = 'Loop terminated unexpectedly (empty solution tag)';
            await log(sessionId, 'mother', 'warn', finalStatusMessage, { repoPath });
            replyText = finalStatusMessage;
          }
        } else {
          // Loop likely ended due to empty replyText from LLM failure
          finalStatusMessage = 'Loop terminated unexpectedly (e.g., LLM error).';
          await log(sessionId, 'mother', 'warn', finalStatusMessage, { repoPath });
          replyText = finalStatusMessage; // Use status message as final content
        }

        // Structured record at the end
        if (useMemoryBank) {
          await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
    ${error ? `Initial Error: ${error}` : ''}
    Final Status: ${finalStatusMessage}
    ${replyText}
    Scenarios Spawned: ${scenarioCounter}
    Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress').catch(err => log(sessionId, 'mother', 'error', 'Failed to update memory bank progress log', { error: err }));
        }

        return replyText; // Return the last reply or status
    
      } catch (err) {
         // Catch unexpected errors during setup or within the loop if not handled
         const caughtError = err instanceof Error ? err : new Error(String(err));
         // Check if the error was due to cancellation signal during an operation
          if (signal.aborted) {
            await log(sessionId, 'mother', 'info', `Operation aborted during execution: ${caughtError.message}`, { repoPath });
            // Optionally update progress log for aborted state
            if (useMemoryBank) {
              await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ABORTED - ${new Date().toISOString()}\nError during abort: ${caughtError.message}`, 'progress').catch(logErr => console.error("Mem bank log fail on abort:", logErr));
            }
            return 'Session cancelled during operation.'; // Return specific cancellation message
          } else {
            // Log and record other errors
            await log(sessionId, 'mother', 'error', `Mother agent failed: ${caughtError.message}`, { repoPath, stack: caughtError.stack });
            if (useMemoryBank) {
              await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - FAILED - ${new Date().toISOString()}\nError: ${caughtError.message}\nStack: ${caughtError.stack}`, 'progress').catch(logErr => console.error("Mem bank log fail on error:", logErr));
            }
            throw caughtError; // Re-throw unexpected errors
          }
      } finally {
          // Ensure any remaining scenario PIDs are cleaned up if the mother agent exits unexpectedly
          if (scenarioPids.size > 0) {
            await log(sessionId, 'mother', 'warn', `Mother agent exiting unexpectedly with ${scenarioPids.size} scenario PIDs still in registry. Attempting cleanup.`, { repoPath, pids: Array.from(scenarioPids) });
            for (const pid of scenarioPids) {
                 try { process.kill(pid, 'SIGTERM'); } catch (e) { /* ignore errors if process already gone */ }
            }
             // Give a moment then force kill
             await new Promise(resolve => setTimeout(resolve, 1000));
             for (const pid of scenarioPids) {
                 try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
             }
             scenarioPids.clear(); // Clear the set
          }
      }
    } // End of runMotherAgent
