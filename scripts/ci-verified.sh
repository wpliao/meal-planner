#!/usr/bin/env bash
# Prints `verified=true` when the CI workflow's push run for commit $1
# finished successfully, so Deploy can skip re-running ./scripts/verify.sh on
# code CI has already verified. Pushes to main never take the docs-only fast
# path, so a successful push run ran every check. While that run is still in
# progress this waits, up to CI_VERIFIED_TIMEOUT_SECONDS (default 1500). In
# every other case (no run, a failed or cancelled run, the deadline, or an
# API error) it prints `verified=false`, and Deploy runs the full gate itself.
#
# Needs GH_TOKEN with actions:read and GITHUB_REPOSITORY. Writes to
# $GITHUB_OUTPUT when it is set.
set -uo pipefail

sha="${1:?usage: ci-verified.sh <commit-sha>}"
timeout="${CI_VERIFIED_TIMEOUT_SECONDS:-1500}"
poll="${CI_VERIFIED_POLL_SECONDS:-30}"
deadline=$((SECONDS + timeout))

finish() {
  echo "verified=$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "verified=$1" >>"$GITHUB_OUTPUT"
  fi
  exit 0
}

# The newest CI push run for the commit, as "<status> <conclusion>", or
# "none". Only the CI workflow file counts, whatever a run is named.
latest_run() {
  gh api "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${sha}&event=push&per_page=100" |
    jq -r '[.workflow_runs[] | select(.path == ".github/workflows/ci.yml")]
      | sort_by(.id) | last
      | if . == null then "none" else "\(.status) \(.conclusion)" end'
}

while true; do
  if ! state="$(latest_run)"; then
    echo "Could not read CI runs for ${sha}." >&2
    finish false
  fi
  case "$state" in
    "completed success")
      echo "CI verified ${sha}."
      finish true
      ;;
    none)
      echo "No CI push run for ${sha}." >&2
      finish false
      ;;
    completed\ *)
      echo "CI for ${sha} ended as: ${state#completed }." >&2
      finish false
      ;;
  esac
  if ((SECONDS >= deadline)); then
    echo "CI for ${sha} is still ${state%% *} after ${timeout}s." >&2
    finish false
  fi
  sleep "$poll"
done
