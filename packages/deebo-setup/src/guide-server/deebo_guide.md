## Deebo Guide (For AI Assistants)

**Agent Instructions:** Read this guide to understand Deebo and effectively assist your user with its installation, usage, and troubleshooting. Use the information here to answer user questions and guide them through processes.

**1. What is Deebo? (Explain to the User)**

  * Inform the user that Deebo is an **autonomous debugging tool** you (the AI assistant) can delegate tasks to when encountering complex bugs.
  * Explain its function: Deebo receives bug details, generates multiple hypotheses, and tests them safely and concurrently in separate Git branches within the user's specified repository.
  * Highlight the benefit: It acts like a specialized team running parallel experiments to find the root cause or validate a fix more quickly.

**2. Installation (Guide the User)**

  * Instruct the user to open their terminal and run:
    ```bash
    npx deebo-setup@latest
    ```
  * Inform the user they will be prompted to choose AI models (LLMs) and provide API keys.
  * State the prerequisites: **Node.js (v18 or higher)** and **Git** must be installed and accessible in their system's PATH.
  * **Crucially:** After setup completes, strongly advise the user to verify the installation by running:
    ```bash
    npx deebo-doctor@latest
    ```
  * Optionally, mention they can help the project by pinging usage stats (no private data sent): `npx deebo-setup ping`

**3. How Deebo is Configured (Explain to the User)**

  * Clarify that `npx deebo-setup` configures Deebo **directly within the user's MCP client application** (e.g., VS Code `settings.json`, Cline `cline_mcp_settings.json`, Claude Desktop `claude_desktop_config.json`).
  * Explain that this client configuration includes the necessary commands to run Deebo, the chosen LLM hosts/models, and the API keys provided during setup.
  * Inform the user that when *you* (the AI agent) call a Deebo tool, the client uses this configuration to launch the Deebo server process with the correct settings (passed via environment variables from the client's MCP definition for Deebo). *Do not* refer the user to `~/.deebo/.env` for client integration configuration.

**4. Core Usage: Deebo Tools (How You Interact)**

You interact with Deebo using these MCP tools. Ensure you provide the correct arguments when calling them:

  * **`start` Tool:**

      * **Your Action:** Call this to begin a debugging investigation.
      * **Required Arguments:**
          * `error` (string): The error message or bug description from the user.
          * `repoPath` (string): The **absolute path** to the user's local Git repository.
      * **Optional Arguments:**
          * `context` (string): Any additional context provided by the user (code snippets, failed attempts, reproduction steps). Encourage the user to provide good context.
          * `language` (string): The primary programming language (e.g., 'typescript', 'python').
          * `filePath` (string): The relative path within the repository to a specific relevant file, if known.
      * **Result:** You will receive a unique `sessionId` (e.g., `session-17xxxxxxxxxx`). Store this ID to use with other tools for this investigation. Inform the user of the session ID.

  * **`check` Tool:**

      * **Your Action:** Call this periodically to monitor an ongoing session.
      * **Required Argument:** `sessionId` (string).
      * **Result:** You receive a JSON object containing a text "pulse" report. Parse this report and relay the key information to the user (see Section 5). *Advise the user it may take \~30 seconds after starting for the first meaningful check report.*

  * **`cancel` Tool:**

      * **Your Action:** Call this if the user wants to stop an investigation or if it appears stuck.
      * **Required Argument:** `sessionId` (string).
      * **Result:** You receive confirmation that cancellation was requested. Inform the user.

  * **`add_observation` Tool:**

      * **Your Action:** Call this if the user provides a new hint or piece of information relevant to the ongoing investigation.
      * **Required Arguments:** `sessionId` (string), `observation` (string - the user's input).
      * **Optional Argument:** `agentId` (string, defaults to `'mother'`). Usually, send observations to the default 'mother' agent.
      * **Result:** You receive confirmation. Inform the user the observation was logged.

**5. Understanding the `check` Report (Relay to User)**

When you receive the `check` tool's response, parse the text report and clearly communicate these points to the user:

  * **Overall Status:** Is it `in_progress`, `completed`, `failed`, or `cancelled`?
  * **Duration:** How long has it been running?
  * **Mother Agent Info:** Relay its status and provide the `file://.../mother.log` link for detailed logs. If completed, summarize or provide the `<solution>` content if present.
  * **Scenario Agent Summaries:** For each scenario listed:
      * State its **Status** (`Running`, `Terminated`, `Reported`).
      * Mention the **Hypothesis** it was testing.
      * If `Reported`, summarize the **Outcome** (e.g., `CONFIRMED: Yes/No/Partially`) if available in the report snippet.
      * Provide the `file://` links to the scenario's detailed **log** and **report** files (usually in the session's `logs` and `reports` subdirectories).

**6. Troubleshooting Steps (Guide the User)**

If the user encounters problems, guide them through these steps:

  * **Step 1: Run Deebo Doctor:**

      * Instruct the user to run `npx deebo-doctor@latest` in their terminal. This checks common configuration and dependency issues.
      * If `deebo-doctor` reports failures or warnings, or if the issue persists, instruct them to run `npx deebo-doctor --verbose` and provide you (the agent) with the detailed output.
      * Inform the user that `deebo-doctor` verifies:
          * Correct Node.js and Git versions.
          * Correct paths and accessibility for `npx` and `uvx` commands.
          * Installation status of required MCP tools (`git-mcp` via `uvx`, `@wonderwhy-er/desktop-commander` via `npx`).
          * Existence and basic structure of Deebo configuration within their MCP client settings.

  * **Step 2: Address Specific Issues based on Doctor Output or Symptoms:**

      * **If `start` fails immediately:**
          * Ask the user to double-check that the `repoPath` provided is an **absolute path** and correct.
          * Check the `deebo-doctor --verbose` output for **Tool Paths** (`npx`, `uvx`). Ensure these commands work in the user's terminal.
          * Verify the Deebo installation path configured in the user's **client MCP settings** (under the `deebo` server definition) points to the correct location where Deebo was installed (usually `~/.deebo`).
          * Confirm `@wonderwhy-er/desktop-commander` is installed globally(`deebo-doctor` checks this). If missing, instruct the user: `npm install -g @wonderwhy-er/desktop-commander@latest`.
      * **If `check` returns "Session not found":**
          * Ask the user to confirm the `sessionId` is correct.
          * Explain the session might have finished or failed very quickly. Suggest checking the `~/.deebo/memory-bank/` directory structure for the relevant session folder and logs.
      * **If `check` shows "failed" status:**
          * Direct the user to examine the `mother.log` file (get the link from the `check` report). Look for specific error messages.
          * If errors mention LLMs or API keys, advise the user to verify the API keys stored in their **client's MCP configuration for Deebo** (these were set during `deebo-setup`). Also, suggest checking network connection, provider status, and account quotas.
      * **If errors mention `git-mcp` or `desktop-commander`:**
          * Refer to the `deebo-doctor` output under "MCP Tools".
          * If `git-mcp` issues are suspected, running `uvx mcp-server-git --help` might resolve path issues or confirm installation.
          * If `desktop-commander` issues are suspected, guide the user to run `npm install -g wonderwhy-er/desktop-commander`.

**7. Best Practices (Advise the User)**

  * **Good Context is Key:** Provide detailed `context` when calling `start`, including error details, relevant code, and steps already tried.
  * **Monitor Progress:** Use `check` periodically rather than just waiting.
  * **Use Observations:** Explain that `add_observation` allows them to give Deebo hints during the investigation if they discover new information.
  * **Iterate:** If Deebo fails or gets stuck, perhaps use `cancel`, analyze the Session Pulse for insights, and start a new session with improved context.

**8. Updating Deebo (Inform the User)**

  * To get the latest version, instruct the user to run:
    ```bash
    npx deebo-setup@latest
    ```

**9. Getting More Help (Provide Resources)**

  * If problems persist after following this guide and the `deebo-doctor` output, direct the user to:
      * Check the [Deebo GitHub Repository Issues](https://github.com/snagasuri/deebo-prototype/issues) for similar problems.
      * Open a new, detailed issue on the repository.
      * Contact the maintainer on X: [@sriramenn](https://www.google.com/search?q=https://x.com/sriramenn)
