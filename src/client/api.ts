import type { ApiErrorResponse } from '../shared/api';

export type Notice = { tone: 'success' | 'error'; message: string } | null;

const messageFor = (response: Response, body: unknown): string => {
  const error = body as Partial<ApiErrorResponse> | undefined;
  if (error?.error?.message) return error.error.message;
  if (response.status === 409)
    return 'This change cannot be completed because the household has changed.';
  return 'The family space could not be updated. Please try again.';
};

/**
 * A rejected API response. It is still an `Error` whose message is fit to show
 * the family, and it also keeps the status and parsed body for a screen that
 * has to act on them — a recipe conflict carries the current recipe.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Throws with a message fit to show the family; callers render it directly. */
export async function api<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiRequestError(
      messageFor(response, body),
      response.status,
      body,
    );
  }
  return body as T;
}

export const jsonMutation = (
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/**
 * Every section runs mutations the same way: block further input, clear the
 * previous result, apply the change, reconcile from the server — after a
 * failure too, so the screen never keeps a value the server rejected — and
 * report exactly once.
 *
 * `reconcile` also carries whatever else has to happen on both paths, such as
 * closing a confirmation dialog.
 */
export async function runMutation(
  {
    setPending,
    notify,
    reconcile,
    fallback,
  }: {
    setPending: (pending: boolean) => void;
    notify: (notice: Notice) => void;
    reconcile: () => Promise<unknown>;
    fallback: string;
  },
  action: () => Promise<unknown>,
  success: string,
): Promise<void> {
  setPending(true);
  notify(null);
  try {
    await action();
    await reconcile();
    notify({ tone: 'success', message: success });
  } catch (error: unknown) {
    await reconcile();
    notify({
      tone: 'error',
      message: error instanceof Error ? error.message : fallback,
    });
  } finally {
    setPending(false);
  }
}
