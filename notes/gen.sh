#!/bin/bash
# Deebo: Build and Package Script
# This script builds Deebo and its required tools as standalone binaries for distribution.

set -e

# 1. Build Deebo MCP server as a standalone binary (Node.js)
echo "Building Deebo MCP server binary (using pkg)..."
npx pkg . --targets node18-macos-x64,node18-linux-x64,node18-win-x64 --output dist/deebo

# 2. Build desktop-commander as a standalone binary (Node.js)
echo "Building desktop-commander binary (using pkg)..."
npx pkg node_modules/@wonderwhy-er/desktop-commander --targets node18-macos-x64,node18-linux-x64,node18-win-x64 --output dist/tools/desktop-commander

# 3. Build git-mcp as a standalone binary (Python)
echo "Building git-mcp binary (using PyInstaller)..."
pyinstaller --onefile --distpath dist/tools $(python3 -c "import mcp_server_git, os; print(os.path.dirname(mcp_server_git.__file__) + '/__main__.py')")

echo "All binaries built. Find them in the dist/ directory."
