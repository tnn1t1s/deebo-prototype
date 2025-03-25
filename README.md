# Deebo: Agentic Debugging System

Deebo is an Agentic Debugging System (ADS) that integrates with [Git MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/git) and [Desktop Commander MCP](https://github.com/wonderwhy-er/ClaudeComputerCommander) to provide intelligent debugging assistance.

## Features

- **Multi-Agent Architecture**: Uses a Mother Agent to coordinate and multiple Scenario Agents to explore different debugging approaches
- **Integration with MCP Servers**: Leverages Git MCP for codebase analysis and Desktop Commander MCP for file system operations
- **Claude AI Integration**: Uses Anthropic's Claude 3.5 Sonnet for intelligent error analysis
- **Context-Aware Debugging**: Gathers relevant context from the codebase, git history, and environment
- **Git-Based Isolation**: Scenario agents work in isolated git branches to prevent conflicts
- **Hypothesis Testing**: Tests different debugging hypotheses and rates their effectiveness

## Installation

### Automated Setup (Recommended)

#### On macOS/Linux:

```bash
# Run the setup script
./setup.sh
```

#### On Windows:

```powershell
# Run the PowerShell setup script
.\setup.ps1
```

The setup script will:
1. Create a Python virtual environment
2. Install Git MCP server in the virtual environment
3. Install Desktop Commander locally
4. Create a template .env file
5. Build the project

### Manual Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Create a Python virtual environment and install Git MCP:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install mcp-server-git
```

4. Copy `.env.template` to `.env` and add your Anthropic API key:

```bash
cp .env.template .env
# Edit .env and add your Anthropic API key
```

5. Build the project:

```bash
npm run build
```

## Environment Configuration

Edit the `.env` file to configure Deebo:

```bash
# Required: Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional: Custom paths to MCP servers
# MCP_GIT_PATH=/custom/path/to/git/mcp
# MCP_COMMANDER_PATH=/custom/path/to/desktop-commander

# Virtual environment path (set automatically by setup script)
VENV_PATH=/absolute/path/to/venv
```

## Usage

To start the server:

```bash
npm start
```

The server exposes two MCP tools:

1. `start_debug_session` - Starts a debugging session with error message and context
2. `check_debug_status` - Checks the status of an ongoing debugging session

### Example with Cline

Example workflow with Cline:

1. Cline detects an error in the code
2. Cline starts a debug session with Deebo, providing:
   - Error information (message, location, etc.)
   - Path to the Git repository
3. Deebo's Mother Agent:
   - Analyzes the error and codebase
   - Determines which Scenario Agents to activate
   - Creates isolated Git branches for each Scenario Agent
4. Scenario Agents:
   - Explore specific debugging approaches in isolation
   - Test and validate potential fixes
   - Report results back to the Mother Agent
5. Mother Agent selects the best solution and reports back to Cline

## Debugging Progress Logs

The `check_debug_status` tool returns detailed logs of the debugging process:

```
"Mother agent starting analysis of codebase and error..."
"Mother agent has selected 3 debugging scenarios: cache, async, dependency"
"Starting cache scenario agent on branch deebo-123-cache-1717..."
"Scenario agent (cache) completed investigation: SUCCESSFUL (confidence: 0.85)"
"Mother agent reviewing results from all scenario agents..."
"Mother agent has selected best fix with confidence: 0.85"
```

## Architecture

- **Mother Agent**: Orchestrates the debugging process, prioritizes scenarios, and selects the best solution
- **Scenario Agents**: Specialized agents that test specific hypotheses (dependency issues, syntax errors, etc.)
- **MCP Clients**: Connect to Git and Desktop Commander MCP servers
- **Anthropic API**: Uses Claude 3.5 Sonnet for intelligent analysis
- **Git Branch Isolation**: Each scenario agent works in its own git branch

## Development

To run in development mode with auto-reloading:

```bash
npm run dev
```

## License

ISC
