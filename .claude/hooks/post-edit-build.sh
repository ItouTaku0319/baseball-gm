#!/bin/bash
# Edit/Write後に自動でビルドチェック
# ビルド失敗時は exit 2 でClaudeに通知し、自動修正を促す

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# TypeScript/JavaScript以外は無視
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

BUILD_OUTPUT=$(cd /c/ITOU/work/baseball-gm && npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "Build failed after editing $(basename "$FILE_PATH"):" >&2
  echo "$BUILD_OUTPUT" | grep -A 2 "Error\|error\|failed" | head -15 >&2
  exit 2
fi

exit 0
