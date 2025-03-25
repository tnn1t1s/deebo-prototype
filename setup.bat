@echo off
setlocal

echo Creating directory for virtual environments...
mkdir venvs 2>nul

echo Setting up Python virtual environment for Git MCP...
python -m venv venvs\git-mcp
call venvs\git-mcp\Scripts\activate.bat
pip install --upgrade pip
pip install mcp-server-git
deactivate

echo Setting up Node environment for Desktop Commander...
mkdir venvs\desktop-commander 2>nul
cd venvs\desktop-commander
call npm init -y
call npm install @wonderwhy-er/desktop-commander
cd ..\..

echo Creating .env file...
(
echo # Anthropic API key for Claude integration
echo ANTHROPIC_API_KEY=your_api_key_here
echo.
echo # Paths to local MCP servers
echo MCP_GIT_VENV=%CD%\venvs\git-mcp
echo MCP_COMMANDER_PATH=%CD%\venvs\desktop-commander
) > .env

echo Installation complete!
echo Please update the ANTHROPIC_API_KEY in the .env file with your actual API key.
echo Run 'npm install ^&^& npm run build' to build the project.

endlocal
