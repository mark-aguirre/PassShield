# PassShield

A local-first, cross-platform desktop password manager. Your vault belongs to
you: create a vault, store and generate credentials, and use it indefinitely
without an online account. Built with Electron (desktop shell) + Next.js /
React / TypeScript (renderer) over an encrypted SQLite vault.

This repository currently holds the **V1 (Local Vault)** scaffold.

## Repository layout

```text
apps/
  desktop/
    electron/main/       # Electron main process: services, IPC router, main entry
    electron/preload/    # contextBridge API exposed to the renderer
    renderer/            # Next.js renderer (App Router)
packages/
  contracts/             # shared IPC + item type definitions
  crypto/                # KDF + AEAD wrappers
  database/              # SQLite schema, migrations, queries
  validation/            # input schemas for the IPC boundary
tests/ { unit, integration, e2e }
docs/  { architecture, security, product, qa }
```

## Security boundary

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. It never touches SQLite, the filesystem, or encryption keys —
all privileged work happens in the Electron main process and is reached only
through the narrow `window.PassShield.*` API exposed by the preload script.

## Prerequisites

- Node.js >= 20 (developed on Node 24)
- npm (workspaces)

## Getting started

```bash
# Install all workspace dependencies
npm install

# Type-check every package (TypeScript project references)
npm run typecheck

# Run unit + integration tests
npm test
```

## Running the app

The renderer is a Next.js app; the Electron main process loads it (dev server
in development, static export in production).

```bash
# Terminal 1 - start the renderer dev server
npm run dev:renderer

# Terminal 2 - build main/preload and launch Electron against the dev server
npm run dev
```

For a production-style run:

```bash
npm run build      # builds the renderer static export + main/preload
npm start          # launches Electron against the built renderer
```

## Scripts (root)

- `npm run typecheck` — build all TypeScript project references (no emit issues).
- `npm run build` — compile all packages and the desktop main/preload.
- `npm test` — run unit and integration suites with Vitest.
- `npm run dev:renderer` — start the Next.js renderer dev server.
- `npm run dev` — build main/preload and launch Electron.
