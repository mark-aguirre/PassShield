#!/usr/bin/env bash
#
# build-win-unpacked.sh — build the PassShield desktop app as an unpacked
# Windows executable (no installer).
#
# Runs the same steps used during development:
#   1. Build the Next.js renderer (static export -> renderer/out)
#   2. Compile the Electron main + preload (tsc -> dist)
#   3. Package an unpacked build with electron-builder (--win --dir)
#
# Output: apps/desktop/release/win-unpacked/PassShield.exe
#
# Usage (from anywhere):
#   ./build-win-unpacked.sh
#
# Notes:
#   - Close any running PassShield.exe first; electron-builder cannot overwrite
#     a locked executable.
#   - Requires Node.js 20+ and the repo dependencies installed (npm install).

set -euo pipefail

# Resolve the desktop app directory relative to this script so it works no
# matter where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${SCRIPT_DIR}/apps/desktop"

cd "${DESKTOP_DIR}"

echo "==> [1/3] Building renderer (Next.js static export)..."
npm run build:renderer

echo "==> [2/3] Building main process (tsc)..."
npm run build:main

echo "==> [3/3] Packaging unpacked Windows build (electron-builder --win --dir)..."
npx electron-builder --win --dir

echo ""
echo "Done. Unpacked build at:"
echo "  ${DESKTOP_DIR}/release/win-unpacked/PassShield.exe"
