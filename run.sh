#!/usr/bin/env bash
#
# run.sh - start PassShield for local development or a production-style run.
#
# PassShield is an Electron (main/preload) + Next.js (renderer) app in an npm
# workspaces monorepo. Running it means coordinating two processes:
#   1. the Next.js renderer dev server on http://localhost:$RENDERER_PORT
#   2. the Electron shell, which loads that dev server
#
# Usage:
#   ./run.sh            # dev mode: renderer dev server + Electron (hot reload)
#   ./run.sh --prod     # production-style: static build, then launch Electron
#   ./run.sh --help
#
# Configuration (.env):
#   On startup this script loads .env then .env.local from the repo root (if
#   present); values already set in the real environment win over the files.
#   See .env.example for the supported keys. Recognised here:
#     RENDERER_PORT     # preferred dev renderer port (default 3000). If busy,
#                       # the script scans upward for the next free port.
#
# In dev mode this script starts the renderer on a fixed port, waits for that
# port to answer, launches Electron pointed at the same URL, and shuts the
# renderer down again on exit.

set -euo pipefail

# Resolve the repo root (the directory this script lives in) so it works from
# any working directory.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RENDERER_URL=""
RENDERER_PID=""

log()  { printf "\033[36m[run]\033[0m %s\n" "$*"; }
err()  { printf "\033[31m[run]\033[0m %s\n" "$*" >&2; }

usage() {
  sed -n '2,23p' "${BASH_SOURCE[0]}" | sed "s/^# \{0,1\}//"
  exit 0
}

# Stop the background renderer (and its child processes) on exit / Ctrl-C.
cleanup() {
  if [[ -n "$RENDERER_PID" ]] && kill -0 "$RENDERER_PID" 2>/dev/null; then
    log "Stopping renderer dev server (pid $RENDERER_PID)..."
    # Kill the process group so next/node children go too.
    kill "$RENDERER_PID" 2>/dev/null || true
    wait "$RENDERER_PID" 2>/dev/null || true
  fi
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js is required (>= 20) but was not found on PATH."
    exit 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if (( major < 20 )); then
    err "Node.js >= 20 is required; found $(node -v)."
    exit 1
  fi
}

install_deps() {
  if [[ ! -d "node_modules" ]]; then
    log "Installing workspace dependencies (npm install)..."
    npm install
  fi
}

# Load key=value pairs from a dotenv file into the environment WITHOUT
# clobbering variables that are already set (so `RENDERER_PORT=4000 ./run.sh`
# still overrides the file). Lines that are blank or start with '#' are
# ignored; surrounding quotes on the value are stripped. This is a deliberately
# simple parser — it does not evaluate shell expansions in values.
load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  log "Loading environment from ${file##*/}..."
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading whitespace; skip blanks and comments.
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Support an optional leading `export `.
    line="${line#export }"
    # Require KEY=VALUE.
    [[ "$line" == *=* ]] || continue
    local key="${line%%=*}"
    local value="${line#*=}"
    # Trim whitespace around the key.
    key="${key//[[:space:]]/}"
    [[ -z "$key" ]] && continue
    # Strip one layer of matching surrounding quotes from the value.
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    # Do not overwrite a value already present in the environment.
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

# Load .env first, then .env.local (local overrides), from the repo root.
load_env() {
  load_env_file "$ROOT_DIR/.env"
  load_env_file "$ROOT_DIR/.env.local"
  # Apply the effective renderer port default after env files are loaded.
  RENDERER_PORT="${RENDERER_PORT:-3000}"
}

# Return 0 if $1 is a free TCP port on localhost, non-zero otherwise. Uses Node
# so we don't depend on lsof/netstat being present (this is cross-platform and
# works in Git Bash on Windows).
port_is_free() {
  node -e "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($1,'127.0.0.1')" 2>/dev/null
}

# Pick a usable renderer port: prefer $RENDERER_PORT, then scan upward until we
# find a free one. This guarantees the renderer and Electron agree on the port
# even if the preferred one is already taken (Next.js would otherwise silently
# bump to a different port, leaving Electron loading the wrong URL).
resolve_port() {
  local candidate="$RENDERER_PORT"
  local limit=$((RENDERER_PORT + 20))
  while (( candidate < limit )); do
    if port_is_free "$candidate"; then
      RENDERER_PORT="$candidate"
      RENDERER_URL="http://localhost:${RENDERER_PORT}"
      return 0
    fi
    log "Port ${candidate} is in use, trying $((candidate + 1))..."
    candidate=$((candidate + 1))
  done
  err "Could not find a free port in range ${RENDERER_PORT}..$((limit - 1))."
  return 1
}

# Poll the renderer URL until it responds or we time out.
wait_for_renderer() {
  log "Waiting for the renderer at ${RENDERER_URL} ..."
  local attempts=60  # ~60s
  while (( attempts-- > 0 )); do
    if node -e "require('http').get('${RENDERER_URL}', r => process.exit(0)).on('error', () => process.exit(1))" 2>/dev/null; then
      log "Renderer is up."
      return 0
    fi
    sleep 1
  done
  err "Renderer did not become ready in time."
  return 1
}

run_dev() {
  trap cleanup EXIT INT TERM

  log "Starting renderer dev server on port ${RENDERER_PORT}..."
  # Pin Next.js to the exact port via PORT so it never silently falls back to
  # another port (which would leave Electron loading the wrong URL).
  PORT="${RENDERER_PORT}" npm run dev:renderer &
  RENDERER_PID=$!

  wait_for_renderer

  log "Building main/preload and launching Electron at ${RENDERER_URL}..."
  # `dev` builds the renderer + main/preload then runs electron .
  # Tell the Electron main process which URL to load (main.ts reads
  # PassShield_RENDERER_URL, defaulting to http://localhost:3000).
  PassShield_RENDERER_URL="${RENDERER_URL}" npm run dev
}

run_prod() {
  log "Building renderer static export + main/preload (npm run build)..."
  npm run build
  log "Launching Electron against the built renderer (npm start)..."
  npm start
}

main() {
  local mode="dev"
  case "${1:-}" in
    -h|--help) usage ;;
    --prod|prod) mode="prod" ;;
    "" ) mode="dev" ;;
    * ) err "Unknown argument: $1"; err "Try: ./run.sh --help"; exit 1 ;;
  esac

  ensure_node
  install_deps
  load_env

  if [[ "$mode" == "prod" ]]; then
    run_prod
  else
    run_dev
  fi
}

main "$@"