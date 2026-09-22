/**
 * Input validation for the household decommission procedure. Every check here
 * runs before any Cloudflare call, so a malformed or unapproved request never
 * reaches the network.
 */

export type DecommissionEnvironment = 'development';

export const PRODUCTION_INELIGIBLE_MESSAGE =
  'Production household decommissioning is not eligible until development rehearsal evidence and a separate owner approval exist (#32 AC-03).';

/** Where each named environment's reviewed resources are declared. */
export interface RepositoryTarget {
  readonly workerName: string;
  readonly databaseName: string;
  readonly databaseId: string;
}

export interface DecommissionConfig {
  readonly environment: DecommissionEnvironment;
  readonly householdId: string;
  readonly databaseId: string;
  readonly databaseName: string;
  readonly workerName: string;
  readonly accessAppId: string;
  readonly accountId: string;
  readonly apiToken: string;
  readonly approvalReference: string;
  readonly expectedMigrations: readonly string[];
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOUSEHOLD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const APPROVAL_REFERENCE =
  /^https:\/\/github\.com\/wpliao\/meal-planner\/issues\/[1-9]\d*#issuecomment-[1-9]\d*$/u;
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/u;

export const confirmationFor = (environment: string): string =>
  `DECOMMISSION_${environment.toUpperCase()}_HOUSEHOLD`;

type Inputs = Readonly<Record<string, string | undefined>>;

const required = (inputs: Inputs, name: string): string => {
  const value = inputs[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required.`);
  return value;
};

const requirePattern = (
  inputs: Inputs,
  name: string,
  pattern: RegExp,
  description: string,
): string => {
  const value = required(inputs, name);
  if (!pattern.test(value)) {
    throw new ConfigurationError(`${name} must be ${description}.`);
  }
  return value;
};

/**
 * Strips `//` and `/* *\/` comments and trailing commas from JSONC text such
 * as `wrangler.jsonc`, leaving string contents untouched.
 */
export const parseJsonc = (text: string): unknown => {
  const stringEnd = (source: string, start: number): number => {
    let end = start + 1;
    while (end < source.length && source[end] !== '"') {
      end += source[end] === '\\' ? 2 : 1;
    }
    return end + 1;
  };

  let withoutComments = '';
  let index = 0;
  while (index < text.length) {
    const pair = text.slice(index, index + 2);
    if (text[index] === '"') {
      const end = stringEnd(text, index);
      withoutComments += text.slice(index, end);
      index = end;
    } else if (pair === '//') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (pair === '/*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      withoutComments += text[index];
      index += 1;
    }
  }

  let output = '';
  index = 0;
  while (index < withoutComments.length) {
    const char = withoutComments[index];
    if (char === '"') {
      const end = stringEnd(withoutComments, index);
      output += withoutComments.slice(index, end);
      index = end;
      continue;
    }
    const isTrailingComma =
      char === ',' && /^\s*[}\]]/u.test(withoutComments.slice(index + 1));
    if (!isTrailingComma) output += char;
    index += 1;
  }
  return JSON.parse(output);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the reviewed Worker and D1 identity of one named environment. */
export const repositoryTargetFor = (
  wranglerConfig: unknown,
  environment: string,
): RepositoryTarget => {
  const environments = isRecord(wranglerConfig)
    ? wranglerConfig.env
    : undefined;
  const named = isRecord(environments) ? environments[environment] : undefined;
  if (!isRecord(named)) {
    throw new ConfigurationError(
      `wrangler.jsonc has no ${environment} environment.`,
    );
  }
  const databases = Array.isArray(named.d1_databases)
    ? named.d1_databases.filter(isRecord)
    : [];
  const bound = databases.filter(({ binding }) => binding === 'DB');
  const [database] = bound;
  if (
    bound.length !== 1 ||
    typeof named.name !== 'string' ||
    typeof database.database_name !== 'string' ||
    typeof database.database_id !== 'string'
  ) {
    throw new ConfigurationError(
      `wrangler.jsonc does not declare exactly one DB database and a Worker name for ${environment}.`,
    );
  }
  return {
    workerName: named.name,
    databaseName: database.database_name,
    databaseId: database.database_id,
  };
};

/** Migration files committed in the repository, in apply order. */
export const repositoryMigrations = (fileNames: readonly string[]): string[] =>
  fileNames.filter((name) => MIGRATION_FILE.test(name)).sort();

export interface ParseConfigSources {
  readonly inputs: Inputs;
  readonly wranglerConfig: unknown;
  readonly migrationFiles: readonly string[];
}

export const parseDecommissionConfig = ({
  inputs,
  wranglerConfig,
  migrationFiles,
}: ParseConfigSources): DecommissionConfig => {
  const environment = required(inputs, 'DECOMMISSION_ENVIRONMENT');
  if (environment === 'production') {
    throw new ConfigurationError(PRODUCTION_INELIGIBLE_MESSAGE);
  }
  if (environment !== 'development') {
    throw new ConfigurationError(
      'DECOMMISSION_ENVIRONMENT must be development.',
    );
  }

  if (inputs.GITHUB_REF !== 'refs/heads/main') {
    throw new ConfigurationError(
      'The decommission procedure runs only from refs/heads/main.',
    );
  }

  if (inputs.DECOMMISSION_CONFIRMATION !== confirmationFor(environment)) {
    throw new ConfigurationError(
      `DECOMMISSION_CONFIRMATION must be exactly ${confirmationFor(environment)}.`,
    );
  }

  const approvalReference = requirePattern(
    inputs,
    'DECOMMISSION_APPROVAL_REFERENCE',
    APPROVAL_REFERENCE,
    'a wpliao/meal-planner issue-comment URL',
  );
  const householdId = requirePattern(
    inputs,
    'DECOMMISSION_EXPECTED_HOUSEHOLD_ID',
    HOUSEHOLD_ID,
    'a lowercase household UUID',
  );
  const expectedDatabaseId = requirePattern(
    inputs,
    'DECOMMISSION_EXPECTED_D1_DATABASE_ID',
    UUID,
    'a lowercase D1 database UUID',
  );
  const accessAppId = requirePattern(
    inputs,
    'DECOMMISSION_ACCESS_APP_ID',
    UUID,
    'a lowercase Access application UUID',
  );
  const accountId = requirePattern(
    inputs,
    'CLOUDFLARE_ACCOUNT_ID',
    ACCOUNT_ID,
    'a 32-character account ID',
  );
  const apiToken = required(inputs, 'CLOUDFLARE_DECOMMISSION_API_TOKEN');

  const target = repositoryTargetFor(wranglerConfig, environment);
  if (target.databaseId !== expectedDatabaseId) {
    throw new ConfigurationError(
      `DECOMMISSION_EXPECTED_D1_DATABASE_ID does not match the ${environment} database in wrangler.jsonc.`,
    );
  }

  const expectedMigrations = repositoryMigrations(migrationFiles);
  if (expectedMigrations.length === 0) {
    throw new ConfigurationError('No committed migrations were found.');
  }

  return {
    environment,
    householdId,
    databaseId: target.databaseId,
    databaseName: target.databaseName,
    workerName: target.workerName,
    accessAppId,
    accountId,
    apiToken,
    approvalReference,
    expectedMigrations,
  };
};
