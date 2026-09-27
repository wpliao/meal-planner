/** Development-only synthetic recipes and plan weeks for issue #98 validation.
 * Run through .github/workflows/dev-nutrition-fixture.yml. Node 24 executes
 * TypeScript with type stripping; this job installs no dependencies.
 */
import { readFile } from 'node:fs/promises';

import { createCloudflareClient } from '../src/operations/household-decommission/cloudflare-client.ts';
import { redact } from '../src/operations/household-decommission/redact.ts';
import {
  parseFixtureConfig,
  runNutritionFixture,
} from '../src/operations/dev-nutrition-fixture-runner.ts';

const rawToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
const secrets = [rawToken, rawToken.trim()];
const log = (line: string): void => {
  console.log(redact(line, secrets));
};

try {
  const config = parseFixtureConfig(
    process.env,
    await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    new Date(),
  );
  const client = createCloudflareClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
    fetch: (input, init) => fetch(input, init),
  });
  await runNutritionFixture(config, { client, log, now: () => new Date() });
} catch (error) {
  // CloudflareApiError reports only an operation and status. Never print an
  // API response body, bound parameters, household ID, or meal content.
  log(
    JSON.stringify({
      status: 'failed',
      message:
        error instanceof Error ? error.message : 'Unknown fixture failure',
    }),
  );
  process.exitCode = 1;
}
