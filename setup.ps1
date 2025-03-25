# PowerShell setup script for Deebo prototype

# Function to check if a command exists
function Test-Command {
    param($Command)
    try { if (Get-Command $Command -ErrorAction Stop) { return $true } }
    catch { return $false }
}

# Get the project root directory
$PROJECT_ROOT = (Get-Location).Path

# Check for Python
if (-not (Test-Command python)) {
    Write-Host "Python 3 is required but not found. Please install Python 3 and try again." -ForegroundColor Red
    exit 1
}

# Check for npm
if (-not (Test-Command npm)) {
    Write-Host "npm is required but not found. Please install Node.js and npm and try again." -ForegroundColor Red
    exit 1
}

# Create Python virtual environment
Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
if (Test-Path -Path "venv") {
    Write-Host "Virtual environment already exists, updating..." -ForegroundColor Yellow
} else {
    python -m venv venv
}

# Activate the virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Cyan
try {
    & .\venv\Scripts\Activate.ps1
} catch {
    Write-Host "Failed to activate virtual environment. Try activating it manually:" -ForegroundColor Red
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor White
    exit 1
}

# Check if virtual environment was activated
if (-not $env:VIRTUAL_ENV) {
    Write-Host "Virtual environment activation failed. Please activate it manually:" -ForegroundColor Red
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor White
    exit 1
}

# Upgrade pip
Write-Host "Upgrading pip..." -ForegroundColor Cyan
python -m pip install --upgrade pip

# Install Git MCP server
Write-Host "Installing Git MCP server..." -ForegroundColor Cyan
pip install mcp-server-git

# Skip uvx installation
Write-Host "Note: Skipping uvx installation as it may not be compatible with your platform." -ForegroundColor Yellow
Write-Host "This won't affect the core functionality of Deebo." -ForegroundColor Yellow

# Install npm packages
Write-Host "Installing npm packages..." -ForegroundColor Cyan
npm install

# Install Desktop Commander locally
Write-Host "Installing Desktop Commander locally..." -ForegroundColor Cyan
npm install @wonderwhy-er/desktop-commander

# Create .env file if it doesn't exist
if (-not (Test-Path -Path ".env")) {
    Write-Host "Creating .env file..." -ForegroundColor Cyan
    $envContent = @"
# Anthropic API key for Claude integration
ANTHROPIC_API_KEY=your_api_key_here

# Virtual environment paths (automatically configured)
VENV_PATH=$($PROJECT_ROOT.Replace('\', '\\'))\venv

# Optional configurations
# MCP_GIT_PATH=/custom/path/to/git/mcp
# MCP_COMMANDER_PATH=/custom/path/to/desktop-commander
"@
    $envContent | Out-File -FilePath ".env" -Encoding utf8
}

# Build the project
Write-Host "Building the project..." -ForegroundColor Cyan
npm run build

Write-Host "Setup complete! The Deebo prototype is ready to use." -ForegroundColor Green
Write-Host ""
Write-Host "Don't forget to set your ANTHROPIC_API_KEY in the .env file." -ForegroundColor Yellow
Write-Host ""
Write-Host "To use the virtual environment in your terminal:" -ForegroundColor Cyan
Write-Host "  .\venv\Scripts\Activate.ps1  # On Windows PowerShell" -ForegroundColor White
Write-Host ""
Write-Host "To start the Deebo MCP server:" -ForegroundColor Cyan
Write-Host "  npm start" -ForegroundColor White
