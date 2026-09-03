# Design Document

## Overview

passShield V1 is a local-first desktop password manager built with an Electron shell hosting a Next.js/React/TypeScript renderer, backed by an encrypted SQLite vault. The defining constraint is a hard security boundary: the renderer never touches the database, filesystem, or encryption keys directly. All sensitive work happens in the Electron main process and is reached only through a narrow, typed IPC contract.

V1 delivers the local vault end-to-end: create/unlock/lock, login and secure-note items, search, categories, favorites, a password generator, safe reveal/copy, and encrypted local backup/restore, packaged for Windows. Cloud synchronization (V2) is intentionally out of scope but the data model and layering are chosen so it can be added without reworking V1.

This design maps directly to the requirements. Where a decision satisfies a specific requirement, it is called out inline (e.g. _(Req 11)_).

### Design Goals

- **Local-first:** full functionality with no network. _(Req 14)_
- **Client-side security:** secrets are encrypted on the device; a stolen database is not a plaintext leak. _(Req 12)_
- **Strong process isolation:** compromised renderer cannot reach secrets directly. _(Req 11)_
- **Future-friendly:** item model carries `version` and encrypted payloads so cloud sync can be added later.

### Non-Goals (V1)

Cloud accounts, sync engine, device registry, browser extensions, mobile, sharing, and enterprise features. No cloud code ships in V1.

## Architecture

### Process Topology

```text
+--------------------------------------------------------+
|                  Electron Application                  |
|                                                        |
|  Renderer (Next.js / React / TypeScript)               |
|    Dashboard | Vault list | Item detail                |
|    Password Generator | Search | Settings              |
|    -> only calls window.passShield.* (context bridge)  |
+---------------------------+----------------------------+
                            |
                    Preload (contextBridge)
                    exposes typed IPC surface
                            |
                     ipcRenderer.invoke
                            |
+---------------------------v----------------------------+
|              Electron Main Process                     |
|                                                        |
|  IPC Router (validates + dispatches)                   |
|    -> Vault Service (orchestration, lock state)        |
|    -> Crypto Service (KDF, encrypt/decrypt)            |
|    -> Database Service (SQLite access, migrations)     |
|    -> Backup Service (export/restore)                  |
|    -> Auto-Lock Manager (inactivity timer)             |
+---------------------------+----------------------------+
                            |
                            v
                    Local SQLite (vault.sqlite)
```

The renderer is a pure presentation + interaction layer. It holds only the data the main process hands back for the current view and never holds the encryption key. _(Req 11.1, 11.5)_

### Security Boundary and IPC Contract

Electron is configured with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` for the renderer. The preload script uses `contextBridge.exposeInMainWorld` to publish a small, explicit API. There is no generic `send(channel, data)` passthrough. _(Req 11.2, 11.3, 11.4)_

Typed IPC surface (renderer-visible):

```text
vault.exists()            -> boolean
vault.create(input)       -> { ok } | { error }
vault.unlock(password)    -> { ok } | { error }
vault.lock()              -> void
vault.status()            -> { locked, autoLockMinutes }

items.list(filter?, sort?) -> ItemSummary[]     // metadata only; scope=all|favorites|recent|logins|notes|category
items.get(id)             -> ItemDetail         // decrypted for display
items.save(item)          -> ItemSummary        // create or update
items.trash(id)           -> void               // soft delete (deleted_at set)
items.restore(id)         -> void               // undo soft delete
items.delete(id)          -> void               // permanent delete
items.search(query, sort?) -> ItemSummary[]

categories.list()         -> Category[]
categories.save(category) -> Category           // create or update (name/icon/color/description)
categories.delete(id)     -> void

generator.generate(opts)  -> { value, strength }  // opts: length, upper, lower, numbers, symbols,
                                                   //       excludeSimilar, avoidAmbiguous, ensureEveryType,
                                                   //       minNumbers, minSymbols
clipboard.copySecret(v)   -> void               // main handles clear timer

settings.get()            -> Settings
settings.update(patch)    -> Settings

backup.export(path)       -> { ok } | { error }
backup.restore(path, pwd) -> { ok } | { error }
```

Every handler:
1. Validates input shape (validation package / zod-style schema).
2. Rejects mutating/read operations that require an unlocked vault when the vault is locked. _(Req 2.5, 4.5)_
3. Returns only what the view needs; secret values are returned only for explicit `items.get` reveal flows, never in bulk list results. _(Req 6.4, 9.1)_

### Layered Modules (Main Process)

- **Vault Service** — owns the in-memory unlock state and the derived key handle; orchestrates crypto + database; enforces "locked = no secrets".
- **Crypto Service** — key derivation from master password, authenticated encryption/decryption of item payloads, verification-material creation/check. _(Req 12)_
- **Database Service** — SQLite connection, schema, migrations, CRUD on encrypted rows. _(Req 1.4, 14.3)_
- **Backup Service** — encrypted export and validated restore. _(Req 10)_
- **Auto-Lock Manager** — inactivity timer that calls Vault Service lock. _(Req 3)_
- **Logger** — structured, non-secret operational logging with a secret-field denylist. _(Req 13)_

## Components and Interfaces

### Renderer Components

```text
App shell
├── OnboardingFlow        // first-run: create vault, set + confirm master pwd, storage mode (default local)
├── UnlockScreen          // master password entry
├── VaultLayout           // three-pane: sidebar | item list | detail
│   ├── Sidebar           // All Items, Favorites, Logins, Notes, Categories
│   ├── ItemList          // search box + list (metadata only)
│   └── ItemDetail        // fields, reveal/copy, edit
├── ItemEditor            // create/edit login or secure note
├── PasswordGenerator     // length slider + charset toggles + regenerate/copy
└── SettingsView          // General, Security, Backup, About (Cloud Sync placeholder disabled)
```

Renderer state is transient. On lock, revealed values and cached item detail are dropped and the UI returns to the unlock screen. _(Req 9.5, 2.6)_

### Crypto Service Interface

```ts
interface CryptoService {
  // Derive vault key from master password + stored salt (KDF params from security design)
  deriveKey(masterPassword: string, salt: Buffer, params: KdfParams): Promise<VaultKey>;

  // Create verification material at vault creation
  createVerifier(key: VaultKey): VerifierRecord;
  verify(masterPassword: string, verifier: VerifierRecord): Promise<boolean>;

  // Authenticated encryption of item payloads
  encrypt(key: VaultKey, plaintext: Buffer, aad?: Buffer): EncryptedPayload;
  decrypt(key: VaultKey, payload: EncryptedPayload, aad?: Buffer): Buffer;
}
```

Concrete algorithm choices (KDF, AEAD cipher, parameters, key lifecycle, and recovery behavior) are deferred to a dedicated **Vault Cryptography Specification** and are not fixed here. This design commits to the shape: KDF-based verification, AEAD-based item encryption, and key never leaving the main process. _(Req 12.2, 12.3, 12.4, 12.5)_

### Vault Service (unlock lifecycle)

```text
locked (default)
   | unlock(password)
   |   deriveKey + verify
   v
unlocked (key held in main-process memory only)
   | lock() / auto-lock / app exit
   v
locked  (zero key material where practical, drop caches)
```

## Data Model

Local SQLite (`vault.sqlite`) in the per-user application data directory. _(Req 1.4, 15.3)_ Sensitive content lives inside `encrypted_payload`; only non-secret metadata is stored in plaintext columns. _(Req 4.2, 5.2)_

```text
vault
  id, name, created_at, updated_at,
  encryption_version, kdf_salt, verifier

vault_item
  id (uuid), item_type ('login' | 'note'),
  title,                 -- non-secret metadata for list/search
  category_id, is_favorite,
  encrypted_payload,     -- AEAD ciphertext of secret fields
  version,               -- for future sync + edit tracking
  created_at, updated_at, deleted_at

category
  id, name, description, icon, color, created_at, updated_at

settings
  key, value             -- theme, auto-lock minutes, clipboard-clear seconds,
                         -- launch-on-startup, minimize behavior
```

Decrypted item shapes (never persisted in plaintext):

```text
LoginPayload  { username, password, website, notes }
NotePayload   { content }
```

`title`, `category_id`, and `is_favorite` are intentionally plaintext so list rendering, category filtering, favorites, and title search work without decrypting every row. _(Req 6.2, 7.3, 7.4)_ If title confidentiality is later required, it can move into the payload with an indexed search redesign.

The schema is created and evolved via a migration runner keyed on `encryption_version` / a schema version, logging only "migration applied". _(Req 13.2)_

## Feature Designs

### Onboarding and Unlock

First run detects no vault (`vault.exists()` false), runs onboarding: set master password, confirm it (reject on mismatch), pick storage mode defaulting to local, then create the vault (generate salt, derive key, store verifier). Subsequent launches show the unlock screen. _(Req 1, 2)_

### Item Management

Create/edit collects fields in `ItemEditor`; the renderer sends the full item to `items.save`. Main process encrypts the secret fields into `encrypted_payload`, writes plaintext metadata columns, sets/bumps `version`, and stamps timestamps. Delete marks/removes the row from active views. All mutations require an unlocked vault. _(Req 4, 5)_

### Search, Categories, Favorites

Search and filtering operate over plaintext metadata columns (`title`, `category_id`, `is_favorite`) for speed and to avoid bulk decryption; list results carry no secret values. Clearing the query restores the full list. _(Req 6, 7)_

### Password Generator

Pure function in a shared package used by both renderer preview and any main-process needs. Options: length + toggles for uppercase/lowercase/numbers/symbols. Uses a cryptographically secure RNG. Regenerate produces a fresh value; copy routes through `clipboard.copySecret`. UI shows no policy-compliance claims. _(Req 8)_

### Reveal and Clipboard Safety

Passwords render concealed; reveal shows plaintext for the current item detail only. Copy goes through the main process, which starts a clipboard-clear timer per the configured interval. Locking re-conceals and drops cached detail. _(Req 9)_

### Auto-Lock

Auto-Lock Manager tracks renderer activity pings (throttled, non-secret) and a timer; on timeout it invokes `vault.lock`. Timeout is a persisted setting applied on startup. _(Req 3)_

### Backup and Restore

Export writes an encrypted backup (vault protection preserved, no plaintext export by default) to a user-selected path. Restore validates format/version and integrity before applying, and fails safely (existing vault untouched) on corrupt/invalid input. Detailed backup format is deferred to a **Backup/Recovery Format Specification**. _(Req 10)_

## UI / Screen Designs

The visual design is defined by the mockups in `.kiro/specs/screens/`. This section translates those mockups into concrete UI structure and behavior. The app is a dark-themed (with light/system options) three-region desktop window: a persistent top bar, a left sidebar, and a main content area whose layout changes per screen.

### Shared Chrome (all screens)

- **Top bar:** passShield logo (left); centered global search (`Search vault...`, `Ctrl+K`); right cluster with a `+ New Item` split button (dropdown for item type), a lock button, a settings gear, and native window controls (minimize/maximize/close).
- **Left sidebar:** VAULT section with `All Items`, `Favorites`, `Recent`, `Logins`, `Secure Notes`, and an expandable `Categories`. A CATEGORIES section lists each category with its colored icon and item count. Each nav row shows a count badge.
- **Sidebar footer:** vault status card (`Vault Unlocked` + `Auto-lock in mm:ss`), a sync status card (V2; shown as inert/hidden in V1), app version, and an "All systems secure" indicator.
- **Bottom status bar:** left shows `Vault is unlocked and ready`; right shows sync state (V2).

The auto-lock countdown, sync cards, and "Synced/Sync Now" controls are V2 surface; in V1 the sync elements are omitted or disabled while the vault status and auto-lock countdown remain.

### Screen 1 — Main Vault Dashboard _(Req 2, 4, 6, 7, 9)_

Three panes inside the content area:
- **Item list (middle):** header with the current scope title (e.g. `All Items`), item count, a `Sort` control (e.g. Title A–Z), and a filter icon. Rows show item icon, title, username/subtitle, and a favorite star toggle. Selected row is highlighted.
- **Item detail (right):** item icon + title + favorite star, `Login • {Category}` subtitle, and an actions cluster: `Edit`, an overflow `...` menu, and close `X`. Fields: Username (with copy), Password (masked dots with reveal-eye and copy), Website (link + open-external), Category (chip), Notes (multi-line). Footer shows Created and Updated timestamps.
- Password is concealed by default; reveal and copy are explicit actions. Copy routes through the main-process clipboard handler.

### Screen 2 — Add Login _(Req 4, 8)_

Full-content form titled `Add Login` with a back arrow. Two-column field grid:
- Title* , Category (dropdown + `+` to create), Username, Password* (masked, reveal-eye, regenerate icon) with a **strength meter** (e.g. "Strong" with a colored bar), Website (optional, open-external), 2FA/OTP (optional, advanced), Notes (optional).
- `Show advanced fields` disclosure.
- **Quick Actions panel (right):** `Generate Password`, `Add Another Field` (custom field), `Attach File`.
- **Item Options panel:** `Mark as favorite` (checkbox), `Auto-type`, `Expires` (date picker).
- Footer: `Cancel` and `Save Login` (split button).

Advanced fields (2FA/OTP, custom fields, attachments, auto-type, expiry) are captured here for design completeness; see Requirement additions — several are **post-V1** and stored inside the encrypted payload when implemented.

### Screen 3 — Edit Vault Item _(Req 4)_

Same layout as Add Login, titled `Edit Vault Item`, with:
- An `Item Type` dropdown (Login/Secure Note/…), pre-filled fields, `Move to Trash` action (soft delete).
- **Quick Actions:** `Generate Password`, `Copy Password`, `Open Website`.
- **Item Information panel:** Created, Updated, and a `Favorite` toggle.
- Footer: `Cancel` and `Save Changes`.

### Screen 4 — Password Generator _(Req 8, 9)_

- **Generated password display:** large monospace value with character-class coloring, plus reveal-eye, copy, and regenerate buttons; a strength bar with label (e.g. "Very Strong").
- **Controls:** `Length` slider with numeric input; checkboxes for Uppercase, Lowercase, Numbers, Symbols, and `Exclude Similar Characters (l, 1, I, 0, O)`.
- **Customize panel:** `Minimum Numbers`, `Minimum Symbols` (steppers), `Avoid Ambiguous Characters` and `Ensure Every Type` toggles.
- **Quick Actions:** `Copy Password`, `Regenerate`, `Save as Custom` (save generated value into the vault).
- Top-right `History` and `Settings`; footer `Clear` and `Copy Password`. A Tips card gives non-prescriptive guidance (no policy-compliance claim).

Generator history is a convenience feature; if implemented it must not persist plaintext generated values outside the encrypted vault.

### Screen 5 — Search Results _(Req 6)_

Full-content results view titled `Search Results` with `{n} items found for "{query}"`, a `Sort: Relevance` control, filter icon, and a **list/grid view toggle**. Each result row: icon, title, username/subtitle, a category chip, an `Updated {date}` column, and `Open` + overflow `...` actions. Footer shows `Showing n of m results` with pagination. Matching operates over plaintext metadata; no secrets are shown inline.

### Screen 6 — Category Management _(Req 7)_

Titled `Categories` with `+ Add Category`. A `Search categories...` box, category count, `Sort`, and list/grid toggle. Table columns: Name (colored icon + name + description), Items (count), Actions (edit pencil, delete trash). An info banner explains categories can be assigned while creating/editing items.

### Screen 7 — General Settings _(Req 14, 15)_

Settings is a two-column layout: a left settings-nav (`General`, `Security`, `Cloud Sync`, `Backup`, `Advanced`, `About`) and a right detail pane. General groups:
- **Startup:** `Launch on startup`, `Start minimized to system tray`.
- **Minimize behavior:** close-window action dropdown (e.g. Minimize to system tray).
- **Appearance:** `Theme` (Light/Dark/System), `Accent color`.
- **Language** selector.
- **Updates:** `Check for updates automatically`.

### Screen 8 — Security Settings _(Req 3, 9, 12)_

- **Vault Lock:** `Auto-lock vault` (interval dropdown, e.g. 15 minutes), `Lock on system lock`, `Lock on sleep / screen saver`, `Lock on application exit` (toggles).
- **Clipboard:** `Clear clipboard after copy` (interval dropdown, e.g. 45s), `Prevent clipboard history` (toggle).
- **Master Password:** `Require master password on restart` (toggle), `Change master password` (button).
- A right-hand explainer panel reinforces the security posture (no policy claims).

### Screen 9 — Cloud Synchronization (V2, design only)

Cloud Sync settings pane: enable toggle, account row (email + plan + `Sign Out`), sync status with `Sync Now`, sync detail tiles (Encrypted, N Devices, last sync, Offline Access), `Sync automatically` and Advanced Options, plus a `Manage Devices` entry and an "About Cloud Sync" explainer emphasizing end-to-end/zero-knowledge encryption. **Not built in V1**; the nav entry appears as a disabled placeholder.

### Screen 10 — Device Management (V2, design only)

Devices view: summary tiles (Active/Revoked/Total devices, Last Successful Sync), a device table (Device name + id, Platform, Last Seen, Status, Action) with `Revoke` per non-current device and `Register New Device`. **Not built in V1.**

### Design vs V1 Scope Reconciliation

The mockups depict the full product vision including V2 (cloud sync, devices) and several enhanced item features. V1 implements: shared chrome, dashboard (screen 1), add/edit login and secure note (screens 2–3, core fields), password generator (screen 4, including strength meter and the ambiguous/every-type options), search (screen 5), categories (screen 6), general settings (screen 7), and security settings (screen 8, excluding cloud). Recent, list/grid toggles, strength meter, and soft-delete trash are in-scope UI behaviors added from the mockups. 2FA/OTP, attachments, custom fields, auto-type, expiry, generator history, cloud sync, and device management are captured for design continuity but flagged post-V1 / V2.

## Repository Structure

Monorepo so shared contracts/crypto/database evolve with the app (cloud `apps/api` reserved for V2, not built in V1):

```text
password-manager/
  apps/
    desktop/
      electron/main/       # services, IPC router, main entry
      electron/preload/    # contextBridge API
      renderer/            # Next.js app, components, features
  packages/
    contracts/             # IPC + item type definitions (shared)
    crypto/                # KDF + AEAD wrappers
    database/              # schema, migrations, queries
    validation/            # input schemas for IPC boundary
  tests/ { unit, integration, e2e }
  docs/ { architecture, security, product, qa }
```

## Error Handling

- **IPC input errors:** validated at the boundary; handlers return `{ error }` with a safe, non-secret message; never throw raw internals to the renderer.
- **Locked-vault access:** operations needing an unlocked vault return a `locked` error; the renderer routes back to unlock. _(Req 2.5, 4.5)_
- **Wrong master password:** verification failure returns a generic auth error without distinguishing "no such vault" details, and reveals nothing. _(Req 2.3)_
- **Corrupt database / failed migration:** fail safe, keep the vault locked, surface a recovery-oriented message, log only non-secret context. _(Req 10.4, 13)_
- **Backup restore failure:** abort without mutating the current vault. _(Req 10.4)_
- **Clipboard/OS errors:** degrade gracefully; never log the copied secret. _(Req 13.1)_

## Testing Strategy

Mapped to the product testing plan and scoped to V1:

- **Unit:** password generator (charset/length correctness, uniqueness), crypto wrappers (encrypt→decrypt round-trip, tamper detection), validation schemas, item/version handling.
- **Integration:** Database Service ↔ Vault Service, Crypto ↔ storage (encrypted round-trip), IPC router ↔ services (locked/unlocked gating).
- **Security:** renderer isolation (no direct SQLite/Node access), IPC authorization (locked-vault rejection), sensitive-logging tests (denylist enforced), malformed-vault and tampered-record handling, wrong-password handling.
- **End-to-end:** create vault → unlock → create/edit login → search → lock → restart → unlock → backup → restore.

## Deferred Technical Specifications

Per the product doc, these are prerequisites before or alongside implementation and are intentionally not resolved in this design:

1. Vault Cryptography Specification _(Req 12.5)_
2. Threat Model
3. SQLite Schema & Migration Strategy (detailed)
4. Electron IPC Contract (detailed)
5. Backup/Recovery Format Specification _(Req 10)_
6. Security Test Plan
7. Windows Store Packaging/Release Specification _(Req 15.2)_

Cloud-related specs (API contract, sync protocol, conflict resolution, auth/device registration) are V2 and out of scope here.
