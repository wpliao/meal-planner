import {
  ProbeFailure,
  runAtomicityProbe,
  type ProbeConfig,
} from './atomicity-probe.ts';
import { createCloudflareClient, type FetchLike } from './cloudflare-client.ts';
import {
  ACCOUNT_ID,
  ConfigurationError,
  parseJsonc,
  repositoryTargetFor,
  required,
  requirePattern,
  UUID,
  type Inputs,
} from './config.ts';
import { redact } from './redact.ts';

export const PROBE_CONFIRMATION = 'PROBE_DEVELOPMENT_D1_BATCH';

export interface ProbeCliConfig extends ProbeConfig {
  readonly accountId: string;
}

/**
 * Validates the probe inputs. Only the development database is eligible,
 * only from `main`, and only with the literal confirmation.
 */
export const parseProbeConfig = (
  inputs: Inputs,
  wranglerConfig: unknown,
): ProbeCliConfig => {
  if (required(inputs, 'PROBE_ENVIRONMENT') !== 'development') {
    throw new ConfigurationError(
      'PROBE_ENVIRONMENT must be development; the probe never runs elsewhere.',
    );
  }
  if (inputs.GITHUB_REF !== 'refs/heads/main') {
    throw new ConfigurationError('The probe runs only from refs/heads/main.');
  }
  if (inputs.PROBE_CONFIRMATION !== PROBE_CONFIRMATION) {
    throw new ConfigurationError(
      `PROBE_CONFIRMATION must be exactly ${PROBE_CONFIRMATION}.`,
    );
  }
  const expectedDatabaseId = requirePattern(
    inputs,
    'PROBE_EXPECTED_D1_DATABASE_ID',
    UUID,
    'a lowercase D1 database UUID',
  );
  const accountId = requirePattern(
    inputs,
    'CLOUDFLARE_ACCOUNT_ID',
    ACCOUNT_ID,
    'a 32-character account ID',
  );
  const apiToken = required(inputs, 'CLOUDFLARE_API_TOKEN');
  const target = repositoryTargetFor(wranglerConfig, 'development');
  if (target.databaseId !== expectedDatabaseId) {
    throw new ConfigurationError(
      'PROBE_EXPECTED_D1_DATABASE_ID does not match the development database in wrangler.jsonc.',
    );
  }
  return {
    databaseId: target.databaseId,
    databaseName: target.databaseName,
    accountId,
    apiToken,
  };
};

export interface ProbeCliDependencies {
  readonly env: Inputs;
  readonly readWranglerConfig: () => Promise<string>;
  readonly fetch: FetchLike;
  readonly log: (line: string) => void;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Runs the probe and returns the process exit code: 0 only for an `atomic`
 * verdict. A `not-atomic` verdict exits 1 so the run is visibly red.
 */
export const runProbeCli = async (
  deps: ProbeCliDependencies,
): Promise<number> => {
  const rawToken = deps.env.CLOUDFLARE_API_TOKEN ?? '';
  const secrets = [rawToken, rawToken.trim()];
  const logLine = (record: Record<string, unknown>): void => {
    deps.log(
      redact(
        JSON.stringify({ time: deps.now().toISOString(), ...record }),
        secrets,
      ),
    );
  };

  let config: ProbeCliConfig;
  try {
    config = parseProbeConfig(
      deps.env,
      parseJsonc(await deps.readWranglerConfig()),
    );
  } catch (error) {
    logLine({
      stage: 'approval',
      status: 'failed',
      message:
        error instanceof ConfigurationError
          ? redact(error.message, secrets)
          : 'The probe inputs or repository configuration could not be read.',
    });
    return 1;
  }
  logLine({
    stage: 'approval',
    status: 'passed',
    databaseId: config.databaseId,
  });

  const client = createCloudflareClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
    fetch: deps.fetch,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });

  try {
    const verdict = await runAtomicityProbe(config, {
      client,
      log: deps.log,
      now: deps.now,
      newId: deps.newId,
    });
    logLine({
      status: verdict === 'atomic' ? 'passed' : 'failed',
      verdict,
      message:
        verdict === 'atomic'
          ? 'The failed REST batch left no row: D1 rolled back the whole batch.'
          : 'The failed REST batch kept its first statement: the REST batch is not atomic. The probe row was removed.',
    });
    return verdict === 'atomic' ? 0 : 1;
  } catch (error) {
    logLine({
      status: 'failed',
      message: redact(
        error instanceof ProbeFailure
          ? `Stage ${error.stage} failed: ${error.message}`
          : 'The probe stopped on an unexpected error.',
        secrets,
      ),
    });
    return 1;
  }
};
