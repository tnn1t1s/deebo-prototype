# Deebo: Your AI Agent's Debugging Partner
[![CI Status](https://github.com/snagasuri/deebo-prototype/actions/workflows/basic-ci.yml/badge.svg)](https://github.com/snagasuri/deebo-prototype/actions/workflows/basic-ci.yml)
[![npm version](https://img.shields.io/npm/v/deebo-setup.svg)](https://www.npmjs.com/package/deebo-setup)
[![GitHub stars](https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=social)](https://github.com/snagasuri/deebo-prototype)

Deebo is an agentic debugging system that AI coding agents (Claude, Cline, Cursor, etc.) can delegate tricky bugs to using the Model Context Protocol (MCP). It runs structured investigations in parallel Git branches to test hypotheses, validate fixes, and helps you move faster. If your main coding agent is like a single-threaded process, Deebo introduces multi-threadedness to your development workflow.

**If you think your team can benefit from Deebo, we’d love to hear from you.** We’re partnering with teams who use AI agents to write production code and want to maximize their productivity. Reach out for a live walkthrough, custom setup support, or to explore early access to enterprise features.

## Quick Install

```bash
npx deebo-setup@latest
```

<details>
<summary> Manual Configuration </summary>

For manual setup, create a configuration file at your coding agent's specified location with the following content:

```json
{
  "servers": {
    "deebo": {
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "--max-old-space-size=4096",
        "/Users/[your-name]/.deebo/build/index.js"
      ],
      "env": {
        "NODE_ENV": "development",
        "USE_MEMORY_BANK": "true",
        "MOTHER_HOST": "openrouter",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",
        "SCENARIO_HOST": "openrouter",
        "SCENARIO_MODEL": "deepseek/deepseek-chat",
        "OPENROUTER_API_KEY": "your-openrouter-api-key"
      }
    }
  }
}
```
Deebo works with any OpenAI-compatible SDK, Anthropic, Gemini, and OpenRouter.
</details>

---

<video src="https://github.com/user-attachments/assets/756d35b4-4f77-48de-bd1a-86f76360279e" controls width="100%"></video>

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.  
