import { CheckResult, DoctorConfig, SystemCheck } from './types.js';
import { homedir } from 'os';
import { join } from 'path';
import { access, readFile } from 'fs/promises';
import { simpleGit as createGit } from 'simple-git';

export const nodeVersionCheck: SystemCheck = {
  name: 'Node.js Version',
  async check() {
    const version = process.version;
    if (version.startsWith('v18') || version.startsWith('v20') || version.startsWith('v22')) {
      return {
        name: 'Node.js Version',
        status: 'pass',
        message: `Node ${version} detected`,
      };
    }
    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `Node.js v18+ required, found ${version}`,
      details: 'Install Node.js v18 or later from https://nodejs.org'
    };
  }
};

export const gitCheck: SystemCheck = {
  name: 'Git Installation',
  async check() {
    try {
      const git = createGit();
      const version = await git.version();
      return {
        name: 'Git Installation',
        status: 'pass',
        message: `Git ${version} detected`,
      };
    } catch {
      return {
        name: 'Git Installation',
        status: 'fail',
        message: 'Git not found',
        details: 'Install Git from https://git-scm.com'
      };
    }
  }
};

export const mcpToolsCheck: SystemCheck = {
  name: 'MCP Tools',
  async check() {
    const results: CheckResult[] = [];
    
    // Check git-mcp
    try {
      const { execSync } = await import('child_process');
      execSync('uvx mcp-server-git --help');
      results.push({
        name: 'git-mcp',
        status: 'pass',
        message: 'git-mcp installed'
      });
    } catch {
      results.push({
        name: 'git-mcp',
        status: 'fail',
        message: 'git-mcp not found',
        details: 'Install with: uvx mcp-server-git --help'
      });
    }

    // Check desktop-commander
    try {
      const { execSync } = await import('child_process');
      execSync('npx @wonderwhy-er/desktop-commander --help 2>/dev/null');
      results.push({
        name: 'desktop-commander',
        status: 'pass',
        message: 'desktop-commander installed'
      });
    } catch {
      results.push({
        name: 'desktop-commander',
        status: 'fail',
        message: 'desktop-commander not found',
        details: 'Install with: npx @wonderwhy-er/desktop-commander setup'
      });
    }

    // Aggregate results
    const allPass = results.every(r => r.status === 'pass');
    return {
      name: 'MCP Tools',
      status: allPass ? 'pass' : 'fail',
      message: allPass ? 'All MCP tools installed' : 'Some MCP tools missing',
      details: results.map(r => `${r.name}: ${r.message}`).join('\n')
    };
  }
};

export const toolPathsCheck: SystemCheck = {
  name: 'Tool Paths',
  async check() {
    const results: CheckResult[] = [];
    
    // Check npx
    try {
      const { execSync } = await import('child_process');
      const npxPath = execSync('which npx').toString().trim();
      results.push({
        name: 'npx',
        status: 'pass',
        message: 'npx found',
        details: `Path: ${npxPath}`
      });
    } catch {
      results.push({
        name: 'npx',
        status: 'fail',
        message: 'npx not found',
        details: 'Install Node.js to get npx'
      });
    }

    // Check uvx
    try {
      const { execSync } = await import('child_process');
      const uvxPath = execSync('which uvx').toString().trim();
      results.push({
        name: 'uvx',
        status: 'pass',
        message: 'uvx found',
        details: `Path: ${uvxPath}`
      });
    } catch {
      results.push({
        name: 'uvx',
        status: 'fail',
        message: 'uvx not found',
        details: 'Install uv to get uvx: curl -LsSf https://astral.sh/uv/install.sh | sh'
      });
    }

    // Aggregate results
    const allPass = results.every(r => r.status === 'pass');
    return {
      name: 'Tool Paths',
      status: allPass ? 'pass' : 'fail',
      message: allPass ? 'All tool paths found' : 'Some tool paths missing',
      details: results.map(r => `${r.name}: ${r.details || r.message}`).join('\n')
    };
  }
};

export const configFilesCheck: SystemCheck = {
  name: 'Configuration Files',
  async check(config: DoctorConfig) {
    const home = homedir();
    const paths = {
      cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
      claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
      env: join(config.deeboPath, '.env'),
      tools: join(config.deeboPath, 'config/tools.json')
    };

    const results: CheckResult[] = [];

    // Check each config file
    for (const [name, path] of Object.entries(paths)) {
      try {
        await access(path);
        const content = await readFile(path, 'utf8');
        
        // Parse JSON if applicable
        if (name !== 'env') {
          const json = JSON.parse(content);
          
          // Check if Deebo is configured in MCP configs
          if ((name === 'cline' || name === 'claude') && (!json.mcpServers?.deebo)) {
            results.push({
              name,
              status: 'fail',
              message: `${name} config exists but Deebo not configured`,
              details: `Path: ${path}\nAdd Deebo configuration to mcpServers`
            });
            continue;
          }

          // Check tools.json structure
          if (name === 'tools' && (!json.tools?.desktopCommander || !json.tools?.['git-mcp'])) {
            results.push({
              name,
              status: 'fail',
              message: `${name} config exists but missing required tools`,
              details: `Path: ${path}\nMissing one or more required tools: desktopCommander, git-mcp`
            });
            continue;
          }
        }

        results.push({
          name,
          status: 'pass',
          message: `${name} config found and valid`,
          details: `Path: ${path}`
        });
      } catch {
        results.push({
          name,
          status: 'fail',
          message: `${name} config not found or invalid`,
          details: `Expected at: ${path}`
        });
      }
    }

    // Aggregate results
    const allPass = results.every(r => r.status === 'pass');
    return {
      name: 'Configuration Files',
      status: allPass ? 'pass' : 'fail',
      message: allPass ? 'All configuration files valid' : 'Some configuration files missing or invalid',
      details: results.map(r => `${r.name}: ${r.message}\n${r.details || ''}`).join('\n\n')
    };
  }
};

export const apiKeysCheck: SystemCheck = {
  name: 'API Keys',
  async check(config: DoctorConfig) {
    const envPath = join(config.deeboPath, '.env');
    try {
      const content = await readFile(envPath, 'utf8');
      const lines = content.split('\n');
      const results: CheckResult[] = [];

      // Check each potential API key
      const keyChecks = {
        OPENROUTER_API_KEY: 'sk-or-v1-',
        ANTHROPIC_API_KEY: 'sk-ant-',
        GEMINI_API_KEY: 'AI'
      };

      for (const [key, prefix] of Object.entries(keyChecks)) {
        const line = lines.find(l => l.startsWith(key));
        if (!line) {
          results.push({
            name: key,
            status: 'warn',
            message: `${key} not found`
          });
          continue;
        }

        const value = line.split('=')[1]?.trim();
        if (!value || !value.startsWith(prefix)) {
          results.push({
            name: key,
            status: 'warn',
            message: `${key} may be invalid`,
            details: `Expected prefix: ${prefix}`
          });
          continue;
        }

        results.push({
          name: key,
          status: 'pass',
          message: `${key} found and valid`
        });
      }

      // Aggregate results
      const allPass = results.some(r => r.status === 'pass');
      return {
        name: 'API Keys',
        status: allPass ? 'pass' : 'warn',
        message: allPass ? 'At least one valid API key found' : 'No valid API keys found',
        details: results.map(r => `${r.name}: ${r.message}`).join('\n')
      };
    } catch {
      return {
        name: 'API Keys',
        status: 'fail',
        message: 'Could not read .env file',
        details: `Expected at ${envPath}`
      };
    }
  }
};

export const allChecks = [
  nodeVersionCheck,
  gitCheck,
  toolPathsCheck,
  mcpToolsCheck,
  configFilesCheck,
  apiKeysCheck
];
