import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const script = (name: string) =>
  fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url));

describe('ci-scope.sh', () => {
  const scope = (paths: string[]) =>
    spawnSync('bash', [script('ci-scope.sh')], {
      input: paths.map((path) => `${path}\n`).join(''),
      encoding: 'utf8',
    }).stdout.trim();

  it('takes the fast path when only documentation Markdown changed', () => {
    expect(scope(['docs/features/0084-recipe-nutrition.md', 'AGENTS.md'])).toBe(
      'docs_only=true',
    );
  });

  it('runs every check when any path is not documentation', () => {
    for (const path of [
      'src/worker/index.ts',
      'docs/diagram.png',
      'package.json',
      'pnpm-lock.yaml',
    ]) {
      expect(scope(['docs/README.md', path]), path).toBe('docs_only=false');
    }
  });

  it('never treats Markdown in code, test, script, workflow, migration, or asset paths as documentation', () => {
    for (const path of [
      '.github/PULL_REQUEST_TEMPLATE.md',
      'src/notes.md',
      'test/fixtures/page.md',
      'tests/e2e/notes.md',
      'scripts/notes.md',
      'migrations/README.md',
      'public/notes.md',
    ]) {
      expect(scope([path]), path).toBe('docs_only=false');
    }
  });

  it('runs every check for an empty change list', () => {
    expect(scope([])).toBe('docs_only=false');
  });
});

describe('ci-verified.sh', () => {
  const SHA = 'a'.repeat(40);
  let stubDir: string | undefined;

  afterEach(() => {
    if (stubDir) rmSync(stubDir, { recursive: true, force: true });
    stubDir = undefined;
  });

  type Run = {
    path: string;
    id: number;
    status: string;
    conclusion: string | null;
  };

  /**
   * Runs the script against a fake `gh` that answers each call with the next
   * response, repeating the last one. A response of `null` fails the call.
   */
  const verified = (responses: (Run[] | null)[], timeoutSeconds = 5) => {
    stubDir = mkdtempSync(join(tmpdir(), 'ci-verified-'));
    responses.forEach((runs, index) => {
      writeFileSync(
        join(stubDir!, `response-${index}`),
        runs === null ? 'FAIL' : JSON.stringify({ workflow_runs: runs }),
      );
    });
    const gh = join(stubDir, 'gh');
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
dir="$(dirname "$0")"
echo "$*" >>"$dir/calls"
count=$(cat "$dir/count" 2>/dev/null || echo 0)
last=${responses.length - 1}
index=$(( count < last ? count : last ))
echo $((count + 1)) >"$dir/count"
body="$(cat "$dir/response-$index")"
[[ "$body" == FAIL ]] && exit 1
echo "$body"
`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync('bash', [script('ci-verified.sh'), SHA], {
      encoding: 'utf8',
      env: {
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        GITHUB_REPOSITORY: 'owner/repo',
        CI_VERIFIED_TIMEOUT_SECONDS: String(timeoutSeconds),
        CI_VERIFIED_POLL_SECONDS: '0',
      },
    });
    return { output: result.stdout.trim(), status: result.status };
  };

  const ci = (status: string, conclusion: string | null, id = 1): Run => ({
    path: '.github/workflows/ci.yml',
    id,
    status,
    conclusion,
  });

  it('reuses a successful CI push run for the exact commit', () => {
    const result = verified([[ci('completed', 'success')]]);
    expect(result.output).toMatch(/verified=true$/u);
    expect(result.status).toBe(0);
  });

  it('waits for a CI run in progress and then reuses its success', () => {
    const result = verified([
      [ci('queued', null)],
      [ci('in_progress', null)],
      [ci('completed', 'success')],
    ]);
    expect(result.output).toMatch(/verified=true$/u);
  });

  it('runs the full gate when CI failed, was cancelled, or never ran', () => {
    for (const responses of [
      [[ci('completed', 'failure')]],
      [[ci('completed', 'cancelled')]],
      [[]],
    ]) {
      expect(verified(responses).output).toMatch(/verified=false$/u);
    }
  });

  it('judges only the newest CI run for the commit', () => {
    expect(
      verified([[ci('completed', 'success', 1), ci('completed', 'failure', 2)]])
        .output,
    ).toMatch(/verified=false$/u);
  });

  it('ignores other workflows, whatever they are named', () => {
    expect(
      verified([
        [
          {
            path: '.github/workflows/deploy.yml',
            id: 9,
            status: 'completed',
            conclusion: 'success',
          },
        ],
      ]).output,
    ).toMatch(/verified=false$/u);
  });

  it('runs the full gate when the GitHub API fails', () => {
    expect(verified([null]).output).toMatch(/verified=false$/u);
  });

  it('runs the full gate when CI is still running at the deadline', () => {
    expect(verified([[ci('in_progress', null)]], 0).output).toMatch(
      /verified=false$/u,
    );
  });
});
