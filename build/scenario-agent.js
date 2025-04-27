import { log } from './util/logger.js';
import { connectRequiredTools } from './util/mcp.js';
import { writeReport } from './util/reports.js'; // System infrastructure for capturing output
import { getAgentObservations } from './util/observations.js';
import { callLlm, getScenarioAgentPrompt } from './util/agent-utils.js'; // Updated import
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
        // Check for observations
        const observations = await getAgentObservations(args.repoPath, args.session, `scenario-${args.id}`);
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
        let replyText = await callLlm(messages, llmConfig);
        if (!replyText) {
            await log(args.session, `scenario-${args.id}`, 'warn', 'Received empty/malformed response from LLM', { repoPath: args.repoPath });
            // Exit if the first call fails, as there's no response to process
            await writeReport(args.repoPath, args.session, args.id, 'Initial LLM call returned empty response.');
            console.log('Initial LLM call returned empty response.');
            process.exit(1);
        }
        else {
            messages.push({ role: 'assistant', content: replyText });
            await log(args.session, `scenario-${args.id}`, 'debug', 'Received from LLM', { response: { content: replyText }, repoPath: args.repoPath });
        }
        while (true) {
            if (Date.now() - startTime > MAX_RUNTIME) {
                await writeReport(args.repoPath, args.session, args.id, 'Investigation exceeded maximum runtime');
                console.log('Investigation exceeded maximum runtime');
                process.exit(1);
            }
            // The assistant's response (replyText) is already added to messages history
            const responseText = replyText;
            // Check for report FIRST - if found, write it and exit immediately
            // No need to process tool calls if we have a report since they would only be used in the next turn
            const reportMatch = responseText.match(/<report>\s*([\s\S]*?)<\/report>/i);
            if (reportMatch) {
                const reportText = reportMatch[1].trim();
                await writeReport(args.repoPath, args.session, args.id, reportText);
                console.log(reportText);
                process.exit(0);
            }
            // Only process tool calls if we don't have a report
            const toolCalls = responseText.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];
            const parsedCalls = toolCalls.map((tc) => {
                try {
                    const server = tc.includes('git-mcp') ? gitClient : filesystemClient;
                    const toolMatch = tc.match(/<tool_name>(.*?)<\/tool_name>/);
                    if (!toolMatch || !toolMatch[1])
                        throw new Error('Missing tool');
                    const tool = toolMatch[1];
                    const argsMatch = tc.match(/<arguments>(.*?)<\/arguments>/s);
                    if (!argsMatch || !argsMatch[1])
                        throw new Error('Missing arguments');
                    const args = JSON.parse(argsMatch[1]);
                    return { server, tool, args };
                }
                catch (err) {
                    return { error: err instanceof Error ? err.message : String(err) };
                }
            });
            // Abort if *any* call fails to parse
            const invalid = parsedCalls.find(p => 'error' in p);
            if (invalid) {
                messages.push({
                    role: 'user',
                    content: `One of your tool calls was malformed and none were run. Error: ${invalid.error}`
                });
                // No need to clear assistantResponse here, just continue the loop
                continue;
            }
            const validCalls = parsedCalls;
            // Only now, execute each one
            for (const { server, tool, args } of validCalls) {
                if (tool === 'git_create_branch') {
                    messages.push({
                        role: 'user',
                        content: 'git_create_branch is not allowed — the branch was already created by the mother agent.'
                    });
                    continue;
                }
                try {
                    const result = await server.callTool({ name: tool, arguments: args });
                    messages.push({
                        role: 'user',
                        content: JSON.stringify(result)
                    });
                }
                catch (toolErr) {
                    messages.push({
                        role: 'user',
                        content: `Tool call failed: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`
                    });
                }
            }
            // Continue the conversation
            // Check for new observations before each Claude call
            const newObservations = await getAgentObservations(args.repoPath, args.session, `scenario-${args.id}`);
            if (newObservations.length > observations.length) {
                const latestObservations = newObservations.slice(observations.length);
                messages.push(...latestObservations.map((obs) => ({
                    role: 'user', // No 'as const' needed here
                    content: `Scientific observation: ${obs}`
                })));
                // Update the baseline observations count after processing
                // This was the bug in the previous attempt - it needs to be updated *outside* the if block
                // observations = newObservations; // Let's remove this line as it wasn't in the original and might be incorrect logic introduced by me. The original logic only checked length difference.
            }
            // Make next LLM call
            await log(args.session, `scenario-${args.id}`, 'debug', 'Sending to LLM', { model: llmConfig.model, provider: llmConfig.provider, messages, repoPath: args.repoPath });
            replyText = await callLlm(messages, llmConfig); // Update replyText
            if (!replyText) {
                await log(args.session, `scenario-${args.id}`, 'warn', 'Received empty/malformed response from LLM', { provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
                // If the LLM fails mid-conversation, write a report and exit
                await writeReport(args.repoPath, args.session, args.id, 'LLM returned empty response mid-investigation.');
                console.log('LLM returned empty response mid-investigation.');
                process.exit(1);
            }
            else {
                messages.push({ role: 'assistant', content: replyText });
                await log(args.session, `scenario-${args.id}`, 'debug', 'Received from LLM', { response: { content: replyText }, provider: llmConfig.provider, model: llmConfig.model, repoPath: args.repoPath });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        await writeReport(args.repoPath, args.session, args.id, `SCENARIO ERROR: ${errorText}`);
        console.log(`SCENARIO ERROR: ${errorText}`);
        process.exit(1);
    }
}
// Parse args and run
const args = parseArgs(process.argv);
runScenarioAgent(args).catch(err => {
    const errorText = err instanceof Error ? err.message : String(err);
    console.log(`SCENARIO ERROR: ${errorText}`);
    process.exit(1);
});
