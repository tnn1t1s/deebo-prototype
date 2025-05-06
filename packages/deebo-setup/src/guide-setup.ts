import { homedir } from 'os';
import { join, dirname } from 'path';
import { access, mkdir, readFile, writeFile, copyFile } from 'fs/promises';
import chalk from 'chalk';
import { McpConfig } from './types.js';

// Configure the guide server in an MCP client's config
async function configureClientGuide(configPath: string, guidePath: string): Promise<void> {
  try {
    let config: McpConfig = { mcpServers: {} };
    try {
      config = JSON.parse(await readFile(configPath, 'utf8')) as McpConfig;
    } catch {
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
  } catch (err) {
    console.log(chalk.yellow(`⚠ Could not configure guide server in ${configPath}`));
    console.log(chalk.dim(err instanceof Error ? err.message : String(err)));
  }
}

// Setup the guide server independently of main Deebo setup
export async function setupGuideServer(): Promise<void> {
  const home = homedir();
  const deeboPath = join(home, '.deebo');
  const guidePath = join(deeboPath, 'deebo_guide.md');

  try {
    // Create .deebo directory
    await mkdir(deeboPath, { recursive: true });
    console.log(chalk.green('✔ Created .deebo directory'));

    // Copy guide file from config directory
    await copyFile(join(process.cwd(), 'config', 'deebo_guide.md'), guidePath);
    console.log(chalk.green('✔ Copied Deebo guide'));

    // Copy guide server
    const serverPath = join(deeboPath, 'guide-server.js');
    await copyFile('packages/deebo-setup/build/guide-server.js', serverPath);
    console.log(chalk.green('✔ Copied guide server'));

    // Configure in all supported MCP clients
    const platform = process.platform;
    const configPaths: { [key: string]: string } = {};

    // Get paths based on platform
    if (platform === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      configPaths.vscode = join(appData, 'Code', 'User', 'settings.json');
      configPaths.cline = join(appData, 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
      configPaths.claude = join(appData, 'Claude/claude_desktop_config.json');
      configPaths.cursor = join(appData, '.cursor', 'mcp.json');
    } else if (platform === 'linux') {
      configPaths.vscode = join(home, '.config', 'Code', 'User', 'settings.json');
      configPaths.cline = join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
      configPaths.claude = join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/claude_desktop_config.json');
      configPaths.cursor = join(home, '.cursor', 'mcp.json');
    } else {
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

  } catch (error) {
    console.error(chalk.red('\n✖ Guide server setup failed:'));
    console.error(error instanceof Error ? error.message : String(error));
    // Don't exit - let main setup continue even if guide setup fails
  }
}
