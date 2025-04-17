import { homedir } from 'os';
import { join } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { simpleGit as createGit } from 'simple-git';
import inquirer from 'inquirer';
export const DEEBO_REPO = 'https://github.com/snagasuri/deebo-prototype.git';
export async function checkPrerequisites() {
    // Check Node version
    const nodeVersion = process.version;
    if (nodeVersion.startsWith('v18') || nodeVersion.startsWith('v20') || nodeVersion.startsWith('v22')) {
        console.log(chalk.green('✔ Node version:', nodeVersion));
    }
    else {
        throw new Error('Node.js v18+ is required');
    }
    // Check git
    try {
        const git = createGit();
        await git.version();
        console.log(chalk.green('✔ git found'));
    }
    catch {
        throw new Error('git is required but not found');
    }
}
export async function findConfigPaths() {
    const home = homedir();
    const isWindows = process.platform === 'win32';
    const paths = isWindows ? {
        cline: join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
        claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json')
    } : {
        cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
        claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
    };
    const result = {};
    try {
        await access(paths.cline);
        result.cline = paths.cline;
        console.log(chalk.green('✔ Cline config found'));
    }
    catch { }
    try {
        await access(paths.claude);
        result.claude = paths.claude;
        console.log(chalk.green('✔ Claude Desktop config found'));
    }
    catch { }
    if (!result.cline && !result.claude) {
        throw new Error('No Cline or Claude Desktop configuration found');
    }
    return result;
}
export async function setupDeeboDirectory(config) {
    let needsCleanup = false;
    try {
        await access(config.deeboPath);
        // Directory exists, ask for confirmation
        const { confirm } = await inquirer.prompt([{
                type: 'confirm',
                name: 'confirm',
                message: 'Deebo is already installed. Update to latest version?',
                default: true
            }]);
        if (!confirm) {
            console.log(chalk.yellow('Installation cancelled.'));
            process.exit(0);
        }
        needsCleanup = true;
    }
    catch (err) {
        // Directory doesn't exist, create it
        await mkdir(config.deeboPath, { recursive: true });
    }
    // Clean up if needed
    if (needsCleanup) {
        const { rm } = await import('fs/promises');
        await rm(config.deeboPath, { recursive: true, force: true });
        console.log(chalk.green('✔ Removed existing installation'));
        await mkdir(config.deeboPath, { recursive: true });
    }
    console.log(chalk.green('✔ Created Deebo directory'));
    // Clone repository
    const git = createGit();
    await git.clone(DEEBO_REPO, config.deeboPath);
    console.log(chalk.green('✔ Cloned Deebo repository'));
    // Install dependencies
    const { execSync } = await import('child_process');
    execSync('npm install', { cwd: config.deeboPath });
    console.log(chalk.green('✔ Installed dependencies'));
    // Build project
    execSync('npm run build', { cwd: config.deeboPath });
    console.log(chalk.green('✔ Built project'));
}
export async function writeEnvFile(config) {
    const envContent = `MOTHER_HOST=${config.llmHost}
MOTHER_MODEL=${getDefaultModel(config.llmHost)}
SCENARIO_HOST=${config.llmHost}
SCENARIO_MODEL=${getDefaultModel(config.llmHost)}
${getApiKeyEnvVar(config.llmHost)}=${config.apiKey}
USE_MEMORY_BANK=true
NODE_ENV=development`;
    await writeFile(config.envPath, envContent);
    console.log(chalk.green('✔ Created environment file'));
}
export async function updateMcpConfig(config) {
    const deeboConfig = {
        autoApprove: [],
        disabled: false,
        timeout: 30,
        command: 'node',
        args: [
            '--experimental-specifier-resolution=node',
            '--experimental-modules',
            '--max-old-space-size=4096',
            join(config.deeboPath, 'build/index.js')
        ],
        env: {
            NODE_ENV: 'development',
            USE_MEMORY_BANK: 'true',
            MOTHER_HOST: config.llmHost,
            MOTHER_MODEL: getDefaultModel(config.llmHost),
            SCENARIO_HOST: config.llmHost,
            SCENARIO_MODEL: getDefaultModel(config.llmHost),
            [getApiKeyEnvVar(config.llmHost)]: config.apiKey
        },
        transportType: 'stdio'
    };
    // Update Cline config if available
    if (config.clineConfigPath) {
        const clineConfig = JSON.parse(await readFile(config.clineConfigPath, 'utf8'));
        clineConfig.mcpServers.deebo = deeboConfig;
        await writeFile(config.clineConfigPath, JSON.stringify(clineConfig, null, 2));
        console.log(chalk.green('✔ Updated Cline configuration'));
    }
    // Update Claude config if available
    if (config.claudeConfigPath) {
        const claudeConfig = JSON.parse(await readFile(config.claudeConfigPath, 'utf8'));
        claudeConfig.mcpServers.deebo = deeboConfig;
        await writeFile(config.claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
        console.log(chalk.green('✔ Updated Claude Desktop configuration'));
    }
}
function getDefaultModel(host) {
    switch (host) {
        case 'openrouter':
            return 'anthropic/claude-3.5-sonnet';
        case 'anthropic':
            return 'claude-3-sonnet-20240229';
        case 'gemini':
            return 'gemini-1.5-pro';
        default:
            return 'anthropic/claude-3.5-sonnet';
    }
}
function getApiKeyEnvVar(host) {
    switch (host) {
        case 'openrouter':
            return 'OPENROUTER_API_KEY';
        case 'anthropic':
            return 'ANTHROPIC_API_KEY';
        case 'gemini':
            return 'GEMINI_API_KEY';
        default:
            return 'OPENROUTER_API_KEY';
    }
}
