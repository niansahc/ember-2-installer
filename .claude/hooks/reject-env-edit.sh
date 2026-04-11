#!/bin/bash
# Pre-edit hook: reject any edit to .env files.
# Reads tool_input JSON from stdin, checks file_path.
# Exit 2 = block the tool call.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *.env ]] || [[ "$FILE_PATH" == *.env.* ]] || [[ "$(basename "$FILE_PATH")" == .env ]]; then
  echo "Blocked: .env files are protected and must not be edited by Claude Code." >&2
  exit 2
fi

exit 0
