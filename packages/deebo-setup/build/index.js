#!/usr/bin/env node
import { homedir, platform as osPlatform } from 'os';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmHostSchema } from './types.js';
import { checkPrerequisites, findConfigPaths, setupDeeboDirectory, writeEnvFile, updateMcpConfig } from './utils.js';
async function main() {
    // Check if this is a ping command
    if (process.argv.length > 2 && process.argv[2] === 'ping') {
        try {
            console.log(chalk.blue('Pinging Deebo installation tracker...'));
            // Simple ping with no extra dependencies or complexity
            const response = await fetch('https://deebo-active-counter.ramnag2003.workers.dev/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash: `user-${Date.now()}` })
            });
            if (response.ok) {
                console.log(chalk.green('✓ Successfully pinged Deebo installation tracker'));
            }
            else {
                console.log(chalk.yellow('⚠ Failed to ping installation tracker'));
            }
        }
        catch (error) {
            console.log(chalk.yellow('⚠ Could not reach installation tracker'));
        }
        return;
    }
    try {
        // Check prerequisites
        await checkPrerequisites();
        // Find config paths
        const configPaths = await findConfigPaths();
        // Get Mother agent configuration
        // Default models for mother agent
        const defaultModels = {
            openrouter: 'anthropic/claude-3.5-sonnet',
            openai: 'gpt-4o',
            anthropic: 'claude-3-5-sonnet-20241022',
            gemini: 'gemini-2.5-pro-preview-03-25'
        };
        // Default models for scenario agents
        const scenarioDefaultModels = {
            openrouter: 'deepseek/deepseek-chat',
            openai: 'gpt-4o',
            anthropic: 'claude-3-5-sonnet-20241022',
            gemini: 'gemini-2.5-pro-preview-03-25'
        };
        // Get Mother agent configuration
        const { motherHost } = await inquirer.prompt([{
                type: 'list',
                name: 'motherHost',
                message: 'Choose LLM host for Mother agent:',
                choices: Object.keys(defaultModels)
            }]);
        const parsedMotherHost = LlmHostSchema.parse(motherHost);
        const { motherModel } = await inquirer.prompt([{
                type: 'input',
                name: 'motherModel',
                message: `Enter model for Mother agent (press Enter for ${defaultModels[parsedMotherHost]}):`,
                default: defaultModels[parsedMotherHost]
            }]);
        // Get Scenario agent configuration
        const { scenarioHost } = await inquirer.prompt([{
                type: 'list',
                name: 'scenarioHost',
                message: 'Choose LLM host for Scenario agents (press Enter to use same as Mother):',
                choices: Object.keys(defaultModels),
                default: parsedMotherHost
            }]);
        const parsedScenarioHost = LlmHostSchema.parse(scenarioHost);
        const { scenarioModel } = await inquirer.prompt([{
                type: 'input',
                name: 'scenarioModel',
                message: `Enter model for Scenario agents (press Enter for ${scenarioDefaultModels[parsedScenarioHost]}):`,
                default: scenarioDefaultModels[parsedScenarioHost]
            }]);
        // Get API key
        const keyPrompt = parsedScenarioHost === parsedMotherHost
            ? `Enter your ${motherHost.toUpperCase()}_API_KEY:`
            : `Enter your ${motherHost.toUpperCase()}_API_KEY for Mother agent:`;
        const { motherApiKey } = await inquirer.prompt([{
                type: 'password',
                name: 'motherApiKey',
                message: keyPrompt
            }]);
        // Show mother API key preview
        console.log(chalk.dim(`Mother API key preview: ${motherApiKey.substring(0, 8)}...`));
        const { confirmMotherKey } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirmMotherKey',
                message: 'Is this Mother API key correct?',
                default: true
            }]);
        if (!confirmMotherKey) {
            throw new Error('Mother API key confirmation failed. Please try again.');
        }
        // Get Scenario agent API key if using different host
        let scenarioApiKey = motherApiKey;
        if (parsedScenarioHost !== parsedMotherHost) {
            const { useNewKey } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'useNewKey',
                    message: `Scenario agent uses different host (${scenarioHost}). Use different API key?`,
                    default: true
                }]);
            if (useNewKey) {
                const { key } = await inquirer.prompt([{
                        type: 'password',
                        name: 'key',
                        message: `Enter your ${scenarioHost.toUpperCase()}_API_KEY for Scenario agents:`
                    }]);
                // Show scenario API key preview
                console.log(chalk.dim(`Scenario API key preview: ${key.substring(0, 8)}...`));
                const { confirmKey } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'confirmKey',
                        message: 'Is this Scenario API key correct?',
                        default: true
                    }]);
                if (!confirmKey) {
                    throw new Error('Scenario API key confirmation failed. Please try again.');
                }
                scenarioApiKey = key;
            }
        }
        // Setup paths
        const home = homedir();
        const deeboPath = join(home, '.deebo');
        const envPath = join(deeboPath, '.env');
        // Create config object with cursorConfigPath
        const config = {
            deeboPath,
            envPath,
            motherHost: parsedMotherHost,
            motherModel,
            scenarioHost: parsedScenarioHost,
            scenarioModel,
            motherApiKey,
            scenarioApiKey,
            clineConfigPath: configPaths.cline,
            claudeConfigPath: configPaths.claude,
            vscodePath: configPaths.vscode
        };
        // Ask about Cursor configuration
        const { useCursorGlobal } = await inquirer.prompt([{
                type: 'confirm',
                name: 'useCursorGlobal',
                message: 'Configure Cursor globally (recommended for single-user systems)?',
                default: true
            }]);
        if (!useCursorGlobal) {
            console.log(chalk.blue('\nNote: Project-specific configuration will only apply to the selected directory.'));
        }
        if (useCursorGlobal) {
            // Use global Cursor config path
            const cursorPath = osPlatform() === 'win32'
                ? join(process.env.APPDATA || '', '.cursor')
                : join(home, '.cursor');
            config.cursorConfigPath = join(cursorPath, 'mcp.json');
        }
        else {
            // Let user select a directory for project-specific config
            const { projectPath } = await inquirer.prompt([{
                    type: 'input',
                    name: 'projectPath',
                    message: 'Enter path to project directory:',
                    default: process.cwd()
                }]);
            config.cursorConfigPath = join(projectPath, '.cursor', 'mcp.json');
        }
        console.log(chalk.blue('\nDetected installations:'));
        if (configPaths.cline)
            console.log('- Cline');
        if (configPaths.claude)
            console.log('- Claude Desktop');
        // Check if VS Code is actually installed
        try {
            const { execSync } = await import('child_process');
            try {
                execSync('code --version', { stdio: 'ignore' });
                console.log('- VS Code');
            }
            catch {
                // VS Code not found
            }
        }
        catch {
            // Command execution failed
        }
        // Check if Cursor is actually installed
        try {
            const { execSync } = await import('child_process');
            try {
                execSync('cursor --version', { stdio: 'ignore' });
                console.log('- Cursor');
            }
            catch {
                // Cursor not found
            }
        }
        catch {
            // Command execution failed
        }
        // Setup Deebo
        await setupDeeboDirectory(config);
        await writeEnvFile(config);
        await updateMcpConfig(config);
        console.log(chalk.green('\n✔ Deebo installation complete!'));
        console.log(chalk.blue('\nNext steps:'));
        console.log('1. Restart your MCP client');
        console.log('2. Run npx deebo-doctor to verify the installation (use --verbose for more details)');
    }
    catch (error) {
        console.error(chalk.red('\n✖ Installation failed:'));
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
main();
