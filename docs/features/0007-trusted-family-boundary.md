# Feature: Trusted family boundary

- Status: Implementing
- Phase: 1
- Issue: [#7](https://github.com/wpliao/meal-planner/issues/7)
- Product owner: Repository owner
- Last updated: 2026-09-20
- Pull requests: [#8 — design](https://github.com/wpliao/meal-planner/pull/8); [#9 — implementation](https://github.com/wpliao/meal-planner/pull/9); [#10 — bootstrap failure classification and traceability](https://github.com/wpliao/meal-planner/pull/10); [#11 — development validation and initial action discoverability correction](https://github.com/wpliao/meal-planner/pull/11); [#12 — balanced responsive member layout](https://github.com/wpliao/meal-planner/pull/12)

## Problem and outcome

Cloudflare Access protects the deployed hostnames, but the Worker does not yet
validate the signed Access assertion or decide whether an authenticated person
belongs to the family. Adding product data before that boundary exists would
make authorization depend entirely on external policy configuration.

Phase 1 establishes a small application identity and household-membership
boundary. A person must pass both layers before any future household data is
returned:

1. Cloudflare Access authenticates the person and applies the perimeter policy.
2. The Worker validates the signed application token and requires an active D1
   membership with the necessary role.

Later pantry, recipe, and planning features receive a trusted application member
context and do not read Cloudflare headers directly.

## User scenarios

1. Given an active family member who passed Cloudflare Access, when they open the
   application, then they see their family space and current role.
2. Given the household owner, when they add a verified email, then that person
   can become active on their first valid Access-authenticated visit.
3. Given a revoked family member, when they make their next protected request,
   then the application denies access even if their Access session remains valid.
4. Given an authenticated person who was not added to the household, when they
   reach a protected API, then they receive no household data.
5. Given a local contributor or CI run, when the application is tested, then a
   deterministic local identity adapter works without Cloudflare or another
   remote service.

## Scope

- Included: Access JWT verification for protected APIs; one household per member;
  first-owner bootstrap; owner/member roles; member list, add, role change,
  revoke, reactivate, and deletion; minimal session UI; D1 migration; environment
  configuration and deployment guidance.
- Not included: public registration, passwords, invitation email delivery,
  multiple households per person, granular permissions, pantry, recipes,
  preferences, meal plans, nutrition, uploads, or AI.
- Cloudflare Access policy membership remains a separate perimeter control. An
  application invitation does not alter the Access policy or send a message.

## Acceptance criteria

Identifiers are stable after the design is accepted. Changed or superseded
criteria remain in this document and are explained in the decision log.

- [ ] `AC-01`: Every non-health product API rejects a missing, invalid, expired,
      wrong-issuer, wrong-audience, or non-user Cloudflare Access application token.
- [ ] `AC-02`: A valid Access identity must map to exactly one active household
      membership before a protected API returns household data.
- [ ] `AC-03`: An active member can retrieve a minimal session containing their
      application member ID, verified email, role, and household ID/name; it contains
      no token or unnecessary Access claims.
- [ ] `AC-04`: The initial owner can be created only while the installation is
      empty and only when the verified Access email matches the environment-scoped
      bootstrap secret.
- [ ] `AC-05`: An owner can list, add, change the role of, revoke, reactivate, and
      delete eligible household members; a regular member cannot, and an operation
      cannot leave the household without an active owner.
- [ ] `AC-06`: Revocation takes effect on the next protected API request and does
      not depend on the Cloudflare Access session expiring.
- [ ] `AC-07`: The responsive client presents accessible loading, setup,
      signed-in, unauthorized, validation, empty, success, and failure states.
- [ ] `AC-08`: Identity assertions, tokens, secrets, and member email addresses
      are excluded from application logs; persistence uses prepared,
      household-scoped D1 statements.
- [ ] `AC-09`: Local and automated tests cover token validation, household
      isolation, role authorization, bootstrap safety, revocation, migrations, and
      the primary owner/member browser journeys without remote services.
- [ ] `AC-10`: Development and production use distinct audience settings,
      bootstrap secrets, D1 data, and explicitly tested migration/deployment steps.

## Experience design

### Application entry

The client requests `GET /api/session` on startup and renders one of these states:

- `loading`: a semantic status announces that the family space is being checked.
- `setup-required`: shown only to the matching bootstrap owner when the
  installation is empty; a button creates the family space after confirmation.
- `ready`: shows the household name, verified email, and role. Owners also see
  member administration.
- `not-a-member`: explains that Access authentication succeeded but the identity
  has not been added to this family. It reveals no membership information.
- `unavailable`: provides a retry action without exposing token or configuration
  details.

Cloudflare handles its own login and logout experience. The application does not
store a browser token or implement a password form.

### Member administration

Owners see a compact member table and an add-member form:

- Adding a normalized email creates an `invited` membership. It does not send an
  email or change the Access policy.
- The first valid Access request with the matching verified email binds the
  Access subject and activates the membership.
- Revoking an active member immediately blocks their next protected request.
- Reactivation retains the bound subject; deleting is permitted only for invited
  or revoked members and permanently removes their stored email and subject.
- Owners may promote an active member or demote an owner only if at least one
  other active owner remains. The same invariant applies to revocation.

Forms use explicit labels and inline error summaries. Status is conveyed in text,
not color alone. Keyboard focus moves to the result message after a mutation, and
destructive actions require a confirmation dialog with a clear member label.
Desktop and narrow mobile layouts expose the same actions in the same reading
order without horizontal scrolling. The desktop table gives the member, role,
and status information most of the available width while keeping a compact
Actions column. On narrow mobile screens, each semantic table row becomes a
stacked member card with labelled details first and its actions underneath.

## Technical design

### Boundaries and contracts

`src/worker/auth/` owns identity verification. Cloudflare-specific headers and
claims must not escape this boundary. It returns this internal shape after token
validation:

```ts
interface VerifiedIdentity {
  subject: string;
  email: string;
}
```

For development and production, the adapter reads
`Cf-Access-Jwt-Assertion`, verifies `RS256` signature and time claims against the
team's remote JWKS, and checks the exact issuer, environment-specific audience,
`type: "app"`, non-empty `sub`, and a syntactically valid email. Service tokens
are not user identities. The implementation should use `jose` and a module-level
remote JWKS cache so signing-key rotation is handled without hard-coded keys.

The top-level local environment uses a deterministic local adapter selected only
when `APP_ENV === "local"`. It never accepts a caller-supplied production identity
header. Worker tests inject identity fixtures at the adapter boundary. Named
development and production environments explicitly set non-local `APP_ENV`
values, preventing the local adapter from being deployed accidentally.

The authorization service converts `VerifiedIdentity` into:

```ts
interface MemberContext {
  memberId: string;
  householdId: string;
  householdName: string;
  email: string;
  role: 'owner' | 'member';
}
```

All later domain services accept `MemberContext` or its `householdId`; they do
not accept an email or request headers as authorization evidence.

Shared JSON contracts and stable error codes live in `src/shared/api.ts` or
focused files under `src/shared/`. Expected endpoints are:

| Method   | Route                              | Authorization                              | Purpose                                       |
| -------- | ---------------------------------- | ------------------------------------------ | --------------------------------------------- |
| `GET`    | `/api/health`                      | None in Worker                             | Existing non-sensitive liveness check         |
| `GET`    | `/api/session`                     | Valid identity; membership optional        | Return ready, setup-required, or not-a-member |
| `POST`   | `/api/bootstrap`                   | Matching bootstrap identity; empty install | Atomically create household and first owner   |
| `GET`    | `/api/household/members`           | Owner                                      | List this household's members                 |
| `POST`   | `/api/household/members`           | Owner                                      | Add or re-invite a normalized email           |
| `PATCH`  | `/api/household/members/:memberId` | Owner                                      | Change an eligible member's role or status    |
| `DELETE` | `/api/household/members/:memberId` | Owner                                      | Delete invited or revoked membership data     |

Unknown APIs remain JSON `404` responses. Validation failures use `400`, missing
or invalid identity uses `401`, insufficient membership or role uses `403`, and
state/invariant conflicts use `409`. Configuration or JWKS availability failures
fail closed with a generic `503`. Responses remain cache-disabled and do not
include raw verification errors.

### Data and migrations

Migration `0001_create_household_identity.sql` creates:

- `households`: opaque ID, display name, and creation/update timestamps.
- `household_members`: opaque ID, household ID, normalized verified email,
  nullable Access subject, role (`owner` or `member`), status (`invited`,
  `active`, or `revoked`), and lifecycle timestamps.
- `app_installation`: a single row pointing to the bootstrapped household. Its
  primary-key constraint makes bootstrap uniqueness explicit while leaving the
  household tables structurally testable for isolation.

Foreign keys and check constraints enforce valid roles/statuses. The Access
subject and normalized email are globally unique in Phase 1, which implements
one household per identity. Every member operation includes `household_id` in
its predicate even when a member ID is globally unique.

Bootstrap pre-generates opaque IDs and uses one transactional `D1Database.batch`
containing household, guarded installation, and owner inserts. A concurrent or
repeated bootstrap conflicts and rolls back the complete batch. All runtime input
uses bound prepared statements.

Email normalization trims surrounding whitespace and applies Unicode-compatible
lowercasing. It does not remove dots, plus-address tags, or otherwise rewrite
provider-specific addresses. The verified email from the Access token must match
an invitation after this normalization. Once activated, the Access `sub` is the
primary lookup key; Cloudflare documents it as unique to an email per Zero Trust
account, while noting it changes if a user is removed and re-added.

Member identity data is retained while the membership exists. Owners may delete
invited or revoked memberships, which removes the stored email and subject. An
active membership must first be revoked. Phase 1 stores no product activity or
audit event containing the email, so member deletion is complete for application
data. Decommissioning the only household remains an operational D1 deletion;
later product-data features must design household deletion and ownership transfer
before adding dependent records.

### Security and privacy

- Treat `Cf-Access-Authenticated-User-Email` as untrusted; it is not an
  authorization source. Verify the signed assertion and use its validated claims.
- Verify exact issuer and audience per environment. Development and production
  Access applications have different audience tags.
- Declare `CF_ACCESS_AUD` and `BOOTSTRAP_OWNER_EMAIL` as required encrypted Worker
  secrets in named environments. Keep the non-secret team-domain URL in repeated
  environment vars.
- Return generic authentication errors. Do not log assertions, claims, emails,
  request bodies, secrets, or remote JWKS response bodies.
- Validate request content type, size, exact fields, IDs, roles, statuses, and
  email syntax before persistence. Add restrictive response security headers.
- Require `application/json` and an `Origin` exactly matching the request origin
  for every browser mutation. Reject missing or cross-origin browser mutation
  requests to prevent cookie-backed cross-site request forgery.
- Re-query membership for every protected request. Do not cache authorization
  across requests, so revocation is immediate.
- Owner mutations use both actor household scope and target household scope.
  Database constraints plus service checks protect the final-owner invariant.
- JWKS retrieval is the only new runtime network dependency. Verification fails
  closed if no valid cached signing key is available.

Cloudflare references used by this design:

- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access application-token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Wrangler secrets and required bindings](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets)
- [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

### Accessibility

- Use headings, lists, tables, forms, buttons, and status/output elements for
  their native semantics; do not recreate them with ARIA roles.
- Associate every field with visible instructions and its validation message.
- Announce async session and mutation results without unexpectedly stealing focus.
- Keep confirmation dialogs focus-trapped, labelled, dismissible by keyboard, and
  restored to the invoking control.
- Meet WCAG AA contrast, visible-focus, zoom/reflow, and reduced-motion behavior.
- Manually check the primary owner and denied-member journeys with keyboard-only
  navigation and a screen reader at desktop and mobile widths.

### Reliability and observability

- Remote JWKS keys are cached by the verifier and refreshed for unknown key IDs,
  supporting Access key rotation. A cold-start fetch failure returns `503` and a
  retryable UI state rather than bypassing verification.
- Bootstrap and final-owner changes are transactional and safe to retry. Member
  add operations return an existing eligible invitation rather than duplicating
  it; incompatible state returns `409`.
- Logs may contain a generated request ID, route template, response class,
  duration, and non-sensitive error code. They must not contain identity or
  household values.
- Client mutations disable duplicate submission while pending and reconcile from
  a fresh server response.

## Test strategy

### Unit and component

- Verify claim-shape validation and email normalization with table-driven cases.
- Verify client rendering and focus behavior for every session and mutation state.
- Mock the API boundary; client tests do not construct Access tokens.

### Worker-runtime integration

- Generate ephemeral RSA keys and signed JWT fixtures in tests. Stub only the
  remote JWKS fetch; do not call Cloudflare.
- Apply the real migration to a fresh local D1 database for each relevant suite.
- Exercise missing, malformed, expired, future, wrong-issuer, wrong-audience,
  service-token, and valid-user assertions.
- Seed two households directly in isolated tests and prove cross-household actor
  and target IDs cannot escape the actor's scope.
- Test bootstrap races/retries, invitation activation, roles, revocation,
  reactivation, deletion, and final-owner constraints.
- Test missing and cross-origin mutation origins and unsupported content types.

### Browser/E2E and manual

- Use the local identity adapter and local D1 only.
- Cover first-owner setup and subsequent ready state on desktop and mobile.
- Cover owner adding a member and a denied/non-owner management attempt.
- In development, confirm at the Cloudflare edge that `GET /` still returns the
  `public/_headers` security headers. The `asset-pipeline` Playwright project
  already proves this against the production build locally; the manual check
  only confirms that no edge or Access setting strips them.
- In development, manually confirm a real Access login, app membership denial,
  invitation activation, revocation on the next request, keyboard flow, and that
  logs contain no identity values.

## Traceability

Implementation merged to `main` in
[#9](https://github.com/wpliao/meal-planner/pull/9) as `410a10e` on 2026-09-20,
followed by the correction in
[#10](https://github.com/wpliao/meal-planner/pull/10) as `81fb6d3` and the first
member-action discoverability correction in
[#11](https://github.com/wpliao/meal-planner/pull/11) as `c7af9ca`. CI and the
Sonar Quality Gate passed for all three. Development deployment and
initial-owner bootstrap evidence are recorded below; acceptance checkboxes
remain open until the outstanding manual scenarios are complete.

| Criterion | Implementation                                                                                                                                              | Automated tests                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Release evidence                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `AC-01`   | `src/worker/auth/access-identity.ts` — `verifyAccessIdentity`                                                                                               | `test/worker/access-identity.test.ts` — invalid-claim matrix; “returns 503 when the signing key service…”; “keeps an unknown signing key classified as an invalid identity”; “does not accept caller-supplied identity hints in a deployed environment”; “uses the deterministic local identity only for the local environment”; “never falls back to the local identity in the %s environment”; “fails closed in the %s environment when Access configuration is absent” | `V-LOCAL-01`; `V-DEV-01`; `V-DEV-02`                             |
| `AC-02`   | `src/worker/auth/member-context.ts` — `requireMemberContext`; `src/worker/data/household-repository.ts`                                                     | `test/worker/members.test.ts` — “returns the activated membership to concurrent first requests”; “denies non-members and regular members from owner operations”; “keeps target operations scoped to the actor household”                                                                                                                                                                                                                                                  | `V-LOCAL-01`; `V-DEV-03`                                         |
| `AC-03`   | `src/worker/index.ts` — `GET /api/session`; `src/shared/api.ts` — session contracts                                                                         | `test/worker/session-bootstrap.test.ts` — “atomically creates the first household owner and returns a minimal session”; `src/client/App.test.tsx` — “shows the member-only family view without management controls”                                                                                                                                                                                                                                                       | `V-LOCAL-01`; `V-DEV-02`; `V-DEV-03`                             |
| `AC-04`   | `src/worker/index.ts` — `POST /api/bootstrap`; `migrations/0001_create_household_identity.sql`                                                              | `test/worker/session-bootstrap.test.ts` — “allows only the configured verified identity to bootstrap”; “creates exactly one family space under concurrent bootstrap requests”; repeated-bootstrap test; “does not report an incomplete setup as an existing family space”; “stays generic when the installation check cannot run either”; “still reports a genuine conflict when the installation exists”                                                                 | `V-LOCAL-01`; `V-DEV-01`; `V-DEV-02`                             |
| `AC-05`   | `src/worker/index.ts` — member routes; `src/worker/data/household-repository.ts` — owner mutations                                                          | `test/worker/members.test.ts` — full regular-member mutation denial; lifecycle/deletion tests; “preserves an active owner under concurrent owner demotions”                                                                                                                                                                                                                                                                                                               | `V-LOCAL-01`; CI and Sonar passed in #9                          |
| `AC-06`   | `src/worker/auth/member-context.ts` — per-request membership lookup                                                                                         | `test/worker/members.test.ts` — “supports role, revocation, reactivation, and immediate denial”                                                                                                                                                                                                                                                                                                                                                                           | `V-LOCAL-01`; CI and Sonar passed in #9                          |
| `AC-07`   | `src/client/App.tsx`; `src/client/styles.css`                                                                                                               | `src/client/App.test.tsx` — setup, validation, lifecycle, destructive confirmation, reconciliation, failure, and focus tests; `tests/e2e/family-boundary.spec.ts` — owner bootstrap/invite/remove, member-only, denied, and “balances member information and actions without horizontal scrolling” journeys                                                                                                                                                               | `V-LOCAL-01`; `V-LOCAL-06`; `V-LOCAL-07`; `V-DEV-02`; `V-DEV-03` |
| `AC-08`   | `src/worker/http.ts`; `public/_headers` — static-document headers; `src/worker/data/household-repository.ts` — validation, headers, prepared scoped queries | `test/worker/members.test.ts` — no identity logging and household scope; `test/worker/session-bootstrap.test.ts` — origin/content-type/body-size validation, including streamed bodies without a trustworthy content length; `tests/e2e/security-headers.spec.ts` — “serves the application document with the static security headers”; “serves built assets with the same framing protection”; “does not serve the headers configuration file itself”                    | `V-LOCAL-01`; security review passed                             |
| `AC-09`   | `test/worker/helpers.ts`; `scripts/dev-e2e.sh`; `vitest.worker.config.ts`                                                                                   | Complete client, Worker-runtime, migration, and isolated desktop/mobile Playwright suites                                                                                                                                                                                                                                                                                                                                                                                 | `V-LOCAL-01`; CI and Sonar passed in #9                          |
| `AC-10`   | `wrangler.jsonc`; `.github/workflows/deploy.yml`; `scripts/dev.sh`; `docs/ENVIRONMENTS.md`                                                                  | `test/worker/migration.test.ts`; generated binding check; named-environment builds; fresh local migration/startup check                                                                                                                                                                                                                                                                                                                                                   | `V-LOCAL-02`; `V-DEV-01`; production pending                     |

### Verification evidence

- `V-LOCAL-01` (2026-09-20): `./scripts/verify.sh` passed in the Dev
  Container—formatting, lint, typecheck, 16 client tests, 40 Worker-runtime
  tests, coverage thresholds, production build, and 10 isolated Playwright
  tests across desktop and mobile.
- `V-LOCAL-02` (2026-09-20): `pnpm cf:typegen` reproduced the checked-in
  bindings; development and production named-environment builds succeeded and
  reported the intentionally unconfigured local secret values; a fresh local
  `pnpm dev` applied migration `0001` and returned `setup-required` from
  `/api/session`.
- `V-LOCAL-03` (2026-09-20): after the second independent security review,
  `./scripts/verify.sh` passed again — 16 client tests, 45 Worker-runtime tests,
  coverage thresholds, production build, and 10 Playwright tests. The resolved
  Wrangler configuration was checked for all three environments: the top-level
  configuration reports `workers_dev false`, while `development` and
  `production` each report `workers_dev true` and their own `APP_ENV`.
- `V-LOCAL-04` (2026-09-20): `./scripts/verify.sh` passed with the new
  `asset-pipeline` Playwright project — 16 client tests, 45 Worker-runtime
  tests, and 13 browser tests. Removing `public/_headers` was confirmed to fail
  that project, so the coverage is a real regression guard.
- `V-LOCAL-05` (2026-09-20): `./scripts/verify.sh` passed after the bootstrap
  failure-classification fix — 16 client tests, 48 Worker-runtime tests, and 13
  browser tests.
- `V-LOCAL-06` (2026-09-20): `./scripts/verify.sh` passed after pinning the
  member Actions column — 16 client tests, 48 Worker-runtime tests, coverage
  thresholds, the production build, and 15 browser tests. The new browser test
  verifies that an active member's Revoke control remains within the visible
  table viewport at a narrow computer-browser width.
- `V-LOCAL-07` (2026-09-20): `./scripts/verify.sh` passed after replacing the
  oversized pinned action region with a balanced desktop table and stacked
  mobile member cards — 16 client tests, 48 Worker-runtime tests, coverage
  thresholds, the production build, and 15 browser tests. The responsive browser
  regression verifies the information/action proportions and absence of
  horizontal scrolling in both desktop and mobile projects.
- `V-DEV-01` (2026-09-20): the protected development workflow ran from `main`
  at `81fb6d3`. Its verification and named-environment build passed, migration
  `0001_create_household_identity.sql` was applied to the development D1
  database, and Worker version `b3634357-06a2-4fda-93e6-f9904b7ae9e5` was
  deployed. The original workflow run was deleted after a configuration warning
  exposed values that had mistakenly been entered as plaintext variables;
  sanitized evidence and the exact cleanup are recorded in
  [PR #10](https://github.com/wpliao/meal-planner/pull/10#issuecomment-5748492937).
- `V-DEV-02` (2026-09-20): the owner passed real Cloudflare Access, bootstrapped
  `Liao Family (Development)` with the configured identity, and observed the
  signed-in owner and member-management state. The remaining scenarios are
  pending. Evidence is recorded in
  [issue #7](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5748528535).
- `V-DEV-03` (2026-09-20): a second real Access-authenticated identity was
  denied application membership without household disclosure. After the owner
  invited it, the identity's next visit activated a regular membership and
  exposed no management controls. Evidence is recorded in
  [the denial record](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5749374636)
  and
  [the activation record](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5749400209).
- Independent security review found no unresolved high-severity issue after all
  review findings were corrected. CI and the Sonar Quality Gate passed for
  [PR #9](https://github.com/wpliao/meal-planner/pull/9) and
  [PR #10](https://github.com/wpliao/meal-planner/pull/10). The remaining
  development Access scenarios and production rollout remain pending.

## Rollout and rollback

1. Add the migration and implementation, then apply the migration to a clean local
   D1 database and run `./scripts/verify.sh`.
2. Obtain each Access application's **Application Audience (AUD) tag**; do not
   confuse it with the Access application ID previously recorded during setup.
3. Configure distinct `CF_ACCESS_AUD` and `BOOTSTRAP_OWNER_EMAIL` Worker secrets
   for development. Confirm the Access team-domain variable.
4. Configure the development GitHub environment secrets and run the protected
   development workflow. It applies migration `0001` to the development D1
   database immediately before deploying code.
5. Bootstrap the owner, run the manual acceptance scenarios,
   and record evidence here.
6. Repeat secret configuration for production only after explicit approval. The
   protected production workflow applies the migration, deploys the exact
   reviewed commit, then bootstrap and verify.

Code rollback redeploys the last known-good Phase 0 revision. The additive schema
may remain unused; do not edit or reverse the applied migration. Before any
product data exists, a failed bootstrap can be recovered by restoring the D1
pre-migration backup or adding a reviewed forward-recovery migration. After
member data exists, use forward recovery and preserve authorization records until
the owner explicitly deletes them.

## Decision and change log

| Date       | Change                                                                                                                                                                             | Reason                                                                                                                                                                     | Evidence                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-19 | Initial design: verified Access identity plus D1 membership, owner/member administration, and one-time owner bootstrap                                                             | Establish defense in depth before accepting family product data                                                                                                            | [Issue #7](https://github.com/wpliao/meal-planner/issues/7)                                                          |
| 2026-09-20 | Product owner accepted the Phase 1 design and authorized implementation                                                                                                            | The proposed experience, security, data, rollout, and test boundaries match the intended first product phase                                                               | [Approval record](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5743365523)                           |
| 2026-09-20 | Implementation started: added Access verification, local identity, D1 membership authorization, bootstrap/member APIs, responsive session UI, isolated test harness, and migration | Turn the accepted boundary into a testable implementation while preserving the one-household and environment-separation constraints                                        | Implementation branch; verification and PR evidence pending                                                          |
| 2026-09-20 | Security hardening added bounded streaming bodies, concurrent activation recovery, JWKS outage classification, session reconciliation, and complete destructive confirmations      | Resolve every finding from the independent authorization and accessibility review before remote review                                                                     | `V-LOCAL-01`; no unresolved high-severity finding                                                                    |
| 2026-09-20 | Local startup now applies pending D1 migrations before Vite; the protected deployment workflow applies remote migrations before each named deployment                              | Make fresh local, Codespaces, development, and production startup orders reproducible                                                                                      | `V-LOCAL-02`; development deployment pending                                                                         |
| 2026-09-20 | A second independent security and authorization review of the implementation branch reported no high-severity finding                                                              | Confirm the boundary before the implementation pull request is merged                                                                                                      | [#9](https://github.com/wpliao/meal-planner/pull/9); `V-LOCAL-03`                                                    |
| 2026-09-20 | The top-level Wrangler configuration is no longer publishable (`workers_dev` and `preview_urls` are `false`, re-enabled explicitly per named environment)                          | The top-level configuration selects the deterministic local identity adapter, so a stray `wrangler deploy` must not expose a reachable Worker                              | `V-LOCAL-03`; resolved the review's only medium-severity finding                                                     |
| 2026-09-20 | `bootstrapHousehold` now reports an incomplete setup as `503` and keeps `409` for a proven existing installation                                                                   | A bare catch reported a D1 outage as “already set up”, which would tell an operator that bootstrap succeeded when nothing was written                                      | `V-LOCAL-05`; resolved a low-severity review finding before development rollout                                      |
| 2026-09-20 | Playwright gained an `asset-pipeline` project that serves the production build through the real Cloudflare asset pipeline and asserts the static security headers                  | The `vite dev` server used by the other suites bypasses that pipeline, so `public/_headers` would otherwise have shipped with no automated coverage                        | `V-LOCAL-04`; verified to fail when `public/_headers` is removed                                                     |
| 2026-09-20 | `public/_headers` adds framing, CSP, referrer, and permissions headers to documents and static assets                                                                              | Static requests bypass the Worker, so `src/worker/http.ts` headers never covered the application document                                                                  | `V-LOCAL-03`; covered by the `asset-pipeline` Playwright project                                                     |
| 2026-09-20 | The member table pins its Actions column to the visible right edge                                                                                                                 | Development acceptance showed that working role and revocation controls were undiscoverable beyond a horizontal scrollbar on a computer browser                            | [Issue #7 acceptance finding](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5749507874); `V-LOCAL-06` |
| 2026-09-20 | Member administration uses information-first desktop columns and stacked mobile member cards instead of a pinned action column                                                     | Owner review found that pinning made actions discoverable but consumed too much space and hid member information; the adaptive layout keeps both visible without scrolling | Owner screenshot and feedback; `V-LOCAL-07`                                                                          |

## Release record

- Local verification: `V-LOCAL-01` and `V-LOCAL-02` passed on 2026-09-20.
- Implementation review: [#9](https://github.com/wpliao/meal-planner/pull/9)
  merged on 2026-09-20 as `410a10e`. CI and the Sonar Quality Gate passed on the
  pull request and again on `main` after the merge.
- Follow-up correction: [#10](https://github.com/wpliao/meal-planner/pull/10)
  merged on 2026-09-20 as `81fb6d3`; CI and the Sonar Quality Gate passed.
- Responsive-action correction:
  [#11](https://github.com/wpliao/meal-planner/pull/11) merged on 2026-09-20 as
  `c7af9ca`; CI and the Sonar Quality Gate passed. Owner review then identified
  that the pinned action region overcorrected the original discoverability issue;
  the balanced desktop and stacked mobile refinement is under review in
  [#12](https://github.com/wpliao/meal-planner/pull/12).
- Development deployment: `V-DEV-01` complete; migration `0001` and the Phase 1
  Worker are deployed with the required values restored as encrypted secrets.
- Development validation: `V-DEV-02` and `V-DEV-03` partially complete;
  next-request revocation, accessibility, edge-header, and log-privacy checks
  remain pending. The refined member layout awaits review and development
  redeployment before its manual recheck.
- Production release: Pending explicit approval
- Known follow-up work: Household-data deletion/transfer must be designed with the
  first feature that stores product data.
