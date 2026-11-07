#!/usr/bin/env sh
# Golden Map Atlas - Capture / build / check / open the atlas (menu when run without a mode)
#   ./run.sh [atlas|capture|build|check|crawl|open|report|clean] [-- playwright args]
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "[x] Node.js not found. Install Node 18+ from https://nodejs.org"; exit 1; }
exec node core/cli.mjs run "$@"
