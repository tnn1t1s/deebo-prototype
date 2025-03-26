# Deebo: Agentic Debugging System - Installation Guide

This guide explains how to install and configure the Deebo MCP server for use with Claude Desktop or other MCP-compatible clients.

## Prerequisites

- Node.js 18+ installed
- Git installed
- An Anthropic API key

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd deebo-prototype
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create a `.env` file in the project root with your Anthropic API key:

```
ANTHROPIC_API_KEY=your-api-key-here
```

### 4. Build the Project

```bash
npm run build
```

### 5. Register with Claude Desktop

To add Deebo as an MCP server in Claude Desktop:

1. Open Claude Desktop
2. Open settings (gear icon)
3. Navigate to the MCP Servers section
4. Add a new MCP server with the following configuration:

```json
{
  "mcpServers": {
    "deebo": {
      "command": "node",
      "args": ["/absolute/path/to/deebo-prototype/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key-here"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Replace `/absolute/path/to/deebo-prototype` with the actual path to the repository on your system.

### 6. Register with Cline

To add Deebo as an MCP server in Cline:

1. Open VSCode with the Cline extension installed
2. Edit the Cline MCP settings file located at:
   - Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
   - macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
   - Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

3. Add the Deebo configuration:

```json
{
  "mcpServers": {
    "deebo": {
      "command": "node",
      "args": ["/absolute/path/to/deebo-prototype/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key-here"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Verification

Once installed, you can verify the Deebo MCP server is working by:

1. Restarting Claude Desktop or VSCode
2. Opening a new Claude chat
3. The Deebo tools should now be available through Claude:
   - `start_debug_session`
   - `check_debug_status`
   - `list_scenarios`

## Usage Example

Here's a simple example of using Deebo through Claude:

```
I'm getting this error in my Node.js application:
Error: Cannot find module 'express'

Can you debug this issue for me? My project is located at /path/to/my/project.
```

Claude should be able to use Deebo to analyze this error, generate scenarios (like checking for missing dependencies), and provide a fix recommendation.

## Troubleshooting

If you encounter issues with the Deebo MCP server:

1. Check the console output for any error messages
2. Verify your Anthropic API key is correct
3. Make sure the paths in your MCP configuration are absolute and correct
4. Ensure Node.js is in your PATH environment variable

---

For more information about Deebo, refer to the `IMPLEMENTATION_REPORT.md` document.
