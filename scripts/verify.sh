#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

echo "Checking formatting"
pnpm format:check

echo "Linting"
pnpm lint

echo "Type checking"
pnpm typecheck

echo "Running unit and Worker tests"
pnpm test

echo "Building"
pnpm build

echo "Running browser tests"
pnpm test:e2e

echo "Verification complete"
