# Deebo: Autonomous Debugging Agent MCP Server

Deebo is an autonomous debugging system built for integration into coding agent workflows using the Model Context Protocol (MCP). It acts as a delegated tool that can investigate software bugs, run experiments in isolated Git branches, and report validated fixes, asynchronously by generating hypotheses in parallel, without human intervention.

Here’s [some logs of Deebo grokking the test53 linearizer failure $100 tinygrad bug bounty](https://github.com/snagasuri/deebo-prototype/tree/master/memory-bank/9bd38e9840d3/sessions/session-1744006973678) by spawning 17 scenario agents and coming up with 2 valid fixes. check out [progress.md](https://github.com/snagasuri/deebo-prototype/blob/master/memory-bank/9bd38e9840d3/progress.md) for just the solution Deebo came up with.

## need help installing? dm me on twitter: @sriramenn

## 🔧 What is Deebo?

Deebo is a fully MCP-compatible agent system that your coding agent (e.g., Claude Desktop, Cline, Cursor, etc.) can call when it encounters a bug it can’t fix confidently.

Instead of relying on a single step or suggestion, Deebo:

- Spawns multiple subprocesses (“scenario agents”) to test competing hypotheses
- Runs each scenario in a dedicated Git branch
- Validates or falsifies each approach
- Returns structured reports and solutions
- Optionally logs session history and context to a memory bank

Coding agents are not necessarily great at debugging, as their primary purpose is generating working end-to-end apps. Deebo gives your agent the ability to offload tricky bugs that would otherwise require several turns of chat to resolve, allowing you to focus more on shipping.


## 🛠️ Exposed MCP Tools

Deebo acts as a single MCP server and exposes four tools:

| Tool             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `start`          | Begins a debugging session                                           |
| `check`          | Returns current status of debugging session                   |
| `cancel`         | Terminates all processes for a given debugging session                         |
| `add_observation`| Logs external observations for an agent (e.g., from another tool like Cline) |

## 🚀 Usage (this part is for LLMs, not humans) 

### Start a Session

```xml
<deebo>
  <start
    error="ReferenceError: x is not defined"
    repoPath="/my/project/path"
    context="// suspect function below\nfunction handleClick() { ... }"
    filePath="src/ui/buttons.ts"
    language="typescript"
  />
</deebo>
```

### Check Session Status

```xml
<deebo>
  <check sessionId="session-1712268439123" />
</deebo>
```

This returns a human-readable session pulse, including:
- Mother agent’s current status
- Running vs. completed scenario agents
- Reported hypotheses
- Any <solution> found

### Cancel Session

```xml
<deebo>
  <cancel sessionId="session-1712268439123" />
</deebo>
```

### Add Observation (e.g., from Cline)

```xml
<deebo>
  <add_observation
    agentId="scenario-session-1712268439123-2"
    observation="The error disappears if we disable memoization"
  />
</deebo>
```

## 🧠 Memory Bank (Optional)

If USE_MEMORY_BANK=true is set, Deebo enables structured memory logging:

| File | Description |
|------|-------------|
| `activeContext.md` | Editable live journal for the Mother agent |
| `progress.md` | Summarized results of completed debug sessions |
| `sessions/<id>/reports/` | Structured scenario agent reports |
| `sessions/<id>/logs/` | Raw logs from Mother and scenarios |
| `sessions/<id>/observations/` | Logs of external observations from tools like Cline |

The memory bank allows Deebo to learn from its mistakes and personalize to your codebase over time. You can also utilize the context field when starting a debugging session with Deebo if there's specific information that Deebo would benefit from, and you can also add observations to specific agents mid-session if guidance is necessary.

## 📦 Installation

### Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Git**: Required for cloning the repository.
- **Node.js**: Version 18 or higher is recommended. This includes `npm`, which is needed for installing dependencies. You can download Node.js from [nodejs.org](https://nodejs.org/).
- docs.txt in the root of this repository can be very helpful to paste into an LLM to ask for guidance when installing deebo

### 1. Clone the Repository

```bash
git clone https://github.com/snagasuri/deebo-prototype.git
cd deebo-prototype
```

### 2. Install Required MCP Tools

Deebo relies on other MCP servers for interacting with Git and the filesystem.

**a) Install `uv` (includes `uvx`)**

`uv` is a fast Python package installer and resolver. We recommend installing it using the official script or `pipx`:

*   **Using the standalone installer (Recommended for macOS/Linux):**
    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Ensure ~/.local/bin is in your PATH (the script usually handles this)
    ```
*   **Using `pipx` (Recommended for isolated installation):**
    ```bash
    pip install pipx
    pipx ensurepath
    pipx install uv
    ```
    (See the [uv installation docs](https://github.com/astral-sh/uv#installation) for Windows and other methods.)

**b) Install `mcp-server-git` using `uvx`**

```bash
uvx install mcp-server-git
```
(Alternatively, if `uvx` fails, you could try `pip install mcp-server-git`.)

**c) Setup `desktop-commander`**

Deebo uses `desktop-commander` for filesystem operations and running commands. Ensure it's installed and configured as an MCP server for your client (like Cline or Claude Desktop) by running its setup command:

```bash
npx @wonderwhy-er/desktop-commander@latest setup
```
This command installs `desktop-commander` (if needed) and automatically adds its configuration to your MCP client's settings. If you're on Mac though you probably don't even need to install it explicitly, it will just install at runtime from tools/config.json.

### 3. Install Deebo Dependencies and Build

```bash
npm install
npm run build
```

### 4. Register Deebo as an MCP Server

Add the Deebo server configuration to your MCP client's settings file.

*   **Configuration File Locations (Examples):**
    *   **Cline (VS Code Extension):** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` (macOS), `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` (Linux), `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` (Windows)
    *   **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `~/.config/Claude/claude_desktop_config.json` (Linux), `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

    Note: you can definitely just edit Cline or Claude MCP settings through the GUI to add deebo. 
    
    Claude --> settings --> developer --> edit config

    Cline --> hamburger menu in top right --> installed --> 'configure MCP servers'

Deebo supports any combination of OpenRouter, Anthropic, and Gemini models. You can switch them out just by replacing 'openrouter' with 'anthropic' or 'gemini' and update the model choice accordingly. See src/util/agent-utils.ts for more information. Add the following entry to the `mcpServers` object within that JSON file. Remember to replace placeholder values like `/absolute/path/to/...` and API keys with your actual information.

```json
{
  "mcpServers": {
    "deebo-prototype": {
      "autoApprove": [],
      "disabled": false,
      "timeout": 30,
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "--max-old-space-size=4096",
        "/absolute/path/to/deebo-prototype/build/index.js"
      ],
      "env": {
        "NODE_ENV": "development",
        "USE_MEMORY_BANK": "true",

        "MOTHER_HOST": "openrouter",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",

        "SCENARIO_HOST": "openrouter",
        "SCENARIO_MODEL": "anthropic/claude-3.5-sonnet",

        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "GEMINI_API_KEY": "AIzaSy...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      },
      "transportType": "stdio"
    }
  }
}
```
**Note:** the settings in ```config/tools.json``` are for the tools that Deebo agents themselves use. If you notice errors when you try to start a Deebo session (check by going to Cline MCP settings --> Installed --> should be red text above the Deebo MCP server). Only provide the API key(s) corresponding to the `MOTHER_HOST` and `SCENARIO_HOST` you selected. Keys for unused providers can be omitted or left empty.

**Important:** Restart your MCP client (Cline, Claude Desktop, etc.) after modifying the configuration file for the changes to take effect.

## 💡 How It Works

### Architecture
- **Mother Agent**: Coordinates the investigation, spawns scenarios, and writes solutions.
- **Scenario Agents**: Each investigates a single hypothesis in its own Git branch and reports findings via <report>.
- **Process Isolation**: All agents run as Node.js subprocesses with timeout enforcement and independent lifecycles.

### Tooling
- **git-mcp**: Git operations (branching, diffs, logs)
- **desktopCommander**: File I/O, terminal commands, directories

Deebo agents are clients themselves- they use the git-mcp and desktopCommander MCP servers to investigate. 


## ✅ Why Use Deebo?

Deebo is ideal when you want to offload bug investigations to a self-directed agent that:
- Runs real experiments in your codebase
- Uses Git branches for full isolation
- Handles failure gracefully — multiple agents can run in parallel
- Returns validated fixes (not just guesses)
- Scales horizontally — plug into any Claude/MCP-compatible agent


## 🔒 Design Principles

- **Tool-isolated**: All mutations are done via MCP tools (no raw fs/git calls inside agents)
- **Stateless scenario agents**: No shared memory; pure function behavior
- **Raw logs, not opinionated UIs**: Human-readable, tailable logs and reports
- **Designed for delegation**: Meant to be called by other agents like Claude, not manually

## 📜 License

Apache 2.0
