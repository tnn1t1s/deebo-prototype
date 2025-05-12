import { homedir } from 'os';
import { join, dirname } from 'path';
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'; // Added copyFile
import { fileURLToPath } from 'url';
import chalk from 'chalk';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Configure the guide server in an MCP client's config
// Modified to accept guideServerScriptPath
async function configureClientGuide(configPath, guideServerScriptPath) {
    try {
        let config = { mcpServers: {} };
        try {
            config = JSON.parse(await readFile(configPath, 'utf8'));
        }
        catch {
            // File doesn't exist or is empty, use empty config
        }
        // Add guide server config without overwriting other servers
        config.mcpServers = {
            ...config.mcpServers,
            'deebo-guide': {
                autoApprove: [],
                disabled: false,
                timeout: 30,
                command: 'node',
                args: [
                    '--experimental-specifier-resolution=node',
                    '--experimental-modules',
                    '--es-module-specifier-resolution=node',
                    guideServerScriptPath // Use the passed persistent path
                ],
                env: {
                    "NODE_ENV": "development"
                },
                transportType: 'stdio'
            }
        };
        // Create parent directory if needed
        await mkdir(dirname(configPath), { recursive: true });
        // Write config file
        await writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✔ Added guide server to ${configPath}`));
    }
    catch (err) {
        console.log(chalk.yellow(`⚠ Could not configure guide server in ${configPath}`));
        console.log(chalk.dim(err instanceof Error ? err.message : String(err)));
    }
}
// Setup the guide server independently of main Deebo setup
export async function setupGuideServer() {
    try {
        const home = homedir();
        const deeboGuideUserDir = join(home, '.deebo-guide'); // Reverted to .deebo-guide
        await mkdir(deeboGuideUserDir, { recursive: true });
        // Source paths (from npx package's build directory)
        const sourceGuideServerJsPath = join(__dirname, 'guide-server.js');
        const sourceGuideMarkdownPath = join(__dirname, 'deebo_guide.md');
        // Destination paths (in user's persistent .deebo-guide directory)
        const destGuideServerJsPath = join(deeboGuideUserDir, 'guide-server.js');
        const destGuideMarkdownPath = join(deeboGuideUserDir, 'deebo_guide.md');
        // Copy files to persistent location
        await copyFile(sourceGuideServerJsPath, destGuideServerJsPath);
        await copyFile(sourceGuideMarkdownPath, destGuideMarkdownPath);
        console.log(chalk.green('✔ Copied guide server files to persistent location.'));
        const platform = process.platform;
        const configPaths = {};
        // Get paths based on platform
        if (platform === 'win32') {
            const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
            configPaths.vscode = join(appData, 'Code', 'User', 'settings.json');
            configPaths.cline = join(appData, 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
            configPaths.claude = join(appData, 'Claude/claude_desktop_config.json');
            configPaths.cursor = join(appData, '.cursor', 'mcp.json');
        }
        else if (platform === 'linux') {
            configPaths.vscode = join(home, '.config', 'Code', 'User', 'settings.json');
            configPaths.cline = join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
            configPaths.claude = join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/claude_desktop_config.json');
            configPaths.cursor = join(home, '.cursor', 'mcp.json');
        }
        else {
            // macOS
            configPaths.vscode = join(home, 'Library/Application Support/Code/User/settings.json');
            configPaths.cline = join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
            configPaths.claude = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
            configPaths.cursor = join(home, '.cursor', 'mcp.json');
        }
        // Configure in each client, passing the persistent path to the guide server script
        for (const [_client, clientConfigPath] of Object.entries(configPaths)) {
            await configureClientGuide(clientConfigPath, destGuideServerJsPath);
        }
        console.log(chalk.green('\n✔ Guide server setup complete!'));
        console.log(chalk.blue('AI assistants can now access Deebo guide even if main installation fails.'));
    }
    catch (error) {
        console.error(chalk.red('\n✖ Guide server setup failed:'));
        console.error(error instanceof Error ? error.message : String(error));
        // Don't exit - let main setup continue even if guide setup fails
    }
}
