#!/bin/bash
# Post-edit hook: run e2e tests after source file edits.
# Only triggers for .js, .html, and .css files in src/ or tests/.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only run tests for source and test files
case "$FILE_PATH" in
  */src/*.js|*/src/*.html|*/src/*.css|*/tests/*.js|*/tests/*.cjs)
    cd "$(dirname "$0")/../.." || exit 0
    npm run test:e2e
    ;;
esac

exit 0
