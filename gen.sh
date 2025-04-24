#!/bin/bash

# Function to add file content with header
add_file_content() {
  echo -e "\n=== $1 ===\n" >> core-files.txt
  cat "$1" >> core-files.txt
}

# Clear existing file
> core-files.txt

# Core source files
add_file_content "src/util/sanitize.ts"
add_file_content "src/util/reports.ts"
add_file_content "src/util/branch-manager.ts"
add_file_content "src/util/agent-utils.ts"
add_file_content "src/util/mcp.ts"
add_file_content "src/util/logger.ts"
add_file_content "src/util/membank.ts"
add_file_content "src/util/observations.ts"
add_file_content "src/mother-agent.ts"
add_file_content "src/index.ts"
add_file_content "src/scenario-agent.ts"

# Setup package
add_file_content "packages/deebo-setup/src/utils.ts"
add_file_content "packages/deebo-setup/src/types.ts"
add_file_content "packages/deebo-setup/src/index.ts"
add_file_content "packages/deebo-setup/package.json"

# Doctor package
add_file_content "packages/deebo-doctor/src/types.ts"
add_file_content "packages/deebo-doctor/src/checks.ts"
add_file_content "packages/deebo-doctor/src/index.ts"
add_file_content "packages/deebo-doctor/package.json"

# Config files
add_file_content "config/tools.json"
add_file_content "package.json"
add_file_content "tsconfig.json"
add_file_content "README.md"

echo "Generated core files content in core-files.txt"
