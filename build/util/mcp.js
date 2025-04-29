// src/util/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as path from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';
// Map to track active connections
const activeConnections = new Map();
export async function connectMcpTool(name, toolName, sessionId, repoPath) {
    const rawConfig = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
    const def = rawConfig.tools[toolName];
    const memoryPath = join(DEEBO_ROOT, 'memory-bank', getProjectId(repoPath));
    const memoryRoot = join(DEEBO_ROOT, 'memory-bank');
    /* --- WINDOWS-ONLY PATCH ----------------------------------------- */
    if (process.platform === "win32" && toolName === "desktopCommander") {
        // Use the real *.cmd so the process owns stdin/stdout
        const cmdPath = path.join(process.env.DEEBO_NPM_BIN, "desktop-commander.cmd");
        def.command = cmdPath;
        def.args = ["serve"]; // same behaviour as 'npx … serve'
    }
    /* ---------------------------------------------------------------- */
    // Substitute npx/uvx paths directly in the command
    let command = def.command
        .replace(/{npxPath}/g, process.env.DEEBO_NPX_PATH)
        .replace(/{uvxPath}/g, process.env.DEEBO_UVX_PATH);
    // Replace placeholders in all args
    let args = def.args.map((arg) => arg
        .replace(/{repoPath}/g, repoPath)
        .replace(/{memoryPath}/g, memoryPath)
        .replace(/{memoryRoot}/g, memoryRoot));
    // Handle environment variable substitutions
    if (def.env) {
        for (const [key, value] of Object.entries(def.env)) {
            if (typeof value === 'string') {
                def.env[key] = value
                    .replace(/{ripgrepPath}/g, process.env.RIPGREP_PATH)
                    .replace(/{repoPath}/g, repoPath)
                    .replace(/{memoryPath}/g, memoryPath)
                    .replace(/{memoryRoot}/g, memoryRoot);
            }
        }
    }
    // No shell: spawn the .cmd/binary directly on all platforms
    const options = {};
    const transport = new StdioClientTransport({
        command,
        args,
        ...options,
        env: {
            ...process.env, // Inherit all environment variables
            // Explicitly set critical variables
            NODE_ENV: process.env.NODE_ENV,
            USE_MEMORY_BANK: process.env.USE_MEMORY_BANK,
            MOTHER_HOST: process.env.MOTHER_HOST,
            MOTHER_MODEL: process.env.MOTHER_MODEL,
            SCENARIO_HOST: process.env.SCENARIO_HOST,
            SCENARIO_MODEL: process.env.SCENARIO_MODEL,
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY
        }
    });
    const client = new Client({ name, version: '1.0.0' }, { capabilities: { tools: true } });
    await client.connect(transport);
    return client;
}
export async function connectRequiredTools(agentName, sessionId, repoPath) {
    const [gitClient, filesystemClient] = await Promise.all([
        connectMcpTool(`${agentName}-git`, 'git-mcp', sessionId, repoPath),
        // Switch from "filesystem-mcp" to "desktop-commander"
        connectMcpTool(`${agentName}-desktop-commander`, 'desktopCommander', sessionId, repoPath)
    ]);
    return { gitClient, filesystemClient };
}
