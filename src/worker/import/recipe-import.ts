/**
 * Fetches one public recipe page and returns a draft for the member to review.
 *
 * Every bound here is the accepted #31 design's, and each one is enforced
 * before the next step runs:
 *
 * - **Destination.** The submitted URL must parse, be `https:`, carry no
 *   credentials, use the default port, and have a hostname exactly on the
 *   reviewed allowlist. A refusal happens before any network request.
 * - **Redirects.** `redirect: 'manual'`, at most three hops, every hop
 *   revalidated against the whole destination policy. Each hop is a fresh
 *   `GET` carrying only a fixed `Accept` and `User-Agent`: no cookies, no
 *   `Cf-Access-*` assertion, nothing from the member's request.
 * - **Response.** `200` and `text/html` only; `4xx`/`5xx` are unavailable;
 *   the body is abandoned past 2 MiB and the whole import past 10 seconds.
 *
 * Nothing here logs the URL, the page, or anything about the family, and
 * nothing here writes to D1.
 */

import {
  parseRecipeSourceUrl,
  truncateRecipeDraft,
  truncateRecipeText,
  RECIPE_IMPORT_MAX_BYTES,
  RECIPE_IMPORT_MAX_REDIRECTS,
  RECIPE_IMPORT_TIMEOUT_MS,
  RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH,
  type RecipeImportFailure,
  type RecipeImportPreviewResponse,
} from '../../shared/recipes';
import { extractRecipeDraft, htmlToPlainText } from './json-ld';

/**
 * The page fetcher, injected so tests never reach a real site. It is shaped
 * like `fetch` on purpose; the Worker passes the real one.
 */
export type ImportFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RecipeImportOptions {
  fetcher?: ImportFetch;
  /**
   * Only tests set this: they cannot wait the real ten seconds. Production
   * always uses the shared bound.
   */
  timeoutMs?: number;
}

export type RecipeImportResult =
  | { ok: true; preview: RecipeImportPreviewResponse }
  | { ok: false; reason: RecipeImportFailure };

/**
 * Identifies the application to the site it contacts, as a well-behaved
 * client should. It carries no member, household, or installation detail.
 */
const IMPORT_USER_AGENT =
  'FamilyMealPlanner/1.0 (+private household recipe import)';

/** The complete request header set. Nothing is copied from the member. */
const importHeaders = (): Record<string, string> => ({
  accept: 'text/html',
  'user-agent': IMPORT_USER_AGENT,
});

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** A bound this adapter enforced itself, as opposed to a network failure. */
class ImportRefused extends Error {
  constructor(readonly reason: RecipeImportFailure) {
    super(reason);
    this.name = 'ImportRefused';
  }
}

const failed = (reason: RecipeImportFailure): RecipeImportResult => ({
  ok: false,
  reason,
});

/** Releases a response the import will not read. */
const discard = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => undefined);
};

/**
 * Resolves a `Location` against the URL that produced it and puts the result
 * through the whole destination policy again. A downgrade to `http:`, another
 * host, credentials, or a non-default port all come back as null.
 */
const nextHop = (location: string, current: URL): URL | null => {
  let candidate: URL;
  try {
    candidate = new URL(location, current);
  } catch {
    return null;
  }
  const revalidated = parseRecipeSourceUrl(candidate.href);
  return revalidated.ok ? revalidated.url : null;
};

interface PageText {
  /** The text of each `application/ld+json` script, in document order. */
  scripts: string[];
  /** The document title, if the page had one. */
  title: string;
}

/**
 * Streams the body through `HTMLRewriter`, keeping only the JSON-LD script
 * text and the document title, and abandons it once 2 MiB have gone past. The
 * rewriter's output is thrown away chunk by chunk, so the page is never held
 * in memory whole.
 */
const readPageText = async (response: Response): Promise<PageText> => {
  const scripts: string[] = [];
  let script = '';
  let title = '';
  let titleComplete = false;

  const rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element() {
        script = '';
      },
      text(chunk) {
        script += chunk.text;
        if (chunk.lastInTextNode) {
          scripts.push(script);
          script = '';
        }
      },
    })
    .on('title', {
      text(chunk) {
        if (titleComplete) return;
        title += chunk.text;
        if (chunk.lastInTextNode) titleComplete = true;
      },
    });

  const body = response.body;
  if (!body) return { scripts, title };

  let exceeded = false;
  let bodyFailure = false;
  const conduit = new TransformStream<Uint8Array, Uint8Array>();

  /**
   * Counts the page as it goes past and stops at the bound by cancelling the
   * site's stream and closing the rewriter's input cleanly. Stopping this way
   * rather than by erroring the stream keeps the reason a plain value: the
   * runtime never has to carry, or swallow, an exception for it.
   */
  const pump = async (): Promise<void> => {
    const source = (body as ReadableStream<Uint8Array>).getReader();
    const sink = conduit.writable.getWriter();
    let seen = 0;
    try {
      let done = false;
      while (!done) {
        const chunk = await source.read();
        done = chunk.done;
        if (!chunk.value) continue;
        seen += chunk.value.byteLength;
        if (seen > RECIPE_IMPORT_MAX_BYTES) {
          exceeded = true;
          break;
        }
        await sink.write(chunk.value);
      }
    } catch {
      // What broke is not recorded: it could quote the page.
      bodyFailure = true;
    } finally {
      // Abandons whatever the site is still sending.
      await source.cancel().catch(() => undefined);
      await sink.close().catch(() => undefined);
    }
  };

  const output = rewriter.transform(new Response(conduit.readable)).body;
  const pumped = pump();
  try {
    const reader = output?.getReader();
    if (reader) {
      try {
        let done = false;
        while (!done) ({ done } = await reader.read());
      } finally {
        reader.releaseLock();
      }
    }
  } finally {
    await pumped;
  }

  if (exceeded) throw new ImportRefused('too_large');
  // A body that broke mid-read is a failure at the far end. A timeout also
  // breaks it, and the caller checks the abort signal before this class.
  if (bodyFailure) throw new ImportRefused('source_unavailable');
  return { scripts, title };
};

const mediaType = (response: Response): string =>
  (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

/**
 * The document title, bounded like a stored source title. It goes through the
 * same plain-text normalization as the recipe, because a page title is page
 * content too.
 */
const sourcePageTitle = (raw: string): string | null => {
  const cleaned = truncateRecipeText(
    htmlToPlainText(raw),
    RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH,
  );
  return cleaned.length > 0 ? cleaned : null;
};

/** Turns the final response into a draft, or says why it cannot. */
const readPreview = async (
  response: Response,
  submitted: URL,
  resolved: URL,
): Promise<RecipeImportResult> => {
  if (response.status >= 400) {
    await discard(response);
    return failed('source_unavailable');
  }
  if (response.status !== 200 || mediaType(response) !== 'text/html') {
    await discard(response);
    return failed('unsupported_source');
  }

  // A declared length over the bound is refused without reading a byte. The
  // streamed count below still decides, because the header may be absent or
  // wrong.
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > RECIPE_IMPORT_MAX_BYTES) {
    await discard(response);
    return failed('too_large');
  }

  const page = await readPageText(response);
  const extracted = extractRecipeDraft(page.scripts);
  if (!extracted) return failed('unsupported_source');

  const { draft, notices } = truncateRecipeDraft(extracted);
  // Truncation cannot empty a field that had content, but normalization can
  // (a title of nothing but control characters), and an empty draft is not
  // something the member should have to fix by hand in the form.
  if (
    draft.title.length === 0 ||
    draft.ingredients.length === 0 ||
    draft.steps.length === 0
  ) {
    return failed('unsupported_source');
  }

  return {
    ok: true,
    preview: {
      draft,
      notices,
      source: {
        submittedUrl: submitted.href,
        resolvedUrl: resolved.href === submitted.href ? null : resolved.href,
        host: resolved.hostname,
        pageTitle: sourcePageTitle(page.title),
      },
    },
  };
};

/**
 * Imports one page. Failures are values, not exceptions, and none of them
 * carries anything from the page or the request.
 */
export const importRecipePreview = async (
  submittedUrl: string,
  options: RecipeImportOptions = {},
): Promise<RecipeImportResult> => {
  const submitted = parseRecipeSourceUrl(submittedUrl);
  if (!submitted.ok) return failed('unsafe_destination');

  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(
    options.timeoutMs ?? RECIPE_IMPORT_TIMEOUT_MS,
  );
  const request = (url: URL): Promise<Response> =>
    fetcher(url.href, {
      method: 'GET',
      headers: importHeaders(),
      redirect: 'manual',
      signal,
    });

  let current = submitted.url;
  let redirects = 0;

  try {
    let response = await request(current);

    while (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await discard(response);
      if (location === null) return failed('unsupported_source');
      if (redirects >= RECIPE_IMPORT_MAX_REDIRECTS) {
        return failed('unsafe_destination');
      }
      const next = nextHop(location, current);
      if (!next) return failed('unsafe_destination');

      redirects += 1;
      current = next;
      response = await request(current);
    }

    return await readPreview(response, submitted.url, current);
  } catch (error: unknown) {
    if (signal.aborted) return failed('timeout');
    if (error instanceof ImportRefused) return failed(error.reason);
    // A refused connection, a DNS failure, or a broken body: the site did not
    // give us a page. Nothing about it is logged.
    return failed('source_unavailable');
  }
};
