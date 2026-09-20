import { beforeEach, describe, expect, it } from 'vitest';

import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  testEnv,
} from './helpers';
import { readJsonObject } from '../../src/worker/http';

describe('session and bootstrap APIs', () => {
  beforeEach(applyMigrations);

  it('offers setup only to the deterministic local bootstrap identity', async () => {
    const response = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'setup-required',
    });
  });

  it('atomically creates the first household owner and returns a minimal session', async () => {
    const response = await bootstrapOwner();
    expect(response.status).toBe(201);
    const body: {
      status: string;
      member: Record<string, unknown>;
      household: Record<string, unknown>;
    } = await response.json();
    expect(body).toMatchObject({
      status: 'ready',
      member: { email: 'owner@example.test', role: 'owner' },
      household: { name: 'Liao Family' },
    });
    expect(Object.keys(body.member).sort()).toEqual(['email', 'id', 'role']);
    expect(Object.keys(body.household).sort()).toEqual(['id', 'name']);

    const session = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    await expect(session.json()).resolves.toEqual(body);
  });

  it('rejects repeated bootstrap without leaving partial rows', async () => {
    expect((await bootstrapOwner()).status).toBe(201);
    const retry = await bootstrapOwner();
    expect(retry.status).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      error: { code: 'state_conflict' },
    });

    const householdCount = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM households',
    ).first<{ count: number }>();
    expect(householdCount?.count).toBe(1);
  });

  it('allows only the configured verified identity to bootstrap', async () => {
    const worker = createWorker(() =>
      Promise.resolve({
        subject: 'different-subject',
        email: 'different@example.test',
      }),
    );
    const response = await worker.fetch(
      new Request(
        'https://example.test/api/bootstrap',
        mutationInit('POST', { householdName: 'Different Family' }),
      ),
      testEnv,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'not_a_member' },
    });
    const householdCount = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM households',
    ).first<{ count: number }>();
    expect(householdCount?.count).toBe(0);
  });

  it('creates exactly one family space under concurrent bootstrap requests', async () => {
    const [first, second] = await Promise.all([
      bootstrapOwner(),
      bootstrapOwner(),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const counts = await testEnv.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM households) AS households,
         (SELECT COUNT(*) FROM household_members) AS members,
         (SELECT COUNT(*) FROM app_installation) AS installations`,
    ).first<{
      households: number;
      members: number;
      installations: number;
    }>();
    expect(counts).toEqual({ households: 1, members: 1, installations: 1 });
  });

  it('rejects missing origins, wrong content types, and unexpected fields', async () => {
    const missingOrigin = await fetchWorker(
      new Request('https://example.test/api/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ householdName: 'Family' }),
      }),
    );
    expect(missingOrigin.status).toBe(403);

    const wrongType = await fetchWorker(
      new Request('https://example.test/api/bootstrap', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          origin: 'https://example.test',
        },
        body: 'Family',
      }),
    );
    expect(wrongType.status).toBe(415);

    const extraField = await fetchWorker(
      new Request(
        'https://example.test/api/bootstrap',
        mutationInit('POST', { householdName: 'Family', role: 'owner' }),
      ),
    );
    expect(extraField.status).toBe(400);
  });

  it('rejects cross-origin and oversized mutation requests', async () => {
    const crossOrigin = await fetchWorker(
      new Request('https://example.test/api/bootstrap', {
        ...mutationInit('POST', { householdName: 'Family' }),
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example',
        },
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const oversized = await fetchWorker(
      new Request(
        'https://example.test/api/bootstrap',
        mutationInit('POST', { householdName: 'x'.repeat(9_000) }),
      ),
    );
    expect(oversized.status).toBe(413);
  });

  it.each([
    ['without a content length', undefined],
    ['with a misleading content length', '1'],
  ])('stops reading an oversized streamed body %s', async (_, length) => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 + 1));
      },
      cancel() {
        canceled = true;
      },
    });
    const headers = new Headers({ 'content-type': 'application/json' });
    if (length) headers.set('content-length', length);

    await expect(
      readJsonObject(
        new Request('https://example.test/api/bootstrap', {
          method: 'POST',
          headers,
          body,
        }),
      ),
    ).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
    expect(canceled).toBe(true);
  });
});
