import { beforeEach, describe, expect, it } from 'vitest';

import { PANTRY_ITEM_LIMIT, type PantryItem } from '../../src/shared/pantry';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  seedOtherHousehold,
  seedPantryItem,
  testEnv,
} from './helpers';

const ITEMS_URL = 'https://example.test/api/pantry/items';
const itemUrl = (id: string) => `${ITEMS_URL}/${id}`;

const listItems = async (): Promise<PantryItem[]> => {
  const response = await fetchWorker(new Request(ITEMS_URL));
  expect(response.status).toBe(200);
  const body = await response.json<{ items: PantryItem[] }>();
  return body.items;
};

const addItem = (name: string, status = 'available'): Promise<Response> =>
  fetchWorker(new Request(ITEMS_URL, mutationInit('POST', { name, status })));

const addItemOk = async (name: string, status = 'available') => {
  const response = await addItem(name, status);
  expect(response.status).toBe(201);
  const body = await response.json<{ item: PantryItem }>();
  return body.item;
};

const patchItem = (id: string, body: unknown): Promise<Response> =>
  fetchWorker(new Request(itemUrl(id), mutationInit('PATCH', body)));

const deleteItem = (id: string, body: unknown): Promise<Response> =>
  fetchWorker(new Request(itemUrl(id), mutationInit('DELETE', body)));

describe('pantry API', () => {
  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
  });

  it('starts empty and adds an item with a signal but no quantity', async () => {
    expect(await listItems()).toEqual([]);

    const item = await addItemOk('Rice', 'available');

    expect(item).toMatchObject({
      name: 'Rice',
      status: 'available',
      version: 1,
    });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Object.keys(item).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'status',
      'updatedAt',
      'version',
    ]);
    expect(await listItems()).toHaveLength(1);
  });

  it('orders needed before low before available, then by name', async () => {
    await addItemOk('zucchini', 'needed');
    await addItemOk('apples', 'needed');
    await addItemOk('olive oil', 'low');
    await addItemOk('rice', 'available');

    expect((await listItems()).map((item) => item.name)).toEqual([
      'apples',
      'zucchini',
      'olive oil',
      'rice',
    ]);
  });

  it('treats case, spacing, and Unicode form differences as the same item', async () => {
    await addItemOk('Olive Oil');

    for (const duplicate of ['olive oil', 'OLIVE   OIL', '  Olive Oil  ']) {
      const response = await addItem(duplicate);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'duplicate_name' },
      });
    }

    expect(await listItems()).toHaveLength(1);
  });

  it('keeps the human spelling while de-duplicating on the folded name', async () => {
    const item = await addItemOk('  Crème   Fraîche  ');
    expect(item.name).toBe('Crème Fraîche');

    const stored = await testEnv.DB.prepare(
      'SELECT normalized_name FROM pantry_items WHERE id = ?',
    )
      .bind(item.id)
      .first<{ normalized_name: string }>();
    expect(stored?.normalized_name).toBe('crème fraîche');
  });

  it('moves an item in and out of the shopping view by signal', async () => {
    const item = await addItemOk('milk', 'low');

    const toNeeded = await patchItem(item.id, {
      version: item.version,
      status: 'needed',
    });
    expect(toNeeded.status).toBe(200);
    const needed = (await toNeeded.json<{ item: PantryItem }>()).item;
    expect(needed).toMatchObject({ status: 'needed', version: 2 });

    const bought = await patchItem(item.id, {
      version: needed.version,
      status: 'available',
    });
    expect(bought.status).toBe(200);
    expect((await bought.json<{ item: PantryItem }>()).item).toMatchObject({
      status: 'available',
      version: 3,
    });
  });

  it('renames an item and rejects renaming onto another item', async () => {
    const rice = await addItemOk('rice');
    const beans = await addItemOk('beans');

    const renamed = await patchItem(rice.id, {
      version: rice.version,
      name: 'Brown Rice',
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json<{ item: PantryItem }>()).item.name).toBe(
      'Brown Rice',
    );

    const collision = await patchItem(beans.id, {
      version: beans.version,
      name: 'brown rice',
    });
    expect(collision.status).toBe(409);
    await expect(collision.json()).resolves.toMatchObject({
      error: { code: 'duplicate_name' },
    });
  });

  it('rejects a stale edit instead of silently overwriting another member', async () => {
    const item = await addItemOk('bread', 'low');

    const first = await patchItem(item.id, {
      version: item.version,
      status: 'needed',
    });
    expect(first.status).toBe(200);

    // A second member still holding version 1 must be told to reload.
    const stale = await patchItem(item.id, {
      version: item.version,
      status: 'available',
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: 'stale_version' },
    });

    const [current] = await listItems();
    expect(current.status).toBe('needed');
  });

  it('lets only one of two concurrent edits win', async () => {
    const item = await addItemOk('eggs', 'low');

    const results = await Promise.all([
      patchItem(item.id, { version: item.version, status: 'needed' }),
      patchItem(item.id, { version: item.version, status: 'available' }),
    ]);
    const codes = results.map((response) => response.status).sort();

    expect(codes).toEqual([200, 409]);
    expect((await listItems())[0].version).toBe(2);
  });

  it('deletes an item only with its current version', async () => {
    const item = await addItemOk('sugar');

    const stale = await deleteItem(item.id, { version: item.version + 1 });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: 'stale_version' },
    });

    const removed = await deleteItem(item.id, { version: item.version });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
    expect(await listItems()).toEqual([]);

    const missing = await deleteItem(item.id, { version: 1 });
    expect(missing.status).toBe(404);
  });

  it('frees a name for reuse once the item is deleted', async () => {
    const first = await addItemOk('yoghurt');
    expect(
      (await deleteItem(first.id, { version: first.version })).status,
    ).toBe(204);

    const second = await addItemOk('Yoghurt');
    expect(second.name).toBe('Yoghurt');
  });

  it('never lets one household reach another household pantry', async () => {
    const other = await seedOtherHousehold();
    const foreignItem = await seedPantryItem(other.householdId, 'secret stash');

    expect(await listItems()).toEqual([]);

    const read = await patchItem(foreignItem, {
      version: 1,
      status: 'needed',
    });
    expect(read.status).toBe(404);

    const removed = await deleteItem(foreignItem, { version: 1 });
    expect(removed.status).toBe(404);

    const row = await testEnv.DB.prepare(
      'SELECT status FROM pantry_items WHERE household_id = ? AND id = ?',
    )
      .bind(other.householdId, foreignItem)
      .first<{ status: string }>();
    expect(row?.status).toBe('available');
  });

  it('allows the same item name in two different households', async () => {
    const other = await seedOtherHousehold();
    await seedPantryItem(other.householdId, 'rice');

    const mine = await addItemOk('rice');
    expect(mine.name).toBe('rice');
  });

  it('denies an identity that is not an active member', async () => {
    await testEnv.DB.prepare(
      `UPDATE household_members
          SET status = 'revoked', revoked_at = ?
        WHERE access_subject = 'local-owner'`,
    )
      .bind(new Date().toISOString())
      .run();

    const list = await fetchWorker(new Request(ITEMS_URL));
    expect(list.status).toBe(403);
    await expect(list.json()).resolves.toMatchObject({
      error: { code: 'not_a_member' },
    });

    const create = await addItem('contraband');
    expect(create.status).toBe(403);
  });

  it('lets a regular member manage the shared pantry', async () => {
    await testEnv.DB.prepare(
      `UPDATE household_members SET role = 'member'
        WHERE access_subject = 'local-owner'`,
    ).run();

    const item = await addItemOk('flour', 'needed');
    const updated = await patchItem(item.id, {
      version: item.version,
      status: 'available',
    });

    expect(updated.status).toBe(200);
  });

  it('rejects invalid names, statuses, versions, and unexpected fields', async () => {
    const cases: [unknown, number][] = [
      [{ name: '', status: 'available' }, 400],
      [{ name: '   ', status: 'available' }, 400],
      [{ name: 'a'.repeat(81), status: 'available' }, 400],
      [{ name: 42, status: 'available' }, 400],
      [{ name: 'ok', status: 'plenty' }, 400],
      [{ name: 'ok' }, 400],
      [{ name: 'ok', status: 'low', quantity: 2 }, 400],
    ];

    for (const [body, expected] of cases) {
      const response = await fetchWorker(
        new Request(ITEMS_URL, mutationInit('POST', body)),
      );
      expect(response.status, JSON.stringify(body)).toBe(expected);
    }

    const item = await addItemOk('salt');
    const badPatches: unknown[] = [
      { version: item.version },
      { status: 'low' },
      { version: 0, status: 'low' },
      { version: 1.5, status: 'low' },
      { version: '1', status: 'low' },
      { version: item.version, status: 'low', colour: 'white' },
    ];

    for (const body of badPatches) {
      const response = await patchItem(item.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('requires same-origin JSON for every pantry mutation', async () => {
    const item = await addItemOk('pepper');

    const noOrigin = await fetchWorker(
      new Request(ITEMS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x', status: 'low' }),
      }),
    );
    expect(noOrigin.status).toBe(403);

    const crossOrigin = await fetchWorker(
      new Request(ITEMS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.test',
        },
        body: JSON.stringify({ name: 'x', status: 'low' }),
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const wrongType = await fetchWorker(
      new Request(itemUrl(item.id), {
        method: 'PATCH',
        headers: {
          'content-type': 'text/plain',
          origin: 'https://example.test',
        },
        body: 'version=1',
      }),
    );
    expect(wrongType.status).toBe(415);
  });

  it('rejects a malformed item id as not found', async () => {
    const response = await fetchWorker(
      new Request(
        'https://example.test/api/pantry/items/not-a-uuid',
        mutationInit('PATCH', { version: 1, status: 'low' }),
      ),
    );
    expect(response.status).toBe(404);
  });

  it('caps the pantry per household and keeps the message free of item names', async () => {
    const owner = await testEnv.DB.prepare(
      `SELECT household_id FROM household_members WHERE access_subject = 'local-owner'`,
    ).first<{ household_id: string }>();
    const householdId = owner?.household_id as string;

    const now = new Date().toISOString();
    await testEnv.DB.batch(
      Array.from({ length: PANTRY_ITEM_LIMIT }, (_unused, index) =>
        testEnv.DB.prepare(
          `INSERT INTO pantry_items (
             id, household_id, display_name, normalized_name, status,
             version, created_source, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'available', 1, 'manual', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          householdId,
          `item-${index}`,
          `item-${index}`,
          now,
          now,
        ),
      ),
    );

    const response = await addItem('one too many');
    expect(response.status).toBe(400);
    const body = await response.json<{
      error: { code: string; message: string };
    }>();
    expect(body.error.code).toBe('limit_reached');
    expect(body.error.message).not.toContain('one too many');
  });

  it('keeps item names out of responses that do not carry them', async () => {
    const item = await addItemOk('anchovies');
    const conflict = await patchItem(item.id, {
      version: item.version + 5,
      status: 'low',
    });

    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain('anchovies');
  });
});
