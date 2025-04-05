# Deebo: Autonomous Debugging Assistant

An Agentic Debugging System (ADS) that uses multi-agent collaboration to autonomously diagnose and fix software errors.

![Deebo Banner](https://img.shields.io/badge/Deebo-Agentic%20Debugging%20System-blue)
![Status](https://img.shields.io/badge/status-prototype-orange)

## Overview

Deebo is an advanced debugging system that uses AI agents to diagnose and fix software issues automatically. It employs a multi-agent architecture to explore different debugging hypotheses in parallel, with each hypothesis tested in isolation through Git branches.

### Key Features

- **Mother/Scenario Agent Architecture**: Orchestrates multiple scenario agents, each exploring a specific debugging hypothesis
- **Git-Based Isolation**: Each debugging scenario runs in its own Git branch for clean isolation
- **Dynamic Scenario Generation**: Analyzes errors to determine the most promising debugging approaches
- **Empirical Validation**: Tests fixes with actual command execution to validate solutions
- **MCP Integration**: Easily accessible through Claude Desktop or Cline via the Model Context Protocol

## Architecture

Deebo consists of:

1. **Mother Agent**: The orchestrator that analyzes errors, generates scenarios, and coordinates the debugging process
2. **Scenario Agents**: Autonomous agents that explore specific hypotheses in isolated Git branches
3. **MCP Server Interface**: Exposes the debugging functionality through standardized tools
4. **MCP Tools Integration**: Utilizes Git MCP and File System MCP for repository and file system operations

## Installation

See [INSTALLATION.md](INSTALLATION.md) for detailed setup instructions.

## Usage

Deebo can be used through Claude Desktop or Cline as an MCP server. It exposes the following tools:

- `start_debug_session`: Begin a new debugging session with an error
- `check_debug_status`: Check the status of an ongoing debugging session
- `list_scenarios`: List active debugging scenarios

## Example

```
# Start a debugging session
{
  "error_message": "Error: Cannot find module 'express'",
  "code_context": "const express = require('express');\nconst app = express();",
  "repo_path": "/path/to/project"
}

# Check status
{
  "session_id": "session-id-from-previous-response"
}
```

## Technical Details

- Built with TypeScript and Node.js
- Uses Claude 3.5 Sonnet for agent intelligence
- Process-based agent isolation
- Git-based testing isolation
- File-based inter-agent communication

## License

Apache 2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
