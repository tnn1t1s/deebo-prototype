# Deebo Claude Code Integration Testing

This directory contains the integration test setup for Deebo with Claude Code using MCP tools.

## Setup

1. Install Deebo using `npx deebo-setup@latest`
2. Copy `mcp.json` to your Claude Code config directory:
   - macOS: `~/.claude-code/`
   - Windows: `%USERPROFILE%\.claude-code\`
3. Update `OPENROUTER_API_KEY` in mcp.json with your API key
4. Copy `.claude.md` to each test repository root

## Test Repositories

The `test-repos` directory contains sample projects with intentional bugs for benchmarking:

1. `type-error-repo`: Contains null/undefined property access bugs
2. `dependency-repo`: Contains missing or incompatible package issues
3. `async-repo`: Contains race conditions or unhandled promise rejections
4. `state-repo`: Contains state management errors

## Running Tests

For each test repository:

1. Change to the repository directory
2. Start Claude Code with `claude-code`
3. Ask Claude to debug the error using Deebo
4. Measure performance metrics

## Metrics Collection

Record the following for each test:
- Time to first hypothesis (seconds)
- Time to solution (seconds)
- Solution correctness (binary)
- Solution quality (1-5 scale)
- Appropriate tool usage (yes/no + comments)