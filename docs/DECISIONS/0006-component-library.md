# ADR 0006: Component library for the family interface

- Status: Proposed
- Date: 2026-09-21
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
