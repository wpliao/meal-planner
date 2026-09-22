# Feature: Recipe library

- Status: Designing
- Phase: 3 — recipes
- Issue: [#31](https://github.com/wpliao/meal-planner/issues/31)
- Product owner: Repository owner
- Last updated: 2026-09-22
- Pull requests: Pending design proposal

## Problem and outcome

The family needs a private place to keep recipes it can use and change. A recipe
may be entered by a member or copied from a website. An imported copy must be
reviewed before saving and must retain its original link and provenance, because
website extraction is imperfect and the family may want to revisit the source.

This is a **proposal**, not an accepted design. The [product roadmap](../PRODUCT.md)
defines the Phase 3 outcome but does not authorize implementation on its own.

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
      list, and ordered instructions; validation, empty, loading, success, and
      failure states work on phone and desktop.
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
It fetches and parses only after member authorization. A first proposal is to
read a page's structured `Recipe` data and return `unsupported_source` when it
is absent or incomplete; arbitrary HTML scraping and AI are outside this
phase. This extraction rule needs product-owner acceptance and a Worker-runtime
feasibility check before design acceptance.

### Data and migrations

The proposed forward migration is `0003_create_recipes.sql`; it is **not yet
created or applied**. A `recipes` row belongs to a household and carries an
opaque ID, title, version, creation/update times, and `manual` or `website`
source kind. A website copy also carries the submitted original URL, final
resolved URL if different, source site/title when available, and import time.
Ordered ingredient and step rows belong to the recipe and delete with it.
Titles need not be unique: two different sources can use the same title.

Ingredient text must remain usable even when the source page has no reliable
quantity or unit. The design must decide whether Phase 3 stores optional
structured quantity/unit fields alongside source text. Unparsed text must
never be treated as a nutrition-ready quantity. No remote HTML, script, or
import debug body is retained. Preserve the original source link, but do not
store unrelated request headers or cookies. Confirm exact field bounds and
household recipe limit before migration review.

Household deletion and ownership transfer remain an explicit Phase 1 follow-up
([feature #7](./0007-trusted-family-boundary.md)), now tracked in
[issue #32](https://github.com/wpliao/meal-planner/issues/32). The current
schema restricts household deletion while `app_installation` points to it, and
pantry rows cascade only after that pointer is handled. The proposed ordinary
transfer uses the existing owner APIs: promote an active successor, have the
successor verify owner access, then let the previous owner step down. The
last-active-owner guard remains in force. An unavailable previous owner needs a
separate recovery decision.

The proposed household deletion remains an explicitly approved operational
procedure until a self-service design is accepted. It must identify the one
household from a verified owner request, rehearse in development, handle the
installation pointer before deleting the household, verify that members,
pantry items, and recipe rows were removed, and account separately for Access
configuration and D1 Time Travel history. The exact authorization,
confirmation, backup, and recovery steps belong to #32 and must be accepted
before recipe implementation. No production deletion is authorized by this
proposal.

### Security and privacy

The recipe page may contain private family preferences. Reads and writes use
prepared statements scoped to the verified household. No family recipe,
identity, submitted URL, or fetched page content appears in application logs.
An import request discloses the requested URL to the source site, so the UI
states that a site will be contacted. No Access assertion, cookie,
authorization header, or family data is forwarded.

The Worker should accept only public `http`/`https` recipe pages, reject URL
credentials and local/private destinations, handle redirects manually and
revalidate each hop, cap redirect count, response bytes, content type, and
duration, and reject anything whose safety cannot be established. Cloudflare
[documents](https://developers.cloudflare.com/workers/runtime-apis/request/)
that automatic redirect following can forward headers to another host; the
proposal uses explicit redirect handling and no incoming credentials. Exact
destination-validation feasibility in the Workers runtime is an **open design
gate**, with unsafe cases tested against a fake fetch adapter. Never fetch an
import URL in the browser.

Only normalized plain text enters the preview or database. The client renders
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

No partial recipe is stored during preview. Timeouts, unsupported page format,
too-large pages, and blocked destinations have distinct user-safe messages.
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

1. Resolve the open design gates and record product-owner acceptance in the
   issue; set this document to `Accepted` on `main` before any feature code or
   migration is written.
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

## Open decisions before acceptance

1. Confirm the minimum recipe fields: title, ordered ingredients and steps,
   plus whether yield, prep time, notes, tags, or ingredient quantity/unit are
   useful now. The proposal keeps the first version small and treats uncertain
   imported ingredient quantities as unstructured text.
2. Confirm that structured recipe data only is an acceptable first import
   boundary, with unsupported pages falling back to manual entry. Establish a
   safe destination policy that the actual Worker runtime can enforce.
3. Resolve [issue #32](https://github.com/wpliao/meal-planner/issues/32) before
   adding recipe records, including who may request deletion and how D1 history
   and Access configuration are handled.

## Decision and change log

| Date       | Change                                      | Reason                                                      | Evidence                                                      |
| ---------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| 2026-09-22 | Initial design proposal; status `Designing` | Start Phase 3 with reviewable scope and explicit open gates | [Issue #31](https://github.com/wpliao/meal-planner/issues/31) |

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
