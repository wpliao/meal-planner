# Security

## Scope and threat model

The application will hold private family preferences, inventory, plans, recipes,
and potentially household images. Primary risks are unauthorized access, overly
broad cloud credentials, cross-family data access, malicious uploads or AI input,
sensitive logging, dependency compromise, and accidental development/production
resource sharing.

## Baseline controls

- Cloudflare Access protects non-local entry points. The Worker independently
  verifies the signed application JWT and checks the active D1 household
  membership on every protected request as defense in depth.
- Secrets exist only in local ignored `.dev.vars` or environment-scoped Cloudflare
  and GitHub secret stores. `VITE_*` values are always public.
- Development and production have distinct Workers, D1 databases, R2 buckets,
  access policies, and least-privilege deployment tokens.
- Named environments require separate `CF_ACCESS_AUD` and
  `BOOTSTRAP_OWNER_EMAIL` secrets. The Access audience tag and bootstrap email
  must never be copied between environments accidentally.
- API clients, uploads, model output, and access headers are untrusted. Validate
  types, sizes, content, and authorization at each boundary.
- Do not log secrets, authorization assertions, family data, raw prompts, model
  responses containing personal data, or uploaded image content.
- Use prepared D1 statements. Add response security headers and CSP before rich
  user content or third-party resources are introduced. Phase 1 adds strict
  request content-type and same-origin checks for browser mutations.
- AI integrations run server-side through AI Gateway, minimize disclosed data,
  and cannot authoritatively calculate nutrition.
- Recipe nutrition proposals send only the recipe title and the requested
  ingredient lines to an AI provider, then USDA candidate food names, IDs,
  and portions in the second call. Notes, steps, source URLs, recipe IDs, and
  household or member identities do not enter prompts. The Worker validates
  chosen IDs against per-line candidates and converts quantities with USDA
  measures. No proposal is stored or counted before a member confirms it.
- Each environment uses its own authenticated AI Gateway with request logging
  off (analytics only). Worker logs contain provider, outcome, latency, and
  line count only. Gemini's unpaid tier lets Google use submitted content to
  improve products and permits human review; its terms bar use by anyone under 18. The owner stated on 2026-09-26 that every household member is an adult.
  Set `GEMINI_FALLBACK=off` or remove its key if this changes. See
  [ADR 0010](DECISIONS/0010-ai-provider-boundary.md).
- The static Content Security Policy in `public/_headers` allows
  `style-src 'self' 'unsafe-inline'`. The component library sets inline style
  attributes that no nonce or hash can cover; the reasoning and what it gives
  up are recorded in [ADR 0006](./DECISIONS/0006-component-library.md). Scripts
  remain restricted to `'self'`. `tests/e2e/security-headers.spec.ts` asserts
  the exact policy, so any further relaxation is a deliberate, reviewed edit —
  and introducing user-supplied HTML to a page would require revisiting it.

## Dependency and delivery security

The pnpm lockfile is committed; CI uses frozen installs. Dependabot monitors npm
and GitHub Actions dependencies. CI, enabled Sonar checks, review, and protected
production approval are required. Investigate security alerts; no known unresolved
high-severity issue may ship.

## Incident handling

If a credential may be exposed: revoke/rotate it first, inspect Git and provider
audit logs, remove the secret from current content, and assess history cleanup.
Never paste live credentials into an issue, PR, chat, test fixture, or log.

Phase 1 retains only household identity records while membership exists. Owners
can revoke an active member, then delete an invited or revoked membership; the
delete removes the stored email and Access subject. Before adding meal data,
document retention/deletion behavior for that data, backup scope, Access policy
ownership, and incident contacts.
