#!/bin/bash
set -e

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file"
  cp .env.template .env
fi

# Create venv directory if it doesn't exist
mkdir -p venv

# Setup Git MCP server
echo "Setting up Git MCP server..."
python -m venv venv/git-mcp
source venv/git-mcp/bin/activate
pip install mcp-server-git
deactivate

# Setup Desktop Commander
echo "Setting up Desktop Commander..."
mkdir -p venv/desktop-commander
cd venv/desktop-commander
npm init -y
npm install @wonderwhy-er/desktop-commander
cd ../..

# Update .env file with paths
echo "Updating .env file with local paths"
GIT_MCP_PATH="$(pwd)/venv/git-mcp/bin/mcp-server-git"
COMMANDER_PATH="$(pwd)/venv/desktop-commander/node_modules/.bin/desktop-commander"

# Check OS type for sed command syntax
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS version of sed
  sed -i '' "s|^# MCP_GIT_PATH=.*|MCP_GIT_PATH=$GIT_MCP_PATH|" .env
  sed -i '' "s|^# MCP_COMMANDER_PATH=.*|MCP_COMMANDER_PATH=$COMMANDER_PATH|" .env
else
  # Linux/other version of sed
  sed -i "s|^# MCP_GIT_PATH=.*|MCP_GIT_PATH=$GIT_MCP_PATH|" .env
  sed -i "s|^# MCP_COMMANDER_PATH=.*|MCP_COMMANDER_PATH=$COMMANDER_PATH|" .env
fi

echo "Setup complete! Environments created at:"
echo "Git MCP: $GIT_MCP_PATH"
echo "Desktop Commander: $COMMANDER_PATH"
echo "These paths have been added to your .env file."
