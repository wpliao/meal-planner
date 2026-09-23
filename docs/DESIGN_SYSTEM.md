# Design system

The family interface is built from Mantine components and a single set of
tokens defined in [`src/client/theme.ts`](../src/client/theme.ts). This page is
the usage contract: what the tokens mean, and the rules for building a screen
from them.

Related: [ADR 0006](DECISIONS/0006-component-library.md) selects Mantine and
records what implementing it cost; [ADR 0007](DECISIONS/0007-navigation-and-information-architecture.md)
covers navigation.

## Why tokens at all

Phase 2 shipped a destructive action the family could not read: a local rule
set `background: transparent` on buttons inside the item row, and it outranked
the shared danger style. Nothing was wrong with either rule on its own. The
fault was that two places decided the same thing.

A token is the one place a decision lives. The rules below exist to keep it
that way.

## Colour

| Token    | Meaning                                                 |
| -------- | ------------------------------------------------------- |
| `sage`   | Primary actions, the current section, and confirmation. |
| `clay`   | Destructive actions and section eyebrows.               |
| `paper`  | Warm neutrals: borders, surfaces, muted fills.          |
| `white`  | `#fffdf9` — card and control surfaces, not pure white.  |
| `black`  | `#2b2924` — body text.                                  |
| `dimmed` | `#6f6454` — secondary text. Overridden; see below.      |
| `error`  | `clay.8` — field error text. Overridden; see below.     |

`primaryColor` is `sage` at `primaryShade: 9`, so a `Button` with no `color`
prop is the primary action.

**`dimmed` is deliberately not Mantine's default.** Mantine's value measures
3.11:1 against this ground, below the 4.5:1 WCAG AA minimum for body text. The
override lives in `cssVariablesResolver` in `theme.ts` and has to be set in
both the scheme-independent and the `light` blocks, because Mantine writes its
own value under a colour-scheme selector that outranks the general one.

**`error` is overridden for the same reason.** Mantine's light-scheme value is
`red-6` (`#fa5252`), about 3.3:1 on a card, so a field's own error message was
the least readable text on the screen. It is `clay.8`, the palette's warning
colour, at about 7:1. Both overrides live in the same `OVERRIDES` object in
`theme.ts`.

## Type

Headings are a serif stack (`Iowan Old Style`, falling back through Palatino to
Georgia); body text is `Inter` falling back to the system stack. `h1` scales
with the viewport via `clamp`; `h2` is fixed. Use `Title` with an `order`, not
a styled `Text` — the heading level is information, not appearance.

## Space, radius, size

Spacing and radius come from Mantine's scales (`xs` … `xl`) through props such
as `mt`, `gap` and `radius`. `defaultRadius` is `md`.

Interactive controls default to `size="md"`, and `--mp-touch-target`
(`2.75rem`) is a floor applied in [`styles.css`](../src/client/styles.css) to
every `button`, every text, email, or URL input, and every element carrying
Mantine's button class. Mantine's `md` sizes land just under 44px, and Phase 2
QA found controls that were comfortable with a mouse and too small on a phone.

The button class is in that list because a `Button` given `component={Link}`
renders an `<a>`, which an element-only rule misses; two such buttons measured
42px before #31's import screen added a phone test that caught it. A new
control that is a button by role belongs in the floor, whatever element it
ends up as.

## Ordered lists the member edits

Recipe ingredients and steps are ordered lines the member can add, remove and
reorder. `RecipeEditor.tsx`'s `LineList` is the pattern; reuse it rather than
inventing a second one.

- **Reorder with Move up and Move down buttons**, not drag and drop. Dragging
  has no keyboard or screen-reader equivalent, and these are real buttons with
  names such as "Move ingredient 2 up".
- **Focus follows the line that moved**, onto the same control unless that
  control is the one that just became unavailable at the top or bottom; then
  the opposite one takes it. Removing a line focuses its neighbour. Adding one
  focuses the new field. Without this the member is thrown back to the top of
  the document on every press.
- **A control that cannot act is hidden, not greyed out** — `visibility:
hidden` keeps its space so the remaining controls stay in their columns, and
  it leaves both the tab order and the accessibility tree. A greyed glyph is
  also low-contrast text the visual suite would have to be told to ignore.
- **Each change is announced** in a visually hidden `aria-live="polite"`
  region: "Moved ingredient to position 2 of 5."
- **The label spans the row and the controls wrap under the field** when there
  is no room for both. That is intrinsic flex wrapping (`flex: 1 1 14rem`),
  not a media query, so it follows the container as rule 5 requires.

## Results that outlive a route change

A result raised as the member leaves a screen — saved, deleted, discarded —
is handed to the next screen through `setRecipeFlash` in `recipe-client.ts`
rather than through router state, which the browser would replay when the
member navigates back. The receiving screen shows it in its own `Alert`
(`RecipeNotice`), which takes focus exactly once.

## Rules for building a screen

1. **Take colour, spacing and radius from the theme.** Use the props
   (`c="dimmed"`, `mt="md"`, `radius="lg"`), not literal values. A hard-coded
   colour is how the invisible button happened.
2. **Prefer a component prop to a stylesheet.** If a rule is needed, it belongs
   on the component, then in a component-scoped stylesheet, and only then in
   the global sheet. `styles.css` is for rules that apply to every screen at
   once and have no component-level equivalent.
3. **Add the component's stylesheet to
   [`mantine.ts`](../src/client/mantine.ts), in Mantine's order.** A missing
   import renders an unstyled control and a misordered one silently overrides a
   styled component. Both are checked: `mantine.test.ts` enforces the order,
   and the visual suite asserts that every Mantine class on screen has a rule
   behind it. Remember that a component can pull in another component's
   stylesheet — a `Radio` needs `InlineInput.css`, a `Title` needs its own —
   so add what the rendered page needs, not only what you imported in JSX.
4. **Do not restyle a Mantine control from the global sheet.** Sizing a
   control there fights the component's own variables: a leftover
   `input[type='radio'] { width: 1.25rem }` shrank the box while the dot stayed
   positioned for the theme's 24px size, so the selection sat off-centre. Set
   the size through the theme instead.
5. **Query by container, not by viewport.** A panel's width is not the screen's
   width. Phase 2's collapsed rename field was a media query standing in for a
   container query. See [`members-table.css`](../src/client/members-table.css).
6. **Keep native semantics.** Mantine wraps real elements; keep it that way.
   Where a Mantine component's props cannot express a semantic the screen
   needs, use `renderRoot` to put the attribute on the real element rather than
   wrapping it in another one — `Button.Group` gets its `role="group"` and
   accessible name this way.
7. **Use `Alert` with `role="status"` for results, and Mantine's `Modal` for
   confirmations.** The layout owns one result region so a message survives its
   section unmounting; `Modal` owns focus trapping and return.
8. **Look at the screen before regenerating a baseline.** Snapshot approval
   records whatever is rendered, including a regression.

## Changing a token

Change it in `theme.ts`, run `pnpm test:e2e --update-snapshots=all`, and read
the resulting image diff as part of the change. The contrast assertion in
`tests/e2e/visual.spec.ts` computes the real rendered contrast of every text
node against its own background, so a token change that breaks readability
fails the suite rather than the family.
