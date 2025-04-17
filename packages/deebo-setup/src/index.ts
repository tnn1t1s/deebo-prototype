#!/usr/bin/env node
import { homedir } from 'os';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmHostSchema } from './types.js';
import {
  checkPrerequisites,
  findConfigPaths,
  setupDeeboDirectory,
  writeEnvFile,
  updateMcpConfig
} from './utils.js';

async function main() {
  try {
    // Check prerequisites
    await checkPrerequisites();

    // Find config paths
    const configPaths = await findConfigPaths();

    // Get LLM host preference
    const { llmHost } = await inquirer.prompt([{
      type: 'list',
      name: 'llmHost',
      message: 'Choose your preferred LLM host:',
      choices: ['openrouter', 'anthropic', 'gemini']
    }]);

    // Validate LLM host
    const parsedHost = LlmHostSchema.parse(llmHost);

    // Get API key
    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${llmHost.toUpperCase()}_API_KEY:`
    }]);

    // Setup paths
    const home = homedir();
    const deeboPath = join(home, '.deebo');
    const envPath = join(deeboPath, '.env');

    // Create config object
    const config = {
      deeboPath,
      envPath,
      llmHost: parsedHost,
      apiKey,
      clineConfigPath: configPaths.cline,
      claudeConfigPath: configPaths.claude
    };

    // Setup Deebo
    await setupDeeboDirectory(config);
    await writeEnvFile(config);
    await updateMcpConfig(config);

    console.log(chalk.green('\n✔ Deebo installation complete!'));
    console.log(chalk.blue('\nNext steps:'));
    console.log('1. Restart your MCP client (Cline/Claude Desktop)');
    console.log('2. Run npx deebo-doctor to verify the installation');
    
  } catch (error) {
    console.error(chalk.red('\n✖ Installation failed:'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
