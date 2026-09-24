import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPlanDays,
  MEAL_PLAN_HOUSEHOLD_LIMIT,
  MEAL_PLAN_NOTE_MAX_LENGTH,
  MEAL_PLAN_SLOT_LIMIT,
  MEAL_PLAN_TITLE_MAX_LENGTH,
  type MealPlanConflictResponse,
  type MealPlanEntry,
  type MealPlanResponse,
} from '../../src/shared/meal-plan';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  seedMealPlanEntry,
  seedOtherHousehold,
  seedRecipe,
  testEnv,
} from './helpers';

const PLAN_URL = 'https://example.test/api/meal-plan';
const ENTRIES_URL = `${PLAN_URL}/entries`;
const entryUrl = (id: string) => `${ENTRIES_URL}/${id}`;

/** The Worker's clock: 2026-09-24 at noon UTC, one second later per call. */
const TODAY = '2026-09-24';
const NOON = Date.parse(`${TODAY}T12:00:00.000Z`);
let tick = 0;
const worker = createWorker(
  undefined,
  undefined,
  () => new Date(NOON + tick++ * 1000),
);
const call = (request: Request): Promise<Response> =>
  worker.fetch(request, testEnv);

const readPlan = (from: string, to: string): Promise<Response> =>
  call(new Request(`${PLAN_URL}?from=${from}&to=${to}`));

const readOk = async (from = TODAY, to = TODAY): Promise<MealPlanEntry[]> => {
  const response = await readPlan(from, to);
  expect(response.status).toBe(200);
  const body = await response.json<MealPlanResponse>();
  expect({ from: body.from, to: body.to }).toEqual({ from, to });
  return body.entries;
};

const create = (body: unknown): Promise<Response> =>
  call(new Request(ENTRIES_URL, mutationInit('POST', body)));

const createOk = async (body: unknown): Promise<MealPlanEntry> => {
  const response = await create(body);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json<{ entry: MealPlanEntry }>()).entry;
};

const text = (title: string, extra: Record<string, unknown> = {}) => ({
  date: TODAY,
  slot: 'dinner',
  title,
  ...extra,
});

const patch = (id: string, body: unknown): Promise<Response> =>
  call(new Request(entryUrl(id), mutationInit('PATCH', body)));

const patchOk = async (id: string, body: unknown): Promise<MealPlanEntry> => {
  const response = await patch(id, body);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json<{ entry: MealPlanEntry }>()).entry;
};

const remove = (id: string, body: unknown): Promise<Response> =>
  call(new Request(entryUrl(id), mutationInit('DELETE', body)));

const errorOf = async (
  response: Response,
): Promise<{ code: string; message: string }> =>
  (await response.json<{ error: { code: string; message: string } }>()).error;

const ownerHouseholdId = async (): Promise<string> => {
  const row = await testEnv.DB.prepare(
    `SELECT household_id FROM household_members WHERE access_subject = 'local-owner'`,
  ).first<{ household_id: string }>();
  return row?.household_id as string;
};

const createRecipe = async (title: string): Promise<string> =>
  seedRecipe(await ownerHouseholdId(), title);

const entryCount = async (): Promise<number> =>
  (
    await testEnv.DB.prepare(
      'SELECT COUNT(*) AS total FROM meal_plan_entries',
    ).first<{ total: number }>()
  )?.total ?? -1;

const deleteRecipe = (id: string, version: number): Promise<Response> =>
  fetchWorker(
    new Request(
      `https://example.test/api/recipes/${id}`,
      mutationInit('DELETE', { version }),
    ),
  );

describe('meal plan API', () => {
  beforeEach(async () => {
    tick = 0;
    await applyMigrations();
    await bootstrapOwner();
  });

  describe('create, read, update, and remove', () => {
    it('starts empty and echoes the requested range', async () => {
      expect(await readOk(TODAY, addPlanDays(TODAY, 6))).toEqual([]);
    });

    it('adds a recipe entry and a free-text entry and reads them back', async () => {
      const recipeId = await createRecipe('Weeknight Fried Rice');

      const planned = await createOk({
        date: TODAY,
        slot: 'dinner',
        recipeId,
        note: 'double batch',
      });
      expect(planned).toEqual({
        id: expect.any(String) as unknown,
        date: TODAY,
        slot: 'dinner',
        kind: 'recipe',
        title: 'Weeknight Fried Rice',
        recipeId,
        recipeRemoved: false,
        note: 'double batch',
        version: 1,
        updatedAt: new Date(NOON).toISOString(),
      });

      const typed = await createOk(text('Leftovers'));
      expect(typed).toMatchObject({
        kind: 'text',
        title: 'Leftovers',
        note: null,
        version: 1,
      });
      expect(typed).not.toHaveProperty('recipeId');

      expect(await readOk()).toEqual([planned, typed]);
    });

    it('orders entries by date, then meal, then placement', async () => {
      const tomorrow = addPlanDays(TODAY, 1);
      const late = await createOk(text('Second dinner'));
      const nextDay = await createOk({ ...text('Porridge'), date: tomorrow });
      const lunch = await createOk({ ...text('Soup'), slot: 'lunch' });
      const breakfast = await createOk({ ...text('Toast'), slot: 'breakfast' });
      const later = await createOk(text('Third dinner'));

      const ids = (await readOk(TODAY, tomorrow)).map(({ id }) => id);
      expect(ids).toEqual([
        breakfast.id,
        lunch.id,
        late.id,
        later.id,
        nextDay.id,
      ]);
      // A range reads only its own dates.
      expect((await readOk(tomorrow, tomorrow)).map(({ id }) => id)).toEqual([
        nextDay.id,
      ]);
    });

    it('normalizes text and keeps a note on one line, storing a blank note as none', async () => {
      const entry = await createOk(
        text('  Eat\u0000  out\n tonight ', { note: ' double\n\tbatch ' }),
      );
      expect(entry).toMatchObject({
        title: 'Eat out tonight',
        note: 'double batch',
      });
      const blank = await createOk(text('Leftovers', { note: '   ' }));
      expect(blank.note).toBeNull();
    });

    it('shows a renamed recipe under its current title', async () => {
      const recipeId = await createRecipe('Soup');
      const entry = await createOk({ date: TODAY, slot: 'lunch', recipeId });
      await testEnv.DB.prepare(
        "UPDATE recipes SET title = 'Tomato Soup' WHERE id = ?",
      )
        .bind(recipeId)
        .run();
      expect((await readOk())[0]).toMatchObject({
        id: entry.id,
        title: 'Tomato Soup',
        recipeRemoved: false,
      });
    });

    it('moves an entry to another date and meal and places it last there', async () => {
      const tomorrow = addPlanDays(TODAY, 1);
      const moving = await createOk(text('Curry'));
      const waiting = await createOk({ ...text('Salad'), date: tomorrow });

      const moved = await patchOk(moving.id, {
        version: 1,
        date: tomorrow,
        slot: 'dinner',
      });
      expect(moved).toMatchObject({
        date: tomorrow,
        slot: 'dinner',
        version: 2,
      });
      expect((await readOk(tomorrow, tomorrow)).map(({ id }) => id)).toEqual([
        waiting.id,
        moving.id,
      ]);

      // Moving within the day to another meal is a move too.
      const lunch = await patchOk(moving.id, { version: 2, slot: 'lunch' });
      expect(lunch).toMatchObject({
        date: tomorrow,
        slot: 'lunch',
        version: 3,
      });
    });

    it('keeps an entry in place when only its note or text changes', async () => {
      const first = await createOk(text('Curry'));
      const second = await createOk(text('Rice'));

      const edited = await patchOk(first.id, {
        version: 1,
        title: ' Green  curry ',
        note: 'mild',
      });
      expect(edited).toMatchObject({
        title: 'Green curry',
        note: 'mild',
        version: 2,
      });
      expect((await readOk()).map(({ id }) => id)).toEqual([
        first.id,
        second.id,
      ]);

      const cleared = await patchOk(first.id, { version: 2, note: null });
      expect(cleared).toMatchObject({ title: 'Green curry', note: null });
    });

    it("refuses to change a recipe entry's title", async () => {
      const recipeId = await createRecipe('Soup');
      const entry = await createOk({ date: TODAY, slot: 'lunch', recipeId });

      const response = await patch(entry.id, { version: 1, title: 'Stew' });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_request');
      expect((await readOk())[0]).toMatchObject({ title: 'Soup', version: 1 });

      // Its note is still editable.
      await expect(
        patchOk(entry.id, { version: 1, note: 'extra bread' }),
      ).resolves.toMatchObject({ note: 'extra bread' });
    });

    it('removes an entry with its current version', async () => {
      const entry = await createOk(text('Curry'));
      const response = await remove(entry.id, { version: 1 });
      expect(response.status).toBe(204);
      expect(await readOk()).toEqual([]);
      expect((await remove(entry.id, { version: 1 })).status).toBe(404);
    });

    it('lets a regular member manage the shared plan', async () => {
      const householdId = await ownerHouseholdId();
      await fetchWorker(
        new Request(
          'https://example.test/api/household/members',
          mutationInit('POST', { email: 'member@example.test' }),
        ),
      );
      await testEnv.DB.prepare(
        `UPDATE household_members
            SET status = 'active', access_subject = 'member-subject',
                activated_at = ?
          WHERE normalized_email = 'member@example.test'`,
      )
        .bind(new Date().toISOString())
        .run();
      const member = createWorker(
        () =>
          Promise.resolve({
            subject: 'member-subject',
            email: 'member@example.test',
          }),
        undefined,
        () => new Date(NOON),
      );
      const ownerEntry = await createOk(text('Curry'));

      const created = await member.fetch(
        new Request(ENTRIES_URL, mutationInit('POST', text('Pizza'))),
        testEnv,
      );
      expect(created.status).toBe(201);
      const edited = await member.fetch(
        new Request(
          entryUrl(ownerEntry.id),
          mutationInit('PATCH', { version: 1, note: 'spicy' }),
        ),
        testEnv,
      );
      expect(edited.status).toBe(200);
      const read = await member.fetch(
        new Request(`${PLAN_URL}?from=${TODAY}&to=${TODAY}`),
        testEnv,
      );
      const body = await read.json<MealPlanResponse>();
      expect(body.entries.map(({ title }) => title)).toEqual([
        'Curry',
        'Pizza',
      ]);
      const row = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS total FROM meal_plan_entries WHERE household_id = ?',
      )
        .bind(householdId)
        .first<{ total: number }>();
      expect(row?.total).toBe(2);
    });
  });

  describe('validation', () => {
    it.each([
      ['a body that is not an object', []],
      ['an unknown field', { ...text('Curry'), householdId: 'x' }],
      [
        'both a recipe and text',
        { ...text('Curry'), recipeId: crypto.randomUUID() },
      ],
      ['neither a recipe nor text', { date: TODAY, slot: 'dinner' }],
      ['a missing date', { slot: 'dinner', title: 'Curry' }],
      ['an impossible date', text('Curry', { date: '2026-02-30' })],
      ['a malformed date', text('Curry', { date: '2026-9-24' })],
      ['a timestamp', text('Curry', { date: `${TODAY}T10:00:00Z` })],
      ['an unknown meal', text('Curry', { slot: 'snack' })],
      ['empty text', text('   ')],
      [
        'text that is too long',
        text('t'.repeat(MEAL_PLAN_TITLE_MAX_LENGTH + 1)),
      ],
      ['text that is not a string', text('Curry', { title: 7 })],
      [
        'a note that is too long',
        text('Curry', { note: 'n'.repeat(MEAL_PLAN_NOTE_MAX_LENGTH + 1) }),
      ],
      ['a note that is not a string', text('Curry', { note: false })],
      ['a malformed recipe ID', { date: TODAY, slot: 'dinner', recipeId: 'x' }],
    ])('rejects a create with %s', async (_, body) => {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_request');
      expect(await entryCount()).toBe(0);
    });

    it('accepts text and a note at their bounds', async () => {
      const entry = await createOk(
        text('t'.repeat(MEAL_PLAN_TITLE_MAX_LENGTH), {
          note: 'n'.repeat(MEAL_PLAN_NOTE_MAX_LENGTH),
        }),
      );
      expect(entry.title).toHaveLength(MEAL_PLAN_TITLE_MAX_LENGTH);
      expect(entry.note).toHaveLength(MEAL_PLAN_NOTE_MAX_LENGTH);
    });

    it.each([
      ['no range', ''],
      ['only a start', `?from=${TODAY}`],
      ['a repeated start', `?from=${TODAY}&from=${TODAY}&to=${TODAY}`],
      ['an unknown parameter', `?from=${TODAY}&to=${TODAY}&household=x`],
      ['an impossible date', `?from=2026-02-30&to=2026-03-01`],
      ['a range that ends before it starts', `?from=${TODAY}&to=2026-09-23`],
      [
        'a range longer than 42 days',
        `?from=${TODAY}&to=${addPlanDays(TODAY, 42)}`,
      ],
    ])('rejects a read with %s', async (_, query) => {
      const response = await call(new Request(`${PLAN_URL}${query}`));
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_request');
    });

    it('reads a range of exactly 42 days', async () => {
      await expect(readOk(TODAY, addPlanDays(TODAY, 41))).resolves.toEqual([]);
    });

    it('rejects invalid updates and removes without changing the entry', async () => {
      const entry = await createOk(text('Curry'));
      for (const body of [
        { title: 'x' },
        { version: 1 },
        { version: 0, title: 'x' },
        { version: 1, date: '2026-02-30' },
        { version: 1, slot: 'brunch' },
        { version: 1, title: '' },
        { version: 1, note: 'n'.repeat(MEAL_PLAN_NOTE_MAX_LENGTH + 1) },
        { version: 1, kind: 'recipe' },
        { version: 1, recipeId: crypto.randomUUID() },
      ]) {
        expect((await patch(entry.id, body)).status, JSON.stringify(body)).toBe(
          400,
        );
      }
      for (const body of [{}, { version: '1' }, { version: 1, extra: true }]) {
        expect((await remove(entry.id, body)).status).toBe(400);
      }
      expect(await readOk()).toEqual([entry]);
    });

    it('requires same-origin JSON for every plan mutation', async () => {
      const entry = await createOk(text('Curry'));
      for (const [url, method, body] of [
        [ENTRIES_URL, 'POST', text('Pizza')],
        [entryUrl(entry.id), 'PATCH', { version: 1, note: 'x' }],
        [entryUrl(entry.id), 'DELETE', { version: 1 }],
      ] as const) {
        const crossOrigin = await call(
          new Request(url, {
            method,
            headers: {
              'content-type': 'application/json',
              origin: 'https://evil.example',
            },
            body: JSON.stringify(body),
          }),
        );
        expect(crossOrigin.status).toBe(403);
        const notJson = await call(
          new Request(url, {
            method,
            headers: {
              'content-type': 'text/plain',
              origin: 'https://example.test',
            },
            body: JSON.stringify(body),
          }),
        );
        expect(notJson.status).toBe(415);
      }
      expect(await readOk()).toEqual([entry]);
    });

    it('answers unknown methods, malformed IDs, and unknown plan paths with 404', async () => {
      const entry = await createOk(text('Curry'));
      for (const request of [
        new Request(PLAN_URL, mutationInit('POST', text('Pizza'))),
        new Request(ENTRIES_URL),
        new Request(ENTRIES_URL, mutationInit('PATCH', {})),
        new Request(entryUrl(entry.id)),
        new Request(entryUrl(entry.id), mutationInit('POST', {})),
        new Request(
          entryUrl('not-an-id'),
          mutationInit('DELETE', { version: 1 }),
        ),
        new Request(`${PLAN_URL}/weeks`),
      ]) {
        const response = await call(request);
        expect(response.status, `${request.method} ${request.url}`).toBe(404);
        expect((await errorOf(response)).code).toBe('not_found');
      }
    });
  });

  describe('write window', () => {
    // The Worker's UTC date is 2026-09-24; one day of slack on each side
    // lets a family in any time zone plan its own today.
    const earliest = addPlanDays(TODAY, -57);
    const latest = addPlanDays(TODAY, 365);

    it('accepts new entries from 8 weeks back to 52 weeks ahead, with a day of slack', async () => {
      for (const date of [earliest, TODAY, latest]) {
        await expect(createOk(text('Curry', { date }))).resolves.toMatchObject({
          date,
        });
      }
      for (const date of [
        addPlanDays(earliest, -1),
        addPlanDays(latest, 1),
        '2062-09-24',
      ]) {
        const response = await create(text('Curry', { date }));
        expect(response.status, date).toBe(400);
        expect((await errorOf(response)).message).toContain('52 weeks ahead');
      }
      expect(await entryCount()).toBe(3);
    });

    it('keeps an old entry editable and movable within its day, but not to another old date', async () => {
      const oldDate = addPlanDays(TODAY, -100);
      const householdId = await ownerHouseholdId();
      const id = await seedMealPlanEntry(householdId, {
        date: oldDate,
        slot: 'lunch',
        title: 'Old soup',
      });

      await expect(
        patchOk(id, { version: 1, note: 'was good' }),
      ).resolves.toMatchObject({ date: oldDate, note: 'was good' });
      await expect(
        patchOk(id, { version: 2, title: 'Old stew' }),
      ).resolves.toMatchObject({ title: 'Old stew' });
      // The same date sent back unchanged is not a move to it.
      await expect(
        patchOk(id, { version: 3, date: oldDate, slot: 'dinner' }),
      ).resolves.toMatchObject({ date: oldDate, slot: 'dinner', version: 4 });

      const response = await patch(id, {
        version: 4,
        date: addPlanDays(oldDate, 1),
      });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('invalid_request');

      // Moving it into the window is allowed.
      await expect(
        patchOk(id, { version: 4, date: TODAY }),
      ).resolves.toMatchObject({ date: TODAY, version: 5 });
    });

    it('reads any date, including dates outside the window', async () => {
      const householdId = await ownerHouseholdId();
      await seedMealPlanEntry(householdId, { date: '2020-01-01' });
      expect(await readOk('2020-01-01', '2020-01-07')).toHaveLength(1);
    });
  });

  describe('conflicts', () => {
    it('rejects a stale update with the current entry and changes nothing', async () => {
      const entry = await createOk(text('Curry'));
      const winner = await patchOk(entry.id, { version: 1, note: 'mild' });

      const response = await patch(entry.id, {
        version: 1,
        slot: 'lunch',
        note: 'hot',
      });
      expect(response.status).toBe(409);
      const body = await response.json<MealPlanConflictResponse>();
      expect(body.error.code).toBe('stale_version');
      expect(body.current).toEqual(winner);
      expect(await readOk()).toEqual([winner]);
    });

    it('rejects a stale remove and keeps the entry', async () => {
      const entry = await createOk(text('Curry'));
      const winner = await patchOk(entry.id, { version: 1, note: 'mild' });

      const response = await remove(entry.id, { version: 1 });
      expect(response.status).toBe(409);
      const body = await response.json<MealPlanConflictResponse>();
      expect(body.current).toEqual(winner);
      expect(await readOk()).toEqual([winner]);
    });

    it('reports an entry already removed by someone else as not found', async () => {
      const entry = await createOk(text('Curry'));
      await remove(entry.id, { version: 1 });
      for (const response of [
        await patch(entry.id, { version: 1, note: 'x' }),
        await remove(entry.id, { version: 1 }),
      ]) {
        expect(response.status).toBe(404);
        expect((await errorOf(response)).code).toBe('not_found');
      }
    });

    it('lets exactly one of two concurrent changes from the same version win', async () => {
      const entry = await createOk(text('Curry'));
      const responses = await Promise.all([
        patch(entry.id, { version: 1, note: 'first' }),
        patch(entry.id, { version: 1, slot: 'lunch', note: 'second' }),
      ]);
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      const [current] = await readOk();
      expect(current.version).toBe(2);
      expect(['first', 'second']).toContain(current.note);
    });

    it('lets only one of two concurrent moves take the last place in a meal', async () => {
      const tomorrow = addPlanDays(TODAY, 1);
      for (let index = 1; index < MEAL_PLAN_SLOT_LIMIT; index += 1) {
        await createOk(text(`Dish ${index}`, { date: tomorrow }));
      }
      const first = await createOk(text('Curry'));
      const second = await createOk(text('Pizza'));

      const responses = await Promise.all([
        patch(first.id, { version: 1, date: tomorrow }),
        patch(second.id, { version: 1, date: tomorrow }),
      ]);
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      const refused = responses.find(({ status }) => status === 409);
      expect((await errorOf(refused as Response)).code).toBe('limit_reached');
      expect(await readOk(tomorrow, tomorrow)).toHaveLength(
        MEAL_PLAN_SLOT_LIMIT,
      );
      expect(await readOk()).toHaveLength(1);
    });
  });

  describe('recipes', () => {
    it("refuses another household's recipe exactly like a missing one", async () => {
      const other = await seedOtherHousehold();
      const foreign = await seedRecipe(other.householdId, 'Secret Family Stew');

      for (const recipeId of [foreign, crypto.randomUUID()]) {
        const response = await create({
          date: TODAY,
          slot: 'dinner',
          recipeId,
        });
        expect(response.status).toBe(404);
        const body = await response.text();
        expect(body).toContain('not_found');
        expect(body).toContain('That recipe no longer exists.');
        expect(body).not.toContain('Secret');
      }
      expect(await entryCount()).toBe(0);
    });

    it("never returns another household's recipe through the read join", async () => {
      const other = await seedOtherHousehold();
      const foreign = await seedRecipe(other.householdId, 'Secret Family Stew');
      // Placed directly: the API can never write such a row.
      await testEnv.DB.prepare(
        `INSERT INTO meal_plan_entries (
           id, household_id, plan_date, meal_slot, kind, recipe_id, title,
           note, placed_at, version, created_at, updated_at
         ) VALUES (?, ?, ?, 'dinner', 'recipe', ?, 'Placeholder', NULL,
                   'x', 1, 'x', 'x')`,
      )
        .bind(crypto.randomUUID(), await ownerHouseholdId(), TODAY, foreign)
        .run();

      const response = await readPlan(TODAY, TODAY);
      const raw = await response.text();
      expect(raw).not.toContain('Secret');
      expect(raw).not.toContain(foreign);
      expect(JSON.parse(raw)).toMatchObject({
        entries: [
          { title: 'Placeholder', recipeId: null, recipeRemoved: true },
        ],
      });
    });

    it("keeps entries under the recipe's last title after the recipe is deleted", async () => {
      const recipeId = await createRecipe('Soup');
      const entry = await createOk({ date: TODAY, slot: 'dinner', recipeId });
      const other = await createOk({
        date: addPlanDays(TODAY, 1),
        slot: 'lunch',
        recipeId,
        note: 'with bread',
      });
      // Renamed after it was planned: the last title, not the planned one.
      await testEnv.DB.prepare(
        "UPDATE recipes SET title = 'Tomato Soup', version = 2 WHERE id = ?",
      )
        .bind(recipeId)
        .run();

      expect((await deleteRecipe(recipeId, 2)).status).toBe(204);

      const entries = await readOk(TODAY, addPlanDays(TODAY, 1));
      expect(entries).toEqual([
        {
          ...entry,
          title: 'Tomato Soup',
          recipeId: null,
          recipeRemoved: true,
        },
        {
          ...other,
          title: 'Tomato Soup',
          recipeId: null,
          recipeRemoved: true,
        },
      ]);
      // The version is unchanged, so an edit made before the delete saves.
      await expect(
        patchOk(entry.id, { version: 1, note: 'from the freezer' }),
      ).resolves.toMatchObject({ recipeRemoved: true, version: 2 });
    });

    it('changes no entry when a recipe delete is stale', async () => {
      const recipeId = await createRecipe('Soup');
      await createOk({ date: TODAY, slot: 'dinner', recipeId });
      await testEnv.DB.prepare(
        "UPDATE recipes SET title = 'Tomato Soup', version = 2 WHERE id = ?",
      )
        .bind(recipeId)
        .run();

      const response = await deleteRecipe(recipeId, 1);
      expect(response.status).toBe(409);
      const stored = await testEnv.DB.prepare(
        'SELECT recipe_id, title FROM meal_plan_entries',
      ).first();
      expect(stored).toEqual({ recipe_id: recipeId, title: 'Soup' });
      expect((await readOk())[0]).toMatchObject({
        title: 'Tomato Soup',
        recipeRemoved: false,
      });
    });

    it("never refreshes another household's entries when a recipe is deleted", async () => {
      const recipeId = await createRecipe('Soup');
      await createOk({ date: TODAY, slot: 'dinner', recipeId });
      const other = await seedOtherHousehold();
      const foreignRecipe = await seedRecipe(other.householdId, 'Stew');
      const foreignEntry = await seedMealPlanEntry(other.householdId, {
        date: TODAY,
        recipeId: foreignRecipe,
      });

      expect((await deleteRecipe(foreignRecipe, 1)).status).toBe(404);
      expect((await deleteRecipe(recipeId, 1)).status).toBe(204);

      const row = await testEnv.DB.prepare(
        'SELECT recipe_id, title FROM meal_plan_entries WHERE id = ?',
      )
        .bind(foreignEntry)
        .first();
      expect(row).toEqual({ recipe_id: foreignRecipe, title: 'Stew' });
    });
  });

  describe('authorization and household isolation', () => {
    it("never lets one household read or change another household's entries", async () => {
      const other = await seedOtherHousehold();
      const foreign = await seedMealPlanEntry(other.householdId, {
        date: TODAY,
        title: 'Secret dinner',
      });

      expect(await readOk()).toEqual([]);
      for (const response of [
        await patch(foreign, { version: 1, note: 'mine now' }),
        await patch(foreign, { version: 1, date: addPlanDays(TODAY, 1) }),
        await remove(foreign, { version: 1 }),
      ]) {
        expect(response.status).toBe(404);
        const body = await response.text();
        expect(body).toContain('not_found');
        expect(body).not.toContain('Secret');
      }
      const row = await testEnv.DB.prepare(
        'SELECT title, note, version FROM meal_plan_entries WHERE id = ?',
      )
        .bind(foreign)
        .first();
      expect(row).toEqual({ title: 'Secret dinner', note: null, version: 1 });
    });

    const everyRoute = (entryId: string): Request[] => [
      new Request(`${PLAN_URL}?from=${TODAY}&to=${TODAY}`),
      new Request(ENTRIES_URL, mutationInit('POST', text('Pizza'))),
      new Request(
        entryUrl(entryId),
        mutationInit('PATCH', { version: 1, note: 'x' }),
      ),
      new Request(entryUrl(entryId), mutationInit('DELETE', { version: 1 })),
    ];

    it('denies a revoked member every plan route', async () => {
      const entry = await createOk(text('Curry'));
      await testEnv.DB.prepare(
        `UPDATE household_members
            SET status = 'revoked', revoked_at = ?
          WHERE access_subject = 'local-owner'`,
      )
        .bind(new Date().toISOString())
        .run();

      for (const request of everyRoute(entry.id)) {
        const response = await call(request);
        expect(response.status).toBe(403);
        const body = await response.text();
        expect(body).toContain('not_a_member');
        expect(body).not.toContain('Curry');
      }
      const row = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS total, MAX(version) AS version FROM meal_plan_entries',
      ).first();
      expect(row).toEqual({ total: 1, version: 1 });
    });

    it('denies an identity that belongs to no household', async () => {
      const entry = await createOk(text('Curry'));
      const stranger = createWorker(() =>
        Promise.resolve({
          subject: 'stranger',
          email: 'stranger@example.test',
        }),
      );
      for (const request of everyRoute(entry.id)) {
        const response = await stranger.fetch(request, testEnv);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain('Curry');
      }
      expect(await readOk()).toEqual([entry]);
    });

    it('denies a request without a valid Access assertion', async () => {
      const entry = await createOk(text('Curry'));
      const deployed = createWorker();
      const deployedEnv = {
        ...testEnv,
        APP_ENV: 'development',
        CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
        CF_ACCESS_AUD: 'development-audience',
      } as const;
      for (const request of everyRoute(entry.id)) {
        const response = await deployed.fetch(request, deployedEnv);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: 'invalid_identity' },
        });
      }
      expect(await readOk()).toEqual([entry]);
    });
  });

  describe('limits and privacy', () => {
    it('caps each meal and keeps the message free of plan text', async () => {
      for (let index = 0; index < MEAL_PLAN_SLOT_LIMIT; index += 1) {
        await createOk(text(`Dish ${index}`));
      }
      const response = await create(text('One too many'));
      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error.code).toBe('limit_reached');
      expect(error.message).toContain(`${MEAL_PLAN_SLOT_LIMIT} entries`);
      expect(error.message).not.toContain('One too many');
      expect(error.message).not.toContain(TODAY);

      // Another meal of the same day still has room.
      await expect(
        createOk(text('Toast', { slot: 'breakfast' })),
      ).resolves.toBeDefined();
    });

    it('refuses to move an entry into a full meal', async () => {
      const tomorrow = addPlanDays(TODAY, 1);
      for (let index = 0; index < MEAL_PLAN_SLOT_LIMIT; index += 1) {
        await createOk(text(`Dish ${index}`, { date: tomorrow }));
      }
      const entry = await createOk(text('Curry'));
      const response = await patch(entry.id, { version: 1, date: tomorrow });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('limit_reached');
      expect(await readOk()).toEqual([entry]);
    });

    it('caps the household and still allows moves, edits, and removal at the cap', async () => {
      const householdId = await ownerHouseholdId();
      const start = addPlanDays(TODAY, -40);
      const now = new Date(NOON).toISOString();
      const statements = Array.from(
        { length: MEAL_PLAN_HOUSEHOLD_LIMIT },
        (_unused, index) =>
          testEnv.DB.prepare(
            `INSERT INTO meal_plan_entries (
               id, household_id, plan_date, meal_slot, kind, recipe_id, title,
               note, placed_at, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'text', NULL, 'Seed', NULL, ?, 1, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            householdId,
            addPlanDays(start, Math.floor(index / 18)),
            (['breakfast', 'lunch', 'dinner'] as const)[index % 3],
            now,
            now,
            now,
          ),
      );
      for (let offset = 0; offset < statements.length; offset += 500) {
        await testEnv.DB.batch(statements.slice(offset, offset + 500));
      }
      // The seeded rows fill every meal up to about 26 weeks ahead; this date
      // has room, so only the household cap can refuse.
      const free = addPlanDays(TODAY, 200);

      const response = await create(text('Birthday cake', { date: free }));
      expect(response.status).toBe(409);
      const error = await errorOf(response);
      expect(error).toEqual({
        code: 'limit_reached',
        message:
          'The plan holds at most 4,000 entries. Remove old entries before adding more.',
      });
      const recipeId = await createRecipe('Cake');
      expect(
        (await create({ date: free, slot: 'dinner', recipeId })).status,
      ).toBe(409);

      const [first] = await readOk(start, start);
      await expect(
        patchOk(first.id, { version: 1, date: free, note: 'moved' }),
      ).resolves.toMatchObject({ date: free, note: 'moved' });
      expect((await remove(first.id, { version: 2 })).status).toBe(204);
      await expect(
        createOk(text('Birthday cake', { date: free })),
      ).resolves.toBeDefined();

      // Another household is unaffected by this household's cap.
      const other = await seedOtherHousehold();
      const stranger = createWorker(
        () =>
          Promise.resolve({
            subject: 'other-subject',
            email: 'other@example.test',
          }),
        undefined,
        () => new Date(NOON),
      );
      const theirs = await stranger.fetch(
        new Request(ENTRIES_URL, mutationInit('POST', text('Their dinner'))),
        testEnv,
      );
      expect(theirs.status).toBe(201);
      const theirCount = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS total FROM meal_plan_entries WHERE household_id = ?',
      )
        .bind(other.householdId)
        .first<{ total: number }>();
      expect(theirCount?.total).toBe(1);
    });

    it('writes no plan text, note, date, or recipe title to the console', async () => {
      const written: string[] = [];
      const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const originals = levels.map(
        (level) => [level, console[level].bind(console)] as const,
      );
      for (const level of levels) {
        console[level] = (...args: unknown[]) => {
          written.push(args.map((arg) => String(arg)).join(' '));
        };
      }

      try {
        const recipeId = await createRecipe('Saffron Risotto');
        const planned = await createOk({
          date: TODAY,
          slot: 'dinner',
          recipeId,
          note: 'saffron note',
        });
        const typed = await createOk(text('Saffron buns'));
        await patch(typed.id, { version: 1, note: 'saffron again' });
        await patch(typed.id, { version: 1, note: 'saffron stale' });
        await patch(planned.id, { version: 1, title: 'saffron title' });
        await remove(typed.id, { version: 1 });
        await readOk();
        await deleteRecipe(recipeId, 1);
        await readOk();
        await create({ ...text('saffron'), date: '2099-01-01' });
      } finally {
        for (const [level, original] of originals) {
          console[level] = original;
        }
      }

      const output = written.join('\n');
      expect(output).not.toContain('affron');
      expect(output).not.toContain(TODAY);
    });
  });
});
