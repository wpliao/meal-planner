# ADR 0007: Navigation and information architecture

- Status: Proposed
- Date: 2026-09-21
- Feature: [UI foundation](../features/0023-ui-foundation.md)

## Context

The application has no client-side router. Every feature appends a section to
`App.tsx`, which is now 588 lines and already stacks the signed-in summary,
owner member management and the pantry on one page. Recipes, meal plans and
nutrition would continue that pile.

The page shell compounds it. `.shell` is a two-column grid,
`minmax(0, 1.35fr) minmax(20rem, 0.9fr)`, designed for a Phase 0 landing page.
Feature panels land in the narrow column — about 320px — which is what collapsed
the pantry rename field to roughly 40px. The shell is not a layout for a working
application with several sections.

Deep links do not work today, and the reason is on the server, not the client.
`wrangler.jsonc` sets `not_found_handling: "single-page-application"`, but the
Worker owns every request that is not a static asset and its router throws a
JSON `404` for anything unmatched. A request for a path like `/pantry` therefore
returns `{"error":{"code":"not_found"}}` rather than the application. This was
confirmed by request against a production build, and again with
`public/_headers` absent, so it is the Worker's behaviour and not an artefact of
the asset pipeline.

Nothing breaks today because there are no client-side routes to link to.

## Options considered

### Tabs or a section switcher, no URLs

Cheapest. A piece of client state selects the visible section. No router
dependency, no Worker change.

It gives up two things permanently: a section cannot be linked to, and the
device back button does not move between sections. On a phone, back is the
system gesture people reach for first; without routing it exits the application
instead of returning to the previous section.

### A client-side router with real URLs

Each section gets a path. Links are shareable, the back button behaves, and
later phases add a route instead of another block in `App.tsx`.

It costs a dependency and requires the Worker to serve the application shell for
non-`/api` paths.

Measured sizes for the candidates: wouter about 2.2 KB gzipped, React Router v7
in library mode about 12 KB, TanStack Router about 14 KB.

## Decision

Adopt a **client-side router with real URLs**, and change the Worker to serve
the application shell for paths that are not `/api/*`.

Use **React Router v7 in library mode**. Against wouter's roughly 10 KB saving,
React Router is the option a successor — human or agent — is most likely to
already know, and this repository is maintained across handoffs between
different agents. Ten kilobytes is immaterial next to the 46.5 KB component
layer in ADR 0006; familiarity across handoffs is not. TanStack Router's
type-safe routing is real but solves a problem this application does not have at
three or four routes.

Sections become routes: the family space, the pantry, and later phases' own
paths. The `.shell` landing-page grid is replaced by an application layout with
persistent navigation, so panels are no longer confined to a 320px column.

### Worker behaviour

The Worker keeps owning `/api/*` exactly as it does now. Unmatched **API** paths
still return a JSON `404`. What changes is that a request outside `/api/*` which
matches no static asset returns the application shell instead of a JSON error,
so a deep link loads the application and the router resolves the path.

This must not weaken the boundary. The `/api/*` routes keep their identity
check, membership check, same-origin mutation checks and content-type checks
unchanged. The shell is public in the same sense `index.html` already is; it
carries no household data, and every piece of data still comes from an
authorised API call. `public/_headers` continues to apply to the shell.

## Consequences

Sections gain shareable URLs and correct back-button behaviour, and later phases
add a route rather than growing a single component. `App.tsx` splits into a
layout plus per-route components, which also makes each one testable on its own.

The Worker gains a fallback branch that must be covered by tests asserting that
`/api/*` still returns JSON errors, that an unknown API path is still `404`, and
that an unknown application path returns the shell rather than household data.

Existing end-to-end tests navigate to `/` and will need to follow routes.
Bookmarks do not exist yet, so no family-visible link breaks.

If the router ever needs to be removed, the Worker fallback must be removed with
it, or unknown paths would silently serve the shell instead of a `404`.
