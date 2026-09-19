# Family Meal Planner

A private, responsive family meal-planning application. Phase 0 establishes the
engineering foundation only; pantry, recipe, nutrition, and AI features have not
been implemented yet.

## Quick start

Prerequisites: Node.js 24 and pnpm 10. The recommended setup is the included
Dev Container.

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm dev
```

Open <http://localhost:5173>. The Vite development server runs the React client
and Cloudflare Worker together.

## Verification

```bash
./scripts/verify.sh
```

This is the same quality gate used by CI. See [AGENTS.md](./AGENTS.md) for the
authoritative engineering workflow and [docs/](./docs/) for architecture,
environment, security, and delivery decisions.

## Useful commands

| Command             | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Start the full local application                  |
| `pnpm build`        | Create a production Worker and client build       |
| `pnpm test`         | Run React/unit tests and Worker integration tests |
| `pnpm test:e2e`     | Run Playwright against the local application      |
| `pnpm lint`         | Run ESLint                                        |
| `pnpm typecheck`    | Check all TypeScript projects                     |
| `pnpm format:check` | Check Prettier formatting                         |

Cloudflare account setup is intentionally deferred. Before deploying, follow
[docs/ENVIRONMENTS.md](./docs/ENVIRONMENTS.md).
