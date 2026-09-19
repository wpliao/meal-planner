# Security

## Scope and threat model

The application will hold private family preferences, inventory, plans, recipes,
and potentially household images. Primary risks are unauthorized access, overly
broad cloud credentials, cross-family data access, malicious uploads or AI input,
sensitive logging, dependency compromise, and accidental development/production
resource sharing.

## Baseline controls

- Cloudflare Access protects non-local entry points. Before product data exists,
  define application-level identity and authorization as defense in depth.
- Secrets exist only in local ignored `.dev.vars` or environment-scoped Cloudflare
  and GitHub secret stores. `VITE_*` values are always public.
- Development and production have distinct Workers, D1 databases, R2 buckets,
  access policies, and least-privilege deployment tokens.
- API clients, uploads, model output, and access headers are untrusted. Validate
  types, sizes, content, and authorization at each boundary.
- Do not log secrets, authorization assertions, family data, raw prompts, model
  responses containing personal data, or uploaded image content.
- Use prepared D1 statements. Add response security headers and CSP before rich
  user content or third-party resources are introduced.
- AI integrations run server-side through AI Gateway, minimize disclosed data,
  and cannot authoritatively calculate nutrition.

## Dependency and delivery security

The pnpm lockfile is committed; CI uses frozen installs. Dependabot monitors npm
and GitHub Actions dependencies. CI, enabled Sonar checks, review, and protected
production approval are required. Investigate security alerts; no known unresolved
high-severity issue may ship.

## Incident handling

If a credential may be exposed: revoke/rotate it first, inspect Git and provider
audit logs, remove the secret from current content, and assess history cleanup.
Never paste live credentials into an issue, PR, chat, test fixture, or log.

Before accepting family data, document retention/deletion behavior, backup scope,
Access policy ownership, and incident contacts.
