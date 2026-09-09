# Implementation Plan

## Overview

Scope: PassShield V1 (Local Vault). Cloud sync and device management (V2) are out of scope. UI follows the mockups in `.kiro/specs/screens/`. Tasks are ordered so each builds on prior work, validates core functionality early through code, and keeps the app runnable as it grows. Every task references the specific requirements it satisfies.

The design commits to an Electron main process + Next.js/React/TypeScript renderer with a hard security boundary (renderer never touches DB, filesystem, or keys) and an encrypted SQLite vault. The design has no "Correctness Properties" section, so testing uses unit, integration, security, and end-to-end tests rather than property-based tests. Test-related sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Scaffold monorepo and Electron + Next.js shell
  - Create the monorepo structure: `apps/desktop/{electron/main,electron/preload,renderer}`, `packages/{contracts,crypto,database,validation}`, `tests/{unit,integration,e2e}`, `docs/`.
  - Configure TypeScript, workspace tooling, and the Next.js renderer.
  - Add an Electron main entry that loads the renderer with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  - Wire a test runner for unit/integration tests.
  - _Requirements: 11.3, 14.2_

- [x] 2. Define shared contracts and validation schemas
  - [x] 2.1 Add item and IPC type definitions in `packages/contracts`
    - Define ItemSummary, ItemDetail, LoginPayload, NotePayload, Category, Settings, and the typed IPC channel signatures (vault.*, items.*, categories.*, generator.*, clipboard.*, settings.*, backup.*).
    - _Requirements: 4.1, 5.1, 7.2, 11.4_
  - [x] 2.2 Add input validation schemas in `packages/validation`
    - Add a schema for every mutating and input-bearing IPC operation so the main-process boundary can validate input shape.
    - _Requirements: 11.2, 11.4_
  - [ ]* 2.3 Write unit tests for validation schemas
    - Cover valid input, malformed input, and rejected shapes for each IPC operation.
    - _Requirements: 11.4_

- [x] 3. Implement the crypto package (behind the deferred security spec)
  - [x] 3.1 Implement KDF-based key derivation and verifier create/verify wrappers
    - Derive a vault key from master password + stored salt with pluggable KDF params; create and verify verification material.
    - _Requirements: 12.1, 12.2, 12.4_
  - [ ]* 3.2 Write unit tests for key derivation and verification
    - Cover verifier round-trip and wrong-password rejection.
    - _Requirements: 12.1, 12.2_
  - [x] 3.3 Implement AEAD encrypt/decrypt wrappers for item payloads
    - Authenticated encryption/decryption of item payloads with optional AAD; key never leaves the main process.
    - _Requirements: 12.3, 11.5_
  - [ ]* 3.4 Write unit tests for AEAD wrappers
    - Cover encrypt→decrypt round-trip and tamper (auth-tag) detection.
    - _Requirements: 12.3_

- [x] 4. Implement the database package
  - [x] 4.1 Create SQLite schema and a version-keyed migration runner
    - Tables: vault (id, name, timestamps, encryption_version, kdf_salt, verifier), vault_item (id, item_type, title, category_id, is_favorite, encrypted_payload, version, timestamps, deleted_at), category (id, name, description, icon, color, timestamps), settings (key, value). Migration runner keyed on schema/encryption version, logging only "migration applied".
    - _Requirements: 1.4, 4.2, 5.2, 7.2, 13.2, 20.1, 21.1_
  - [x] 4.2 Implement CRUD queries over encrypted payloads with plaintext metadata columns
    - Item and category CRUD; store secret fields in encrypted_payload with plaintext title/category_id/is_favorite; soft-delete/restore/permanent-delete; recent ordering by updated_at; category item counts and safe reassignment on category delete.
    - _Requirements: 4.2, 4.6, 5.2, 6.2, 7.3, 7.4, 17.1, 20.1, 20.2, 20.3, 21.2, 21.3_
  - [ ]* 4.3 Write integration tests for database CRUD and trash lifecycle
    - Cover item/category CRUD, soft-delete → restore → permanent delete, recent ordering, and category delete reassignment.
    - _Requirements: 4.2, 5.2, 20.1, 20.2, 20.3, 21.3_

- [x] 5. Implement the Vault Service and unlock lifecycle (main process)
  - [x] 5.1 Implement create/unlock/lock/status with in-memory key state
    - Hold unlock state and the derived key handle in main-process memory only; orchestrate crypto + database; on lock (manual, auto, or exit) drop the key and cached secrets where practical; gate all secret operations so they fail when the vault is locked.
    - _Requirements: 1.4, 2.2, 2.3, 2.4, 2.5, 11.5_
  - [ ]* 5.2 Write integration tests for the unlock lifecycle
    - Cover create → unlock → locked/unlocked gating → lock, and wrong-password denial revealing nothing.
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 6. Wire the IPC router and preload context bridge
  - [x] 6.1 Implement the typed IPC router in main
    - Validate input via the validation schemas, enforce locked-vault gating, dispatch to services, and return only view-needed data (secrets only on explicit items.get); return safe non-secret error shapes.
    - _Requirements: 11.2, 11.4, 11.5, 2.5, 4.5_
  - [x] 6.2 Expose the narrow API via `contextBridge.exposeInMainWorld` in preload
    - Publish only the explicit `window.PassShield.*` surface; no generic passthrough channel.
    - _Requirements: 11.1, 11.2, 11.4_
  - [ ]* 6.3 Write a security test for renderer isolation
    - Assert the renderer has no direct SQLite/Node/filesystem access and cannot reach a generic IPC channel.
    - _Requirements: 11.1, 11.3, 11.5_

- [x] 7. Checkpoint - secure core operational
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Build onboarding and unlock UI
  - [x] 8.1 First-run onboarding flow
    - Detect no vault, set master password, confirm it (reject on mismatch), storage mode defaulting to local, then create the vault.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_
  - [x] 8.2 Unlock screen
    - Shown when a vault exists; correct password unlocks and reflects state in the UI; wrong password reveals nothing.
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

- [x] 9. Build shared chrome and the three-pane vault UI (per mockups)
  - [x] 9.1 Top bar and sidebar
    - Top bar with global search (Ctrl+K focus), New Item split button, lock control, settings control. Sidebar navigation for All Items, Favorites, Recent, Logins, Secure Notes, Categories with counts; vault status + auto-lock countdown. Sync elements hidden/disabled in V1.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 17.1_
  - [x] 9.2 Item list pane
    - Scope title, item count, sort control, favorite star toggle; render metadata only (no secret values).
    - _Requirements: 6.4, 7.4, 17.2, 17.4_
  - [x] 9.3 Item detail pane
    - Username/password/website/category/notes and created/updated timestamps; passwords concealed by default with explicit reveal, copy, and open-website.
    - _Requirements: 9.1, 9.2_

- [x] 10. Implement item create/edit/delete (Add Login / Edit Vault Item screens)
  - [x] 10.1 ItemEditor for logins and secure notes
    - Login fields (title, username, password, website, notes, category, favorite) and secure-note fields; Quick Actions panel (Generate Password, Copy Password, Open Website) and Item Options (favorite).
    - _Requirements: 4.1, 5.1_
  - [x] 10.2 Save, edit, and trash paths
    - Save encrypts secret fields into encrypted_payload, writes metadata, sets/bumps version and timestamps; edit flow persists changes; Move to Trash (soft delete) with restore and permanent delete; all mutations require an unlocked vault.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.2, 5.3, 20.1, 20.2, 20.3, 20.4_

- [x] 11. Implement search, categories, and favorites
  - [x] 11.1 Search results view
    - Search over plaintext metadata with sort (Relevance), list/grid toggle, category chips, and pagination; clearing the query restores the full list; no secrets shown inline.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 17.2, 17.3, 17.4_
  - [x] 11.2 Category management and favorites views
    - Create/edit categories (name, description, icon, color), item counts, search/sort, delete with safe reassignment; category filtering and a favorites view.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 21.1, 21.2, 21.3, 21.4_

- [x] 12. Implement the password generator (per mockup)
  - [x] 12.1 Pure generator in a shared package
    - Length, uppercase/lowercase/numbers/symbols, exclude-similar/avoid-ambiguous, ensure-every-type, minimum numbers/symbols, using a CSPRNG; regenerate yields a fresh value; unsatisfiable minimums/length are rejected with user-facing feedback.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 19.1, 19.2, 19.3, 19.4_
  - [ ]* 12.2 Write unit tests for the generator
    - Cover charset/length correctness, minimum/every-type guarantees, regeneration uniqueness, and unsatisfiable-constraint rejection.
    - _Requirements: 8.2, 8.4, 19.3, 19.4_
  - [x] 12.3 Generator UI
    - Length slider + charset toggles, Customize panel (min numbers/symbols, avoid-ambiguous, ensure-every-type), Quick Actions (Copy, Regenerate, Save as Custom), a locally-computed strength meter, and no policy-compliance claims.
    - _Requirements: 8.5, 8.6, 18.1, 18.2, 18.3_

- [x] 13. Implement clipboard safety and reveal-on-lock behavior
  - Route copies through the main process and start a clipboard-clear timer per the configured interval; re-conceal revealed values and drop cached detail when the vault locks.
  - _Requirements: 9.3, 9.4, 9.5_

- [x] 14. Implement auto-lock
  - Auto-Lock Manager tracks throttled, non-secret activity pings and an inactivity timer; on timeout it locks the vault and clears secrets where practical; persist and apply the timeout setting across sessions.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 15. Checkpoint - full local vault usable
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement settings (two-column Settings layout per mockups)
  - [x] 16.1 General settings
    - Launch on startup, start minimized, minimize/close behavior, theme (Light/Dark/System), accent color, language, check for updates.
    - _Requirements: 14.3_
  - [x] 16.2 Security settings
    - Auto-lock interval, lock on system lock / sleep / app exit, clipboard clear interval, prevent clipboard history, require master password on restart, change master password.
    - _Requirements: 3.1, 3.4, 9.4_
  - [x] 16.3 Backup and About panes
    - Backup pane entry points and About; Cloud Sync shown as a disabled placeholder (V2).
    - _Requirements: 14.2_
  - [x] 16.4 Persist settings via the settings table
    - Read/write settings through the settings store so they apply across sessions.
    - _Requirements: 3.4, 9.4, 14.3_

- [x] 17. Implement encrypted backup and restore
  - [x] 17.1 Export and restore in the Backup Service
    - Export an encrypted backup (vault protection preserved, no plaintext export by default) to a user-selected path; restore validates format/version and integrity before applying and fails safely on corrupt/invalid input, leaving the existing vault untouched.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ]* 17.2 Write integration tests for backup/restore
    - Cover export→restore round-trip and corrupt/invalid-backup rejection without mutating the current vault.
    - _Requirements: 10.3, 10.4_

- [x] 18. Add non-secret logging with a secret denylist
  - [x] 18.1 Structured logger for operational events
    - Log non-secret events (vault locked, vault unlocked, migration applied) with a denylist for secret fields (master password, keys, decrypted passwords, note contents, tokens, recovery secrets).
    - _Requirements: 13.1, 13.2_
  - [ ]* 18.2 Write a test asserting secrets never reach log output
    - Feed records containing secret fields and assert the denylist redacts them.
    - _Requirements: 13.1_

- [x] 19. Checkpoint - feature-complete V1
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 20. End-to-end tests
  - Automate: create vault → unlock → create/edit login → search → lock → restart → unlock → backup → restore.
  - _Requirements: 1.1, 2.2, 4.1, 6.1, 10.1_

- [x] 21. Windows packaging
  - Produce a Windows-compatible package from the production build; store the vault DB in a per-user application data location; prepare MSIX/Microsoft Store-compatible packaging to be validated during release engineering.
  - _Requirements: 15.1, 15.2, 15.3_

## Notes

- Tasks marked with `*` are optional (unit, integration, security, and end-to-end tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement clauses for traceability.
- The design has no Correctness Properties section, so no property-based tests are included; testing relies on unit, integration, security, and end-to-end tests per the design's Testing Strategy.
- Checkpoints (7, 15, 19) provide incremental validation at natural boundaries.
- Cryptographic algorithm/parameter choices are deferred to the Vault Cryptography Specification; the crypto package commits only to the KDF/AEAD shape.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "12.1"] },
    { "id": 4, "tasks": ["4.3", "5.1", "12.2"] },
    { "id": 5, "tasks": ["5.2", "6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["6.3", "8.1", "8.2"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 9, "tasks": ["10.1", "10.2", "11.1", "11.2", "12.3"] },
    { "id": 10, "tasks": ["13", "14", "16.1", "16.2", "16.3"] },
    { "id": 11, "tasks": ["16.4", "17.1", "18.1"] },
    { "id": 12, "tasks": ["17.2", "18.2"] },
    { "id": 13, "tasks": ["20", "21"] }
  ]
}
```
