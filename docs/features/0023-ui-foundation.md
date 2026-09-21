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

- [ ] `AC-01`: An accepted decision record selects the component approach,
      records the alternatives and the evidence, and states the measured bundle
      cost.
- [ ] `AC-02`: An accepted decision record selects navigation and information
      architecture, including URL shareability and how the Worker serves
      application paths outside `/api/*`.
- [ ] `AC-03`: Design tokens and usage rules are written down and the interface
      is built from them.
- [ ] `AC-04`: Family-visible behaviour is unchanged; every Phase 1 and Phase 2
      acceptance criterion still holds and its tests still pass.
- [ ] `AC-05`: Visual regression coverage exists at desktop and phone widths on
      Chromium and WebKit, and demonstrably catches the three Phase 2 defect
      classes.
- [ ] `AC-06`: Accessibility is preserved or improved — native semantics,
      keyboard operation, visible focus, focus-trapped dialogs, WCAG AA contrast.
- [ ] `AC-07`: The measured production bundle change is recorded and justified.
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
| `AC-01`   | [ADR 0006](../DECISIONS/0006-component-library.md)                       | Measured bundle comparison              | Pending          |
| `AC-02`   | [ADR 0007](../DECISIONS/0007-navigation-and-information-architecture.md) | Routing and Worker fallback tests       | Pending          |
| `AC-03`   | Token definitions and usage rules                                        | Interface built from tokens             | Pending          |
| `AC-04`   | Migrated Phase 1 and Phase 2 interfaces                                  | Existing suites still passing           | Pending          |
| `AC-05`   | Visual regression project                                                | Fails on the three reintroduced defects | Pending          |
| `AC-06`   | Component layer and dialog helper                                        | Accessibility and keyboard tests        | Pending          |
| `AC-07`   | Build output                                                             | Before and after measurement            | Pending          |
| `AC-08`   | Deployment workflow                                                      | Development and production records      | Pending          |

## Rollout and rollback

1. Accept this design and both decision records in
   [issue #23](https://github.com/wpliao/meal-planner/issues/23). No
   implementation begins while the status is `Designing`.
2. Implement in reviewable steps — tokens and component layer, then routing and
   the Worker fallback, then visual regression — each passing the full gate.
3. Validate in development against real Cloudflare Access identities, confirming
   Phase 1 and Phase 2 journeys still work on Android and iOS.
4. Production release after separate explicit approval, recorded in the issue
   before dispatch.

There is no migration to reverse. Rollback is redeploying the previous version.

## Decision and change log

| Date       | Change                                                                                              | Reason                                                                                                                                                | Evidence                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-09-21 | Proposed the UI foundation as one piece of work covering component layer, tokens and page structure | The three parts touch the same files; doing them separately would migrate the interface two or three times                                            | [Issue #23](https://github.com/wpliao/meal-planner/issues/23)                               |
| 2026-09-21 | Measured the bundle cost of both component options rather than relying on published figures         | Public numbers were contradictory, and the prior assumption that the copied-in option was smaller proved wrong for this component set in this bundler | ADR 0006                                                                                    |
| 2026-09-21 | Product owner accepted the design and both decision records, and authorised implementation          | The component choice, the navigation model and the foundation-only scope match the intended work                                                      | [Approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016) |
| 2026-09-21 | The initial Mantine theme approximates the current palette rather than adopting Mantine defaults    | Avoids a visible lurch during migration, and keeps deliberate theme design out of the same change while still preceding visual-regression baselines   | Owner decision                                                                              |

## Release record

- Design approval: Accepted on 2026-09-21 ([approval record](https://github.com/wpliao/meal-planner/issues/23#issuecomment-5763375016))
- Local verification: Not run; design only
- Development validation: Pending
- Production release: Pending separate explicit approval
- Known follow-up work: Household deletion and ownership transfer remain
  outstanding from Phase 1 and must be designed before further product data.
