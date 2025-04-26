
# Deebo: Your AI Agent's Debugging Partner
[![npm version](https://img.shields.io/npm/v/deebo-setup.svg)](https://www.npmjs.com/package/deebo-setup)
[![GitHub stars](https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=social)](https://github.com/snagasuri/deebo-prototype)
[![Active installs](https://img.shields.io/endpoint?url=https://deebo-active-counter.ramnag2003.workers.dev/active)](https://github.com/snagasuri/deebo-prototype)

Deebo is an autonomous debugging system that works alongside AI coding agents (Claude, Cline, Cursor, etc.) using the Model Context Protocol (MCP). It runs structured investigations in parallel Git branches to test hypotheses, validate fixes, and helps you move faster. If your main coding agent is like a single-threaded process, Deebo introduces multi-threadedness to your development workflow.

**If you think your team can benefit from Deebo, we’d love to hear from you.**
We’re partnering with teams who use AI agents to write production code and want to maximize their productivity.
Reach out for a live walkthrough, custom setup support, or to explore early access to enterprise features.

<video src="https://github.com/user-attachments/assets/756d35b4-4f77-48de-bd1a-86f76360279e" controls width="100%"></video>
**40-second sped-up video of Deebo in action on a real codebase**


Deebo scales to production codebases, too. Here's [an example of Deebo solving the test53 linearizer failure $100 tinygrad bug bounty](https://github.com/snagasuri/deebo-prototype/tree/master/memory-bank/9bd38e9840d3/sessions/session-1744006973678) by spawning 17 scenario agents and coming up with 2 valid fixes. Check out [progress.md](https://github.com/snagasuri/deebo-prototype/blob/master/memory-bank/9bd38e9840d3/progress.md) for just the solution.

## 🚀 Quick Install (for Cline/Claude Desktop users) questions/support? dm me on x @sriramenn or open an issue here

```bash
npx deebo-setup
```
That's it! Follow the prompts to configure your API key and you're ready to go.

**show us you're alive!!**
```bash
npx deebo-setup ping
```


<details>
<summary>🔍 What exactly does Deebo do?</summary>

Deebo is your AI agent's debugging partner. When your agent encounters a tricky bug, Deebo:

- Spawns multiple "scenario agents" to test different hypotheses in parallel
- Runs each experiment in an isolated Git branch
- Validates or falsifies each approach
- Returns structured reports and solutions
- Optionally logs session history for learning

Instead of going back and forth with your AI agent about bugs, let Deebo handle the investigation while you focus on building features.

### Exposed MCP Tools
| Tool             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `start`          | Begins a debugging session                                           |
| `check`          | Returns current status of debugging session                          |
| `cancel`         | Terminates all processes for a given debugging session               |
| `add_observation`| Logs external observations for an agent                              |
</details>

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

4. Configure your MCP client to use Deebo (see Technical Details section for configuration format)
</details>

<details>
<summary>📚 Technical Details</summary>

### Memory Bank
If `USE_MEMORY_BANK=true` is set, Deebo enables structured memory logging:
- `activeContext.md`: Editable live journal for the Mother agent
- `progress.md`: Summarized results of completed debug sessions
- `sessions/<id>/reports/`: Structured scenario agent reports
- `sessions/<id>/logs/`: Raw logs from Mother and scenarios
- `sessions/<id>/observations/`: Logs of external observations

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

### Design Principles
- **Tool-isolated:** All mutations via MCP tools (no raw fs/git calls)
- **Stateless scenarios:** No shared memory between agents
- **Raw logs:** Human-readable, tailable logs and reports
- **Delegation-first:** Built to be called by other agents, not humans
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
- Any other OpenAI-compatible API endpoint
  - `OPENAI_API_KEY` to your API key (e.g., `'ollama'` for Ollama)
  - `OPENAI_BASE_URL` to your API endpoint (e.g., `'http://localhost:11434/v1'` for Ollama)

See `src/util/agent-utils.ts` for supported models and configuration details.
</details>

<details>
<summary>📖 For LLM Agents</summary>

This section contains detailed information to help LLM agents like Claude, GPT, and others effectively work with Deebo.

### Understanding Deebo's Architecture

Deebo operates using a mother‑scenario agent architecture:

- **Mother Agent:** Coordinates the overall debugging process, generates hypotheses, spawns scenario agents, analyzes reports, and synthesizes solutions
- **Scenario Agents:** Each tests a single hypothesis in an isolated Git branch, running experiments and reporting findings
- **Process Isolation:** All agents run as separate Node.js subprocesses with timeout enforcement
- **Memory Bank:** Optional persistent storage for session history and context

### OODA Loop Debugging Process

The mother agent follows an OODA (Observe, Orient, Decide, Act) loop:

1. **Observe:** Gather information about the bug through code examination and error analysis
2. **Orient:** Generate multiple competing hypotheses about potential causes
3. **Decide:** Dispatch scenario agents to investigate each hypothesis
4. **Act:** Synthesize findings and implement validated solutions

### Effective Tool Usage

#### Starting a Debugging Session

When starting a new debugging session:

    <deebo>
      <start
        error="[Full error message or stack trace]"
        repoPath="[Absolute path to repository]"
        context="[Relevant code snippets, reproduction steps, or previous attempts]"
        filePath="[Path to the primary suspect file, if known]"
        language="[Programming language, e.g., 'typescript', 'python']"
      />
    </deebo>

**Best Practices:**
- Include the complete error message, not just a summary
- Provide as much context as possible, including related code snippets
- Mention any previous debugging attempts that failed
- Reference any known constraints or requirements

#### Monitoring Progress

To check the current status of a debugging session:

    <deebo>
      <check sessionId="[session ID returned from start]" />
    </deebo>

**Understanding the Pulse Report:**
- "Mother Agent" section shows current OODA loop stage
- "Scenario Agents" section lists all running and completed scenarios
- Completed scenarios include hypothesis validation status
- Final solution (when found) appears in the SOLUTION section

#### Adding External Observations

To inject information into a running agent:

    <deebo>
      <add_observation
        sessionId="[session ID]"
        agentId="[mother or scenario-session-ID-N]"
        observation="[Your observation as a plain text message]"
      />
    </deebo>

**Effective Observations:**
- Facts about the codebase architecture
- Known constraints not visible in the code
- Debugging hints from your own reasoning
- Results from external tests or tools

#### Canceling a Session

When a solution is found or to terminate a long‑running investigation:

    <deebo>
      <cancel sessionId="[session ID]" />
    </deebo>

### Interpreting Results

Deebo's solutions are wrapped in `<solution>` tags in the mother agent's response:

    <solution>
    [Detailed explanation of the root cause]

    [Recommended code changes with reasoning]

    [Supporting evidence from successful scenario(s)]
    </solution>

**Solution Confidence:**
- Solutions are only provided when the mother agent is >96% confident
- All solutions are validated through actual code changes and testing
- If no solution is found, the session will either continue or time out

### Memory Bank Structure

When memory bank is enabled (`USE_MEMORY_BANK=true`), Deebo creates a structured record:

    memory-bank/{codebaseHash}/
      ├── activeContext.md    # Live notebook for the mother agent
      ├── progress.md         # Historical record of all sessions
      └── sessions/{sessionId}/
          ├── logs/           # Raw agent logs
          ├── reports/        # Structured scenario reports
          └── observations/   # External observations

**Using the Memory Bank:**
- Reference previous debugging attempts to avoid duplication
- Learn from past failures to generate better hypotheses
- Build on successful approaches for similar bugs

### Advanced Usage Patterns

#### Multi‑Agent Collaboration

If working with other LLM agents (like Cline and Claude Desktop together):
- Use observations to share insights between agents
- Have specialized agents focus on different aspects (e.g., testing vs. code examination)
- Share and reference session IDs to build on previous investigations

#### Session Chaining

For complex bugs that might require multiple approaches:
1. Start a debugging session with a narrow initial hypothesis
2. Review scenario reports to identify promising directions
3. Cancel the initial session and start a new one with refined hypotheses
4. Use observations to share context between sessions

#### Custom Test Development

When a bug requires specific test cases:
1. Start a debugging session focused on the bug
2. Use observations to provide test case results as they become available
3. Guide scenarios toward particular testing approaches

### Limitations and Considerations

- **Runtime:** Sessions have a 60‑minute maximum duration for mother agents, 15 minutes for scenario agents
- **Memory:** Large codebases might require multiple focused sessions
- **Branch Management:** Deebo creates temporary Git branches which are not automatically cleaned up
- **LLM Context:** Complex bugs may exceed token limits, so be concise in observation messages
- **Tool Access:** Deebo has access to file system and Git operations, but not external APIs or databases
</details>

## 📜 License

Apache 2.0
