#!/usr/bin/env sh
# Golden Map Atlas - Install npm packages and Playwright Chromium
#   ./deps.sh
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "[x] Node.js not found. Install Node 18+ from https://nodejs.org"; exit 1; }
exec node core/cli.mjs deps "$@"
