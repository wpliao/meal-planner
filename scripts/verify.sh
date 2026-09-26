#!/usr/bin/env bash
# The complete quality gate. CI runs the same steps as parallel jobs: this
# script with --no-e2e, and the browser tests one project per job.
set -euo pipefail

run_e2e=true
case "${1:-}" in
  "") ;;
  --no-e2e) run_e2e=false ;;
  *)
    echo "Usage: $0 [--no-e2e]" >&2
    exit 2
    ;;
esac

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

echo "Checking formatting"
pnpm format:check

echo "Linting"
pnpm lint

echo "Type checking"
pnpm typecheck

echo "Running unit and Worker tests with coverage"
pnpm test:coverage

echo "Building"
pnpm build

if [[ "$run_e2e" == true ]]; then
  echo "Running browser tests"
  pnpm test:e2e
fi

echo "Verification complete"
