# Feature: Put recipe search above suggestions when adding a meal

- Status: Proposed
- Phase: 5 follow-up
- Issue: https://github.com/wpliao/meal-planner/issues/117
- Product owner: wpliao
- Last updated: 2026-10-01
- Pull requests: none yet

## Problem and outcome

When a member adds a meal and stays on **Pick a recipe**, the [meal
suggestions](./0073-meal-suggestions.md) appear first, and the **Recipe**
search field sits below up to five suggestions. On a phone that group is about
330px tall, so a member who already knows what they want has to scroll down
to reach the search. Family members said so.

The low position also caused the #73 bug where the search's dropdown, opened at
the modal's bottom edge, was hidden or flickered. That was worked around by
scrolling the field to the middle of the modal on focus.

Outcome: the **Recipe** search field comes first and has focus, so a member can
type straight away. The suggestions follow below it, unchanged.

## User scenarios

1. Given a member who wants lasagne for Tuesday dinner, when they open **Add**,
   then the **Recipe** search field is directly under **What to add** and has
   focus. Typing "las" filters the list without any scrolling.
2. Given a member who wants an idea, when they open **Add**, then the
   suggestions are directly below the search field. Choosing one selects it in
   the search field, as today.
3. Given a member on **Type a meal**, nothing changes.

## Scope

- Included: the order of the search field and the suggestions in **Pick a
  recipe** mode; initial focus on the search field.
- Not included: changes to which recipes are suggested, their reasons, Not
  now, or favourites; changes to **Type a meal**; changes to the edit-entry
  dialog.

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: In **Pick a recipe** mode, the **Recipe** search field is the
      first field after **What to add**. The suggestion group follows directly
      below it, with the same heading, recipes, reasons, order, Not now, Undo,
      and loading and failure states as before.
- [ ] `AC-02`: When the dialog opens in **Pick a recipe** mode with recipes in
      the library, the **Recipe** search field has focus. When the library is
      empty or still loading, focus lands as it does today. Switching modes
      keeps today's focus behavior.
- [ ] `AC-03`: Choosing a suggestion still selects that recipe in the search
      field. Choosing a different recipe in the field still clears the
      suggestion choice. Keyboard and screen-reader order follows the new
      visual order.
- [ ] `AC-04`: On a phone viewport, the search dropdown opens below the field
      without being hidden or flickering. It covers the suggestions while
      open and closes as it does today.
- [ ] `AC-05`: Unit and browser tests cover the order, the focus, and choosing
      both a searched and a suggested recipe on desktop and phone viewports.

## Experience design

**Pick a recipe mode, top to bottom:**

1. **What to add**
2. **Recipe** (the search field, with the description "Type to search 42
   recipes.")
3. "Suggested for Tuesday dinner", with its options
4. **Note**
5. **Add to plan**

The suggestion group keeps its own spacing and heading, so it reads as a
separate choice, not as search results.

**Focus.** The search field gets `data-autofocus`, so the modal focuses it on
open. On a phone this raises the keyboard straight away, which suits a member
who opened the dialog to search. Mantine's searchable Select may open its
list on focus. If it does, the list covers the suggestions until the member
types, picks, presses Escape, or taps elsewhere. Implementation records which
happens. If an open list on arrival hides the suggestions on a phone, the
fallback is to focus without opening the list. That fallback is the only UI
choice left open.

**Dropdown position.** With the field near the top of the modal, the dropdown
has room below it. The #73 workaround (scroll the field to the middle on
focus) stays, because it is harmless and still helps in a short landscape
viewport.

## Technical design

### Boundaries and contracts

- **Client only:** `AddEntryDialog` in `src/client/MealPlanDialogs.tsx`
  renders `RecipePicker` before `MealSuggestions`, and `RecipePicker`'s
  `Select` gets `data-autofocus`.
- No Worker, shared-contract, or API change.

### Data and migrations

Not applicable: no data changes.

### Security and privacy

No change. The same requests are made with the same data.

### Accessibility

- DOM order matches visual order, so Tab reaches the search field, then each
  suggestion, then the note.
- Initial focus on a labelled field is announced with its label and
  description.
- The suggestion group keeps its `radiogroup` semantics and heading.

### Reliability and observability

No change.

## Test strategy

- **Client** (`src/client/MealPlan.test.tsx`):
  - the search field precedes the suggestion group in document order;
  - it has focus on open when recipes are loaded;
  - choosing a suggestion and then a searched recipe still works as before.
- **Browser** (`tests/e2e/meal-plan.spec.ts`), on desktop and phone projects:
  - the suggestion and keyboard specs follow the new order;
  - a new case types into the focused field straight after opening and plans
    the searched recipe.

## Traceability

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |
| `AC-05`   | Pending        | Pending         | Pending          |

## Rollout and rollback

One implementation pull request. It also updates the [#73
design](./0073-meal-suggestions.md): it marks `AC-01`'s "before the full list"
as changed by this feature and adds a decision log entry. V-DEV: the owner adds
a meal on a phone, by search and by suggestion. Rollback: redeploy the
previous Worker; there is no data.

## Decision and change log

| Date       | Change           | Reason                                                                                                                                                                         | Evidence                                                  |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 2026-10-01 | Initial proposal | Family feedback said searching meant scrolling past the suggestions. The owner chose to put the search field on top, with focus, and keep the suggestions below it, unchanged. | [#117](https://github.com/wpliao/meal-planner/issues/117) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None
