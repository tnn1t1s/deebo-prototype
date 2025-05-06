import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdir, readFile, writeFile, copyFile, rm } from 'fs/promises';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
// Get project root path using import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..');
// Configure the guide server in an MCP client's config
async function configureClientGuide(configPath, guidePath) {
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
                    join(dirname(guidePath), 'guide-server.js')
                ],
                env: {},
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
    const home = homedir();
    const deeboPath = join(home, '.deebo');
    const guidePath = join(deeboPath, 'deebo_guide.md');
    const serverPath = join(deeboPath, 'guide-server.js');
    const tempDir = join(home, '.deebo-guide-temp');
    try {
        // Create temp directory
        await mkdir(tempDir, { recursive: true });
        // Copy guide file using reliable package-relative path resolution
        const guideSource = fileURLToPath(new URL('../src/deebo_guide.md', import.meta.url));
        const tempGuidePath = join(tempDir, 'deebo_guide.md');
        await copyFile(guideSource, tempGuidePath);
        // Copy guide server using reliable package-relative path resolution
        const serverSource = fileURLToPath(new URL('../build/guide-server.js', import.meta.url));
        const tempServerPath = join(tempDir, 'guide-server.js');
        await copyFile(serverSource, tempServerPath);
        // Create .deebo directory if it doesn't exist
        await mkdir(deeboPath, { recursive: true });
        console.log(chalk.green('✔ Created .deebo directory'));
        // Copy files from temp to .deebo
        await copyFile(tempGuidePath, guidePath);
        console.log(chalk.green('✔ Copied Deebo guide'));
        await copyFile(tempServerPath, serverPath);
        console.log(chalk.green('✔ Copied guide server'));
        // Clean up temp directory
        await rm(tempDir, { recursive: true, force: true });
        // Configure in all supported MCP clients
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
        // Configure in each client
        for (const [client, path] of Object.entries(configPaths)) {
            await configureClientGuide(path, guidePath);
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
