# Deebo: Autonomous Debugging Agent MCP Server

Deebo is an autonomous debugging system built for integration into coding agent workflows using the Model Context Protocol (MCP). It acts as a delegated tool that can investigate software bugs, run experiments in isolated environments, and report validated fixes, asynchronously, without human intervention.

If you'd like to see a run, I recommend memory-bank/7d4cacd8ed6f/sessions/session-1743739554230. Deebo working on Deebo's codebase!

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

## 🚀 Usage

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

### 1. Clone the Repository

```bash
git clone https://github.com/snagasuri/deebo-prototype.git
cd deebo-prototype
```

### 2. Install Required MCP Tools

```bash
pip install uvx  # or pipx install uvx
uvx install mcp-server-git
```

`desktop-commander` runs via `npx` — no install required.

### 3. Install and Build

```bash
npm install
npm run build
```

### 4. Register Deebo as an MCP Server

Add this to your mcpServers config (e.g., in Cline):

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
        "/absolute/path/to/deebo-prototype/build/index.js"
      ],
      "env": {
        "OPENROUTER_API_KEY": "your-key",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",
        "SCENARIO_MODEL": "anthropic/claude-3.5-sonnet",
        "USE_MEMORY_BANK": "true"
      },
      "transportType": "stdio"
    }
  }
}
```

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
