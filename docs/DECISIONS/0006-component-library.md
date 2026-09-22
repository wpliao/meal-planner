# ADR 0006: Component library for the family interface

- Status: Accepted
- Date: 2026-09-21
- Approval: [Issue #23](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016)
- Feature: [UI foundation](../features/0023-ui-foundation.md)

## Context

Every control in this application is hand-built from plain CSS. Phase 2 shipped
three styling defects to the product owner while the whole automated suite was
green:

| Defect                                                                               | Cause                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| The destructive action rendered as a blank box                                       | A later rule outranked `.button--danger` on specificity, leaving white text on a near-white card |
| The rename field collapsed to roughly 40px                                           | A four-column grid keyed on the viewport while the card sits in a ~320px column                  |
| Status controls rendered several times their size on iOS and overlapped their labels | An unconstrained form control in a flex row, sized differently by WebKit                         |

None were findable by the tests: Testing Library and Playwright both locate
elements by accessible name, which colour, size and overlap do not affect.

A component layer would likely have prevented the first and third — a maintained
library ships contrast-checked variants and is tested across engines. It would
**not** have prevented the second, which was a layout judgement rather than a
component defect. That class is addressed by visual regression coverage, decided
in the feature design rather than here.

Constraints that bear on the choice:

- `AGENTS.md` requires native semantics over recreated ARIA roles.
- The application has three runtime dependencies today and ships 71 KB of
  gzipped JavaScript. It runs on Cloudflare Workers behind Access, on family
  phones.
- The repository is maintained largely by coding agents, so the volume of code
  an agent must carry is a real cost.
- The existing interface is plain CSS with 39 classes; there is no Tailwind.

## Options considered

### Mantine (npm dependency)

Styled, accessible components installed and upgraded through pnpm. Native form
controls. First-class theming, so much of a design system becomes theme
configuration. Version 9 targets React 19 explicitly, including `useEffectEvent`
and `Activity`, and we are on React 19.3.

### Untitled UI React (components copied into the repository)

MIT-licensed open-source components copied in rather than installed, in the
shadcn style. Built on **React Aria v1.20 and Tailwind CSS v4.3**, requiring
React v19.2. A paid PRO tier exists for advanced components and templates; the
open-source set covers base components plus tables, tabs, modals, navigation and
pagination.

"No package dependencies to manage" applies only to the component source. React
Aria remains a runtime dependency and Tailwind a build dependency, and adopting
it means adopting Tailwind wholesale across a codebase that has none.

### Tailwind alone

Rejected as a standalone answer. It is a different layer: it changes how CSS is
authored but still leaves every component hand-built, which is the thing that
has been failing. Its output is build-time, so the `public/_headers` content
security policy is unaffected either way.

## Evidence

Bundle cost was the main quantitative claim separating the options, and the
public figures are contradictory — React Aria has documented tree-shaking
problems, with reports of 80 KB or more for a single button. So it was measured
directly, on this project's toolchain (Vite 8, React 19.3), building an
equivalent set of the components this application actually uses: button, text
input, radio group, modal, table, alert, badge and card.

| Build                               | JS (gzip) | CSS (gzip) | Added over baseline |
| ----------------------------------- | --------- | ---------- | ------------------- |
| Bare React 19 baseline              | 67.6 KB   | —          | —                   |
| Mantine, per-component CSS imports  | 104.8 KB  | 9.3 KB     | **+46.5 KB**        |
| Mantine, full core stylesheet       | 104.8 KB  | 33.6 KB    | +70.8 KB            |
| React Aria Components, **unstyled** | 133.8 KB  | —          | **+66.2 KB**        |

The React Aria figure is a floor, not a total: it buys behaviour only, and all
styling would be added on top. Untitled UI's real cost is therefore above
66.2 KB, while Mantine's measured cost with per-component CSS is 46.5 KB.

This contradicts the prior assumption that the copied-in option would be
smaller. It is not, for this component set in this bundler.

## Decision

Adopt **Mantine** as the component layer, importing per-component CSS rather
than the full core stylesheet.

Reasons, in the order they carried weight:

1. **Measured bundle cost is lower** — 46.5 KB against a floor of 66.2 KB.
2. **Native form controls** fit the `AGENTS.md` rule on semantics; React Aria
   reimplements controls with ARIA, which is legitimate but is the thing that
   rule steers away from.
3. **Maintenance falls on the dependency, not on us.** Copied-in components
   become our code to carry and patch, in a repository maintained by agents.
4. **No Tailwind migration.** Untitled UI requires adopting Tailwind across a
   codebase with none, which is a second large change bundled into the first.
5. **Theming is the design-token mechanism**, so tokens and components come
   from one place instead of two.

## Consequences

The application gains a runtime dependency and roughly 46.5 KB of gzipped
payload, which must be re-measured and recorded when implemented. Mantine's
visual language becomes the product's; the current warm palette must be carried
across through theming or deliberately replaced. The existing plain CSS is
retired in favour of the theme plus a small set of layout rules, and the Phase 1
member interface migrates too, so the product does not run two design systems.

Upgrades arrive through pnpm and must pass the full gate like any dependency.
Untitled UI's advantages — full design ownership, no runtime library — are real
and are given up deliberately; if the family interface later needs a visual
identity Mantine's theming cannot express, this decision should be revisited and
superseded rather than worked around.

This decision does not address the layout defect class. Visual regression
coverage does, and is required by the feature design regardless of this choice.

## Implementation findings

Recorded after the migration. The decision stands; three things were only
learnable by building it.

### Measured bundle cost

The estimate above was taken from a scratch build of an equivalent component
set. These are the real figures for this application, gzipped, measured on the
routing branch immediately before the migration and on the finished one.

| Build               | JS (gzip)    | CSS (gzip)  | Total        |
| ------------------- | ------------ | ----------- | ------------ |
| Before (no Mantine) | 84.4 KB      | 2.6 KB      | 87.0 KB      |
| After (Mantine)     | 144.0 KB     | 12.1 KB     | 156.2 KB     |
| **Added**           | **+59.7 KB** | **+9.5 KB** | **+69.2 KB** |

Exact gzipped bytes: 86,423 → 147,509 (JS) and 2,648 → 12,407 (CSS).

That is higher than the +46.5 KB the decision was taken on. The estimate
covered only the component set; the real application also pulls in Mantine's
provider, theming runtime, floating-ui (used by `Menu` and `Modal`) and the
hooks those depend on. The CSS figure is close to the 9.3 KB the estimate predicted.

The decision is unchanged: the comparison that mattered was against React Aria
Components' 66.2 KB floor for behaviour alone, and that floor moves with the
same runtime costs. The absolute number is worth restating plainly — this is a
private family application behind Cloudflare Access, served to a handful of
returning devices on a warm cache, so 69 KB of additional first-load payload is
a cost the project can carry. It would not be self-evidently acceptable for a
public, first-visit-sensitive site.

### The Content Security Policy had to change

Mantine sets inline `style` attributes on nearly every element it renders —
spacing, colour, layout, and every button's variant colours. `public/_headers`
set `default-src 'self'` with no `style-src`, which blocks all of them. The
symptom was not an error: the application rendered with its layout and
typography intact and **every button reduced to bare text**, with no
background, padding or border.

No narrower fix exists. A nonce covers `<style>` elements but has no effect on
style attributes, and `'unsafe-hashes'` cannot cover values computed per render.
The choice was `style-src 'self' 'unsafe-inline'` or abandoning the component
layer, and the owner chose to add the directive.

What this gives up is real but narrow: an attacker who can already inject
markup could use CSS to exfiltrate data through attribute selectors, or to
redress the interface. It does not weaken script execution — `default-src
'self'` still governs scripts — and `base-uri 'none'`, `object-src 'none'`,
`form-action 'self'` and `frame-ancestors 'none'` are unchanged. The
application renders no user-supplied HTML. `tests/e2e/security-headers.spec.ts`
asserts the exact policy, so any further loosening is a deliberate, reviewed
edit.

### Per-component stylesheets must be imported in Mantine's order

The per-component imports that make the CSS cost 12.1 KB instead of 33.6 KB are
not independent of each other. A `Button` is also an `UnstyledButton` and a
`Card` is also a `Paper`: the rules share a root element at equal specificity,
so the file imported last wins. Alphabetical order put `UnstyledButton.css`
after `Button.css` and silently stripped every button's styling.

Nothing caught it. All 58 tests passed, because they assert behaviour and
accessible names. The visual suite did not catch it either — its baselines had
been regenerated against the broken rendering, which is the failure mode that
makes snapshot approval dangerous. It was found by opening a screenshot.

`src/client/mantine.test.ts` now checks the import order against the
concatenated `@mantine/core/styles.css`, and was itself verified by
reintroducing the fault.

A **missing** import is the same failure with a different cause, and the order
check cannot see it. Two shipped before one was noticed by eye:

- `InlineInput.css`, which Mantine's radio and checkbox layout lives in. Its
  absence put every radio's label below the control instead of beside it, and
  combined with a leftover global `input[type='radio']` size rule it left the
  selected radio's dot visibly off-centre.
- `Title.css`. Every heading in the application fell back to the browser
  default, so the serif heading family configured in `theme.ts` never applied
  at all. Nothing looked broken — it looked like a different, plainer design.

`tests/e2e/visual.spec.ts` now asserts that every Mantine `m_…` class present
in the DOM has a matching rule in the loaded CSS. That is exactly the signature
of a stylesheet that was never imported, and it found `Title.css` immediately —
it had been missing since the migration landed.

### Mantine's default secondary text fails WCAG AA here

`--mantine-color-dimmed` measures 3.11:1 against this project's cream ground,
below the 4.5:1 minimum. The computed-contrast assertion in the visual suite
caught it; nothing looked wrong. `theme.ts` overrides the token. Adopting a
library's defaults does not transfer responsibility for meeting the bar.
