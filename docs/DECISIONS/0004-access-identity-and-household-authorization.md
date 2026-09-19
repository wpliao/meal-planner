# ADR 0004: Access identity and household authorization

- Status: Accepted
- Date: 2026-09-20
- Feature: [Trusted family boundary](../features/0007-trusted-family-boundary.md)

## Context

Cloudflare Access is already the perimeter authentication layer, but perimeter
policy alone cannot provide application data isolation or protect against an
accidental policy expansion. Reading an email header without validating the
signed assertion would allow identity spoofing if a request reached the Worker
outside the expected path. Future pantry, recipe, and planning code needs a
provider-neutral authorization context.

## Decision

Use two independent gates for every protected product API:

1. Verify the Cloudflare Access application JWT from
   `Cf-Access-Jwt-Assertion`, including its RS256 signature, time claims, exact
   team issuer, environment-specific audience, user token type, subject, and
   verified email.
2. Resolve that verified subject to an active D1 household membership and apply
   the required owner/member role inside the application.

Keep Cloudflare-specific verification behind an identity adapter. Domain code
receives an application `MemberContext` containing opaque member and household
IDs, verified email, and role. Re-query membership on every protected request so
revocation is immediate.

Invite members by normalized verified email, then bind Cloudflare's account-level
`sub` claim on first use. Provide a deterministic identity adapter only when the
explicit environment is `local`; named deployed environments always validate
real Access tokens. Bootstrap the initial owner once, guarded by an
environment-scoped owner-email secret and a transactional D1 uniqueness
constraint.

## Consequences

An authenticated Access user is not automatically authorized for family data,
and future features share one household-scoping boundary. Development and
production require separate audience and bootstrap configuration. Cold starts
may depend on Access's remote JWKS endpoint, but cached keys support normal
operation and key rotation; failure is closed rather than bypassed.

Membership administration and retention become application responsibilities.
Phase 1 therefore includes owner/member lifecycle operations and deletion of
invited or revoked identity records. Supporting multiple households per person or
another identity provider later will require revisiting the membership uniqueness
and adapter decisions, without changing domain authorization call sites.
