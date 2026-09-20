#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

e2e_state_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$e2e_state_dir"
}
trap cleanup EXIT

CI=true pnpm exec wrangler d1 migrations apply DB \
  --local \
  --persist-to "$e2e_state_dir"

E2E_STATE_PATH="$e2e_state_dir" pnpm exec vite --host 0.0.0.0 "$@"
