#!/bin/sh
# Validate, test and type-check; stops at the first failure.
# Usage: scripts/check.sh [path-to-claude]   (defaults to `claude` on PATH)
set -eu
cd "$(dirname "$0")/.."
CLAUDE="${1:-claude}"
"$CLAUDE" plugin validate .
"$CLAUDE" plugin test .
if [ -d .claude-plugin/types ]; then
  npx -y -p typescript@5.6.3 tsc -p .
  echo "type-check: ok"
else
  echo "type-check: skipped (types are written when Claude Code loads the plugin from this folder)"
fi
