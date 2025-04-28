#!/bin/bash

MODE=${1:-core} 

add_file_content() {
  if [ -f "$1" ]; then
    echo -e "\n=== $1 ===\n" >> core-files.txt
    cat "$1" >> core-files.txt
  else
    echo "Warning: File $1 not found, skipping." >&2
  fi
}

# Clear existing output file
> core-files.txt

echo "Generating core-files.txt in mode: $MODE"

# Core source files
add_file_content "src/index.ts"
add_file_content "src/util/mcp.ts"
add_file_content "config/tools.json"
add_file_content "src/util/sanitize.ts"
add_file_content "src/util/reports.ts"
add_file_content "src/util/branch-manager.ts"
add_file_content "src/util/agent-utils.ts"
add_file_content "src/util/logger.ts"
add_file_content "src/util/membank.ts"
add_file_content "src/util/observations.ts"
add_file_content "src/mother-agent.ts"
add_file_content "src/scenario-agent.ts"

# Only include packages if full mode is requested (just for deebo devs to look at installer stuff)
if [ "$MODE" = "full" ]; then
  echo "Including package files..."

  add_file_content "packages/deebo-setup/src/utils.ts"
  add_file_content "packages/deebo-setup/src/types.ts"
  add_file_content "packages/deebo-setup/src/index.ts"
  add_file_content "packages/deebo-setup/package.json"

  add_file_content "packages/deebo-doctor/src/types.ts"
  add_file_content "packages/deebo-doctor/src/checks.ts"
  add_file_content "packages/deebo-doctor/src/index.ts"
  add_file_content "packages/deebo-doctor/package.json"
fi

# Config files
add_file_content "package.json"
add_file_content "tsconfig.json"
add_file_content "README.md"

echo "Done. Output written to core-files.txt."