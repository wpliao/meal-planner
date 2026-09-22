import type { BoundStatement } from './sql.ts';

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export interface CloudflareClientOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  /** Total attempts for a read-only call, including the first. */
  readonly maxReadAttempts?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
}

/**
 * A Cloudflare API failure. The message names only the operation, the HTTP
 * status, and Cloudflare's numeric error codes. It never carries the request,
 * the response body, headers, or the original network error text.
 */
export class CloudflareApiError extends Error {
  readonly operation: string;
  readonly status: number | undefined;
  readonly retriable: boolean;

  constructor(
    operation: string,
    detail: string,
    status: number | undefined,
    retriable: boolean,
  ) {
    super(`${operation} failed: ${detail}`);
    this.name = 'CloudflareApiError';
    this.operation = operation;
    this.status = status;
    this.retriable = retriable;
  }
}

export interface D1DatabaseInfo {
  readonly uuid: string;
  readonly name: string;
}

export interface D1StatementResult {
  readonly success: boolean;
  readonly changes: number | undefined;
  readonly rows: readonly Record<string, unknown>[];
}

export interface WorkerSubdomainState {
  readonly enabled: boolean;
  readonly previewsEnabled: boolean;
}

export interface AccessPolicy {
  readonly decision: string;
  readonly include: readonly Record<string, unknown>[];
  readonly require: readonly Record<string, unknown>[];
  readonly exclude: readonly Record<string, unknown>[];
}

export interface CloudflareClient {
  getD1Database(databaseId: string): Promise<D1DatabaseInfo>;
  /** Runs one read-only statement. Transient failures are retried. */
  readD1(
    databaseId: string,
    statement: BoundStatement,
  ): Promise<readonly Record<string, unknown>[]>;
  /**
   * Sends a destructive batch in a single request. It is never retried: after
   * an ambiguous failure the batch may or may not have committed.
   */
  executeD1Batch(
    databaseId: string,
    statements: readonly BoundStatement[],
  ): Promise<readonly D1StatementResult[]>;
  getTimeTravelBookmark(databaseId: string): Promise<string>;
  getAccountWorkersSubdomain(): Promise<string>;
  getWorkerSubdomainState(scriptName: string): Promise<WorkerSubdomainState>;
  listWorkerCustomDomains(scriptName: string): Promise<readonly string[]>;
  getAccessApplicationHosts(appId: string): Promise<readonly string[]>;
  listAccessPolicies(appId: string): Promise<readonly AccessPolicy[]>;
}

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 30_000;
const BASE_BACKOFF_MS = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const errorCodes = (body: unknown): string => {
  if (!isRecord(body)) return 'none';
  const codes = asRecords(body.errors)
    .map(({ code }) => code)
    .filter((code): code is number => typeof code === 'number');
  return codes.length > 0 ? codes.join(',') : 'none';
};

const shapeError = (operation: string): CloudflareApiError =>
  new CloudflareApiError(
    operation,
    'unexpected response shape',
    undefined,
    false,
  );

const isTransientStatus = (status: number): boolean =>
  status === 429 || status >= 500;

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const createCloudflareClient = (
  options: CloudflareClientOptions,
): CloudflareClient => {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const maxReadAttempts = Math.max(1, options.maxReadAttempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const account = `/accounts/${encodeURIComponent(options.accountId)}`;

  const requestOnce = async (
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The original error can echo request details; report only its kind.
      throw new CloudflareApiError(operation, 'network error', undefined, true);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }

    if (!response.ok || !isRecord(parsed) || parsed.success !== true) {
      throw new CloudflareApiError(
        operation,
        `HTTP ${response.status}, error codes ${errorCodes(parsed)}`,
        response.status,
        isTransientStatus(response.status),
      );
    }
    return parsed.result;
  };

  const read = async (
    operation: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await requestOnce(
          operation,
          body === undefined ? 'GET' : 'POST',
          path,
          body,
        );
      } catch (error) {
        const retriable =
          error instanceof CloudflareApiError && error.retriable;
        if (!retriable || attempt >= maxReadAttempts) throw error;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  };

  const database = (databaseId: string): string =>
    `${account}/d1/database/${encodeURIComponent(databaseId)}`;

  const toStatementResults = (
    operation: string,
    result: unknown,
  ): D1StatementResult[] => {
    if (!Array.isArray(result)) {
      throw shapeError(operation);
    }
    return result.map((entry): D1StatementResult => {
      const record = isRecord(entry) ? entry : {};
      const meta = isRecord(record.meta) ? record.meta : {};
      return {
        success: record.success === true,
        changes: typeof meta.changes === 'number' ? meta.changes : undefined,
        rows: asRecords(record.results),
      };
    });
  };

  return {
    async getD1Database(databaseId) {
      const result = await read('Read D1 database', database(databaseId));
      if (
        !isRecord(result) ||
        typeof result.uuid !== 'string' ||
        typeof result.name !== 'string'
      ) {
        throw shapeError('Read D1 database');
      }
      return { uuid: result.uuid, name: result.name };
    },

    async readD1(databaseId, statement) {
      const operation = 'Read D1 query';
      const result = await read(operation, `${database(databaseId)}/query`, {
        sql: statement.sql,
        params: statement.params,
      });
      const [first] = toStatementResults(operation, result);
      if (first?.success !== true) {
        throw new CloudflareApiError(
          operation,
          'statement did not succeed',
          undefined,
          false,
        );
      }
      return first.rows;
    },

    async executeD1Batch(databaseId, statements) {
      const operation = 'Deletion batch';
      const result = await requestOnce(
        operation,
        'POST',
        `${database(databaseId)}/query`,
        {
          batch: statements.map(({ sql, params }) => ({ sql, params })),
        },
      );
      return toStatementResults(operation, result);
    },

    async getTimeTravelBookmark(databaseId) {
      const result = await read(
        'Read Time Travel bookmark',
        `${database(databaseId)}/time_travel/bookmark`,
      );
      if (!isRecord(result) || typeof result.bookmark !== 'string') {
        throw shapeError('Read Time Travel bookmark');
      }
      return result.bookmark;
    },

    async getAccountWorkersSubdomain() {
      const result = await read(
        'Read account workers.dev subdomain',
        `${account}/workers/subdomain`,
      );
      if (!isRecord(result) || typeof result.subdomain !== 'string') {
        throw shapeError('Read account workers.dev subdomain');
      }
      return result.subdomain;
    },

    async getWorkerSubdomainState(scriptName) {
      const result = await read(
        'Read Worker workers.dev state',
        `${account}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
      );
      if (
        !isRecord(result) ||
        typeof result.enabled !== 'boolean' ||
        typeof result.previews_enabled !== 'boolean'
      ) {
        throw shapeError('Read Worker workers.dev state');
      }
      return {
        enabled: result.enabled,
        previewsEnabled: result.previews_enabled,
      };
    },

    async listWorkerCustomDomains(scriptName) {
      const operation = 'List Worker custom domains';
      const result = await read(
        operation,
        `${account}/workers/domains?service=${encodeURIComponent(scriptName)}`,
      );
      if (!Array.isArray(result)) {
        throw shapeError(operation);
      }
      return asRecords(result).map(({ hostname }) =>
        typeof hostname === 'string' ? hostname : '',
      );
    },

    async getAccessApplicationHosts(appId) {
      const operation = 'Read Access application';
      const result = await read(
        operation,
        `${account}/access/apps/${encodeURIComponent(appId)}`,
      );
      if (!isRecord(result)) {
        throw shapeError(operation);
      }
      const hosts = new Set<string>();
      if (typeof result.domain === 'string') hosts.add(result.domain);
      if (Array.isArray(result.self_hosted_domains)) {
        for (const host of result.self_hosted_domains) {
          if (typeof host === 'string') hosts.add(host);
        }
      }
      for (const destination of asRecords(result.destinations)) {
        if (typeof destination.uri === 'string') hosts.add(destination.uri);
      }
      return [...hosts];
    },

    async listAccessPolicies(appId) {
      const operation = 'List Access policies';
      const result = await read(
        operation,
        `${account}/access/apps/${encodeURIComponent(appId)}/policies`,
      );
      if (!Array.isArray(result)) {
        throw shapeError(operation);
      }
      return asRecords(result).map((policy): AccessPolicy => ({
        decision:
          typeof policy.decision === 'string' ? policy.decision : 'unknown',
        include: asRecords(policy.include),
        require: asRecords(policy.require),
        exclude: asRecords(policy.exclude),
      }));
    },
  };
};
