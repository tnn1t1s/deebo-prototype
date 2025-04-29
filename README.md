
# Deebo: Your AI Agent's Debugging Partner
[![npm version](https://img.shields.io/npm/v/deebo-setup.svg)](https://www.npmjs.com/package/deebo-setup)
[![GitHub stars](https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=social)](https://github.com/snagasuri/deebo-prototype)
[![Active installs](https://img.shields.io/endpoint?url=https://deebo-active-counter.ramnag2003.workers.dev/active)](https://github.com/snagasuri/deebo-prototype)

Deebo is an autonomous debugging system that AI coding agents (Claude, Cline, Cursor, etc.) can delegate tricky bugs to using the Model Context Protocol (MCP). It runs structured investigations in parallel Git branches to test hypotheses, validate fixes, and helps you move faster. If your main coding agent is like a single-threaded process, Deebo introduces multi-threadedness to your development workflow.

**feedback, questions/support? CHECK OUT DEEBO GUIDE BELOW, or dm me on x @sriramenn or open an issue here**

**If you think your team can benefit from Deebo, we’d love to hear from you.**
We’re partnering with teams who use AI agents to write production code and want to maximize their productivity.
Reach out for a live walkthrough, custom setup support, or to explore early access to enterprise features.

<video src="https://github.com/user-attachments/assets/756d35b4-4f77-48de-bd1a-86f76360279e" controls width="100%"></video>
**40-second sped-up video of Deebo in action on a real codebase**


Deebo scales to production codebases, too. Here's [an example of Deebo solving the test53 linearizer failure $100 tinygrad bug bounty](https://github.com/snagasuri/deebo-prototype/tree/master/memory-bank/9bd38e9840d3/sessions/session-1744006973678) by spawning 17 scenario agents and coming up with 2 valid fixes. Check out [progress.md](https://github.com/snagasuri/deebo-prototype/blob/master/memory-bank/9bd38e9840d3/progress.md) for just the solution.

## 🚀 Quick Install
```bash
npx deebo-setup
```
That's it! Follow the prompts to configure your API key and you're ready to go. Works with:
- VS Code Agent Mode
- Cline
- Claude Desktop

**show us you're alive!!**
```bash
npx deebo-setup ping
```

**Cursor users: https://cursor.directory/mcp/deebo**

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
<summary> 📖 Deebo Guide </summary>

### Prerequisites
- **Git**: For version control
- **Node.js**: v18+ (includes npm)
- **Python**: 3.10+ (for git-mcp)

### Configuration Files
- **VS Code:** `~/Library/Application Support/Code/User/settings.json`
- **Cline:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### LLM Support
Deebo supports OpenRouter, Anthropic, OpenAI SDK, and Gemini models. Configure via environment variables:
- `MOTHER_HOST`: LLM provider for mother agent
- `SCENARIO_HOST`: LLM provider for scenario agents
- `[PROVIDER]_API_KEY`: API key for chosen provider
- Any other OpenAI-compatible API endpoint
  - `OPENAI_API_KEY` to your API key (e.g., `'ollama'` for Ollama)
  - `OPENAI_BASE_URL` to your API endpoint (e.g., `'http://localhost:11434/v1'` for Ollama)

See `src/util/agent-utils.ts` for supported models and configuration details.

This guide explains how to effectively leverage Deebo by instructing your AI coding agent (which acts as the MCP client).

### 1. Delegating a Bug (`start` tool)

When you encounter a tricky bug, instruct your AI agent to delegate the investigation to Deebo.

**Example Instruction to your AI Agent:**

> "This error `(<Error message or description>)` is happening in `/absolute/path/to/your/repo`. I think it might be related to `<brief context>`. Can you delegate this debugging task to Deebo? Please also tell Deebo that I already tried `<what you tried>` and it didn't work."

**Key Information to Provide Your Agent:**

*   **The Error:** The specific error message, stack trace, or observed incorrect behavior.
*   **Repository Path:** The **absolute path** to the Git repository on your machine. Your agent needs this to tell Deebo where to work.
*   **Context (Crucial!):** Tell your agent any relevant details so it can pass them to Deebo:
    *   What you've already tried and ruled out.
    *   Relevant code snippets or file paths (`filePath`).
    *   Specific conditions for reproduction.
    *   The programming language (`language`).
    *   *The more context your agent gives Deebo, the faster and more effective the investigation will be.*

Your agent will then use the `deebo.start` tool, providing this information. It should report back the `sessionId` (e.g., `session-1745822688572`) that Deebo returns. **Keep track of this ID.**

### 2. Checking Investigation Progress (`check` tool)

Ask your agent to check the status of the ongoing Deebo session.

**Example Instruction to your AI Agent:**

> "Can you check the status of Deebo session `<Your Session ID>`?"

*   **Timing:** Give Deebo's Mother Agent 30-60 seconds after starting before asking for the first check.
*   **The Pulse Report:** Your agent will call `deebo.check` and should relay the "Session Pulse" report back to you. This report provides a snapshot (explained in the previous (incorrect) guide draft and still relevant in structure):
    *   Overall Status (in\_progress, completed, etc.)
    *   Mother Agent Status & Last Activity/Stage
    *   Scenario Agent Summary (Running, Terminated, Reported counts)
    *   Details on Reported Scenarios (Hypothesis, Confirmed Status, Summary)
    *   Details on Running/Terminated Scenarios (Hypothesis, Runtime, Last Activity)
    *   `file://` links to detailed logs/reports (Your agent might present these as clickable links or code blocks).

Use the pulse relayed by your agent to understand what hypotheses Deebo is exploring and how they are progressing.

### 3. Guiding the Investigation Mid-Session (`add_observation` tool)

If you see Deebo's Mother Agent going off track (based on the pulse report from your agent), or if you have new insights, you can guide it *indirectly* by giving instructions *to your primary AI agent*.

**Example Instruction to your AI Agent:**

> "Tell Deebo session `<Your Session ID>` the following observation: '<Your Insight>'. For example, tell it 'The file size errors it reported earlier are likely a tool limitation, it should focus on checking the CI script environment variables instead.'"

**Why Instruct Your Agent to Add Observations?**

*   **Correcting Course:** If the pulse report shows the Mother Agent is stuck (e.g., repeatedly failing the same tool call, fixated on disproven hypotheses), your observation (relayed by your agent) can provide a crucial nudge.
*   **Providing New Information:** Maybe you found a relevant commit hash, noticed the bug only happens after a specific user action, or confirmed an external dependency is healthy. Tell your agent to pass this to Deebo.
*   **Suggesting Alternatives:** "Ask Deebo session `<ID>` to consider if a race condition in the data loading might be causing this, since the file system checks passed."

Your agent will use the `deebo.add_observation` tool. The observation is added to the Mother Agent's context for its *next* LLM call, potentially changing its course.

### 4. Ending an Investigation (`cancel` tool)

If you want to stop the Deebo investigation early (e.g., you found the fix, it's taking too long, the hypotheses seem wrong), tell your agent to cancel it.

**Example Instruction to your AI Agent:**

> "Please cancel Deebo session `<Your Session ID>`."

Your agent will use `deebo.cancel`. Deebo will attempt to gracefully stop the Mother Agent and terminate all active Scenario Agents for that session. Your agent should confirm the cancellation request was sent.

### 5. Understanding the Agent-Deebo Dynamic

*   **Your Agent is the Interface:** You talk to your coding agent; your agent talks to Deebo using MCP.
*   **Leverage Your Agent's Strengths:** Your primary agent can help formulate the initial context for Deebo or summarize Deebo's pulse reports.
*   **Indirect Steering:** Your `add_observation` instructions are powerful. They allow your human insight to guide Deebo's autonomous investigation via your agent acting as the messenger. The example run showed the Mother Agent *could* get stuck in loops (like the tool/hypothesis conflict); your observation via the primary agent is the mechanism to break such loops.
*   **Iterative Process:** If one Deebo session doesn't solve the bug, review the results (pulse reports, logs via `file://` links if provided by your agent) and start a *new* session, instructing your agent to provide the key learnings as context.
*   **Keep Deebo Updated:** Use `npx deebo-setup@latest` periodically so your agent benefits from the latest server-side improvements.

By understanding that you instruct your *agent* to use Deebo, you can effectively integrate this powerful parallel debugging capability into your AI-assisted development workflow.


</details>

## 📜 License

This project is licensed under the Apache License, Version 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Sriram Nagasuri
