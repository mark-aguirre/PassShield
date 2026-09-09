# Product Design & Software Specification

**Working Product Name:** PassShield  
**Product Type:** Cross-platform desktop password manager  
**Initial Platform:** Windows  
**Future Platforms:** macOS and Linux  
**Primary Architecture:** Local-first with optional cloud synchronization  
**Document Status:** Draft v0.1

---

# 1. Product Vision

The product is a modern desktop password manager designed around one central principle:

> **The user's vault belongs to the user. Cloud services are optional.**

A user should be able to install the application, create a vault, save credentials, generate passwords, search the vault, and use the application indefinitely **without creating an online account**.

Cloud synchronization becomes an optional capability for users who want their encrypted vault synchronized between multiple devices.

```text
                    PRODUCT
                       |
              +--------+--------+
              |                 |
         Local Only        Cloud Enabled
              |                 |
            SQLite          SQLite
                                |
                          Encryption
                                |
                          Sync Service
                                |
                          Cloud Storage
```

---

# 2. Product Goals

## 2.1 Primary Goals

The product should provide:

1. Secure local storage of credentials.
2. Offline-first operation.
3. Optional cloud synchronization.
4. Multi-device capability.
5. Cross-platform architecture.
6. Simple, modern desktop UI.
7. Strong separation between the UI and sensitive vault operations.
8. Microsoft Store distribution for Windows.
9. A foundation that can later support macOS and Linux.
10. A design where the cloud service does not need plaintext vault contents.

---

# 3. Non-Goals for the Initial Product

These should **not** be part of the first release:

- Enterprise shared vaults
- Organization/team password management
- Admin-managed users
- Role-based access control
- Enterprise auditing
- Browser extensions
- Mobile applications
- Password sharing between users
- Organization-wide SSO
- Emergency-access workflows

These can become future product areas.

> **Enterprise-use note:** If the product is ever used for organization-owned shared or customer credentials, applicable internal security and approved-vault requirements must be reviewed before such use is supported.

---

# 4. Target Users

## Primary

Individual users who need a secure application for managing personal credentials.

Examples:

- Software developers
- IT professionals
- Power users
- General Windows users

## Future

Multi-device users who want one encrypted vault across multiple computers while retaining local access on each device.

---

# 5. Technology Stack

```text
UI
|
+-- Next.js
+-- React
+-- TypeScript
+-- Tailwind CSS

Desktop Runtime
|
+-- Electron

Local Data
|
+-- SQLite

Security
|
+-- Vault encryption
+-- Key derivation
+-- Restricted Electron IPC
+-- OS-protected secrets where appropriate

Optional Cloud
|
+-- TypeScript backend
+-- REST API initially
+-- Authentication service
+-- Sync service
+-- PostgreSQL

Distribution
|
+-- Windows package / Microsoft Store
```

---

# 6. High-Level Architecture

```text
+---------------------------------------------+
|            Desktop Application              |
|                                             |
|          Next.js / React Renderer           |
|                                             |
| Dashboard                                   |
| Vault                                       |
| Password Generator                          |
| Search                                      |
| Settings                                    |
+--------------------+------------------------+
                     |
                 Restricted IPC
                     |
+--------------------v------------------------+
|              Electron Main                  |
|                                             |
| Vault Service                               |
| Encryption Service                          |
| Database Service                            |
| Sync Service                                |
| Backup Service                              |
+-------------+----------------+--------------+
              |                |
              v                v
        Local SQLite      Optional Cloud
                                 |
                              HTTPS API
                                 |
                    +------------v------------+
                    |      Cloud Service       |
                    |                          |
                    | Authentication           |
                    | Device Registry          |
                    | Sync Engine              |
                    | Encrypted Objects        |
                    +------------+-------------+
                                 |
                                 v
                            PostgreSQL
```

---

# 7. Security Architecture

Security is a first-class product requirement.

## 7.1 Security Boundary

The React/Next.js renderer should **not directly access the vault database**.

```text
Renderer
   |
   | restricted request
   v
Preload / Context Bridge
   |
   | defined IPC operation
   v
Electron Main Process
   |
   v
Vault Service
   |
   +-- Encryption
   |
   +-- SQLite
```

Required separation:

```text
Renderer
   X SQLite access
   X filesystem access
   X encryption keys
   X raw Node APIs
   X unrestricted IPC

Main Process
   OK database
   OK encryption
   OK filesystem
   OK sync
   OK sensitive operations
```

---

# 8. Vault Security

The product has two separate security concepts.

## Master Password

Used to unlock and protect the local vault.

## Cloud Account Authentication

Used to authenticate a user/device to the optional synchronization service.

These concerns should remain separate.

```text
                     USER
                       |
             +---------+---------+
             |                   |
       Master Password       Cloud Login
             |                   |
             v                   v
        Vault Security       Authentication
             |                   |
       Key Derivation             |
             |                   |
             v                   |
      Encryption Key             |
             |                   |
             +---------+---------+
                       |
                     Sync
```

---

# 9. Master Password Handling

The master password must never be stored as plaintext.

Authentication/verification credentials should use an appropriate password-storage design, while vault entries that must later be revealed to the user require encryption rather than one-way hashing.

Conceptually:

```text
Authentication Password
   |
Hash / KDF
   |
Stored verification material
```

Vault credential:

```text
Saved Password
   |
Encryption
   |
Ciphertext
   |
Storage
```

Exact cryptographic algorithms, parameters, key lifecycle, memory handling, and recovery behavior must be finalized in a dedicated security design before implementation.

---

# 10. Local Database

**Technology:** SQLite

Conceptual location:

```text
User device
|
+-- Application Data
      |
      +-- vault.sqlite
```

## Proposed Entities

### Vault

```text
vault
-----
id
name
created_at
updated_at
encryption_version
```

### Vault Item

```text
vault_item
----------
id
vault_id
item_type
encrypted_payload
version
created_at
updated_at
deleted_at
```

### Category

```text
category
--------
id
name
icon
color
created_at
updated_at
```

### Device

```text
device
------
id
name
platform
created_at
last_sync_at
```

### Sync Metadata

```text
sync_metadata
-------------
object_id
local_version
remote_version
sync_state
last_synced_at
```

### Application Settings

```text
settings
--------
key
value
```

The exact schema will be finalized during technical design.

---

# 11. Vault Item Model

The vault should support multiple secure item types.

## V1

- Login
- Secure Note

## Future

- Credit Card
- Identity
- SSH Key
- API Credential
- Software License
- Database Credential
- Wi-Fi Credential
- Custom Secure Item

A login entry may contain:

```text
Login

Title
Username
Password
Website
Notes
Category
Favorite
Created Date
Updated Date
```

Sensitive fields should be placed inside authenticated encrypted payloads rather than exposed as plaintext database fields wherever practical.

---

# 12. Local-Only Mode

Local-only operation is the default product experience.

```text
Welcome
   |
Create Vault
   |
Create Master Password
   |
Choose Storage Mode

(*) Keep my vault on this device
( ) Sync my vault across devices

   |
Create Vault
```

Cloud registration must not be required for local mode.

---

# 13. Optional Cloud Synchronization

Cloud sync is an **opt-in feature**.

```text
Settings
   |
   +-- Cloud Sync
          |
          +-- OFF
          |
          +-- ON
                |
             Sign In
                |
          Register Device
                |
            Initial Sync
```

Security objective:

```text
PLAINTEXT

Generated/entered
on user's device
      |
      v
ENCRYPT
      |
      v
CIPHERTEXT
      |
      +----------> SQLite
      |
      +----------> Cloud Sync
```

The backend should not require plaintext vault secrets to perform synchronization.

---

# 14. Cloud Architecture

```text
                        Internet
                           |
                         HTTPS
                           |
                 +---------v---------+
                 |     API Layer     |
                 +---------+---------+
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
           Auth          Sync         Devices
          Service       Service       Service
             |             |             |
             +-------------+-------------+
                           |
                           v
                      PostgreSQL
```

---

# 15. Cloud Data Model

The backend should understand as little as reasonably possible about vault contents.

## Users

```text
users
-----
id
email
authentication_state
created_at
updated_at
```

## Devices

```text
devices
-------
id
user_id
device_name
device_platform
created_at
last_seen_at
revoked_at
```

## Vault Objects

```text
vault_objects
-------------
id
user_id
encrypted_payload
version
object_type
created_at
updated_at
deleted_at
```

## Sync State

```text
sync_state
----------
user_id
device_id
last_sync_version
last_sync_at
```

The cloud design should prefer an `encrypted_payload` over separate plaintext secret fields.

---

# 16. Synchronization Model

Every synchronized vault object requires an identity and version.

```text
Object

UUID: <unique object identifier>
Version: <object version>
EncryptedPayload: <ciphertext>
UpdatedAt: <timestamp>
```

Conceptual flow:

```text
Local Database
      |
      v
Find modifications
      |
      v
Encrypt changed objects
      |
      v
Upload
      |
      v
Download remote changes
      |
      v
Compare versions
      |
      v
Merge / Conflict
      |
      v
SQLite update
```

---

# 17. Conflict Handling

Example:

```text
                    Version 10
                        |
              +---------+---------+
              |                   |
           Windows              Mac
              |                   |
         changes item        changes item
              |                   |
         Version 11A         Version 11B
              |                   |
              +---------+---------+
                        |
                    CONFLICT
```

The system must not silently discard a conflicting user modification.

Initial requirements:

- Detect conflicting modifications.
- Preserve enough information to recover conflicting versions.
- Inform the user when automatic resolution is unsafe.
- Allow the user to choose the desired version when necessary.

The final merge algorithm remains a technical-design decision.

---

# 18. Offline Behavior

Offline operation is a fundamental requirement.

```text
Internet?

YES
 |
 +-- Local Vault + optional background sync

NO
 |
 +-- Local Vault continues working
```

Therefore:

```text
Cloud unavailable != Vault unavailable
```

Local modifications should remain locally available and become eligible for synchronization when connectivity returns.

---

# 19. Core Functional Requirements

## FR-001 Create Vault

The application shall allow a user to create a local vault.

## FR-002 Unlock Vault

The user shall be able to unlock the vault using the required local vault authentication material.

## FR-003 Lock Vault

The application shall allow the vault to be immediately locked.

## FR-004 Auto Lock

The application shall support automatically locking the vault based on configured security behavior.

## FR-005 Add Login

The user shall be able to create a login entry.

## FR-006 Edit Login

The user shall be able to modify a vault entry.

## FR-007 Delete Login

The user shall be able to delete a vault entry.

## FR-008 Search

The user shall be able to find vault items.

## FR-009 Categories

The user shall be able to organize items into categories.

## FR-010 Favorites

Vault items may be marked as favorites.

## FR-011 Password Generator

The application shall provide a configurable password generator.

## FR-012 Copy Password

The user shall be able to copy password values.

## FR-013 Reveal Password

Passwords shall remain visually concealed until the user intentionally reveals them.

## FR-014 Disable Cloud

The user shall be able to use the application without cloud synchronization.

## FR-015 Enable Cloud

The user shall be able to opt into cloud synchronization.

## FR-016 Device Management

Cloud users shall be able to see devices associated with their account.

## FR-017 Device Revocation

Cloud users shall be able to revoke synchronized devices.

## FR-018 Synchronization Status

The UI shall communicate synchronization state.

Suggested states:

```text
Synced
Syncing
Sync problem
Offline
Conflict
```

---

# 20. Password Generator Product Design

```text
+---------------------------------------+
| Password Generator                    |
|                                       |
|  <generated password>                 |
|                                       |
| Length                         18      |
| -----------------------------o----    |
|                                       |
| [x] Uppercase                         |
| [x] Lowercase                         |
| [x] Numbers                           |
| [x] Symbols                           |
|                                       |
|      Regenerate          Copy         |
+---------------------------------------+
```

Password-generation defaults must remain configurable and should not be presented as satisfying external or enterprise password policies unless the applicable policy has been explicitly mapped to those settings.

---

# 21. Main UI Design

A three-section desktop layout is proposed.

```text
+----------------------------------------------------------+
| MyVault                           Search            Gear  |
+-------------+---------------------+----------------------+
|             |                     |                      |
| All Items   | GitHub              | GitHub               |
| Favorites   | Microsoft           |                      |
| Logins      | AWS                 | username             |
| Notes       | Gmail               | mark@example.com     |
|             | Azure               |                      |
| Categories  | Jira                | password             |
|             |                     | ************   View  |
| Development |                     |                      |
| Personal    |                     | website              |
| Work        |                     | github.com           |
|             |                     |                      |
|             |                     |          Edit        |
+-------------+---------------------+----------------------+
| Vault unlocked                              Synced        |
+----------------------------------------------------------+
```

---

# 22. Settings Design

```text
Settings
|
+-- General
|   +-- Launch on startup
|   +-- Minimize behavior
|   +-- Theme
|
+-- Security
|   +-- Vault lock
|   +-- Auto-lock policy
|   +-- Clipboard behavior
|
+-- Cloud Sync
|   +-- Enable Cloud Sync
|   +-- Account
|   +-- Devices
|   +-- Last Sync
|   +-- Sync Now
|
+-- Backup
|   +-- Export backup
|   +-- Restore backup
|
+-- About
    +-- Version
    +-- Privacy
    +-- Licenses
```

---

# 23. Electron Security Requirements

## SEC-E01 Context Isolation

Electron context isolation shall be enabled.

## SEC-E02 Restricted Renderer

Renderer code shall not receive unrestricted Electron or Node APIs.

## SEC-E03 Narrow IPC Contracts

IPC methods shall be narrowly defined.

Example:

```text
vault.create()
vault.unlock()
vault.getItems()
vault.saveItem()
vault.deleteItem()
vault.lock()

sync.status()
sync.start()
```

Avoid generic interfaces such as:

```text
sendAnything(channel, data)
```

## SEC-E04 Dependency Management

Electron, Chromium-related runtime dependencies, Node dependencies, and application packages must be actively maintained, reviewed, and updated under an explicit dependency-management process.

---

# 24. Logging Requirements

The application must not intentionally log sensitive secrets.

Sensitive values include:

```text
Master password
Vault encryption key
Decrypted password
Secure note contents
Authentication token
Recovery secrets
```

Operational logging should be limited to non-secret events, for example:

```text
Vault unlocked
Vault locked
Sync attempted
Sync succeeded
Sync conflict detected
Database migration applied
```

---

# 25. Backup & Recovery

Local users require backup functionality because cloud synchronization is optional.

```text
Local Vault
    |
    v
Encrypted Backup
    |
    v
User-selected location
```

Requirements:

- Backups must preserve vault protection.
- Backup should not create plaintext credential exports by default.
- Restore must validate compatibility and integrity.
- Corrupted or invalid backups must fail safely.
- Recovery design must be documented separately before implementation.

---

# 26. Cloud Failure Behavior

The application must gracefully handle conditions such as:

```text
No Internet
Timeout
Cloud unavailable
Authentication expired
Device revoked
Sync conflict
Remote record unavailable
```

Expected local-first behavior:

```text
Sync unavailable
      |
      v
Local vault remains usable
      |
      v
Keep local modifications
      |
      v
Synchronize when possible
```

---

# 27. Product Security Threat Areas

Before public release, the design should explicitly consider at least:

```text
Database theft
Device theft
Cloud database compromise
Malicious renderer / XSS
IPC abuse
Dependency compromise
Memory exposure
Clipboard exposure
Backup theft
Weak master password
Brute-force attack
Sync replay
Device impersonation
Session/token theft
Malicious update
```

A formal threat model and security review should be completed before production release.

---

# 28. Windows Distribution

Windows distribution will target a Microsoft Store-compatible packaging and submission process.

Proposed release flow:

```text
Git Repository
      |
      v
Automated Tests
      |
      v
Security Checks
      |
      v
Production Build
      |
      v
Electron Application
      |
      v
Windows Package
      |
      v
Store Submission
```

Platform/package compatibility details will be validated against current Microsoft Store and MSIX requirements during release engineering.

---

# 29. Suggested Release Scope

## V1: Local Vault

```text
Desktop UI
SQLite
Vault creation
Vault locking/unlocking
Login items
Secure notes
Search
Categories
Favorites
Password generator
Local backup/restore
Windows packaging
```

## V2: Cloud Sync

```text
Cloud account
Authentication
Encrypted sync
Device registry
Conflict detection
Offline synchronization
Device revocation
```

## V3: Productivity

Potential scope:

```text
Browser integration
Improved autofill
Import/export integrations
Password health
Breach-related functionality
Advanced generator
```

## V4: Multi-platform

```text
macOS
Linux
```

---

# 30. Repository Structure

A monorepo is proposed so desktop, cloud, shared contracts, and tests can evolve together.

```text
password-manager/
|
+-- apps/
|   |
|   +-- desktop/
|   |   +-- electron/
|   |   |   +-- main/
|   |   |   +-- preload/
|   |   |
|   |   +-- renderer/
|   |       +-- app/
|   |       +-- components/
|   |       +-- features/
|   |
|   +-- api/
|       +-- auth/
|       +-- devices/
|       +-- sync/
|       +-- infrastructure/
|
+-- packages/
|   +-- contracts/
|   +-- crypto/
|   +-- database/
|   +-- validation/
|
+-- tests/
|   +-- unit/
|   +-- integration/
|   +-- e2e/
|
+-- docs/
    +-- architecture/
    +-- security/
    +-- product/
    +-- qa/
```

---

# 31. Testing Strategy

## Unit Tests

```text
Vault models
Validation
Password generator
Version handling
Sync comparison logic
```

## Integration Tests

```text
SQLite <-> Vault Service
Encryption <-> Storage
Electron IPC <-> Vault Service
Sync Client <-> API
API <-> PostgreSQL
```

## Security Tests

```text
IPC authorization
Renderer isolation
Sensitive logging tests
Malformed vault handling
Tampered encrypted records
Authentication failure
Replay scenarios
Revoked device
```

## End-to-End Tests

```text
Create vault
Unlock vault
Create password
Edit password
Search
Lock
Restart
Unlock
Backup
Restore
Enable sync
Offline modification
Reconnect
Conflict
```

---

# 32. Product Definition

> **A local-first, cross-platform desktop password manager built with Next.js, React, TypeScript, and Electron, using an encrypted SQLite-backed local vault with optional encrypted multi-device cloud synchronization and a PostgreSQL-backed synchronization service.**

Core engineering philosophy:

```text
OFFLINE FIRST
     +
LOCAL VAULT
     +
CLIENT-SIDE SECURITY
     +
OPTIONAL CLOUD SYNC
     +
ZERO DEPENDENCY ON CLOUD FOR BASIC USE
     +
CROSS-PLATFORM FOUNDATION
```

---

# 33. Next Technical Specifications

Before implementation begins, the following detailed specifications should be created:

1. Vault cryptography specification
2. Threat model
3. SQLite schema and migration strategy
4. Electron IPC contract
5. Cloud API contract
6. Synchronization protocol
7. Conflict-resolution specification
8. Authentication and device-registration design
9. Backup/recovery format specification
10. Security test plan
11. Store packaging/release specification

These documents should turn the product-level requirements above into implementation-ready technical contracts.
