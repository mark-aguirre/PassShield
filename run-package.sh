#!/usr/bin/env bash
set -euo pipefail

# Build and package the Windows APPX (Microsoft Store-compatible),
# showing the last 55 lines of output.
npm run dist:appx --workspace @passshield/desktop 2>&1 | tail -n 55
