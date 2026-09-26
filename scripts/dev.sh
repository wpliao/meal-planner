#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

CI=true pnpm exec wrangler d1 migrations apply DB --local
# The full USDA dataset; skipped when this exact file is already loaded.
node scripts/nutrition-dataset-load.ts --local
exec pnpm exec vite --host 0.0.0.0 "$@"
