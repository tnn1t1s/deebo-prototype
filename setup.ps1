# Function to check if a command exists
function Test-Command {
    param($Command)
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'stop'
    try {
        if (Get-Command $Command) { return $true }
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldPreference
    }
}

# Get the project root directory
$PROJECT_ROOT = Get-Location

# Check for npm
if (-not (Test-Command npm)) {
    Write-Error "npm is required but not found. Please install Node.js and npm and try again."
    exit 1
}

# Install npm packages locally
Write-Host "Installing npm packages..."
npm install

# Install uvx globally
Write-Host "Installing uvx globally..."
npm install -g uvx

# Install git-mcp server using uvx
Write-Host "Installing git-mcp server..."
npx -y uvx @modelcontextprotocol/server-git

# Create .env file if it doesn't exist
if (-not (Test-Path .env)) {
    Write-Host "Creating .env file..."
    @"
# Anthropic API key for Claude integration
ANTHROPIC_API_KEY=your_api_key_here

# Optional configurations
# MCP_GIT_PATH=/custom/path/to/git/mcp
"@ | Out-File -FilePath .env -Encoding UTF8
}

# Build the project
Write-Host "Building the project..."
npm run build

Write-Host "Setup complete! The Deebo prototype is ready to use."
Write-Host ""
Write-Host "Don't forget to set your ANTHROPIC_API_KEY in the .env file."
Write-Host ""
Write-Host "To start the Deebo MCP server:"
Write-Host "  npm start"
