import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  collectSubtreeIds,
  createItem,
  deleteItem,
  listChildren,
  listItems,
  openDatabase,
  restoreItem,
  trashItem,
  updateItem,
  type VaultDatabase,
} from '@PassShield/database';

/**
 * Secure-note sub-pages, exercised at the database query layer.
 *
 * These tests lock in the parent/child (sub-page) behavior added in schema v2:
 *   - a child item stores its parent via `parent_id`
 *   - `listChildren` returns a parent's direct children only
 *   - `listItems` hides sub-pages from the main lists via `topLevelOnly`
 *   - `collectSubtreeIds` walks the whole descendant tree (arbitrary depth)
 *   - trashing a parent cascades the soft-delete to its entire sub-tree
 *   - permanently deleting a parent cascades (ON DELETE CASCADE) to descendants
 *
 * The database is opened in-memory, which runs the migration runner and enables
 * foreign keys, so this covers the real v2 schema end to end. No encryption is
 * involved here; the query layer stores opaque ciphertext text, so a stub
 * payload string stands in for `encrypted_payload`.
 */
describe('secure-note sub-pages (database layer)', () => {
  let db: VaultDatabase;

  /** Minimal note-item factory; `encrypted_payload` is opaque at this layer. */
  function makeNote(title: string, parentId: string | null = null) {
    return createItem(db, {
      itemType: 'note',
      title,
      categoryId: null,
      isFavorite: false,
      encryptedPayload: 'ciphertext',
      parentId,
    });
  }

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('creates a child note that references its parent', () => {
    const parent = makeNote('Parent');
    const child = makeNote('Child', parent.id);

    expect(parent.parent_id).toBeNull();
    expect(child.parent_id).toBe(parent.id);
  });

  it('lists only a parent’s direct children via listChildren', () => {
    const parent = makeNote('Parent');
    const childB = makeNote('B child', parent.id);
    const childA = makeNote('A child', parent.id);
    const grandchild = makeNote('Grandchild', childA.id);
    makeNote('Unrelated top-level');

    const children = listChildren(db, parent.id);

    // Direct children only (not the grandchild), ordered title A–Z by default.
    expect(children.map((c) => c.title)).toEqual(['A child', 'B child']);
    expect(children.every((c) => c.parent_id === parent.id)).toBe(true);
    // The grandchild is a child of childA, not the parent.
    expect(listChildren(db, childA.id).map((c) => c.id)).toEqual([grandchild.id]);
  });

  it('hides sub-pages from the main note list (topLevelOnly)', () => {
    const parent = makeNote('Top-level note');
    makeNote('Sub-page', parent.id);
    makeNote('Another top-level note');

    const topLevel = listItems(db, { scope: 'notes', topLevelOnly: true });
    expect(topLevel.map((r) => r.title).sort()).toEqual([
      'Another top-level note',
      'Top-level note',
    ]);

    // Without topLevelOnly, the sub-page is included.
    const all = listItems(db, { scope: 'notes' });
    expect(all).toHaveLength(3);
  });

  it('collects the full descendant subtree at arbitrary depth', () => {
    const root = makeNote('Root');
    const child = makeNote('Child', root.id);
    const grandchild = makeNote('Grandchild', child.id);

    const ids = collectSubtreeIds(db, root.id).sort();
    expect(ids).toEqual([child.id, grandchild.id, root.id].sort());
  });

  it('cascades soft-delete (trash) to the entire sub-tree', () => {
    const root = makeNote('Root');
    const child = makeNote('Child', root.id);
    const grandchild = makeNote('Grandchild', child.id);

    expect(trashItem(db, root.id)).toBe(true);

    // None of the sub-tree remains in the active lists.
    expect(listItems(db, { scope: 'notes' })).toHaveLength(0);
    // But they still exist as trashed rows.
    for (const id of [root.id, child.id, grandchild.id]) {
      const row = getRow(id);
      expect(row?.deleted_at).not.toBeNull();
    }
  });

  it('does not cascade soft-delete beyond the targeted sub-tree', () => {
    const root = makeNote('Root');
    makeNote('Child', root.id);
    const sibling = makeNote('Sibling top-level');

    trashItem(db, root.id);

    // A sibling top-level note is untouched.
    const active = listItems(db, { scope: 'notes' });
    expect(active.map((r) => r.id)).toEqual([sibling.id]);
  });

  it('restores only the targeted item (restore is not a subtree cascade)', () => {
    const root = makeNote('Root');
    const child = makeNote('Child', root.id);

    trashItem(db, root.id);
    expect(restoreItem(db, root.id)).toBe(true);

    // The root is active again; the child remains trashed until restored.
    expect(getRow(root.id)?.deleted_at).toBeNull();
    expect(getRow(child.id)?.deleted_at).not.toBeNull();
  });

  it('cascades permanent delete to descendants (ON DELETE CASCADE)', () => {
    const root = makeNote('Root');
    const child = makeNote('Child', root.id);
    const grandchild = makeNote('Grandchild', child.id);

    expect(deleteItem(db, root.id)).toBe(true);

    // The whole sub-tree is gone from storage entirely.
    for (const id of [root.id, child.id, grandchild.id]) {
      expect(getRow(id)).toBeUndefined();
    }
  });

  it('can re-parent a note by updating its parentId', () => {
    const oldParent = makeNote('Old parent');
    const newParent = makeNote('New parent');
    const child = makeNote('Child', oldParent.id);

    const updated = updateItem(db, {
      id: child.id,
      title: child.title,
      categoryId: null,
      isFavorite: false,
      encryptedPayload: 'ciphertext',
      parentId: newParent.id,
    });

    expect(updated?.parent_id).toBe(newParent.id);
    expect(listChildren(db, oldParent.id)).toHaveLength(0);
    expect(listChildren(db, newParent.id).map((c) => c.id)).toEqual([child.id]);
  });

  /** Read a row directly, including trashed ones, for assertions. */
  function getRow(id: string) {
    return db
      .prepare('SELECT id, deleted_at FROM vault_item WHERE id = @id')
      .get({ id }) as { id: string; deleted_at: string | null } | undefined;
  }
});
