#!/usr/bin/env sh
# Golden Map Atlas - Control panel: a local page for setup, capture, check and approve
#   ./panel.sh   (the page opens in the browser; the address is printed too)
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "[x] Node.js not found. Install Node 18+ from https://nodejs.org"; exit 1; }
exec node core/control-server.mjs --open
