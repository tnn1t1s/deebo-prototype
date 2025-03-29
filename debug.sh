#!/bin/bash

# Load environment variables from .env
export $(cat .env | xargs)

# Create a test payload json
cat > test-payload.json << 'EOF'
{
  "error_message": "Race condition in task cache management",
  "code_context": "// Cache the result - BUG: This is causing a race condition with invalidateTaskCache\n setCachedTasks(cacheKey, paginatedResponse)\n .catch(err => logger.error('Cache setting error:', err));\n\n return paginatedResponse;",
  "language": "typescript",
  "file_path": "/Users/sriram/Documents/task-manager/src/services/taskService.ts",
  "repo_path": "/Users/sriram/Documents/task-manager"
}
EOF

# Run the inspector with the test payload
npx @modelcontextprotocol/inspector node build/index.js --test-payload test-payload.json

# Clean up
rm test-payload.json