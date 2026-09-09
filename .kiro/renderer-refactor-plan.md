# Renderer API Layer + Hooks Refactor

## Architecture Direction

**CQRS-lite + Application/Service Layer + Typed IPC Contract**

The main-process side (IPC router, VaultService, repositories) is already well-structured. The gap is on the renderer side: every component calls `window.passShield.*` directly, owns its own async state machinery, and mixes UI lifecycle with data-fetching concerns.

This plan introduces the renderer abstraction layers that are missing.

---

## Target Architecture

```
Component
    ↓
React Hook  (useVault / useItems / useCategories / useSettings)
    ↓
lib/api.ts  (typed PassShieldApi binding)
    ↓
IPC  (window.passShield — only touched by api.ts)
    ↓
IPC Handler  (ipc-router.ts)
    ↓
Application Service  (VaultService etc.)
    ↓
Repository / Database
```

**Dependency direction:**

```
             ┌─────────────────┐
             │    Renderer     │
             │ Components/Hooks│
             └────────┬────────┘
                      ↓
             ┌─────────────────┐
             │  Typed API      │
             │  lib/api.ts     │
             └────────┬────────┘
                      ↓
             ┌─────────────────┐
             │      IPC        │
             └────────┬────────┘
                      ↓
             ┌─────────────────┐
             │    Services     │
             │ Business Logic  │
             └────────┬────────┘
                      ↓
             ┌─────────────────┐
             │  Repositories   │
             └────────┬────────┘
                      ↓
             ┌─────────────────┐
             │ Encrypted Store │
             └─────────────────┘
```

---

## Key Architectural Rules

1. **`window.passShield` is only referenced in `renderer/src/lib/api.ts`** — nowhere else in the renderer.
2. **Hooks handle UI state and lifecycle** — they do not own business logic. Business logic stays on the main-process service layer.
3. **`Result<T>` is used consistently across IPC** — mutations surface errors via TanStack Query's `error` state rather than hand-rolled `useState` flags.
4. **TanStack Query owns all async/cache state** — components do not write their own `useEffect` loading loops.
5. **Renderer must never access the database, encryption keys, or Node.js APIs directly.**

---

## What Was Kept vs. Changed from the Original Proposal

### Kept
- Typed IPC contract (`@passshield/contracts` `PassShieldApi`) — already existed, no changes needed
- Service/application layer on main process — already existed
- `Result<T>` consistently on main-process side — already existed
- CQRS-lite IPC handler split — already existed in `ipc-router.ts`
- Narrow preload surface — already correct

### Changed / Added
- `renderer/src/lib/api.ts` — typed binding (NEW)
- TanStack Query as renderer async/cache layer (NEW)
- Domain hooks: `useVault`, `useItems`, `useCategories`, `useSettings` (NEW)
- All components migrated off `window.passShield.*` (MIGRATION)
- ESLint rule banning `window.passShield` outside `lib/api.ts` (NEW)

---

## Current State (pre-refactor)

`window.passShield.*` is called directly from:

- `page.tsx` — vault probe, status, onLocked subscription
- `UnlockScreen.tsx` — vault.unlock
- `VaultLayout.tsx` — vault.lock, activity.ping, items.get, items.save (toggle favorite)
- `ItemList.tsx` — items.list
- `ItemDetail.tsx` — items.get, items.listChildren, categories.list
- `FavoritesView.tsx` — items.list
- `SearchResults.tsx` — items.search, items.list, categories.list
- `ItemEditor.tsx` — items.get, items.save, items.trash, categories.list
- `CategoryManagement.tsx` — categories.list, categories.save, categories.delete
- `SettingsView.tsx` — settings.get, settings.update, vault.changeMasterPassword, backup.export, backup.restore
- `PasswordGenerator.tsx` — generator.generate, clipboard.copySecret
- `Sidebar.tsx` — items.list (×5 scopes), categories.list, vault.status

---

## Implementation Order

### Step 0 — Already done (main-process side)
- `@passshield/contracts` — complete typed IPC contract ✓
- `preload.ts` — narrow, typed contextBridge exposure ✓
- `ipc-router.ts` — validated handlers, safe Result<T> ✓
- `vault-service.ts` — application service layer ✓

### Step 1 — `renderer/src/lib/api.ts`
Typed binding: `export const api: PassShieldApi = window.passShield`

### Step 2 — TanStack Query setup
Install `@tanstack/react-query`. Create `lib/query-client.ts`. Wire `QueryClientProvider` in app layout.

### Step 3 — `useVault` hook
`useQuery` for status. Mutations for lock/unlock/create/changeMasterPassword. `vault.onLocked` subscription wired as `useEffect` with cache invalidation.

### Step 4 — `useItems` hook
- `useItemList(filter?, sort?)` — query with key `['items', 'list', filter, sort]`
- `useItemDetail(id)` — query with key `['items', 'detail', id]`
- `useItemChildren(parentId)` — query with key `['items', 'children', parentId]`
- `useItemSearch(query, sort?)` — query with key `['items', 'search', query, sort]`
- Mutations: `saveItem`, `trashItem`, `restoreItem`, `deleteItem`, `toggleFavorite`

### Step 5 — `useCategories` + `useSettings` hooks
- `useCategories()` — query + save/delete mutations (invalidates `['categories']` and `['items']`)
- `useSettings()` — query + optimistic update mutation

### Step 6 — Migrate `page.tsx` + `UnlockScreen`
Replace vault probe/status/onLocked with `useVault()`.

### Step 7 — Migrate item components
`ItemList`, `ItemDetail`, `FavoritesView`, `SearchResults`, `VaultLayout`, `ItemEditor`.

### Step 8 — Migrate utility overlays
`CategoryManagement`, `SettingsView`, `PasswordGenerator`, `Sidebar`.

### Step 9 — ESLint security boundary
`no-restricted-syntax` rule banning `window.passShield` outside `lib/api.ts`.

---

## File Layout (post-refactor)

```
renderer/src/
├── app/
│   ├── layout.tsx          ← QueryClientProvider added here
│   ├── page.tsx            ← uses useVault()
│   ├── view-state.ts       ← unchanged
│   └── components/
│       ├── UnlockScreen.tsx        ← useVault().unlock
│       ├── SettingsView.tsx        ← useSettings(), useVault().changeMasterPassword
│       ├── ItemEditor.tsx          ← useItems().saveItem, useCategories()
│       └── vault/
│           ├── VaultLayout.tsx     ← useVault().lock, useItems().toggleFavorite
│           ├── ItemList.tsx        ← useItemList()
│           ├── ItemDetail.tsx      ← useItemDetail(), useItemChildren(), useCategories()
│           ├── FavoritesView.tsx   ← useItemList({ scope: 'favorites' })
│           ├── SearchResults.tsx   ← useItemSearch()
│           ├── Sidebar.tsx         ← useCategories(), useItemList (×5)
│           ├── CategoryManagement.tsx ← useCategories()
│           └── PasswordGenerator.tsx  ← direct api.* via useMutation
│
└── lib/
    ├── api.ts              ← ONLY place window.passShield is referenced  ← NEW
    ├── query-client.ts     ← QueryClient instance + config               ← NEW
    ├── utils.ts            ← unchanged
    ├── image.ts            ← unchanged
    └── attachment.ts       ← unchanged

renderer/src/hooks/         ← NEW directory
    ├── useVault.ts
    ├── useItems.ts
    ├── useCategories.ts
    └── useSettings.ts
```

---

## Notes on TanStack Query Configuration

For a desktop Electron app with a local vault:

- `staleTime: 30_000` — data from a local process doesn't go stale quickly
- `gcTime: 5 * 60_000` — keep cache for 5 minutes after last subscriber
- `retry: false` — IPC calls either succeed or fail; retrying a `locked` error is wrong
- `refetchOnWindowFocus: false` — Electron window focus is not a reliable signal for IPC data staleness

Sensitive operations (unlock, lock, changeMasterPassword) use `useMutation` only — never cached.

After a successful vault lock, all item/category queries are invalidated so they return empty on next use (matching the main process returning `locked` errors while locked).

---

## `Result<T>` Handling Convention

Mutations that return `Result<T>` should:
1. Check `result.ok` inside `mutationFn`
2. Throw an `Error(result.error.message)` on failure — this surfaces it as the mutation's `error` property
3. Components read `mutation.error?.message` for display — no hand-rolled error state needed

Example:
```ts
const saveItem = useMutation({
  mutationFn: async (input: SaveItemInput) => {
    const result = await api.items.save(input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['items'] });
  },
});
```
