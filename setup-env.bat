@echo off
setlocal enabledelayedexpansion

echo Setting up local environments for Deebo...

:: Create .env file if it doesn't exist
if not exist .env (
  echo Creating .env file
  copy .env.template .env
)

:: Create venv directory
if not exist venv mkdir venv

:: Setup Git MCP server
echo Setting up Git MCP server...
python -m venv venv\git-mcp
call venv\git-mcp\Scripts\activate.bat
pip install mcp-server-git
deactivate

:: Setup Desktop Commander
echo Setting up Desktop Commander...
mkdir -p venv\desktop-commander
cd venv\desktop-commander
call npm init -y
call npm install @wonderwhy-er/desktop-commander
cd ..\..

:: Update .env file with paths
echo Updating .env file with local paths
set "GIT_MCP_PATH=%CD%\venv\git-mcp\Scripts\mcp-server-git.exe"
set "COMMANDER_PATH=%CD%\venv\desktop-commander\node_modules\.bin\desktop-commander.cmd"

:: Create a temporary file to update .env
type .env > .env.tmp
set "replaced=0"
for /f "tokens=*" %%a in (.env.tmp) do (
  set "line=%%a"
  if "!line:~0,14!"=="# MCP_GIT_PATH" (
    echo MCP_GIT_PATH=!GIT_MCP_PATH! >> .env.new
    set "replaced=1"
  ) else if "!line:~0,20!"=="# MCP_COMMANDER_PATH" (
    echo MCP_COMMANDER_PATH=!COMMANDER_PATH! >> .env.new
    set "replaced=1"
  ) else (
    echo !line! >> .env.new
  )
)

move /y .env.new .env
del .env.tmp

echo Setup complete! Environments created at:
echo Git MCP: %GIT_MCP_PATH%
echo Desktop Commander: %COMMANDER_PATH%
echo These paths have been added to your .env file.

endlocal
