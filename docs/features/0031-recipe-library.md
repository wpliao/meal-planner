# Feature: Recipe library

- Status: Designing
- Phase: 3 — recipes
- Issue: [#31](https://github.com/wpliao/meal-planner/issues/31)
- Product owner: Repository owner
- Last updated: 2026-09-22
- Pull requests: [#33 — design proposal](https://github.com/wpliao/meal-planner/pull/33)

## Problem and outcome

The family needs a private place to keep recipes it can use and change. A recipe
may be entered by a member or copied from a website. An imported copy must be
reviewed before saving and must retain its original link and provenance, because
website extraction is imperfect and the family may want to revisit the source.

This is a **proposal**, not an accepted design. The [product roadmap](../PRODUCT.md)
defines the Phase 3 outcome but does not authorize implementation on its own.
The product owner answered every open design decision on 2026-09-22; see
[Resolved design decisions](#resolved-design-decisions). The design becomes
`Accepted` only after the owner explicitly accepts this revision.

## User scenarios

1. Given an active member, when they enter a title, ingredients, and steps, then
   the recipe appears in the shared household library and can be edited later.
2. Given two active members viewing the same recipe, when one saves a change
   first, then the other's older draft cannot silently replace it.
3. Given a public recipe page, when a member imports its URL, then they review
   and correct an editable draft before explicitly saving a private copy that
   links to the source.
4. Given an unsupported, unavailable, or unsafe page, when import fails, then
   no recipe is created and the member can continue with manual entry.
5. Given a non-member or an identity without a valid Access assertion, when
   they request a recipe, then no household data is disclosed.

## Scope

- Included: household recipe list and detail views; manual create, edit, and
  confirmed delete; one-at-a-time import preview from a website URL; editable
  copy with source metadata; responsive and accessible states.
- Not included: meal planning, pantry matching or deduction, structured
  nutrition, AI, photos, public sharing, bulk import, source synchronization, or
  guaranteed extraction from every site. Imported markup is never displayed.

## Acceptance criteria

These identifiers mirror [issue #31](https://github.com/wpliao/meal-planner/issues/31)
and are **proposed**. They become stable only when the issue and design are
accepted. No criterion is marked complete at this stage.

- [ ] `AC-01`: Active members can list, view, create, edit, and delete only their
      household's recipes; unauthenticated visitors and non-members cannot read
      or change them.
- [ ] `AC-02`: A manually entered recipe records a title, an ordered ingredient
      list, and ordered instructions, plus optional notes; validation, empty,
      loading, success, and failure states work on phone and desktop.
- [ ] `AC-03`: An active member can submit a public recipe-page URL, review and
      edit an extracted draft, and explicitly save it. The saved recipe retains
      the original URL and source/provenance; a failed or unsupported import does
      not create a recipe.
- [ ] `AC-04`: Concurrent changes cannot silently overwrite a newer edit.
      Deletion requires confirmation, and stale updates or deletion return a
      recoverable conflict.
- [ ] `AC-05`: Recipe data stays household scoped in D1; URL fetching and parsing
      are bounded against unsafe destinations, redirects, oversized responses,
      active content, and disclosure through logs. Imported text is rendered
      safely under the current Content Security Policy.
- [ ] `AC-06`: Deterministic tests cover migration, Worker authorization and
      isolation, import success and failure, concurrent edits, and primary
      browser journeys. Development and production validation evidence is
      recorded before release.

## Experience design

A Recipes route joins the existing navigation in [ADR 0007](../DECISIONS/0007-navigation-and-information-architecture.md).
The library shows recipe titles and source labels, with a distinct empty state
and a retry action when loading fails. A detail page shows ingredients in their
entered order and numbered steps. Create and edit use the same form, built from
the components and tokens in [ADR 0006](../DECISIONS/0006-component-library.md)
and [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md).

Import starts with a URL and returns a **draft preview**, not a persisted
recipe. The member sees the extracted title, ingredients, steps, source URL,
and any missing fields, can edit every field, and then chooses Save. Leaving or
cancelling discards the draft. If the page is unavailable, unsupported, or
unsafe, the form explains the failure without creating data and offers manual
entry. Import is one URL at a time; the family does not give the application
website credentials.

The form marks invalid fields near the control and preserves typed content
after a validation or network error. A stale save shows that another member
changed the recipe and offers the current version for comparison before a new
save. Delete names the recipe in a focus-trapped confirmation dialog and
returns focus appropriately. Browser back and direct links follow the existing
route pattern. Phone layouts use a single column and 44px minimum targets.

## Technical design

### Boundaries and contracts

The client adds `/recipes`, `/recipes/new`, and `/recipes/:id` under the existing
authenticated layout. Shared contracts describe recipe fields, bounded
validation, version, and source metadata. The Worker reuses the verified
identity and active membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md)
on **every** recipe request; household scope comes from `MemberContext`, never
from a URL or request body.

Proposed API: `GET /api/recipes`, `GET /api/recipes/:id`, `POST /api/recipes`,
`PATCH /api/recipes/:id`, `DELETE /api/recipes/:id`, and
`POST /api/recipes/import-preview`. Mutations retain the existing same-origin
and JSON content-type checks. Update and delete require the current version and
return `409` for a stale version; missing or another household's ID returns a
non-disclosing `404`. Import preview performs no D1 write. The same create API
saves manual and imported recipes after validation.

The import adapter accepts a URL and returns text fields and source metadata.
It fetches and parses only after member authorization. It reads only
schema.org `Recipe` objects from `<script type="application/ld+json">`
elements, including top-level arrays and `@graph` containers and `@type`
arrays that include `Recipe`. The script text is collected with the Workers
runtime `HTMLRewriter` from a byte-bounded response stream; each script's JSON
is parsed with `JSON.parse` and never evaluated. The draft uses `name` as the
title, `recipeIngredient` as ingredient lines, and `recipeInstructions` as
steps: plain strings, `HowToStep.text` (or `name` when `text` is absent), and
the steps inside each `HowToSection`, in document order. Any other property
(yield, times, images, ratings, nutrition, author) is ignored. A page without
a usable name, at least one ingredient, and at least one instruction returns
`unsupported_source`, and the member is offered manual entry. Microdata,
heuristic HTML scraping, and AI are outside this release.

Worker-runtime feasibility: `fetch` with `redirect: 'manual'` exposes the
`3xx` status and `Location` header, `AbortSignal.timeout` bounds the total
duration, and `HTMLRewriter` streams text content by selector. Each of these
is proven by Workers-runtime tests against a fake fetch adapter. Real host
behavior is checked during development validation, not in automated tests.

### Data and migrations

The forward migration is `0003_create_recipes.sql`; it is **not yet created
or applied**. A `recipes` row belongs to a household and carries an opaque ID,
title, optional notes, version, creation/update times, and `manual` or
`website` source kind. A website copy also carries the submitted original URL,
final resolved URL if different, source host, source page title when available,
and import time. Ordered `recipe_ingredients` and `recipe_steps` rows belong to
the recipe. Titles need not be unique: two different sources can use the same
title.

Deletion semantics are fixed by the accepted
[#32 design](./0032-household-lifecycle.md) and
[ADR 0008](../DECISIONS/0008-household-decommissioning.md):
`recipes.household_id` references `households(id)` with `ON DELETE CASCADE`,
and `recipe_ingredients.recipe_id` and `recipe_steps.recipe_id` reference
`recipes(id)` with `ON DELETE CASCADE`. The accepted operator batch (clear
`app_installation`, then delete the household) therefore removes every recipe
row without change, as it does for `pantry_items`. Deleting one recipe removes
its lines. Migration tests prove both cascades.

Each ingredient is one ordered, unstructured plain-text line, for example
`2 tbsp soy sauce` or `大さじ2 しょうゆ`, for manual and imported recipes
alike. There are no quantity or unit columns in this release; unparsed text is
never treated as a nutrition-ready quantity. Structured quantities, if a later
nutrition or pantry-matching feature needs them, arrive as a forward migration.
No remote HTML, script, or import debug body is retained. Preserve the original
source link, but do not store unrelated request headers or cookies.

Bounds are shared constants in `src/shared/recipes.ts`. The migration enforces
the storage bounds with `CHECK` constraints:

| Field                          | Bound                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Title                          | 1–120 characters after whitespace normalization                    |
| Ingredients                    | 1–100 lines; each 1–300 characters                                 |
| Steps                          | 1–50 steps; each 1–2,000 characters                                |
| Notes                          | Optional; up to 4,000 characters                                   |
| Recipes per household          | 500, checked on create like the pantry item limit                  |
| Source URL (submitted / final) | Up to 2,048 characters each; the source page title up to 200 chars |

An imported draft that exceeds a recipe bound is truncated to the bound (extra
lines dropped, long lines cut at a character boundary) and the preview carries
a notice so the member reviews it before saving. Saving always revalidates
against the same bounds.

Household deletion and ownership transfer remain an explicit Phase 1 follow-up
([feature #7](./0007-trusted-family-boundary.md)), now tracked in
[issue #32](https://github.com/wpliao/meal-planner/issues/32) and its
[design](./0032-household-lifecycle.md). The current
schema restricts household deletion while `app_installation` points to it, and
pantry rows cascade only after that pointer is handled. The proposed ordinary
transfer uses the existing owner APIs: promote an active successor, have the
successor verify owner access, then let the previous owner step down. The
last-active-owner guard remains in force. An unavailable previous owner needs a
separate recovery decision.

Household deletion is the owner-approved operator procedure accepted in the
#32 design and ADR 0008. It identifies the one household from a verified owner
request, rehearses in development, handles the installation pointer before
deleting the household, verifies that members, pantry items, and recipe rows
were removed, and accounts separately for Access configuration and D1 Time
Travel history. That procedure's post-deletion count check must include
`recipes` (and its child tables) once migration `0003` exists. Whichever of the
recipe migration pull request and the #32 `AC-02` pull request merges second
adds that check, and both pull requests say so. No production deletion is
authorized by this design.

### Security and privacy

The recipe page may contain private family preferences. Reads and writes use
prepared statements scoped to the verified household. No family recipe,
identity, submitted URL, or fetched page content appears in application logs.
An import request discloses the requested URL to the source site, so the UI
states that a site will be contacted. No Access assertion, cookie,
authorization header, or family data is forwarded.

**Destination policy: exact-host allowlist.** A Worker cannot resolve DNS and
check the resulting address before `fetch()`, so "any public page" cannot be
fully enforced. The first release fetches only these hosts, each with and
without a leading `www.`:

| Site                  | Allowed hostnames                                            |
| --------------------- | ------------------------------------------------------------ |
| Budget Bytes          | `budgetbytes.com`, `www.budgetbytes.com`                     |
| Minimalist Baker      | `minimalistbaker.com`, `www.minimalistbaker.com`             |
| Sally's Baking        | `sallysbakingaddiction.com`, `www.sallysbakingaddiction.com` |
| Just One Cookbook     | `justonecookbook.com`, `www.justonecookbook.com`             |
| The Woks of Life      | `thewoksoflife.com`, `www.thewoksoflife.com`                 |
| Kikkoman Home Cooking | `kikkoman.co.jp`, `www.kikkoman.co.jp`                       |

The submitted URL must parse with the WHATWG `URL` parser, use `https:`, have
no username or password, use the default port, and have a lowercase ASCII
hostname exactly equal to an entry; subdomain or suffix matching is not used.
The fragment is dropped before fetching. A disallowed or malformed URL returns
`unsafe_destination` before any network request. The allowlist is a reviewed
constant, so adding or removing a host is a small code change with tests. A
host that fails development validation, or whose terms of use the owner finds
do not permit a private family copy, is removed before production. Maangchi is
excluded because a direct fetch returns `403`; access controls are never
bypassed.

**Redirects.** Every request uses `redirect: 'manual'`. A `301`, `302`, `303`,
`307`, or `308` response with a `Location` header is resolved against the
current URL and the result is revalidated against the full destination policy
above. A redirect to `http:` (no downgrade), a non-allowlisted host, or a URL
with credentials returns `unsafe_destination`. At most **3** redirects are
followed; the fourth returns `unsafe_destination`. Each hop is a fresh `GET`
without a body, cookies, the incoming `Cf-Access-*` headers, or any incoming
header; the request sends only a fixed `Accept: text/html` and a fixed
identifying `User-Agent`. The final URL is stored as the resolved URL when it
differs from the submitted URL. Cloudflare
[documents](https://developers.cloudflare.com/workers/runtime-apis/request/)
that automatic redirect following can forward headers to another host, which
this avoids.

**Response limits.** The final response must be `200` with a `Content-Type`
of `text/html` (optionally with parameters); anything else returns
`unsupported_source`, and `4xx`/`5xx` return `source_unavailable`. The body is
read as a stream and abandoned at **2 MiB**, returning `too_large`. The whole
import, including redirects and parsing, is aborted after **10 seconds**,
returning `timeout`. Unsafe cases are tested against a fake fetch adapter;
tests never contact a real site. Never fetch an import URL in the browser.

Only normalized plain text enters the preview or database: HTML entities in
JSON-LD strings are decoded, any tags are stripped, control characters are
removed, and whitespace is collapsed before bounds are applied. The client renders
it as text, never through `innerHTML` or a markup renderer. This matters because
the current Content Security Policy allows inline styles for Mantine; see
[ADR 0006](../DECISIONS/0006-component-library.md) and [SECURITY.md](../SECURITY.md).
The design must be re-reviewed before adding rich imported HTML later.

### Accessibility

Use labelled native fields, ordered lists, visible focus, keyboard-reorderable
ingredient and step controls, announced validation/results, and a focus-trapped
delete dialog. Verify phone widths and Chromium/WebKit visual snapshots as well
as keyboard and screen-reader flow. Source links have descriptive names and
open with safe link attributes.

### Reliability and observability

No partial recipe is stored during preview. The preview returns one of the
failure classes `unsafe_destination`, `source_unavailable`,
`unsupported_source`, `too_large`, or `timeout`, each with a distinct
user-safe message.
An import failure leaves manual entry available. Failed writes keep the user's
draft and reconcile with the server. Metrics may count import outcome classes
without recording URLs or content. A bounded import avoids unpredictable
compute and network cost.

## Test strategy

- Shared validation tests: required title/ingredients/steps, bounds, version,
  source metadata, and plain-text handling.
- Actual Workers-runtime tests: migration constraints and cascades, member and
  non-member access, cross-household IDs, stale updates/deletes, URL policy,
  redirects, size/time limits, unsupported structured data, and no write on
  import failure. Mock remote pages; tests require no website or paid service.
- Playwright: manual create/edit/delete; import preview/edit/save; failure to
  manual entry; deep link, back navigation, mobile layout, keyboard focus, and
  visual checks on Chromium and WebKit.
- Development validation: use real Access identities and selected public pages
  on phone and desktop; confirm unsupported-page behavior and source link.
  Record exact deployment and owner acceptance separately from local tests.

## Traceability

These are planned locations and case names. Replace them with exact symbols and
passing test names during implementation; no recipe tests exist yet.

| Criterion | Planned implementation                                                                                | Planned automated evidence                                                                                         | Release evidence |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `AC-01`   | `src/worker/index.ts` recipe routes; `src/worker/data/recipe-repository.ts`; `src/client/Recipes.tsx` | `test/worker/recipes.test.ts` — authorization and household isolation; `tests/e2e/recipes.spec.ts` — member access | Pending          |
| `AC-02`   | `src/shared/recipes.ts`; `src/client/RecipeEditor.tsx`                                                | `src/shared/recipes.test.ts` — field bounds; `tests/e2e/recipes.spec.ts` — manual create and edit                  | Pending          |
| `AC-03`   | `src/worker/import/recipe-import.ts`; `src/client/RecipeEditor.tsx`                                   | `test/worker/recipe-import.test.ts` — preview/no write; `tests/e2e/recipes.spec.ts` — import review and save       | Pending          |
| `AC-04`   | `src/worker/data/recipe-repository.ts`; delete dialog                                                 | `test/worker/recipes.test.ts` — stale update/delete; `tests/e2e/recipes.spec.ts` — confirmed delete                | Pending          |
| `AC-05`   | `src/worker/import/recipe-import.ts`; plain-text rendering                                            | `test/worker/recipe-import.test.ts` — URL and response limits; browser security assertions                         | Pending          |
| `AC-06`   | Migration `0003`; feature release record                                                              | `test/worker/migration.test.ts`; full `./scripts/verify.sh`; PR CI/Sonar                                           | Pending          |

## Rollout and rollback

1. Record product-owner acceptance in the issue and set this document to
   `Accepted` on `main` before any feature code or migration is written.
2. Implement on focused `codex/` branches. Add the migration and tests together.
   Run the full Dev Container gate and require CI, Sonar, and security review.
3. Apply the migration in development through the protected workflow and
   validate real user flows, including import failure, on actual phones.
4. Obtain separate, explicit production approval before applying the migration
   and deploying. Record the exact run, Worker version, and owner validation.

The proposed migration is additive. A code rollback redeploys the prior Worker
while keeping the unused table; it does not reverse an applied migration or
silently delete family recipes. Recovery from a bad data write is a forward fix
or an explicitly approved restore after examining D1 backup scope.

## Resolved design decisions

The product owner answered these on 2026-09-22 in the design session. Each
chose the recommended option unless noted.

1. **Import destinations:** an exact-host allowlist of the six candidate sites
   from [issue #31](https://github.com/wpliao/meal-planner/issues/31), each
   with and without `www.`, HTTPS only. "Any public HTTPS page with guards" and
   "three verified hosts only" were rejected.
2. **Redirects:** manual handling, at most 3 hops, with every hop revalidated
   against the allowlist and no downgrade to `http:`. "No redirects" and
   "same host only" were rejected.
3. **Extraction:** structured JSON-LD `Recipe` data only, with manual entry
   as the fallback for unsupported pages. Microdata and heuristic scraping
   were rejected for this release.
4. **Ingredients:** unstructured ordered text lines; no quantity or unit
   fields.
5. **Deletion cascade:** recipes cascade from households, and ingredient and
   step rows cascade from recipes, as the #32 design and ADR 0008 require.
6. **Fields:** title, ordered ingredients, ordered steps, and **optional
   notes** (the owner chose notes over the smaller recommended set). Import
   never fills notes. Yield and times remain out of scope.
7. **Limits:** the bounds in [Data and migrations](#data-and-migrations) and
   the import limits in [Security and privacy](#security-and-privacy);
   over-limit imports are truncated with a review notice. The 4,000-character
   notes bound was proposed after the owner chose notes and is listed for
   confirmation in the design pull request.

## Decision and change log

| Date       | Change                                                                                                                                                                              | Reason                                                                            | Evidence                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-09-22 | Initial design proposal; status `Designing`                                                                                                                                         | Start Phase 3 with reviewable scope and explicit open gates                       | [Issue #31](https://github.com/wpliao/meal-planner/issues/31)                             |
| 2026-09-22 | Product owner endorsed the proposed direction; retain `Designing` while prerequisites are resolved                                                                                  | Household lifecycle and import-destination policy still need concrete acceptance  | [Review record](https://github.com/wpliao/meal-planner/issues/31#issuecomment-5774034983) |
| 2026-09-22 | Resolve open decisions: six-host allowlist, manual redirects (≤3, revalidated), JSON-LD `Recipe` only, unstructured ingredient lines, household cascade, optional notes, and bounds | Product-owner answers in the design session; #32 deletion design already accepted | Design decisions pull request                                                             |

## Release record

- Local verification: Baseline `./scripts/verify.sh` passed in the Dev Container
  on 2026-09-22: formatting, lint, typecheck, 60 client tests, 76 Worker tests,
  build, and 92 browser tests. The first run stopped at a 5-second timeout in
  `src/client/main.test.tsx`; the isolated test and complete second run passed.
  This baseline verifies existing behavior, not the proposed recipe feature.
- Development validation: Pending
- Production release: Pending
- Known follow-up work: [Household deletion and ownership transfer
  #32](https://github.com/wpliao/meal-planner/issues/32) is a prerequisite; no
  recipe implementation or migration exists yet.
