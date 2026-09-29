# Family Meal Planner

A private, responsive family meal-planning application. The production app
brings together household access, pantry and shopping signals, a recipe library,
meal plans, explainable recipe suggestions, and recipe and plan nutrition.
Recipe ingredient matching uses AI proposals that a member reviews before
saving. [The product roadmap](./docs/PRODUCT.md) records the release scope and
future photo and offline work.

## Quick start

Prerequisites: Node.js 24 and pnpm 10. The recommended setup is the included
Dev Container. Dev Containers and GitHub Codespaces run `pnpm run setup`
automatically when they are created, installing both the locked JavaScript
dependencies and the Chromium and WebKit browsers required by Playwright.

```bash
pnpm run setup
pnpm dev
```

Run `pnpm run setup` again after a Playwright version update. If the Dev Container
configuration changes, rebuild the container so its setup lifecycle runs again.

Open <http://localhost:5173>. `pnpm dev` applies pending migrations to the
ignored local D1 database, then runs the React client and Cloudflare Worker
together through Vite.

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
| `pnpm run setup`    | Install locked packages and Playwright browsers   |
| `pnpm dev`          | Migrate and start the full local application      |
| `pnpm build`        | Create a production Worker and client build       |
| `pnpm test`         | Run React/unit tests and Worker integration tests |
| `pnpm test:e2e`     | Run Playwright against the local application      |
| `pnpm lint`         | Run ESLint                                        |
| `pnpm typecheck`    | Check all TypeScript projects                     |
| `pnpm format:check` | Check Prettier formatting                         |

Before configuring or deploying a named Cloudflare environment, follow
[docs/ENVIRONMENTS.md](./docs/ENVIRONMENTS.md).

## License

The source code is released under the [MIT License](./LICENSE). The committed
nutrition reference data in `data/nutrition/` is derived from USDA FoodData
Central, which is in the public domain (CC0 1.0); USDA asks that FoodData
Central be named as the source. See
[ADR 0009](./docs/DECISIONS/0009-nutrition-reference-data.md).
