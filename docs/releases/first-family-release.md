# First family release preparation

- Status: Draft for owner review
- Tracking issue: [#103](https://github.com/wpliao/meal-planner/issues/103)
- Preparation PR: [#104](https://github.com/wpliao/meal-planner/pull/104)
- Proposed GitHub release tag: `v1.0.0`
- Scope decision: Phases 1–7, with Phase 7 represented by the released
  human-reviewed AI ingredient-matching workflow in #84
- Last checked: 2026-09-28

## Scope

| Phase | First-release capability                                                                                  | Release record                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | Cloudflare Access plus Worker membership and household authorization; ownership lifecycle                 | [#7](../features/0007-trusted-family-boundary.md), [#32](../features/0032-household-lifecycle.md)  |
| 2     | Pantry availability signals and shopping view                                                             | [#16](../features/0016-lightweight-pantry.md)                                                      |
| 3     | Editable household recipes and reviewed website import                                                    | [#31](../features/0031-recipe-library.md)                                                          |
| 4     | Shared weekly meal plan and controlled clearing of past weeks                                             | [#49](../features/0049-meal-planning.md), [#56](../features/0056-clear-past-week.md)               |
| 5     | Explainable suggestions from pantry and recent plans, with favourites and temporary “Not now”             | [#73](../features/0073-meal-suggestions.md), [#78](../features/0078-recipe-preferences.md)         |
| 6     | USDA-based recipe nutrition and daily/weekly plan estimates                                               | [#84](../features/0084-recipe-nutrition.md), [#98](../features/0098-meal-plan-nutrition-totals.md) |
| 7     | AI-proposed ingredient matches through AI Gateway, with provider fallback and member review before saving | [#84](../features/0084-recipe-nutrition.md), [ADR 0010](../DECISIONS/0010-ai-provider-boundary.md) |

The Phase 7 entry describes one shipped, bounded AI workflow. The accepted
#84 design excludes AI meal suggestions and recipe transformations. Those,
photo ingestion, and offline sync are outside this release and require
separate accepted feature issues before implementation. The responsive app
already has an installable shell; offline writes are deferred.

## Draft release notes

The family can manage pantry and shopping signals, keep and import editable
recipes, plan meals together, and receive explainable recipe suggestions.
Recipes show reviewed, USDA-based nutrition per serving; the meal plan shows
daily and weekly nutrition estimates with coverage and links to incomplete
recipes. AI can propose ingredient-to-food matches, but a family member must
review and save them. The app is private to authorized household members.

Nutrition is a planning estimate, not medical advice or a record of what
anyone ate. A planned recipe entry counts as one serving. Free-text meals and
recipes with incomplete nutrition appear as coverage gaps rather than zero.

## Verified release evidence

- Production app code: `c8bdba5901650ffe486f84135abe307eba2e0821`,
  published by [Deploy run
  36338395179](https://github.com/wpliao/meal-planner/actions/runs/36338395179)
  as Worker version `deff8436-7c2e-4e0a-9b43-fc699ca0925b`. The run found
  no migrations to apply and the pinned USDA dataset already loaded. The
  owner [passed an authenticated production phone
  check](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)
  for the latest nutrition feature.
- The subsequent `main` commit `5479e70cddc5e000243fb53881e06116059703bf`
  records #98's release in Markdown and did not deploy another Worker.
  [Main CI run
  36338998890](https://github.com/wpliao/meal-planner/actions/runs/36338998890)
  passed `Verify`, all four browser projects, static/unit/Workers-runtime
  tests, and its SonarCloud analysis step. The implementation
  [PR #100](https://github.com/wpliao/meal-planner/pull/100) and fixture
  [PR #101](https://github.com/wpliao/meal-planner/pull/101) also passed
  SonarCloud Code Analysis. Each linked feature document has its own
  production release evidence.
- An unauthenticated GET to production `/api/health` and to the meal-plan
  nutrition route returned HTTP 302 from Cloudflare Access after the latest
  deployment. This checks the perimeter redirect, while the owner's phone
  check exercised the authenticated app.
- `pnpm audit --prod --audit-level high` reported **No known vulnerabilities
  found** on 2026-09-28. The owner approved Dependabot alerts for ongoing
  monitoring; they were enabled on 2026-09-28, the setting was verified, and
  GitHub reported zero open alerts at that checkpoint. This does not enable
  automatic security-update PRs or replace review of future alerts.
  [PR #92](https://github.com/wpliao/meal-planner/pull/92)
  updates `jose` and has passing `Verify`; [PR #91](https://github.com/wpliao/meal-planner/pull/91)
  groups development dependencies and currently fails `Verify`. Neither is
  part of the deployed app code or this release scope.

## Known limits and recovery

- A 17-line recipe timed out on Workers AI in development and succeeded via
  Gemini fallback. [PR #94](https://github.com/wpliao/meal-planner/pull/94)
  added cancellation of timed-out Workers AI calls. The case is recorded in
  [#84](../features/0084-recipe-nutrition.md#release-record); monitor it if
  larger recipes are used often.
- AI matching uses free-tier providers. When neither can answer, members can
  still search for and confirm foods manually. The Gemini fallback's content
  handling and adult-only constraint are recorded in
  [ADR 0010](../DECISIONS/0010-ai-provider-boundary.md).
- A Worker rollback changes application code and assets, not D1 data.
  Cloudflare documents [Worker version
  rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
  and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  separately. The owner confirmed the Cloudflare Free plan and accepted its
  seven-day D1 Time Travel window for this first private release on 2026-09-28.
  A restore rewinds the whole database, including valid changes made after the
  selected point; it requires separate owner approval. A general family-data
  backup and restore rehearsal is not yet documented. No data restoration is
  implied by a Worker rollback.

## Publication checklist

- [x] Owner confirms the Phases 1–7 first-release scope.
- [x] Owner accepts the Cloudflare Free seven-day D1 Time Travel window and
      whole-database rollback for this first private release.
- [x] Owner approves Dependabot alerts; enable and verify the setting, then
      check for open alerts.
- [x] On an authenticated production phone, check one existing household path
      across pantry, recipe selection, meal planning, suggestions, and nutrition;
      record only pass/fail and any visible error.
- [ ] After this documentation PR merges and its `main` CI passes, choose the
      exact resulting `main` commit for the proposed `v1.0.0` tag. The tag may
      include documentation commits after the deployed code commit; release notes
      must keep the deployed Worker commit and version explicit.
- [ ] Prepare the GitHub release as a draft, review its title and notes, and
      obtain explicit owner approval before publishing it. Publishing the GitHub
      release does not itself redeploy the Worker.
