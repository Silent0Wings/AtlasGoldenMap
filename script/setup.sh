#!/usr/bin/env sh
# Golden Map Atlas - Install dependencies and create atlas.config.ts
#   ./setup.sh
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "[x] Node.js not found. Install Node 18+ from https://nodejs.org"; exit 1; }
exec node core/cli.mjs setup "$@"
