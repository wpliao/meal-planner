import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CloudflareApiError,
  createCloudflareClient,
  type CloudflareClient,
  type FetchLike,
} from '../../src/operations/household-decommission/cloudflare-client.ts';
import { redact } from '../../src/operations/household-decommission/redact.ts';
import {
  ACCOUNT_ID,
  API_TOKEN,
  createFakeCloudflare,
  DEVELOPMENT_D1_ID,
  WORKER_ID,
  WORKER_NAME,
} from './fake-cloudflare';

const DATABASE_ID = DEVELOPMENT_D1_ID;

const clientFor = (fetch: FetchLike, overrides = {}): CloudflareClient =>
  createCloudflareClient({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    fetch,
    sleep: () => Promise.resolve(),
    ...overrides,
  });

const respondWith =
  (result: unknown): FetchLike =>
  () =>
    Promise.resolve(Response.json({ success: true, errors: [], result }));

describe('Cloudflare client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the documented endpoints with a bearer token', async () => {
    const fake = createFakeCloudflare();
    const client = clientFor(fake.fetch);
    await client.getD1Database(DATABASE_ID);
    await client.getTimeTravelBookmark(DATABASE_ID);
    await client.getAccountWorkersSubdomain();
    await client.getWorkerSubdomainState('worker-name');
    await client.listWorkerCustomDomains('worker-name');
    await expect(client.getWorkerId(WORKER_NAME)).resolves.toBe(WORKER_ID);
    await client.getAccessApplicationTargets('app-id');
    await client.listAccessPolicies('app-id');

    const account = `/client/v4/accounts/${ACCOUNT_ID}`;
    expect(fake.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${account}/d1/database/${DATABASE_ID}`,
      `GET ${account}/d1/database/${DATABASE_ID}/time_travel/bookmark`,
      `GET ${account}/workers/subdomain`,
      `GET ${account}/workers/scripts/worker-name/subdomain`,
      `GET ${account}/workers/domains?service=worker-name`,
      `GET ${account}/workers/workers/${WORKER_NAME}`,
      `GET ${account}/access/apps/app-id`,
      `GET ${account}/access/apps/app-id/policies?page=1&per_page=50`,
    ]);
    for (const { headers } of fake.calls) {
      expect(headers.authorization).toBe(`Bearer ${API_TOKEN}`);
      expect(headers['content-type']).toBeUndefined();
    }
  });

  it('encodes path and query values', async () => {
    const fake = createFakeCloudflare();
    await clientFor(fake.fetch).listWorkerCustomDomains('a b&c');
    expect(fake.calls[0]?.path).toContain('service=a%20b%26c');
  });

  it.each<[string, (client: CloudflareClient) => Promise<unknown>]>([
    ['D1 database', (client) => client.getD1Database(DATABASE_ID)],
    ['bookmark', (client) => client.getTimeTravelBookmark(DATABASE_ID)],
    ['account subdomain', (client) => client.getAccountWorkersSubdomain()],
    ['Worker subdomain', (client) => client.getWorkerSubdomainState('w')],
    ['custom domains', (client) => client.listWorkerCustomDomains('w')],
    ['Worker', (client) => client.getWorkerId('w')],
    ['Access application', (client) => client.getAccessApplicationTargets('a')],
    ['Access policies', (client) => client.listAccessPolicies('a')],
    [
      'D1 read',
      (client) => client.readD1(DATABASE_ID, { sql: 'SELECT 1', params: [] }),
    ],
    ['D1 batch', (client) => client.executeD1Batch(DATABASE_ID, [])],
  ])('rejects a malformed %s result', async (_, call) => {
    const client = clientFor(respondWith('unexpected'));
    await expect(call(client)).rejects.toBeInstanceOf(CloudflareApiError);
  });

  it.each([
    ['another Worker', { id: 'x', name: 'other-worker' }],
    ['an empty ID', { id: '', name: 'w' }],
  ])('rejects a Worker result for %s', async (_, result) => {
    await expect(
      clientFor(respondWith(result)).getWorkerId('w'),
    ).rejects.toBeInstanceOf(CloudflareApiError);
  });

  it('rejects a read whose statement did not succeed', async () => {
    const client = clientFor(respondWith([{ success: false, results: [] }]));
    await expect(
      client.readD1(DATABASE_ID, { sql: 'SELECT 1', params: [] }),
    ).rejects.toThrow('statement did not succeed');
  });

  it('rejects an empty read result', async () => {
    const client = clientFor(respondWith([]));
    await expect(
      client.readD1(DATABASE_ID, { sql: 'SELECT 1', params: [] }),
    ).rejects.toThrow('statement did not succeed');
  });

  it('normalizes loosely shaped list entries', async () => {
    const domains = await clientFor(
      respondWith([{ hostname: 'a.example.test' }, { hostname: 7 }, 'x']),
    ).listWorkerCustomDomains('w');
    expect(domains).toEqual(['a.example.test', '']);

    const policies = await clientFor(
      respondWith([{ include: 'x' }]),
    ).listAccessPolicies('a');
    expect(policies).toEqual([
      { decision: 'unknown', include: [], require: [], exclude: [] },
    ]);

    const targets = await clientFor(
      respondWith({
        domain: 'a.example.test',
        self_hosted_domains: ['a.example.test', 3, 'b.example.test'],
        destinations: [
          { uri: 'c.example.test' },
          { type: 'private' },
          { type: 'worker', worker_id: 'worker-1' },
          { type: 'worker', worker_id: 5 },
          { type: 'preview_worker', worker_id: 'preview-only' },
          { type: 'all_workers' },
        ],
      }),
    ).getAccessApplicationTargets('a');
    expect(targets).toEqual({
      hosts: ['a.example.test', 'b.example.test', 'c.example.test'],
      workerIds: ['worker-1'],
    });

    const results = await clientFor(
      respondWith([{ success: true, meta: 'x', results: 'y' }, 'z']),
    ).executeD1Batch(DATABASE_ID, []);
    expect(results).toEqual([
      { success: true, changes: undefined, rows: [] },
      { success: false, changes: undefined, rows: [] },
    ]);
  });

  it('treats a success response without success: true as a failure', async () => {
    const client = clientFor(() =>
      Promise.resolve(new Response('not json', { status: 200 })),
    );
    await expect(client.getAccountWorkersSubdomain()).rejects.toThrow(
      'HTTP 200, error codes none',
    );
  });

  it('reports only numeric Cloudflare error codes', async () => {
    const client = clientFor(() =>
      Promise.resolve(
        Response.json(
          {
            success: false,
            errors: [{ code: 7003, message: API_TOKEN }, { code: 'x' }],
          },
          { status: 400 },
        ),
      ),
    );
    const error: unknown = await client
      .getAccountWorkersSubdomain()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status: 400, retriable: false });
    expect(String(error)).toContain('error codes 7003');
    expect(String(error)).not.toContain(API_TOKEN);
  });

  it('replaces a thrown fetch error with a generic network error', async () => {
    const client = clientFor(
      () => Promise.reject(new Error(`Bearer ${API_TOKEN}`)),
      { maxReadAttempts: 1 },
    );
    const error: unknown = await client
      .getAccountWorkersSubdomain()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ retriable: true, status: undefined });
    expect(String(error)).toBe(
      'CloudflareApiError: Read account workers.dev subdomain failed: network error',
    );
  });

  it('backs off between read attempts using the default timer', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const client = createCloudflareClient({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      fetch: () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? Response.json({ success: false }, { status: 500 })
            : Response.json({ success: true, result: { subdomain: 's' } }),
        );
      },
    });
    const pending = client.getAccountWorkersSubdomain();
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe('s');
    expect(attempts).toBe(2);
  });

  it('never retries the batch, even on a transient status', async () => {
    let attempts = 0;
    const client = clientFor(() => {
      attempts += 1;
      return Promise.resolve(
        Response.json({ success: false }, { status: 503 }),
      );
    });
    await expect(client.executeD1Batch(DATABASE_ID, [])).rejects.toMatchObject({
      retriable: true,
    });
    expect(attempts).toBe(1);
  });
});

describe('redaction', () => {
  it('removes known secrets and authorization values', () => {
    expect(
      redact(
        `token ${API_TOKEN}; Authorization: Bearer abc.def "authorization":"xyz"`,
        [API_TOKEN, ''],
      ),
    ).toBe(
      'token [REDACTED]; Authorization: Bearer [REDACTED] "authorization":"[REDACTED]"',
    );
  });

  it('leaves text without secrets unchanged', () => {
    expect(redact('Stage delete failed', [API_TOKEN])).toBe(
      'Stage delete failed',
    );
  });
});
