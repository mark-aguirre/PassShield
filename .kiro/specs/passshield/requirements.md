# Requirements Document

## Introduction

passShield is a local-first, cross-platform desktop password manager. Its central principle is that the user's vault belongs to the user: a person can install the app, create a vault, store and generate credentials, and use it indefinitely **without an online account**. Cloud synchronization is an optional, future capability layered on top of the local experience.

This spec covers the **V1 (Local Vault)** release scope, targeting Windows first with an architecture that keeps the door open for optional cloud sync (V2) and macOS/Linux (V4). The technology stack is Next.js/React/TypeScript for the renderer, Electron for the desktop runtime, and encrypted SQLite for local storage.

V1 explicitly excludes: cloud sync, accounts, device management, browser extensions, mobile apps, and any enterprise/team/sharing features. The design must not prevent adding cloud sync later, but no cloud code is required for V1.

## Requirements

### Requirement 1: Create a Local Vault

**User Story:** As an individual user, I want to create a local vault protected by a master password, so that I can store credentials securely on my own device without an online account.

#### Acceptance Criteria

1. WHEN the application launches AND no vault exists THEN the system SHALL present a first-run flow to create a vault.
2. WHEN the user creates a vault THEN the system SHALL require the user to set a master password.
3. WHEN the user sets a master password THEN the system SHALL require confirmation of that password before creating the vault.
4. WHEN the user completes vault creation THEN the system SHALL create a local SQLite database in the application data directory.
5. WHEN a vault is created THEN the system SHALL NOT require any cloud registration or network connectivity.
6. IF the confirmation password does not match the master password THEN the system SHALL reject creation and inform the user without creating a vault.
7. WHERE storage mode selection is offered THE system SHALL default to "keep my vault on this device".

### Requirement 2: Unlock and Lock the Vault

**User Story:** As a user, I want to unlock my vault with my master password and lock it on demand, so that my credentials are protected when I am not using them.

#### Acceptance Criteria

1. WHEN the application launches AND a vault exists THEN the system SHALL present an unlock screen and keep the vault locked until authenticated.
2. WHEN the user enters the correct master password THEN the system SHALL unlock the vault and grant access to vault contents.
3. IF the user enters an incorrect master password THEN the system SHALL deny access AND SHALL NOT reveal any vault contents.
4. WHEN the user chooses to lock the vault THEN the system SHALL immediately lock it and clear decrypted secrets from memory where practical.
5. WHILE the vault is locked THE system SHALL NOT expose decrypted vault contents to the renderer.
6. WHEN the vault is locked or unlocked THEN the system SHALL reflect the current state in the UI.

### Requirement 3: Auto-Lock

**User Story:** As a security-conscious user, I want the vault to lock automatically based on my configured policy, so that it is not left open unattended.

#### Acceptance Criteria

1. WHERE an auto-lock policy is configured THE system SHALL lock the vault when the policy condition is met (for example, after a period of inactivity).
2. WHEN the configured inactivity timeout elapses without user activity THEN the system SHALL lock the vault.
3. WHEN the vault auto-locks THEN the system SHALL clear decrypted secrets from memory where practical.
4. WHERE the user configures the auto-lock timeout THE system SHALL persist that setting and apply it on subsequent sessions.

### Requirement 4: Manage Login Items

**User Story:** As a user, I want to add, edit, and delete login entries, so that I can keep my credentials organized and up to date.

#### Acceptance Criteria

1. WHEN the vault is unlocked THEN the system SHALL allow the user to create a login entry with title, username, password, website, notes, category, and favorite flag.
2. WHEN the user saves a login entry THEN the system SHALL store sensitive fields inside an authenticated encrypted payload rather than as plaintext database columns.
3. WHEN the user edits an existing entry THEN the system SHALL persist the changes and update the item's updated timestamp and version.
4. WHEN the user deletes an entry THEN the system SHALL remove it from the active vault view.
5. IF the vault is locked THEN the system SHALL NOT permit creating, editing, or deleting entries.
6. WHEN an entry is created THEN the system SHALL record created and updated timestamps.

### Requirement 5: Manage Secure Notes

**User Story:** As a user, I want to store secure notes, so that I can keep sensitive free-form text protected in my vault.

#### Acceptance Criteria

1. WHEN the vault is unlocked THEN the system SHALL allow the user to create a secure note with a title and note contents.
2. WHEN the user saves a secure note THEN the system SHALL store the note contents inside an authenticated encrypted payload.
3. WHEN the user edits or deletes a secure note THEN the system SHALL persist the change consistently with login items.

### Requirement 6: Search the Vault

**User Story:** As a user, I want to search my vault, so that I can quickly find a specific item.

#### Acceptance Criteria

1. WHEN the vault is unlocked AND the user enters a search query THEN the system SHALL return matching vault items.
2. WHEN a search query matches item metadata (such as title) THEN the system SHALL include those items in results.
3. WHEN the search query is cleared THEN the system SHALL return to the full item list.
4. WHILE searching THE system SHALL NOT expose decrypted secret values that the user has not explicitly revealed.

### Requirement 7: Categories and Favorites

**User Story:** As a user, I want to organize items into categories and mark favorites, so that I can navigate a large vault efficiently.

#### Acceptance Criteria

1. WHEN the vault is unlocked THEN the system SHALL allow the user to assign an item to a category.
2. WHEN the user creates or selects categories THEN the system SHALL persist category name, icon, and color.
3. WHEN the user filters by a category THEN the system SHALL display only items in that category.
4. WHEN the user marks an item as favorite THEN the system SHALL persist the favorite flag AND provide a favorites view.

### Requirement 8: Password Generator

**User Story:** As a user, I want a configurable password generator, so that I can create strong, unique passwords.

#### Acceptance Criteria

1. WHEN the user opens the password generator THEN the system SHALL generate a password using the current settings.
2. WHERE generator options are provided THE system SHALL support configurable length and inclusion of uppercase, lowercase, numbers, and symbols.
3. WHEN the user changes a generator option THEN the system SHALL be able to regenerate a password reflecting the new settings.
4. WHEN the user requests regeneration THEN the system SHALL produce a new password without reusing the previous one by default.
5. WHEN the user copies the generated password THEN the system SHALL place it on the clipboard.
6. WHERE generator defaults are shown THE system SHALL NOT present them as satisfying any external or enterprise password policy unless such a policy has been explicitly mapped.

### Requirement 9: Reveal and Copy Secrets Safely

**User Story:** As a user, I want passwords hidden by default and copied without lingering, so that my secrets are not casually exposed.

#### Acceptance Criteria

1. WHILE displaying a password field THE system SHALL keep the value visually concealed until the user intentionally reveals it.
2. WHEN the user chooses to reveal a password THEN the system SHALL display the plaintext value.
3. WHEN the user copies a password THEN the system SHALL place the value on the clipboard.
4. WHERE a clipboard-clear policy is configured THE system SHALL clear the copied secret from the clipboard after the configured interval.
5. WHEN the vault locks THEN the system SHALL re-conceal any revealed values.

### Requirement 10: Local Backup and Restore

**User Story:** As a local-only user, I want to back up and restore my vault, so that I can recover my data since cloud sync is optional.

#### Acceptance Criteria

1. WHEN the user requests a backup THEN the system SHALL produce an encrypted backup that preserves vault protection.
2. WHEN creating a backup THEN the system SHALL NOT produce a plaintext credential export by default.
3. WHEN the user restores from a backup THEN the system SHALL validate backup compatibility and integrity before applying it.
4. IF a backup is corrupted or invalid THEN the system SHALL fail safely without damaging the existing vault.
5. WHEN the user selects a backup location THEN the system SHALL write the backup to the user-selected location.

### Requirement 11: Renderer/Main Security Boundary

**User Story:** As a security-conscious user, I want the UI to be strictly separated from vault internals, so that a compromised renderer cannot directly access my secrets.

#### Acceptance Criteria

1. WHERE the renderer runs THE system SHALL NOT grant it direct access to SQLite, the filesystem, encryption keys, raw Node APIs, or unrestricted IPC.
2. WHEN the renderer needs a vault operation THEN it SHALL request it through a narrowly defined IPC contract exposed via a context bridge.
3. WHERE Electron is configured THE system SHALL enable context isolation and SHALL NOT enable unrestricted Node integration in the renderer.
4. WHEN defining IPC THEN the system SHALL expose specific operations (for example vault.create, vault.unlock, vault.getItems, vault.saveItem, vault.deleteItem, vault.lock) rather than a generic pass-through channel.
5. WHERE sensitive operations occur (database, encryption, filesystem, backup) THE system SHALL perform them in the Electron main process.

### Requirement 12: Master Password and Vault Cryptography Handling

**User Story:** As a user, I want my master password and vault to be handled with sound cryptography, so that my secrets remain protected even if my device or database is stolen.

#### Acceptance Criteria

1. WHERE the master password is handled THE system SHALL NOT store it as plaintext.
2. WHEN verifying the master password THEN the system SHALL use a key-derivation-based verification approach rather than storing the raw password.
3. WHEN storing vault entries that must later be revealed THEN the system SHALL use authenticated encryption rather than one-way hashing.
4. WHEN deriving the encryption key THEN the system SHALL derive it from the master password using a key derivation function.
5. WHERE cryptographic algorithms, parameters, key lifecycle, and recovery behavior are chosen THE system SHALL finalize them in a dedicated security design before implementation.

### Requirement 13: Non-Sensitive Logging Only

**User Story:** As a user, I want the app to avoid logging my secrets, so that logs cannot leak my credentials.

#### Acceptance Criteria

1. WHERE the application logs events THE system SHALL NOT intentionally log master passwords, encryption keys, decrypted passwords, secure note contents, authentication tokens, or recovery secrets.
2. WHEN logging operational events THEN the system SHALL limit them to non-secret events such as vault locked, vault unlocked, and database migration applied.

### Requirement 14: Local-First Operation Without Cloud

**User Story:** As a user, I want full functionality offline, so that the vault remains usable regardless of network conditions.

#### Acceptance Criteria

1. WHILE there is no network connectivity THE system SHALL continue to provide full local vault functionality.
2. WHERE cloud sync is out of scope for V1 THE system SHALL operate entirely without cloud dependencies.
3. WHEN local modifications are made THEN the system SHALL persist them locally so they remain available across restarts.

### Requirement 15: Windows Packaging

**User Story:** As a Windows user, I want to install passShield through a supported Windows package, so that installation is straightforward and trustworthy.

#### Acceptance Criteria

1. WHEN a production build is produced THEN the system SHALL package the Electron application into a Windows-compatible package.
2. WHERE Microsoft Store distribution is targeted THE system SHALL produce packaging compatible with current Microsoft Store/MSIX requirements, validated during release engineering.
3. WHEN the application is packaged THEN the system SHALL store its vault database in an appropriate per-user application data location.

### Requirement 16: Application Chrome and Navigation

**User Story:** As a user, I want a consistent top bar and sidebar, so that I can navigate my vault and reach key actions from anywhere.

#### Acceptance Criteria

1. WHERE the main window is shown THE system SHALL display a top bar with global search, a New Item action, a lock control, and a settings control.
2. WHERE the sidebar is shown THE system SHALL provide navigation to All Items, Favorites, Recent, Logins, Secure Notes, and Categories, each with an item count.
3. WHEN the user activates the lock control THEN the system SHALL lock the vault immediately (consistent with Requirement 2).
4. WHILE the vault is unlocked THE system SHALL display vault status and the auto-lock countdown in the sidebar.
5. WHEN the user presses the global search shortcut (Ctrl+K) THEN the system SHALL focus the search input.

### Requirement 17: Recent Items and List Presentation

**User Story:** As a user, I want to see recently used items and control how the list is sorted and displayed, so that I can find items the way I prefer.

#### Acceptance Criteria

1. WHEN the user selects Recent THEN the system SHALL display items ordered by most recent activity.
2. WHERE a list or results view is shown THE system SHALL provide sort options (for example Title A–Z, and Relevance for search).
3. WHERE the search results or category views are shown THE system SHALL provide a list/grid view toggle.
4. WHEN list results are displayed THEN the system SHALL show item metadata (title, subtitle, category) without revealing secret values.

### Requirement 18: Password Strength Feedback

**User Story:** As a user, I want to see how strong a password is, so that I can make informed choices when creating or generating credentials.

#### Acceptance Criteria

1. WHEN the user enters or generates a password THEN the system SHALL display a strength indicator.
2. WHERE a strength indicator is shown THE system SHALL compute it locally without transmitting the password.
3. WHERE strength is presented THE system SHALL NOT claim compliance with any external or enterprise password policy.

### Requirement 19: Extended Password Generator Options

**User Story:** As a user, I want fine-grained generator controls, so that generated passwords meet the constraints of the sites I use.

#### Acceptance Criteria

1. WHERE generator options are provided THE system SHALL support excluding similar/ambiguous characters (for example l, 1, I, 0, O).
2. WHERE generator options are provided THE system SHALL support minimum-count constraints for numbers and symbols.
3. WHERE the "ensure every selected type" option is enabled THE system SHALL guarantee at least one character from each enabled character class.
4. IF the requested minimums or length are mutually unsatisfiable THEN the system SHALL prevent generation and inform the user rather than produce an invalid password.

### Requirement 20: Soft Delete (Trash)

**User Story:** As a user, I want deleted items to go to a trash before permanent removal, so that I can recover from accidental deletions.

#### Acceptance Criteria

1. WHEN the user chooses "Move to Trash" on an item THEN the system SHALL soft-delete the item (set its deleted timestamp) and remove it from active views.
2. WHILE an item is in trash THE system SHALL allow the user to restore it to its previous state.
3. WHEN the user permanently deletes a trashed item THEN the system SHALL remove it from storage.
4. WHILE the vault is locked THE system SHALL NOT permit trashing, restoring, or permanently deleting items.

### Requirement 21: Category Metadata Management

**User Story:** As a user, I want to create and manage categories with names, descriptions, colors, and icons, so that my vault stays organized and readable.

#### Acceptance Criteria

1. WHEN the user creates or edits a category THEN the system SHALL persist its name, description, icon, and color.
2. WHEN the user views categories THEN the system SHALL show each category's item count.
3. WHEN the user deletes a category THEN the system SHALL handle items assigned to it without data loss (for example, reassign to Other or clear the assignment).
4. WHERE the category management view is shown THE system SHALL allow searching and sorting categories.
