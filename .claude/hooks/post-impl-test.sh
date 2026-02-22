#!/bin/bash
# 実装くん(implementer)完了後に自動でビルド+lint検証
# テストくんの代わりにhookで軽量チェック → コンテキスト節約

echo "=== Auto QA Check ===" >&2

# ビルド
BUILD_OUTPUT=$(cd /c/ITOU/work/baseball-gm && npm run build 2>&1)
if [ $? -ne 0 ]; then
  echo "NG: Build failed" >&2
  echo "$BUILD_OUTPUT" | grep -A 2 "Error\|error" | head -10 >&2
  exit 2
fi
echo "OK: Build passed" >&2

# Lint
LINT_OUTPUT=$(cd /c/ITOU/work/baseball-gm && npm run lint 2>&1)
if [ $? -ne 0 ]; then
  echo "WARNING: Lint issues found" >&2
  echo "$LINT_OUTPUT" | head -10 >&2
  # lintは警告止まり（exit 0）にする
fi

echo "=== Auto QA Complete ===" >&2
echo "QA passed. PM: git add → commit(日本語で変更内容を要約) → push origin を実行せよ。" >&2
exit 0
