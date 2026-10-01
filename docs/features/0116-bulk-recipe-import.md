# Feature: Import several recipe links at once

- Status: Proposed
- Phase: 3 follow-up
- Issue: https://github.com/wpliao/meal-planner/issues/116
- Product owner: wpliao
- Last updated: 2026-10-01
- Pull requests: none yet

## Problem and outcome

Family members find recipes on the supported sites and want the app to "just
import them". Today the [recipe library](./0031-recipe-library.md) imports one
link at a time: paste, wait, review the copy, save. Importing ten recipes means
ten rounds of that.

Outcome: a member pastes up to 20 links, one per line, and presses one button.
The app imports them one after another and saves each without the review step.
Each link then shows whether it was saved, was already in the library, or
failed and why.

## User scenarios

1. Given a member with eight RecipeTin Eats and Budget Bytes links, when they
   paste them on **Import several links** and press **Import links**, then the
   links are imported one at a time with visible progress. Each saved recipe
   is listed with a link to it.
2. Given one of the links was imported last week, when the batch reaches it,
   then it is listed as "Already in the library", links to the existing
   recipe, and is not saved again.
3. Given a link from a site the app does not support, or text that is not a
   link, when the member presses **Import links**, then that line is listed as
   failed with the reason. No request is made for it, and the other links are
   still imported.
4. Given a page with no readable recipe, when the batch reaches it, then it is
   listed as failed with the same explanation the single import gives, and the
   batch continues.
5. Given a batch in progress, when the member presses **Stop**, then the link
   being imported finishes, and the rest are listed as "Not imported".

## Scope

- Included:
  - a new screen for up to 20 links, reached from the import screen;
  - sequential import through the existing import preview;
  - saving each preview's draft without review;
  - skipping links already in the library;
  - per-link results, stop, and retry of failed links.
- Not included:
  - background or overnight imports that continue after the page is closed;
  - links from sites outside the current import allowlist;
  - changes to the single-link import and its review step;
  - editing recipes inside the batch screen;
  - deduplicating recipes saved before this feature by anything other than
    their source link.

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: The import screen links to **Import several links**, which
      accepts up to 20 links, one per line. - Blank lines are ignored, and more than 20 links is refused before
      anything starts. - A line that is not a link from a supported site is listed as failed
      with the reason, and no request is made for it. - A link pasted twice (same link once its `#fragment` is removed) is
      imported once; the repeat is listed as "Listed twice".
- [ ] `AC-02`: **Import links** imports the remaining links one at a time, in
      the order pasted, through the same import preview as a single link.
      Each successful preview is saved without review. The saved recipe is
      exactly what saving the unedited preview on the single-import screen
      would store: title, ingredients, steps, servings, and source. A link
      whose text was shortened says so in its result.
- [ ] `AC-03`: Each link shows its state: - Waiting or Importing while the batch runs; - Saved, linking to the recipe; - Already in the library, linking to the existing recipe; - Failed, with the reason; - Not imported, after **Stop**.

      A summary such as "Saved 6, already in the library 1, failed 1" is
      announced at the end. **Stop** halts the batch after the link being
      imported. **Retry failed links** puts the failed links back in the box.

- [ ] `AC-04`: A link counts as already in the library when one of the
      household's website recipes has the same submitted or resolved address
      as the new import's submitted or resolved address. - The Worker makes this check in the same statement that saves, so two
      tabs importing the same link save it once. - It applies only when the request asks for it, so the single-link
      import still lets a member save a second copy.
- [ ] `AC-05`: When the library reaches its 500-recipe limit, the batch stops.
      The link that hit the limit is listed as failed with the existing
      limit message, and the rest are listed as "Not imported".
- [ ] `AC-06`: Deterministic unit, Workers-runtime, and browser tests cover
      these criteria without network access.

## Experience design

- **Entry:** the import screen (`/recipes/import`) gains a link "Import
  several links" below its address field. It opens `/recipes/import/several`,
  titled **Import several links**. A back link returns to the import screen.
- **Before starting:**
  - A **Recipe links** textarea, labelled and described "One link per line, up
    to 20. Each recipe is saved without a review step; you can edit it later."
  - The supported sites are listed exactly as on the import screen.
  - **Import links** is the primary button. Pressing it with no links shows
    "Paste at least one recipe link." beside the field.
  - Pressing it with more than 20 links shows "Paste up to 20 links at a time.
    You pasted 23." beside the field. Nothing is cleared in either case.
- **While running:**
  - The textarea becomes read-only, and a results list appears below it with
    one row per pasted line, in order.
  - Each row shows the link's host and path, shortened to one line on a
    phone, and its state.
  - The current row says "Importing…". A polite live region announces
    "Importing 3 of 8".
  - **Import links** is replaced by **Stop**. A note says "Keep this page open
    until the import finishes."
  - Leaving the page while running asks the browser's leave-page
    confirmation.
- **Row states:**
  - Saved: "Saved", with the recipe title as a link. When the text was
    shortened, it adds "Some text was shortened to fit."
  - Already in the library: "Already in the library", with the existing
    recipe's title as a link.
  - Failed: "Failed:" and the reason. For an import failure, that is the
    single import's message for its failure class. Otherwise it is "not a
    link from a supported site", "this link is not a web address", the
    library-limit message, or "the app could not be reached".
  - Listed twice: "Listed twice", for the second and later copies.
  - Not imported: after **Stop** or the library limit.
- **After running:**
  - The summary is announced and shown above the list.
  - The textarea becomes editable again and is cleared.
  - **Retry failed links** fills it with the failed links that can be retried
    (import failures and connection failures), one per line. It is offered only
    when there are some.
- **Phone and desktop:** the existing single-column layout. Rows wrap, and
  every control is at least 44px high.

## Technical design

### Boundaries and contracts

- **Client:** a new `RecipeImportSeveral` screen in `src/client`. It runs the
  batch as a loop over the pasted links:
  1. Check the link with the shared `parseRecipeSourceUrl`.
  2. `POST /api/recipes/import-preview` (unchanged).
  3. `POST /api/recipes` with the preview's draft, its source, and the new
     `onlyIfNewSource: true`.

  The loop awaits each step, so only one link is in flight. **Stop** sets a
  flag that the loop checks between links.

- **Shared contract (`src/shared/recipes.ts`):**
  - `CreateRecipeRequest` gains optional `onlyIfNewSource: true`. It is
    accepted only with a website source; with a manual recipe it is a 400
    field error.
  - A new error code `duplicate_source` (HTTP 409) carries
    `existing: { id, title }`.
  - `RECIPE_BULK_IMPORT_MAX_LINKS = 20` and a pure
    `planBulkImport(text)` split, trim, check, and deduplicate the pasted lines
    into the rows the screen shows. The client and its unit tests share them.
- **Worker:** `createRecipe` keeps its race-safe guarded `INSERT … SELECT`.
  With `onlyIfNewSource`, its `WHERE` also requires `NOT EXISTS` a recipe
  that meets all of these:
  - it is in the same household;
  - its `source_submitted_url` or `source_resolved_url` equals the new
    submitted URL, or the new resolved URL when there is one.

  When nothing is inserted, the Worker tells apart the limit, a duplicate,
  and a lost race with one follow-up read, and returns `duplicate_source` with
  the existing recipe's ID and title. No new route and no new outbound fetch
  are added.

### Data and migrations

Not applicable: no schema change. The duplicate check reads existing source
columns. A household has at most 500 recipes, and the existing
`recipes_household_updated_idx` narrows the scan to the household.

### Security and privacy

- Every link goes through the existing allowlist, redirect, size, and timeout
  rules of the import preview. The batch adds no outbound capability, only
  repetition: at most 20 previews, one at a time, per press of a button by an
  authenticated family member.
- The duplicate check is scoped to the member's household and reveals only
  that household's own recipe ID and title.
- Pasted links and results are not logged, and nothing about the batch is
  stored except the recipes it saves.

### Accessibility

- The textarea has a visible label, a description, and errors tied to it.
- The results are an ordered list. Each row's state is text, not colour alone.
- Progress and the final summary use a polite live region.
- **Stop** and **Retry failed links** are ordinary buttons, and focus moves to
  the summary when the batch ends.

### Reliability and observability

- A failure on one link never stops the batch, except the library limit.
- A connection failure marks that link failed and moves on.
- Closing the page stops the loop. Recipes already saved stay saved, and
  re-pasting the same links skips them as already in the library.
- The worst case is about 20 × 10 seconds, the preview timeout. Each preview
  is an ordinary request, so no Worker request runs long.

## Test strategy

- **Unit** (`src/shared/recipes.test.ts`): `planBulkImport` covers blank
  lines, the 20-link limit, unsupported and malformed lines, and repeats after
  the fragment is removed. The create validator accepts `onlyIfNewSource`
  only with a website source.
- **Client** (`src/client/RecipeImportSeveral.test.tsx`), with a mocked API:
  - sequential order and every row state;
  - shortening notes;
  - Stop;
  - the library limit stopping the batch;
  - Retry failed links;
  - the summary announcement.
- **Workers runtime** (`test/worker/recipes.test.ts`):
  - `onlyIfNewSource` refuses a recipe whose submitted or resolved address
    matches, with `duplicate_source` and the existing ID and title;
  - it saves when none matches;
  - it ignores other households' recipes;
  - two concurrent duplicates save once;
  - without the flag, a second copy still saves.
- **Browser** (`tests/e2e/recipes.spec.ts`), against the E2E stub sites the
  single-import tests use: paste three links (one new, one already imported,
  one unsupported), import, and check the three results and that the new
  recipe opens.

## Traceability

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |
| `AC-05`   | Pending        | Pending         | Pending          |
| `AC-06`   | Pending        | Pending         | Pending          |

## Rollout and rollback

One implementation pull request. No migration and no configuration.
Development validation (V-DEV): the owner imports a handful of real links,
including one already in the library. Production follows with the
protected-environment approval. Rollback: redeploy the previous Worker. The
older Worker rejects `onlyIfNewSource` as an unknown field, and the older
client never sends it.

## Decision and change log

| Date       | Change           | Reason                                                                                                                                                                                                           | Evidence                                                  |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2026-10-01 | Initial proposal | Family feedback asked the app to import recipes by itself. The owner chose: up to 20 links, imported one at a time in the browser with progress, saved without review, and links already in the library skipped. | [#116](https://github.com/wpliao/meal-planner/issues/116) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None
