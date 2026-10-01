# Feature: Import recipes from Kikkoman Singapore

- Status: Proposed
- Phase: 3 — recipes (follow-up to the [recipe library](./0031-recipe-library.md))
- Issue: [#111](https://github.com/wpliao/meal-planner/issues/111)
- Product owner: Repository owner
- Last updated: 2026-10-01
- Pull requests: none yet

## Problem and outcome

The family cooks from Kikkoman Singapore's recipes at
`https://www.kikkoman.com.sg/recipes/`. The recipe library (#31) imports only
pages that publish a JSON-LD `Recipe` ([resolved decision 3](./0031-recipe-library.md#resolved-design-decisions)).
Kikkoman Singapore publishes none. On 2026-10-01, all 58 recipe pages linked
from `/recipes/` (`/product_recipes/<name>/`) carried only
`BreadcrumbList`, `ListItem`, and `SiteNavigationElement` JSON-LD, with no
microdata. A browser user agent received the same data. Every import from the
site would fail today.

Outcome: a member pastes a Kikkoman Singapore recipe link and gets the same
editable draft as any other import, then reviews and saves it. The draft is read
from the page's own recipe layout by a reader that runs only for this host.
Every other site keeps the JSON-LD-only rule.

## User scenarios

1. Given a Kikkoman Singapore recipe page, when a member imports its URL, then
   the draft has the page's title, every ingredient with its amount in page
   order, the steps in order, and the servings from a heading such as
   "For 2 portion(s)".
2. Given a recipe whose ingredients are grouped as "(A)" and "(B)", when it is
   imported, then the group labels stay in the ingredient list in place, so a
   step that says "add (A)" still makes sense.
3. Given a page with no ingredients or steps, or a page whose layout Kikkoman
   has changed, when it is imported, then the import fails with the existing
   "couldn't read a recipe" explanation and manual entry stays open.

## Scope

- Included: the `www.kikkoman.com.sg` host on the import allowlist; a
  site-specific reader for the site's recipe page layout, used only on that
  host and only when the page has no usable JSON-LD `Recipe`; the host in the
  import screen's list of supported sites.
- Not included: any other site; a general HTML recipe parser; microdata;
  images, category tags, nutrition panels, or the PDF download; Kikkoman sites
  for other countries. Kikkoman Japan (`kikkoman.co.jp`) keeps its existing
  JSON-LD import.

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: Importing a Kikkoman Singapore recipe page returns a draft with
      the page's title, ingredient lines in page order, steps in order, and
      servings when the page states a portion count, following the
      [extraction rules](#extraction-rules).
- [ ] `AC-02`: The site-specific reader runs only for the host
      `www.kikkoman.com.sg`, and only when the page has no usable JSON-LD
      `Recipe`. A page on any other host with the same layout still fails as
      `unsupported_source`.
- [ ] `AC-03`: Every #31 import protection applies unchanged: the destination
      allowlist and per-hop redirect revalidation, the 2 MiB, 10-second, `200`,
      and `text/html` limits, plain text only, the recipe bounds and truncation
      notices, no logging of URLs or page content, and no D1 write before the
      member saves. A page without the expected layout fails as
      `unsupported_source`.
- [ ] `AC-04`: Deterministic Workers-runtime tests cover each supported layout
      and each failure with synthetic pages that mirror the site's markup. No
      test contacts the site.

## Experience design

No new screen or state. The import screen's list of supported sites gains
`kikkoman.com.sg`. The draft review, truncation notices, provenance, failure
messages, and manual-entry fallback are the #31 ones. The saved recipe's source
link points to the page the member imported, as for every website copy.

## Technical design

### Boundaries and contracts

No API, contract, or client-flow change. `POST /api/recipes/import-preview`
returns the same preview and the same failure classes.

- **Allowlist.** `RECIPE_IMPORT_HOSTS` in `src/shared/recipes.ts` gains
  `www.kikkoman.com.sg` only. The bare domain `kikkoman.com.sg` is left out,
  an exception to the #31 "with and without `www.`" convention, because it does
  not complete a TLS handshake; a member who types it gets the existing
  `unsafe_destination` message. `recipeImportSites` changes from "hosts without
  `www.`" to "each host with any leading `www.` removed, once", so the screen
  still lists `kikkoman.com.sg`.
- **Reader.** A new `src/worker/import/kikkoman-sg.ts` adds `HTMLRewriter`
  handlers to the existing single streaming pass in `readPageText`. The extra
  handlers are attached only when the final URL's host is
  `www.kikkoman.com.sg`, and collect plain text only. They never keep markup or
  attribute values.
- **Order.** `readPreview` tries `extractRecipeDraft` on the JSON-LD first. Only
  when that returns nothing and the host is `www.kikkoman.com.sg` does it build
  the draft from the reader's text. If Kikkoman later publishes JSON-LD
  `Recipe` data, it wins with no code change.
- **Normalization.** The reader's lines go through the same
  `htmlToPlainText`, line cap, and `truncateRecipeDraft` as JSON-LD text. A
  draft with no title, ingredient, or step fails as `unsupported_source`, as
  today.

### Extraction rules

All 58 recipe pages use one Elementor template (`elementor-page-2078`), with a
single `<h1>` title, an ingredients column, and a steps column. The rules below
held on every page checked; 57 of the 58 produced a complete draft, and the
58th has no ingredients or steps on the page at all.

| Field       | Source on the page                                                                                                                      | Rule                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title       | The page's first `<h1>`                                                                                                                 | Its text.                                                                                                                                                                                                                                                               |
| Servings    | The heading in the ingredients column that mentions portions ("For 3-4 portion(s)", "2 portions")                                       | Remove a leading "For", then apply the #84 `servingsFromYield` rule: the leading whole number from 1 to 50. "For 3-4 portion(s)" gives 3. No such heading gives no servings.                                                                                            |
| Ingredients | Usually every row of every `table.recipe-table` in the ingredients column, in document order (49 pages one table, 7 pages two or three) | One line per row: the cells' text joined by one space ("Pork belly 500 g"). Text inside one cell is joined without a separator, because the site splits a word across links ("K" + "IKKOMAN"). Empty rows are skipped. A label row such as "(A)" stays as its own line. |
| Ingredients | Otherwise, the paragraphs in the ingredients column (one page today)                                                                    | One line per `<br>`-separated line. Lines such as "For seasoning:" and "(A) 1 tsp chicken broth mix" are kept as written.                                                                                                                                               |
| Steps       | The text widget in the steps column: an ordered list (33 pages) or paragraphs with `<br>`-separated numbered lines (24 pages)           | One step per list item, with lines inside an item joined by a space. Without a list, one step per line, with a leading "1." or "1)" number removed. "Share" and other buttons are outside the widget and never read.                                                    |

The reader finds the columns by the template's stable element classes and the
"Ingredients" heading, not by position in the page. Its implementation pins the
exact selectors and cites them in code comments. Weight annotations such as
`[45g]` and the site's spelling and spacing are kept verbatim, because the copy
is the member's to edit.

### Data and migrations

Not applicable. Imported Kikkoman Singapore recipes are ordinary website
recipes in the #31 schema, with `source_kind = 'website'` and the page URL.

### Security and privacy

The #31 security design is unchanged: the same request headers, manual
redirects revalidated against the allowlist on every hop, size and time limits,
and no forwarded identity. The new allowlist entry is one exact host. The reader
runs inside the existing bounded stream, collects text only, never evaluates
script, and its output is rendered as plain text like every other import.
Nothing is logged.

This amends #31 resolved decision 3 ("JSON-LD `Recipe` only; microdata and
heuristic scraping rejected") for this one host only. The exception is
deliberately narrow: a named host, a fixed page template, and a fixed set of
rules rather than a general heuristic. A layout change can only make an import
fail. It cannot widen what is fetched or how text is handled.

The repository is public, so the test fixtures are synthetic pages that mirror
the template's markup with made-up recipe text. They do not copy Kikkoman's
recipes. The owner confirms that the site's terms permit a private family copy
before production, as #31 requires for every host.

### Accessibility

No interface change beyond one more item in an existing list.

### Reliability and observability

Kikkoman can change its template at any time. The failure mode is a clean
`unsupported_source` and manual entry. A redesign that keeps the class names but
moves content could produce an incomplete draft; the member reviews every draft
before saving, as with any import. Outcome classes may be counted as today,
without URLs or content.

## Test strategy

- Workers runtime (`test/worker/recipe-import.test.ts`, with synthetic pages in
  `test/worker/import-pages.ts`): a single-table page; a grouped page with
  two tables, empty rows, a label row, and a word split across links; the
  paragraph-ingredients layout; ordered-list steps, including a step with
  internal line breaks; `<br>` numbered steps; a portion range, a plain
  portion count, and no portion heading; JSON-LD on the same host taking
  precedence; the same layout on another allowlisted host failing; a page with
  no ingredients or steps failing; over-long and over-many lines truncated with
  notices; markup in cells kept as literal text.
- Unit (`src/shared/recipes.test.ts`): the allowlist accepts
  `www.kikkoman.com.sg` and refuses `kikkoman.com.sg`; `recipeImportSites`
  lists `kikkoman.com.sg` once.
- Client (`src/client/RecipeImport.test.tsx`): the supported-sites list.
- No new Playwright journey: the browser flow is unchanged, and the existing
  import specs cover it.
- Manual development validation: import real pages covering a single table, a
  grouped recipe, the paragraph layout, and `<br>` steps, and compare each draft
  with the page.

## Traceability

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |

## Rollout and rollback

One implementation pull request after the design is accepted. It follows
[PR #110](https://github.com/wpliao/meal-planner/pull/110) (RecipeTin Eats),
because both edit the allowlist. The implementation pull request also appends a
row to the #31 decision log that points here. Deploy to development, validate
with real pages, then release to production with approval. Rollback removes the
host and the reader. Recipes already saved are unaffected, because they are
ordinary website copies.

## Resolved design decisions

These are proposed defaults. The owner accepts them with the design or changes
them.

1. **Group labels:** keep a label row such as "(A)" as its own ingredient line,
   in place. This is recommended because it copies the page faithfully and
   matches steps that refer to "(A)". Rejected: prefixing the label to each
   following ingredient, which would mean guessing where a group ends across
   tables; and dropping the label, which leaves "add (A)" unexplained.
2. **Portion ranges:** "For 3-4 portion(s)" records 3 servings, the #84 rule
   for a leading whole number. The member can change it in the draft. Rejected:
   recording no servings for a range.
3. **Weight annotations:** keep `[45g]` as written. Rejected: stripping them,
   which would edit the source text.
4. **Bare domain:** leave `kikkoman.com.sg` off the allowlist while it fails
   TLS. Rejected: adding it, which only produces a connection failure.

## Decision and change log

| Date       | Change                                                                       | Reason                                                                                                                                                                    | Evidence                                                        |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 2026-10-01 | Initial proposal; status `Proposed`; amends #31 decision 3 for one host only | Owner chose a Kikkoman Singapore–only reader after a check of all 58 recipe pages found no JSON-LD `Recipe`, and found one consistent template that 57 pages fill in full | [Issue #111](https://github.com/wpliao/meal-planner/issues/111) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None
