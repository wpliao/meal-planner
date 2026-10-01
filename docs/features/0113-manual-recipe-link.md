# Feature: Recipe link for manually entered recipes

- Status: Accepted
- Phase: 3 follow-up
- Issue: https://github.com/wpliao/meal-planner/issues/113
- Product owner: wpliao
- Last updated: 2026-10-01
- Pull requests: [#114](https://github.com/wpliao/meal-planner/pull/114) (design)

## Problem and outcome

The family often types a recipe in by hand while following a web page. That
happens for Kikkoman Singapore, whose pages cannot be imported (#111 was
withdrawn for manual entry), for sites outside the import list, and for recipes
adapted from a page. The recipe library ([#31](./0031-recipe-library.md)) stores
a page address only on imported recipes, and nothing in the editor can set it.
A hand-entered recipe therefore loses the page it came from.

Outcome: when a member creates or edits a manually entered recipe, they can add
one optional **recipe link**. The recipe's page shows where it points and opens
it in a new tab, the same way an imported recipe links to its original. The app
stores the address and never fetches it.

## User scenarios

1. Given a member typing in a Kikkoman Singapore recipe, when they paste the
   page address into **Recipe link** and save, then the recipe page says
   "Entered by hand" and offers "Open the original recipe on
   www.kikkoman.com.sg (opens in a new tab)".
2. Given an older manual recipe, when a member edits it to add a link or clears
   the field, then the change is saved with the usual concurrent-edit check.
3. Given a member who pastes text that is not an `https` address, when they
   save, then the field explains the problem and everything typed is kept.
4. Given a recipe imported from a website, when a member edits it, then no
   recipe link field appears; its import source stays read-only and unchanged.

## Scope

- Included: one optional link per manually entered recipe, set at create or
  edit and clearable; its host shown on the recipe page and in the library
  list; validation in the shared contract and at the Worker boundary; one
  additive migration.
- Not included: fetching, previewing, or checking the link; importing from it;
  more than one link; a link on imported recipes (they already have one);
  changes to the import allowlist.

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: Creating or editing a manually entered recipe offers an
      optional **Recipe link**. It accepts an absolute `https` URL from any
      host, with no username, password, or port, of at most 2,048 characters
      after the fragment is removed. Saving it empty stores no link, and an
      existing link can be cleared. An invalid value is explained beside the
      field and the draft is kept.
- [ ] `AC-02`: A manual recipe with a link shows "Entered by hand" and a link
      "Open the original recipe on <host> (opens in a new tab)" that opens in a
      new tab with `rel="noopener noreferrer"`. The library list labels it
      "Manual · <host>". A manual recipe without a link looks as it does today.
- [ ] `AC-03`: The Worker validates the link with the shared contract and never
      fetches it. A link sent for an imported recipe, at create with a website
      source or at edit of a website-sourced recipe, is rejected with a field
      error and changes nothing. Imported recipes' sources are unchanged.
- [ ] `AC-04`: A forward migration adds the link as a nullable column, leaves
      every existing recipe without a link, and the database rejects a link that
      is not `https://`, is longer than 2,048 characters, or is on a
      website-sourced row. The link follows the recipe's household scope,
      version check, and deletion like every other field.
- [ ] `AC-05`: Deterministic unit, Workers-runtime, migration, and browser tests
      cover these criteria without network access.

## Experience design

- **Editor** (`Add recipe`, `Edit recipe` for a manual recipe): a
  **Recipe link** text input (`type="url"`, `inputMode="url"`) directly below
  **Servings**, with the description "Optional. The web page this recipe comes
  from." It is not shown on the import-review screen or when editing an
  imported recipe, which already show their source.
- **Validation:** the client checks with the shared parser before sending and
  shows the message under the field, for example "The recipe link must be an
  https web address." The Worker's field error is shown the same way if it
  differs. The draft stays filled in either way.
- **Recipe page:** "Entered by hand", then the existing `SourceLink` component
  with the link's host. The link is rendered only if it still parses as
  `https`, as imported links are today.
- **Library list:** the source label becomes "Manual · <host>" for a linked
  manual recipe and stays "Manual" otherwise.
- Mobile and desktop use the existing editor layout; the field wraps like the
  others. No new loading or empty states.

## Technical design

### Boundaries and contracts

- `src/shared/recipes.ts`:
  - `Recipe` gains `link: string | null`; `RecipeSourceLabel`'s manual variant
    gains `linkHost: string | null` so the list can label it without the full
    address.
  - `ValidCreateRecipe` and `ValidUpdateRecipe` gain `link` (`string | null`,
    optional on update). `CREATE_FIELDS` and `UPDATE_FIELDS` accept `link`.
  - A new `parseRecipeLinkUrl` applies the same structural rules as
    `parseRecipeSourceUrl` (absolute, `https`, no credentials or port,
    fragment removed, at most `RECIPE_SOURCE_URL_MAX_LENGTH`) but no host
    allowlist. A blank string means no link. `validateCreateRecipe` rejects a
    non-null `link` with a website source.
- `src/worker`: create and update persist `link`. Update of a website-sourced
  recipe with a non-null `link` returns the usual 400 field error before any
  write. List and detail responses include the new fields.
- `src/client`: `RecipeEditor` adds the field and sends `link` for manual
  recipes only; `RecipeDetail` renders it; `sourceLabel` formats the list label;
  `safeSourceHref`'s `https` check is reused for the link.

### Data and migrations

`migrations/0007_add_recipe_link.sql`, additive only:

```sql
ALTER TABLE recipes ADD COLUMN link_url TEXT
  CHECK (link_url IS NULL OR (
    source_kind = 'manual'
    AND length(link_url) BETWEEN 9 AND 2048
    AND substr(link_url, 1, 8) = 'https://'));
```

Existing rows get `NULL`, so the CHECK holds for all of them. The link belongs to
the recipe's household and is deleted with the recipe or the household. Older
Worker code ignores the column, so the migration is safe to apply before the
new code. It is not retained beyond the recipe and is not personal data beyond
the family's choice of page.

### Security and privacy

- The link is stored and rendered, never fetched by the Worker, so it adds no
  outbound request and no SSRF surface. This is why any host is allowed while
  import keeps its allowlist.
- Only `https` addresses are accepted by the contract, the database, and the
  renderer, so a stored value can never become a `javascript:` or other active
  link. The host is shown so the member sees where the link goes, and it opens
  with `noopener noreferrer`.
- Members are the trusted family; household scope and Access identity apply as
  for every recipe field. Links are not logged.

### Accessibility

The field has a visible label and description tied to the input; errors use the
editor's existing `error` prop, so they are announced with the field. The
recipe-page link text names the host and says it opens in a new tab, as today.

### Reliability and observability

No new failure modes beyond validation. Saves remain one version-checked write.
A broken or moved page is the member's to fix by editing the link.

## Test strategy

- Unit (`src/shared/recipes.test.ts`): `parseRecipeLinkUrl` accepts any `https`
  host, trims, removes the fragment, treats blank as none, and rejects `http`,
  credentials, ports, malformed input, and over-length input;
  `validateCreateRecipe` rejects a link with a website source; update accepts
  `link` and `null`.
- Client (`src/client/RecipeEditor.test.tsx`, `RecipeDetail.test.tsx`,
  `Recipes.test.tsx`): the field appears only for manual recipes, its error
  keeps the draft, the detail page renders the host link, and the list label.
- Workers runtime (`test/worker/recipes.test.ts`): create, read, list, update,
  and clear a link; reject a link for an imported recipe without a write; no
  outbound fetch.
- Migration (`test/worker/migration.test.ts`): 0007 applies on top of 0006,
  leaves rows unchanged, and its CHECK rejects `http`, over-length, and
  website-row links.
- Browser (`tests/e2e/recipes.spec.ts`): add a manual recipe with a link, see
  the host link on its page and in the list, then clear it.

## Traceability

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |
| `AC-05`   | Pending        | Pending         | Pending          |

## Rollout and rollback

One implementation pull request with the migration. Deploy applies 0007 to
development, then the owner adds a linked manual recipe there (V-DEV). Production
follows with the protected-environment approval. Rollback: redeploy the previous
Worker; the nullable column is ignored by old code, so no down-migration is
needed. A later forward migration can drop it if the feature is retired.

## Decision and change log

| Date       | Change           | Reason                                                                                                                         | Evidence                                                  |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 2026-10-01 | Initial proposal | The owner enters some recipes by hand from web pages (Kikkoman Singapore after #111 was withdrawn) and wants to keep the page. | [#113](https://github.com/wpliao/meal-planner/issues/113) |
| 2026-10-01 | Accepted         | The owner approved the design by merging its pull request.                                                                     | [#114](https://github.com/wpliao/meal-planner/pull/114)   |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None
