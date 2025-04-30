// src/scenario-agent.ts
import { log } from './util/logger.js';
import { connectRequiredTools } from './util/mcp.js';
import { writeReport } from './util/reports.js';
import { getAgentObservations } from './util/observations.js';
import { callLlm, getScenarioAgentPrompt } from './util/agent-utils.js';
const MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes
function parseArgs(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
            result[key] = value;
            if (value)
                i++;
        }
    }
    const repoPath = result.repo;
    if (!repoPath) {
        throw new Error('Required argument missing: --repo');
    }
    return {
        id: result.id || '',
        session: result.session || '',
        error: result.error || '',
        context: result.context || '',
        hypothesis: result.hypothesis || '',
        language: result.language || 'typescript',
        repoPath,
        filePath: result.file || undefined,
        branch: result.branch || ''
    };
}
export async function runScenarioAgent(args) {
    await log(args.session, `scenario-${args.id}`, 'info', 'Scenario agent started', { repoPath: args.repoPath, hypothesis: args.hypothesis });
    await log(args.session, `scenario-${args.id}`, 'debug', `CWD: ${process.cwd()}, DEEBO_NPX_PATH=${process.env.DEEBO_NPX_PATH}, DEEBO_UVX_PATH=${process.env.DEEBO_UVX_PATH}`, { repoPath: args.repoPath });
    try {
        // Set up tools
        await log(args.session, `scenario-${args.id}`, 'info', 'Connecting to tools...', { repoPath: args.repoPath });
        const { gitClient, filesystemClient } = await connectRequiredTools(`scenario-${args.id}`, args.session, args.repoPath);
        await log(args.session, `scenario-${args.id}`, 'info', 'Connected to tools successfully', { repoPath: args.repoPath });
        // Branch creation is handled by system infrastructure before this agent is spawned.
        // Start LLM conversation with initial context
        const startTime = Date.now();
        // Initial conversation context
        const messages = [{
                role: 'assistant',
                content: getScenarioAgentPrompt({
                    branch: args.branch,
                    hypothesis: args.hypothesis,
                    context: args.context,
                    repoPath: args.repoPath
                })
            }, {
                role: 'user',
                content: `Error: ${args.error}
Context: ${args.context}
Language: ${args.language}
File: ${args.filePath}
Repo: ${args.repoPath}
Hypothesis: ${args.hypothesis}`
            }];
        // Check for observations (initial load)
        let observations = await getAgentObservations(args.repoPath, args.session, `scenario-${args.id}`);
        if (observations.length > 0) {
            messages.push(...observations.map((obs) => ({
                role: 'user',
                content: `Scientific observation: ${obs}`
            })));
        }
        // Read LLM configuration from environment variables
        const scenarioProvider = process.env.SCENARIO_HOST; // Read provider name from SCENARIO_HOST
        const scenarioModel = process.env.SCENARIO_MODEL;
        const openrouterApiKey = process.env.OPENROUTER_API_KEY; // Still needed if provider is 'openrouter'
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const openaiBaseUrl = process.env.OPENAI_BASE_URL;
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        // Create the config object to pass to callLlm
        const llmConfig = {
            provider: scenarioProvider, // Use the provider name from SCENARIO_HOST
            model: scenarioModel,
            apiKey: openrouterApiKey,
            openrouterApiKey: openrouterApiKey, // For OpenRouter
            openaiApiKey: openaiApiKey, // For OpenAI and compatible providers
            baseURL: openaiBaseUrl, // For OpenAI-compatible APIs
            geminiApiKey: geminiApiKey,
            anthropicApiKey: anthropicApiKey
        };
        await log(args.session, `scenario-${args.id}`, 'debug', 'Sending to LLM', { model: llmConfig.model, provider: llmConfig.provider, messages, repoPath: args.repoPath });
        // Add retry logic with exponential backoff for initial call
        let consecutiveFailures = 0;
        const MAX_RETRIES = 3;
        let replyText;
        while (consecutiveFailures < MAX_RETRIES) {
            replyText = await callLlm(messages, llmConfig);
            if (!replyText) {
                // Log the failure and increment counter
                consecutiveFailures++;
                await log(args.session, `scenario-${args.id}`, 'warn', `Received empty/malformed response from LLM on initial call (Failure ${consecutiveFailures}/${MAX_RETRIES})`, { provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                // Push a message indicating the failure to help LLM recover
                messages.push({
                    role: 'user',
                    content: `INTERNAL_NOTE: Initial LLM call failed to return valid content (Attempt ${consecutiveFailures}/${MAX_RETRIES}). Please try again.`
                });
                // Add exponential backoff delay
                const delay = 2000 * Math.pow(2, consecutiveFailures - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                // Try again if we haven't hit max retries
                if (consecutiveFailures < MAX_RETRIES) {
                    continue;
                }
                // Max retries hit - write report and exit
                const errorMsg = `Initial LLM call failed to return valid response after ${MAX_RETRIES} attempts`;
                await log(args.session, `scenario-${args.id}`, 'error', errorMsg, { provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                await writeReport(args.repoPath, args.session, args.id, errorMsg);
                console.log(errorMsg);
                process.exit(1);
            }
            // Valid response received
            messages.push({ role: 'assistant', content: replyText });
            await log(args.session, `scenario-${args.id}`, 'debug', 'Received response from LLM', { response: { content: replyText }, repoPath: args.repoPath });
            break; // Exit retry loop on success
        }
        // --- Main Investigation Loop ---
        while (true) {
            if (Date.now() - startTime > MAX_RUNTIME) {
                const timeoutMsg = 'Investigation exceeded maximum runtime';
                await log(args.session, `scenario-${args.id}`, 'warn', timeoutMsg, { repoPath: args.repoPath });
                await writeReport(args.repoPath, args.session, args.id, timeoutMsg);
                console.log(timeoutMsg);
                process.exit(1);
            }
            // Get the latest assistant response
            if (!replyText) {
                const errorMsg = 'Unexpected undefined response in main loop';
                await log(args.session, `scenario-${args.id}`, 'error', errorMsg, { repoPath: args.repoPath });
                await writeReport(args.repoPath, args.session, args.id, errorMsg);
                console.log(errorMsg);
                process.exit(1);
            }
            // --- Check for Report and Tool Calls ---
            const toolCalls = replyText.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];
            const reportMatch = replyText.match(/<report>\s*([\s\S]*?)<\/report>/i);
            let executeToolsThisTurn = false;
            let exitThisTurn = false;
            if (reportMatch && toolCalls.length > 0) {
                // LLM included both - prioritize executing tools, ignore report this turn
                messages.push({
                    role: 'user',
                    content: `Instructions conflict: You provided tool calls and a report in the same message. I will execute the tool calls now. Provide the report ONLY after analyzing the tool results in the next turn.`
                });
                executeToolsThisTurn = true; // Signal to execute tools below
                await log(args.session, `scenario-${args.id}`, 'warn', 'LLM provided tools and report simultaneously. Executing tools, ignoring report.', { repoPath: args.repoPath });
            }
            else if (reportMatch) {
                // Only report found - process it and exit
                const reportText = reportMatch[1].trim();
                await log(args.session, `scenario-${args.id}`, 'info', 'Report found. Writing report and exiting.', { repoPath: args.repoPath });
                await writeReport(args.repoPath, args.session, args.id, reportText);
                console.log(reportText); // Print report to stdout for mother agent
                exitThisTurn = true; // Signal to exit loop cleanly
            }
            else if (toolCalls.length > 0) {
                // Only tool calls found - execute them
                executeToolsThisTurn = true; // Signal to execute tools below
                await log(args.session, `scenario-${args.id}`, 'debug', `Found ${toolCalls.length} tool calls to execute.`, { repoPath: args.repoPath });
            }
            // If neither tools nor report found, the loop continues to the next LLM call
            // Exit now if a report-only response was processed
            if (exitThisTurn) {
                process.exit(0);
            }
            // --- Execute Tools if Flagged ---
            if (executeToolsThisTurn) {
                const parsedCalls = toolCalls.map((tc) => {
                    try {
                        const serverNameMatch = tc.match(/<server_name>(.*?)<\/server_name>/);
                        if (!serverNameMatch || !serverNameMatch[1])
                            throw new Error('Missing server_name');
                        const serverName = serverNameMatch[1];
                        const server = serverName === 'git-mcp' ? gitClient : filesystemClient; // Select client based on name
                        if (!server)
                            throw new Error(`Invalid server_name: ${serverName}`);
                        const toolMatch = tc.match(/<tool_name>(.*?)<\/tool_name>/);
                        if (!toolMatch || !toolMatch[1])
                            throw new Error('Missing tool_name');
                        const tool = toolMatch[1];
                        const argsMatch = tc.match(/<arguments>(.*?)<\/arguments>/s);
                        if (!argsMatch || !argsMatch[1])
                            throw new Error('Missing arguments');
                        const args = JSON.parse(argsMatch[1]);
                        return { server, tool, args };
                    }
                    catch (err) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        log(args.session, `scenario-${args.id}`, 'error', `Failed to parse tool call: ${errorMsg}`, { toolCall: tc, repoPath: args.repoPath });
                        return { error: errorMsg }; // Return error object for specific call
                    }
                });
                // Process each parsed call - add results or errors back to messages
                let toolCallFailed = false;
                for (const parsed of parsedCalls) {
                    if ('error' in parsed) {
                        messages.push({
                            role: 'user',
                            content: `Tool call parsing failed: ${parsed.error}`
                        });
                        toolCallFailed = true; // Mark failure, but continue processing other calls if needed, or let LLM handle it next turn
                        continue; // Skip execution for this malformed call
                    }
                    // Prevent disallowed tools
                    if (parsed.tool === 'git_create_branch') {
                        messages.push({
                            role: 'user',
                            content: 'Error: Tool call `git_create_branch` is not allowed. The branch was already created by the mother agent.'
                        });
                        await log(args.session, `scenario-${args.id}`, 'warn', `Attempted disallowed tool call: ${parsed.tool}`, { repoPath: args.repoPath });
                        continue; // Skip this specific call
                    }
                    try {
                        await log(args.session, `scenario-${args.id}`, 'debug', `Executing tool: ${parsed.tool}`, { args: parsed.args, repoPath: args.repoPath });
                        const result = await parsed.server.callTool({ name: parsed.tool, arguments: parsed.args });
                        messages.push({
                            role: 'user',
                            content: JSON.stringify(result) // Tool results are added as user messages
                        });
                        await log(args.session, `scenario-${args.id}`, 'debug', `Tool result for ${parsed.tool}`, { result: result, repoPath: args.repoPath });
                    }
                    catch (toolErr) {
                        const errorMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
                        messages.push({
                            role: 'user',
                            content: `Tool call failed for '${parsed.tool}': ${errorMsg}`
                        });
                        await log(args.session, `scenario-${args.id}`, 'error', `Tool call execution failed: ${parsed.tool}`, { error: errorMsg, repoPath: args.repoPath });
                        toolCallFailed = true; // Mark failure
                    }
                }
                // Decide if we should immediately ask LLM again after tool failure, or let the loop naturally continue.
                // Current logic lets loop continue, LLM will see the error messages.
            }
            // --- Check for New Observations ---
            const newObservations = await getAgentObservations(args.repoPath, args.session, `scenario-${args.id}`);
            if (newObservations.length > observations.length) {
                const latestObservations = newObservations.slice(observations.length);
                messages.push(...latestObservations.map((obs) => ({
                    role: 'user',
                    content: `Scientific observation: ${obs}`
                })));
                observations = newObservations; // Update the baseline observation list
                await log(args.session, `scenario-${args.id}`, 'debug', `Added ${latestObservations.length} new observations to context.`, { repoPath: args.repoPath });
            }
            // --- Make Next LLM Call ---
            await log(args.session, `scenario-${args.id}`, 'debug', `Sending message history (${messages.length} items) to LLM`, { model: llmConfig.model, provider: llmConfig.provider, repoPath: args.repoPath });
            // Add retry logic with exponential backoff
            let consecutiveFailures = 0;
            const MAX_RETRIES = 3;
            while (consecutiveFailures < MAX_RETRIES) {
                replyText = await callLlm(messages, llmConfig);
                if (!replyText) {
                    // Log the failure and increment counter
                    consecutiveFailures++;
                    await log(args.session, `scenario-${args.id}`, 'warn', `Received empty/malformed response from LLM (Failure ${consecutiveFailures}/${MAX_RETRIES})`, { provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                    // Push a message indicating the failure to help LLM recover
                    messages.push({
                        role: 'user',
                        content: `INTERNAL_NOTE: Previous LLM call failed to return valid content (Attempt ${consecutiveFailures}/${MAX_RETRIES}). Please try again.`
                    });
                    // Add exponential backoff delay
                    const delay = 2000 * Math.pow(2, consecutiveFailures - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    // Try again if we haven't hit max retries
                    if (consecutiveFailures < MAX_RETRIES) {
                        continue;
                    }
                    // Max retries hit - write report and exit
                    const errorMsg = `LLM failed to return valid response after ${MAX_RETRIES} attempts`;
                    await log(args.session, `scenario-${args.id}`, 'error', errorMsg, { provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                    await writeReport(args.repoPath, args.session, args.id, errorMsg);
                    console.log(errorMsg);
                    process.exit(1);
                }
                // Valid response received
                messages.push({ role: 'assistant', content: replyText });
                await log(args.session, `scenario-${args.id}`, 'debug', 'Received response from LLM', { responseLength: replyText.length, provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                break; // Exit retry loop on success
            }
            // Small delay before next iteration (optional)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    catch (error) {
        // Catch unexpected errors during setup or within the loop if not handled
        const errorText = error instanceof Error ? `${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}` : String(error);
        await log(args.session, `scenario-${args.id}`, 'error', `Unhandled scenario error: ${errorText}`, { repoPath: args.repoPath });
        await writeReport(args.repoPath, args.session, args.id, `SCENARIO FAILED UNEXPECTEDLY: ${errorText}`);
        console.error(`SCENARIO FAILED UNEXPECTEDLY: ${errorText}`); // Log error to stderr as well
        process.exit(1);
    }
}
// --- Script Entry Point ---
try {
    const args = parseArgs(process.argv.slice(2)); // Pass relevant args, skipping node path and script path
    runScenarioAgent(args); // No await here, let the async function run
}
catch (err) {
    // Handle argument parsing errors
    const errorText = err instanceof Error ? err.message : String(err);
    console.error(`Scenario agent failed to start due to arg parsing error: ${errorText}`);
    // Attempt to log if possible, though session info might be missing
    // log(args.session || 'unknown', `scenario-${args.id || 'unknown'}`, 'error', `Arg parsing failed: ${errorText}`, {}).catch();
    process.exit(1);
}
// Optional: Add unhandled rejection/exception handlers for more robustness
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Log this? Might be hard without session context.
    process.exit(1); // Exit on unhandled promise rejection
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Log this?
    process.exit(1); // Exit on uncaught exception
});
