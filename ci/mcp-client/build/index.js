// ci/mcp-client/index.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from 'path';
dotenv.config();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CI_LLM_MODEL = process.env.CI_LLM_MODEL || "deepseek/deepseek-chat"; // Keep for optional analysis
if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
}
const openrouterClient = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});
class MinimalMCPClient {
    mcp;
    transport = null;
    connected = false; // Track connection status internally
    constructor() {
        this.mcp = new Client({ name: "deebo-ci-client", version: "1.0.0" });
    }
    async connectToServer(deeboServerScriptPath) {
        if (this.connected) {
            console.log("CI Client already connected.");
            return;
        }
        if (!path.isAbsolute(deeboServerScriptPath)) {
            throw new Error(`Server script path must be absolute: ${deeboServerScriptPath}`);
        }
        try {
            // Ensure all required environment variables are present
            const requiredEnvVars = [
                'NODE_ENV',
                'USE_MEMORY_BANK',
                'MOTHER_HOST',
                'MOTHER_MODEL',
                'SCENARIO_HOST',
                'SCENARIO_MODEL',
                'OPENROUTER_API_KEY'
            ];
            for (const envVar of requiredEnvVars) {
                if (!process.env[envVar]) {
                    throw new Error(`Required environment variable ${envVar} is not set`);
                }
            }
            this.transport = new StdioClientTransport({
                command: process.execPath,
                args: [
                    "--experimental-specifier-resolution=node",
                    "--experimental-modules",
                    "--max-old-space-size=4096",
                    deeboServerScriptPath
                ],
                env: {
                    ...process.env, // Inherit all environment variables from parent process
                    // Explicitly set critical variables to ensure they're passed correctly
                    NODE_ENV: process.env.NODE_ENV,
                    USE_MEMORY_BANK: process.env.USE_MEMORY_BANK,
                    MOTHER_HOST: process.env.MOTHER_HOST,
                    MOTHER_MODEL: process.env.MOTHER_MODEL,
                    SCENARIO_HOST: process.env.SCENARIO_HOST,
                    SCENARIO_MODEL: process.env.SCENARIO_MODEL,
                    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY
                }
            });
            const connectPromise = this.mcp.connect(this.transport);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timed out after 15 seconds")), 15000));
            await Promise.race([connectPromise, timeoutPromise]);
            this.connected = true; // Set connected flag
            console.log("CI Client Connected to Deebo Server");
        }
        catch (e) {
            this.connected = false; // Ensure flag is false on error
            console.error("CI Client Failed to connect to MCP server: ", e);
            throw e;
        }
    }
    ensureConnected() {
        if (!this.connected || !this.transport) {
            throw new Error("Client is not connected to the Deebo server.");
        }
    }
    async forceStartSession(args) {
        this.ensureConnected(); // Check connection status
        console.log(`Attempting to start session with args: ${JSON.stringify(args)}`);
        // Assuming callTool returns the 'result' part of the JSON-RPC response directly
        const result = await this.mcp.callTool({ name: "start", arguments: args }); // Use 'as any' for now to bypass strict type checking on result
        // Access content directly from the assumed 'result' payload
        const text = result?.content?.[0]?.text ?? "";
        if (!text) {
            console.error("Raw start response object:", JSON.stringify(result, null, 2));
            throw new Error(`Received empty or unexpected text content from 'start' tool.`);
        }
        const match = text.match(/Session (session-[0-9]+) started!/);
        if (!match || !match[1]) {
            console.error("Raw start response text:", text);
            throw new Error(`Failed to parse session ID from Deebo start output.`);
        }
        const sessionId = match[1];
        console.log(`✅ Started session: ${sessionId}`);
        return sessionId;
    }
    async forceCheckSession(sessionId, maxRetries = 10) {
        this.ensureConnected(); // Check connection status
        const baseDelay = 1000; // Start with 1 second
        const maxDelay = 300000; // Cap at 5 minutes
        console.log(`Starting check loop for session ${sessionId} (Max ${maxRetries} attempts with exponential backoff)...`);
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Calculate delay with exponential backoff and jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
            const jitter = delay * 0.1 * Math.random(); // Add 0-10% jitter
            const finalDelay = Math.floor(delay + jitter);
            console.log(`--- Check Attempt ${attempt}/${maxRetries} for ${sessionId} (delay: ${finalDelay}ms) ---`);
            let result; // Use 'any' type for result
            let text = "";
            try {
                result = await this.mcp.callTool({ name: "check", arguments: { sessionId } }); // Use 'as any'
                // Access content directly from the assumed 'result' payload
                text = result?.content?.[0]?.text ?? "";
                if (!text) {
                    console.warn(`Attempt ${attempt}: Received empty or unexpected text content from 'check' tool.`);
                    console.warn("Raw check response object:", JSON.stringify(result, null, 2));
                }
                else {
                    console.log(`Check attempt ${attempt} response snippet:\n${text.substring(0, 300)}...\n`);
                }
            }
            catch (checkError) {
                console.error(`Error during check attempt ${attempt}:`, checkError);
                text = `Error during check: ${checkError instanceof Error ? checkError.message : String(checkError)}`;
            }
            // Check for terminal statuses
            if (text.includes("Overall Status: completed") || text.includes("Overall Status: failed") || text.includes("Overall Status: cancelled")) {
                console.log(`✅ Session ${sessionId} reached terminal status on attempt ${attempt}.`);
                return text;
            }
            // Check for session not found
            if (text.includes(`Session ${sessionId} not found`)) {
                console.error(`Error: Session ${sessionId} reported as not found during check loop.`);
                throw new Error(`Session ${sessionId} not found during check.`);
            }
            // If not the last attempt, wait with exponential backoff
            if (attempt < maxRetries) {
                console.log(`Session not finished, waiting ${finalDelay}ms before next check...`);
                await new Promise((res) => setTimeout(res, finalDelay));
            }
            else {
                console.error(`Session ${sessionId} did not finish after ${maxRetries} attempts.`);
                console.error(`Final check response text:\n${text}`);
                throw new Error(`Session ${sessionId} did not finish after ${maxRetries} attempts.`);
            }
        }
        throw new Error(`Unexpected exit from check loop for session ${sessionId}.`);
    }
    // Optional: AI analysis function
    async analyzeDeeboOutput(checkOutputText) {
        // ... (implementation remains the same) ...
        try {
            const prompt = `You are a CI assistant analyzing the final 'check' output of a Deebo debugging session. Based SOLELY on the following text, does this indicate a plausible final state for the session (completed, failed, cancelled)? Ignore transient errors mentioned in the output if a final status is present. Answer YES or NO and provide a brief one-sentence justification.

Output to analyze:
---
${checkOutputText || "[No output provided]"}
---

Analysis (YES/NO + Justification):`;
            const completion = await openrouterClient.chat.completions.create({
                model: CI_LLM_MODEL,
                messages: [{ role: "user", content: prompt }],
                max_tokens: 100,
                temperature: 0.1,
            });
            return completion.choices[0]?.message?.content?.trim() ?? "AI analysis failed.";
        }
        catch (error) {
            console.error("Error during AI analysis:", error);
            return `AI analysis step failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async cleanup() {
        // Use internal flag instead of relying on potentially non-existent mcp.isConnected
        if (this.connected) {
            try {
                await this.mcp.close();
                this.connected = false;
                console.log("CI Client Disconnected from Deebo Server.");
            }
            catch (closeError) {
                console.error("Error during client cleanup/close:", closeError);
                this.connected = false; // Ensure flag is set even if close fails
            }
        }
        else {
            // console.log("CI Client already disconnected or never connected.")
        }
    }
}
// --- Main Execution Logic ---
async function main() {
    // Args: <path_to_deebo_build_index.js> <repo_fixture_path_abs>
    if (process.argv.length < 4) {
        console.error("Usage: node ci/mcp-client/build/index.js <path_to_deebo_build_index.js> <repo_fixture_path_abs>");
        process.exit(1);
    }
    const deeboServerScriptPath = path.resolve(process.argv[2]);
    const repoFixturePathAbs = path.resolve(process.argv[3]);
    const startArgs = {
        "error": "Race condition in task cache management",
        "repoPath": repoFixturePathAbs,
        "language": "typescript",
        "filePath": path.join(repoFixturePathAbs, "src", "services", "taskService.ts"),
        "context": "// Cache the result - BUG: This is causing a race condition with invalidateTaskCache\n  setCachedTasks(cacheKey, paginatedResponse)\n    .catch(err => logger.error('Cache setting error:', err));\n\n  return paginatedResponse;"
    };
    const client = new MinimalMCPClient();
    let exitCode = 0;
    let sessionId = "";
    let finalCheckOutput = "";
    try {
        console.log("--- Connecting Client to Server ---");
        await client.connectToServer(deeboServerScriptPath);
        console.log("--- Forcing Start Session ---");
        sessionId = await client.forceStartSession(startArgs);
        console.log("--- Forcing Check Session Loop ---");
        finalCheckOutput = await client.forceCheckSession(sessionId);
        // Optional AI Analysis
        if (finalCheckOutput) {
            console.log("\n--- Requesting Optional AI Analysis of Final Check Output ---");
            const analysisResult = await client.analyzeDeeboOutput(finalCheckOutput);
            console.log(analysisResult);
        }
        else {
            console.log("Skipping AI analysis as final check output was empty/error.");
        }
        console.log("--- Client Script Completed Successfully ---");
    }
    catch (error) {
        console.error("--- Client Script Failed ---");
        // Error should have been logged by the method that threw it
        exitCode = 1;
    }
    finally {
        await client.cleanup();
        if (sessionId) {
            console.log(`FINAL_SESSION_ID_MARKER:${sessionId}`);
        }
        process.exit(exitCode);
    }
}
main();
