#!/bin/bash

# Define output file
OUTPUT_FILE="core-files.txt"

# Core files to concatenate
FILES=(
  "notes/RULES.TXT"
  "notes/memory.txt"
  "config/tools.json"
  "src/index.ts"
  "src/mother-agent.ts"
  "src/scenario-agent.ts"
  "src/util/mcp.ts"
  "src/util/logger.ts"
  "src/util/reports.ts"
  "src/util/membank.ts"
  "src/util/sanitize.ts"
  "src/util/observations.ts"
  "src/util/branch-manager.ts"
  "src/util/agent-utils.ts"
)

# Clear the output file if it exists
> "$OUTPUT_FILE"

# Concatenate files
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "=== $file ===" >> "$OUTPUT_FILE"
    cat "$file" >> "$OUTPUT_FILE"
    echo -e "\n\n" >> "$OUTPUT_FILE"
  else
    echo "Warning: $file not found" >> "$OUTPUT_FILE"
  fi
done

echo "Core files concatenated into $OUTPUT_FILE"
