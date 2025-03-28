#!/bin/bash
set -e

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get the project root directory
PROJECT_ROOT=$(pwd)

# Check for npm
if ! command_exists npm; then
  echo "npm is required but not found. Please install Node.js and npm and try again."
  exit 1
fi

# Install npm packages locally
echo "Installing npm packages..."
npm install

# Check for Python
if ! command_exists python3; then
  echo "Python 3 is required but not found. Please install Python 3 and try again."
  exit 1
fi

# Create and activate virtual environment
echo "Setting up Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

# Upgrade pip and install wheel
echo "Upgrading pip and installing wheel..."
python3 -m pip install --upgrade pip wheel

# Install git-mcp server in virtual environment
echo "Installing git-mcp server..."
pip install mcp-server-git

# Store Python interpreter path
PYTHON_PATH=$(which python)
DEEBO_ROOT="$HOME/.local/share/deebo-prototype"

# Create Deebo root directory if it doesn't exist
mkdir -p "$DEEBO_ROOT"

# Save Python configuration
echo "Saving Python configuration..."
cat > "$DEEBO_ROOT/python-config.json" << EOF
{
  "interpreter_path": "$PYTHON_PATH",
  "venv_path": "$PROJECT_ROOT/.venv",
  "git_mcp_version": "$(pip show mcp-server-git | grep Version | cut -d ' ' -f 2)"
}
EOF

# Install official filesystem MCP server
echo "Installing filesystem MCP server..."
npx -y @modelcontextprotocol/servers/filesystem

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file..."
  cat > .env << EOF
# Anthropic API key for Claude integration
ANTHROPIC_API_KEY=your_api_key_here

# Optional configurations
# MCP_GIT_PATH=/custom/path/to/git/mcp
EOF
fi

# Build the project
echo "Building the project..."
npm run build

echo "Setup complete! The Deebo prototype is ready to use."
echo ""
echo "Don't forget to set your ANTHROPIC_API_KEY in the .env file."
echo ""
echo "To start the Deebo MCP server:"
echo "  npm start"
