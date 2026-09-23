/**
 * No Worker test may reach the internet.
 *
 * This is not a style rule. The recipe import route calls the runtime's own
 * `fetch`, and a test that exercises it through `SELF` — which holds the real
 * `fetch`, not an injected one — will silently make a live request to whatever
 * site the URL names. That happened once: a case asserting the import route
 * was "still unbuilt" kept working after the route existed, because the real
 * site answered. The assertion passed for the wrong reason and a private
 * family application quietly talked to a stranger from CI.
 *
 * So the global `fetch` is replaced here, for every Worker test file, with one
 * that refuses and says what to do instead. A test that needs an outbound
 * request must say so out loud with {@link stubOutboundFetch}, and that stub
 * is cleared before each test, so it can never leak into the next file.
 *
 * This does not affect `SELF.fetch`, `createWorker().fetch`, or any binding:
 * those dispatch inside the runtime and never leave it.
 */

import { beforeEach } from 'vitest';

type Outbound = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let stub: Outbound | null = null;

const targetOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

/**
 * Lets one test answer outbound requests itself. Prefer injecting a fake into
 * the code under test — `createWorker(identity, fetcher)` for the import
 * route — and reach for this only when the call is made by a dependency that
 * takes no injection point.
 */
export const stubOutboundFetch = (handler: Outbound): void => {
  stub = handler;
};

beforeEach(() => {
  stub = null;
});

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (stub) return stub(input, init);
  return Promise.reject(
    new Error(
      `A Worker test tried to fetch ${targetOf(input)} over the real network. ` +
        'Tests must never contact a site. Inject a fake fetcher (see ' +
        'test/worker/recipe-import.test.ts) or call stubOutboundFetch from ' +
        'test/worker/setup.ts.',
    ),
  );
};
