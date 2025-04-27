
# Deebo: Your AI Agent's Debugging Partner
[![npm version](https://img.shields.io/npm/v/deebo-setup.svg)](https://www.npmjs.com/package/deebo-setup)
[![GitHub stars](https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=social)](https://github.com/snagasuri/deebo-prototype)
[![Active installs](https://img.shields.io/endpoint?url=https://deebo-active-counter.ramnag2003.workers.dev/active)](https://github.com/snagasuri/deebo-prototype)

Deebo is an autonomous debugging system that AI coding agents (Claude, Cline, Cursor, etc.) can delegate tricky bugs to using the Model Context Protocol (MCP). It runs structured investigations in parallel Git branches to test hypotheses, validate fixes, and helps you move faster. If your main coding agent is like a single-threaded process, Deebo introduces multi-threadedness to your development workflow.

**feedback, questions/support? dm me on x @sriramenn or open an issue here**

**If you think your team can benefit from Deebo, we’d love to hear from you.**
We’re partnering with teams who use AI agents to write production code and want to maximize their productivity.
Reach out for a live walkthrough, custom setup support, or to explore early access to enterprise features.

<video src="https://github.com/user-attachments/assets/756d35b4-4f77-48de-bd1a-86f76360279e" controls width="100%"></video>
**40-second sped-up video of Deebo in action on a real codebase**


Deebo scales to production codebases, too. Here's [an example of Deebo solving the test53 linearizer failure $100 tinygrad bug bounty](https://github.com/snagasuri/deebo-prototype/tree/master/memory-bank/9bd38e9840d3/sessions/session-1744006973678) by spawning 17 scenario agents and coming up with 2 valid fixes. Check out [progress.md](https://github.com/snagasuri/deebo-prototype/blob/master/memory-bank/9bd38e9840d3/progress.md) for just the solution.

## 🚀 Quick Install (for Cline/Claude Desktop users) 
```bash
npx deebo-setup
```
That's it! Follow the prompts to configure your API key and you're ready to go.

**show us you're alive!!**
```bash
npx deebo-setup ping
```
## Cursor users: https://cursor.directory/mcp/deebo

<details>
<summary>🛠️ Manual Installation (for other setups)</summary>

If you're not using Cline or Claude Desktop, follow these steps:

1. Clone the repo:
   ```bash
   git clone https://github.com/snagasuri/deebo-prototype.git
   cd deebo-prototype
   ```

2. Install dependencies:
   ```bash
   npm install
   npm run build
   ```

3. Install required MCP tools:
   ```bash
   # Install uv/uvx
   curl -LsSf https://astral.sh/uv/install.sh | sh
   
   # Install git-mcp
   uvx mcp-server-git --help
   
   # Install desktop-commander
   npx @wonderwhy-er/desktop-commander@latest setup
   ```

4. Configure your MCP client to use Deebo 

### MCP Configuration
```json
{
  "mcpServers": {
    "deebo": {
      "autoApprove": [],
      "disabled": false,
      "timeout": 30,
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "--max-old-space-size=4096",
        "/absolute/path/to/deebo/build/index.js"
      ],
      "env": {
        "NODE_ENV": "development",
        "USE_MEMORY_BANK": "true",
        "MOTHER_HOST": "openrouter",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",
        "SCENARIO_HOST": "openrouter",
        "SCENARIO_MODEL": "anthropic/claude-3.5-sonnet",
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      },
      "transportType": "stdio"
    }
  }
}
```
</details>

<details>
<summary>🔧 Development Guide</summary>

### Prerequisites
- **Git**: For version control
- **Node.js**: v18+ (includes npm)
- **Python**: 3.10+ (for git-mcp)

### Configuration Files
- **Cline:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### LLM Support
Deebo supports OpenRouter, Anthropic, and Gemini models. Configure via environment variables:
- `MOTHER_HOST`: LLM provider for mother agent
- `SCENARIO_HOST`: LLM provider for scenario agents
- `[PROVIDER]_API_KEY`: API key for chosen provider

See `src/util/agent-utils.ts` for supported models and configuration details.
</details>

## 📜 License

This project is licensed under the Apache License, Version 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Sriram Nagasuri
