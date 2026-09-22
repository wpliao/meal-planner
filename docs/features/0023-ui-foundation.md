# Feature: UI foundation

- Status: Accepted
- Phase: Foundation — between Phase 2 and Phase 3
- Issue: [#23](https://github.com/wpliao/meal-planner/issues/23)
- Product owner: Repository owner
- Last updated: 2026-09-21
- Pull requests: design proposal pending

## Problem and outcome

Three user-interface defects reached the product owner during Phase 2 while the
entire automated suite was green: a destructive action that rendered as a blank
box, a rename field that collapsed to roughly 40px, and status controls that
rendered several times their size on iOS Safari and overlapped their own labels.

All three were styling faults, and none were findable by the tests, because
Testing Library and Playwright both locate elements by accessible name — which
colour, size and overlap do not affect. Hand review of screenshots was the only
detector. That does not scale.

The outcome is a foundation where correct rendering is the default rather than
something each feature re-earns, and where a later phase adds a route instead of
another block in one growing component.

**This ships no new family-visible capability.** When it is finished the family
does exactly what it does today. It is scoped that way on purpose, so the cost
is planned in the open rather than absorbed invisibly into Phase 3.

## User scenarios

1. Given a family member on Android or iOS, when they use the pantry and family
   settings, then everything works exactly as before with nothing lost.
2. Given a family member sent a link to a section, when they open it, then that
   section loads and the back button returns them where they expect.
3. Given a contributor adding a section in a later phase, when they build it,
   then they add a route and compose existing components rather than redesigning
   the shell or hand-building controls.
4. Given an unintended rendering change, when the suite runs, then it fails in
   CI instead of reaching the family.

## Scope

- Included: the component layer from [ADR 0006](../DECISIONS/0006-component-library.md);
  written design tokens and usage rules; the routing and application layout from
  [ADR 0007](../DECISIONS/0007-navigation-and-information-architecture.md); the
  Worker shell fallback that routing requires; visual regression coverage;
  migration of the existing Phase 1 member interface and Phase 2 pantry onto all
  of it.
- Not included: recipes, meal plans, nutrition, photos, imports, AI, or any new
  family capability. No change to the identity and household boundary, the
  pantry data model, or migration `0002`. No visual redesign beyond what
  adopting the component layer and tokens necessarily implies.

## Acceptance criteria

Identifiers match [issue #23](https://github.com/wpliao/meal-planner/issues/23)
and stay stable after acceptance.

- [x] `AC-01`: An accepted decision record selects the component approach,
      records the alternatives and the evidence, and states the measured bundle
      cost.
- [x] `AC-02`: An accepted decision record selects navigation and information
      architecture, including URL shareability and how the Worker serves
      application paths outside `/api/*`.
- [x] `AC-03`: Design tokens and usage rules are written down and the interface
      is built from them.
- [x] `AC-04`: Family-visible behaviour is unchanged; every Phase 1 and Phase 2
      acceptance criterion still holds and its tests still pass.
- [x] `AC-05`: Visual regression coverage exists at desktop and phone widths on
      Chromium and WebKit, and demonstrably catches the three Phase 2 defect
      classes.
- [x] `AC-06`: Accessibility is preserved or improved — native semantics,
      keyboard operation, visible focus, focus-trapped dialogs, WCAG AA contrast.
- [x] `AC-07`: The measured production bundle change is recorded and justified.
- [ ] `AC-08`: Development and production release evidence is recorded before
      completion.

## Experience design

Sections become routes behind persistent navigation: the family space, and the
pantry. Owners additionally reach member management. The landing-page shell is
replaced by an application layout, so a panel is no longer confined to the
320px column that collapsed the rename field.

The existing states are preserved rather than redesigned: loading, setup,
ready, not-a-member and unavailable for the session; and loading, empty,
validation, conflict, success and failure for the pantry. Their wording stays as
the owner accepted it, including "Status" for the pantry's three-choice control.

On a phone, navigation must not consume a large share of the screen, and the
back gesture must move between sections rather than leave the application.

## Technical design

### Boundaries and contracts

`src/client` gains a layout plus per-route components; `App.tsx` stops being the
single container for every feature. `src/shared` and `src/worker` keep their
contracts; no API changes.

The Worker keeps owning `/api/*` unchanged — identity, membership, same-origin
mutation checks, content types and error codes are all untouched. It gains one
branch: a request outside `/api/*` that matches no static asset returns the
application shell rather than a JSON `404`. Unmatched **API** paths still return
`404` JSON.

### Data and migrations

None. No schema change, no migration, no new binding.

### Security and privacy

The shell is public in the same sense `index.html` already is: it carries no
household data, and every value still comes from an authorised API call. The
fallback must not become a way to reach data without the membership check, which
is why the `/api/*` branch is left exactly as it is and is covered by tests that
assert an unknown API path still returns `404` JSON.

A component library becomes a runtime dependency in a family application behind
Cloudflare Access. Its licence, maintenance and supply-chain posture are
recorded in ADR 0006, and upgrades pass the full gate like any dependency.
`public/_headers` continues to apply to the shell and to built assets.

### Accessibility

Native semantics over recreated ARIA where the library allows it. Keyboard
operation, visible focus, focus-trapped dialogs and WCAG AA contrast are
preserved or improved, and the shared dialog helper in `src/client/dialog.ts`
is either kept or replaced by the library's equivalent — not dropped.

### Reliability and observability

No runtime behaviour change. Bundle size is measured before and after and
recorded, because it affects every page load on a family phone.

## Test strategy

- Existing client, Worker-runtime and browser suites must keep passing; they are
  the guarantee that `AC-04` holds. Tests may be updated where they assert
  structure that legitimately changed, never weakened to accommodate a
  regression.
- Worker tests for the shell fallback: `/api/*` still returns JSON errors, an
  unknown API path is still `404`, an unknown application path returns the shell
  and no household data.
- Visual regression snapshots at desktop and phone widths on Chromium and
  WebKit. Their value must be demonstrated, not assumed: the suite has to fail
  when the three Phase 2 defects are reintroduced. Snapshot churn and update
  policy are part of this design's implementation.
- Routing coverage: deep link loads the right section, back moves between
  sections, an unknown path behaves as designed.

## Resolved design decisions

The product owner resolved these on 2026-09-21 in the
[approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016). They are settled for this work;
reopening any of them requires a change recorded in the decision log below.

- **Visual language**: adopting Mantine's component look is acceptable. The
  initial theme **approximates the current warm palette**, so the application
  does not visually lurch during the migration. Deliberate theme design is a
  later, separate change, taken before visual-regression baselines settle, since
  a theme change afterwards churns every snapshot.
- **Navigation**: **real URLs**, using React Router v7 in library mode, with the
  Worker serving the application shell for paths outside `/api/*`. Chosen
  primarily because the manifest sets `display: standalone`, so on a home-screen
  install the system back gesture is the only back affordance there is; with tabs
  it exits the application instead of returning to the previous section. Linkable
  sections and surviving a refresh follow from the same decision.
- **Scope**: approved explicitly as foundation work that ships **no new
  family-visible capability**.

## Traceability

| Criterion | Planned implementation                                                   | Planned evidence                        | Release evidence |
| --------- | ------------------------------------------------------------------------ | --------------------------------------- | ---------------- |
| `AC-01`   | [ADR 0006](../DECISIONS/0006-component-library.md)                       | Measured bundle comparison              | `V-LOCAL-U4`     |
| `AC-02`   | [ADR 0007](../DECISIONS/0007-navigation-and-information-architecture.md) | Routing and Worker fallback tests       | `V-LOCAL-U3`     |
| `AC-03`   | [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) and `src/client/theme.ts`        | Interface built from tokens             | `V-LOCAL-U4`     |
| `AC-04`   | Migrated Phase 1 and Phase 2 interfaces                                  | Existing suites still passing           | `V-LOCAL-U4`     |
| `AC-05`   | Visual regression project                                                | Fails on the three reintroduced defects | `V-LOCAL-U1`     |
| `AC-06`   | Component layer on Mantine `Modal` and `Alert`                           | Accessibility and keyboard tests        | `V-LOCAL-U4`     |
| `AC-07`   | Build output                                                             | Before and after measurement            | `V-LOCAL-U4`     |
| `AC-08`   | Deployment workflow                                                      | Development and production records      | `V-DEV-U1`       |

## Rollout and rollback

1. Accept this design and both decision records in
   [issue #23](https://github.com/wpliao/meal-planner/issues/23). No
   implementation begins while the status is `Designing`.
2. Implement in reviewable steps, each passing the full gate. The order was
   revised on 2026-09-22 to **visual regression first**, then routing and the
   Worker fallback, then the component layer and tokens; the decision log
   records why.
3. Validate in development against real Cloudflare Access identities, confirming
   Phase 1 and Phase 2 journeys still work on Android and iOS.
4. Production release after separate explicit approval, recorded in the issue
   before dispatch.

There is no migration to reverse. Rollback is redeploying the previous version.

## Decision and change log

| Date       | Change                                                                                                                       | Reason                                                                                                                                                                                                                                                                                                  | Evidence                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-09-21 | Proposed the UI foundation as one piece of work covering component layer, tokens and page structure                          | The three parts touch the same files; doing them separately would migrate the interface two or three times                                                                                                                                                                                              | [Issue #23](https://github.com/wpliao/meal-planner/issues/23)                               |
| 2026-09-21 | Measured the bundle cost of both component options rather than relying on published figures                                  | Public numbers were contradictory, and the prior assumption that the copied-in option was smaller proved wrong for this component set in this bundler                                                                                                                                                   | ADR 0006                                                                                    |
| 2026-09-21 | Product owner accepted the design and both decision records, and authorised implementation                                   | The component choice, the navigation model and the foundation-only scope match the intended work                                                                                                                                                                                                        | [Approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016) |
| 2026-09-21 | The initial Mantine theme approximates the current palette rather than adopting Mantine defaults                             | Avoids a visible lurch during migration, and keeps deliberate theme design out of the same change while still preceding visual-regression baselines                                                                                                                                                     | Owner decision                                                                              |
| 2026-09-22 | Implementation reordered: visual regression first, then routing and the Worker fallback, then the component layer and tokens | `AC-05` requires the suite to demonstrably catch the three Phase 2 defects, and those defects only exist in the current hand-rolled CSS — after migrating, the proof cannot be constructed. It also gives the two riskier migrations a safety net. Cost: baselines churn twice, each as a reviewed diff | Deviation from step 2 of the accepted rollout                                               |
| 2026-09-22 | Visual regression pairs pixel snapshots with a computed-contrast assertion, and adds a tightly scoped action-row snapshot    | Proving the suite against the real defects showed pixel diffing alone **missed** the unreadable destructive action: the affected text was too small a share of the panel to clear the ratio tolerance that absorbs font antialiasing                                                                    | `V-LOCAL-U1`                                                                                |
| 2026-09-22 | End-to-end specs moved to their own `tsconfig.e2e.json` with the DOM library                                                 | Playwright specs legitimately contain browser-context code inside `page.evaluate`; the node project deliberately has no DOM types and should keep it that way                                                                                                                                           | `V-LOCAL-U1`                                                                                |

### Findings during the component migration

| Date       | Finding                                                                                                                                                                                                                              | Resolution                                                                                                                                                                                                                 | Evidence     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-09-22 | The Content Security Policy blocked every inline style attribute, leaving all buttons as bare text in the built app                                                                                                                  | Owner approved adding `style-src 'self' 'unsafe-inline'`; no nonce or hash can cover a runtime-computed style attribute. Recorded in ADR 0006 and `docs/SECURITY.md`, and asserted by `tests/e2e/security-headers.spec.ts` | `V-LOCAL-U4` |
| 2026-09-22 | Alphabetical per-component stylesheet imports put `UnstyledButton.css` after `Button.css`, silently unstyling every button                                                                                                           | Imports reordered to Mantine's own order, and `src/client/mantine.test.ts` added to enforce it. The guard was verified by reintroducing the fault                                                                          | `V-LOCAL-U4` |
| 2026-09-22 | Mantine's default `dimmed` text measures 3.11:1 on this ground, below WCAG AA                                                                                                                                                        | Overridden in `theme.ts` at 5.4:1 or better. Caught by the computed-contrast assertion, not by eye or by pixel diffing                                                                                                     | `V-LOCAL-U4` |
| 2026-09-22 | The shell smoke test asserted a heading that only exists before a session resolves, so it raced the redirect to `/pantry` — green on WebKit, red on Chromium                                                                         | Rewritten to assert the banner, the brand and a level-1 heading, which hold in every session state. The states it used to stand in for are covered properly by `family-boundary.spec.ts`                                   | `V-LOCAL-U4` |
| 2026-09-22 | Two per-component stylesheets were never imported: `InlineInput.css` (radio labels below the control, selection dot off-centre) and `Title.css` (every heading fell back to the browser default, so the theme's serif never applied) | Both imported in Mantine's order, and the leftover global radio size rule removed. `tests/e2e/visual.spec.ts` now asserts every Mantine class in the DOM has a rule behind it — the check found `Title.css` immediately    | `V-LOCAL-U5` |
| 2026-09-22 | Visual baselines were regenerated against the broken rendering and passed                                                                                                                                                            | Baselines regenerated only after the rendering was inspected directly. `docs/DESIGN_SYSTEM.md` records the rule: look at the screen before approving a snapshot                                                            | `V-LOCAL-U4` |

## Release record

- Design approval: Accepted on 2026-09-21 ([approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016))
- Local verification: `V-LOCAL-U1` (2026-09-22) — visual regression added and
  proven. Each of the three Phase 2 defects was reintroduced in turn and the
  suite failed on each; with the tree clean it passes. The first attempt showed
  pixel diffing alone missing the contrast defect, which is why a computed
  contrast assertion and a scoped action-row snapshot were added.
- Local verification: `V-LOCAL-U4` (2026-09-22) — component layer and tokens.
  Full gate green in the Dev Container: 60 client tests, the Worker suite, and
  84 browser tests across Chromium and WebKit at desktop and phone widths.
  Bundle measured at 144.0 KB JS and 12.1 KB CSS gzipped, against 84.4 KB and
  2.6 KB before, and recorded in ADR 0006.
- Local verification: `V-LOCAL-U5` (2026-09-22) — missing stylesheets. Full
  gate green with 92 browser tests, including the new missing-stylesheet guard
  on both sections.
- Development validation: `V-DEV-U1` complete on 2026-09-22. `523bdc5`
  deployed to development through the protected workflow and validated by the
  owner on both Android and iOS against real Cloudflare Access identities; the
  Phase 1 and Phase 2 journeys still work. There are no migrations in this
  feature, so nothing was applied to the development database.

  The gate did not catch what this round did. The first development deployment
  surfaced a selected radio whose dot sat off-centre, and chasing it found two
  per-component stylesheets that had never been imported — `InlineInput.css`
  and `Title.css`. The second meant every heading in the application had been
  falling back to the browser default since the migration landed, so the serif
  heading family in `theme.ts` had never once applied. Fixed in
  [#29](https://github.com/wpliao/meal-planner/pull/29), re-validated, and now
  covered by a test that asserts every Mantine class in the DOM has a rule
  behind it.

- Production release: Approved on 2026-09-22
  ([approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5772717202)).
  Dispatch pending.
- Known follow-up work: Household deletion and ownership transfer remain
  outstanding from Phase 1 and must be designed before further product data.
