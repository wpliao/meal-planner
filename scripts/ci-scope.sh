#!/usr/bin/env bash
# Reads changed paths, one per line, on stdin and prints `docs_only=true` when
# every path is Markdown outside code, test, script, workflow, migration, and
# public-asset paths; otherwise `docs_only=false`. An empty list is not
# docs-only. CI uses this for pull requests only: pushes to main always run
# every check.
set -euo pipefail

docs_only=false
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  case "$path" in
    .github/* | src/* | test/* | tests/* | scripts/* | migrations/* | public/*)
      docs_only=false
      break
      ;;
    *.md) docs_only=true ;;
    *)
      docs_only=false
      break
      ;;
  esac
done

echo "docs_only=$docs_only"
