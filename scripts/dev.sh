#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

CI=true pnpm exec wrangler d1 migrations apply DB --local
exec pnpm exec vite --host 0.0.0.0 "$@"
