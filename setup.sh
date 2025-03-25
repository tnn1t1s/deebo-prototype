#!/bin/bash
set -e

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get the project root directory
PROJECT_ROOT=$(pwd)

# Check for Python
if ! command_exists python3; then
  echo "Python 3 is required but not found. Please install Python 3 and try again."
  exit 1
fi

# Check for npm
if ! command_exists npm; then
  echo "npm is required but not found. Please install Node.js and npm and try again."
  exit 1
fi

# Create Python virtual environment
echo "Creating Python virtual environment..."
if [ -d "venv" ]; then
  echo "Virtual environment already exists, updating..."
else
  python3 -m venv venv
fi

# Activate the virtual environment
echo "Activating virtual environment..."
source venv/bin/activate || { echo "Failed to activate virtual environment. Please check your Python installation."; exit 1; }

# Verify venv activation
if [[ "$VIRTUAL_ENV" == "" ]]; then
  echo "Virtual environment activation failed. Please activate it manually:"
  echo "  source venv/bin/activate"
  exit 1
fi

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install Git MCP server
echo "Installing Git MCP server..."
pip install mcp-server-git

# Skip uvx installation as it's causing issues
echo "Note: Skipping uvx installation as it may not be compatible with your platform."
echo "This won't affect the core functionality of Deebo."

# Install npm packages locally
echo "Installing npm packages..."
npm install

# Install Desktop Commander locally
echo "Installing Desktop Commander locally..."
npm install git+https://github.com/wonderwhy-er/ClaudeDesktopCommander.git

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file..."
  cat > .env << EOF
# Anthropic API key for Claude integration
ANTHROPIC_API_KEY=your_api_key_here

# Virtual environment paths (automatically configured)
VENV_PATH=${PROJECT_ROOT}/venv

# Optional configurations
# MCP_GIT_PATH=/custom/path/to/git/mcp
# MCP_COMMANDER_PATH=/custom/path/to/desktop-commander
EOF
fi

# Build the project
echo "Building the project..."
npm run build

echo "Setup complete! The Deebo prototype is ready to use."
echo ""
echo "Don't forget to set your ANTHROPIC_API_KEY in the .env file."
echo ""
echo "To use the virtual environment in your terminal:"
echo "  source venv/bin/activate  # On Linux/macOS"
echo "  venv\\Scripts\\activate     # On Windows"
echo ""
echo "To start the Deebo MCP server:"
echo "  npm start"
