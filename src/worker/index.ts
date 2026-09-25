import type {
  AddHouseholdMemberRequest,
  BootstrapRequest,
  HealthResponse,
  HouseholdMemberResponse,
  HouseholdMembersResponse,
  MemberRole,
  SessionResponse,
} from '../shared/api';
import {
  cleanPantryDisplayName,
  isPantryStatus,
  isValidPantryName,
  normalizePantryName,
  PANTRY_NAME_MAX_LENGTH,
  type PantryItemResponse,
  type PantryItemsResponse,
  type PantryStatus,
} from '../shared/pantry';
import {
  isWithinPlanWindow,
  MEAL_PLAN_SERVER_SLACK_DAYS,
  serverPlanWriteWindow,
  utcPlanDate,
  validateClearMealPlanWeek,
  validateCreateMealPlanEntry,
  validateMealPlanRange,
  validateMealPlanVersion,
  validateUpdateMealPlanEntry,
  type MealPlanEntryResponse,
  type MealPlanResponse,
} from '../shared/meal-plan';
import {
  rankMealSuggestions,
  validateSuggestionQuery,
  type MealSuggestionsResponse,
} from '../shared/meal-suggestions';
import {
  validateRecipePreferenceChange,
  type RecipeDetailResponse,
  type RecipePreferencesResponse,
} from '../shared/recipe-preferences';
import {
  validateCreateRecipe,
  validateRecipeVersion,
  validateUpdateRecipe,
  type RecipeImportFailure,
  type RecipeImportPreviewRequest,
  type RecipeResponse,
  type RecipesResponse,
} from '../shared/recipes';
import { getVerifiedIdentity } from './auth/access-identity';
import {
  isValidEmail,
  normalizeEmail,
  requireNormalizedEmail,
} from './auth/email';
import { requireMemberContext, requireOwner } from './auth/member-context';
import type { IdentityEnv, VerifiedIdentity } from './auth/types';
import {
  addMember,
  bootstrapHousehold,
  changeMemberRole,
  changeMemberStatus,
  deleteMember,
  installationExists,
  listMembers,
  resolveMemberContext,
  type MemberContext,
} from './data/household-repository';
import {
  clearMealPlanWeek,
  createMealPlanEntry,
  deleteMealPlanEntry,
  readMealPlan,
  updateMealPlanEntry,
} from './data/meal-plan-repository';
import { readSuggestionInput } from './data/meal-suggestion-repository';
import {
  getRecipePreferences,
  setRecipePreference,
} from './data/recipe-preference-repository';
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  updatePantryItem,
  type PantryItemChange,
} from './data/pantry-repository';
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  updateRecipe,
} from './data/recipe-repository';
import { ApiError, invalidRequest } from './errors';
import { importRecipePreview, type ImportFetch } from './import/recipe-import';
import {
  errorResponse,
  json,
  readJsonObject,
  requireExactFields,
  requireMutationHeaders,
} from './http';

type AppEnv = Env &
  IdentityEnv & {
    BOOTSTRAP_OWNER_EMAIL?: string;
  };
type IdentityProvider = (
  request: Request,
  env: AppEnv,
) => Promise<VerifiedIdentity>;
type Clock = () => Date;

const LOCAL_BOOTSTRAP_EMAIL = 'owner@example.test';
const MEMBER_PATH =
  /^\/api\/household\/members\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const PANTRY_ITEM_PATH =
  /^\/api\/pantry\/items\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const RECIPE_PATH =
  /^\/api\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

const RECIPE_PREFERENCES_PATH =
  /^\/api\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/preferences$/iu;

const RECIPE_IMPORT_PATH = '/api/recipes/import-preview';
const MEAL_PLAN_PATH = '/api/meal-plan';
const MEAL_PLAN_ENTRIES_PATH = '/api/meal-plan/entries';
const MEAL_PLAN_SUGGESTIONS_PATH = '/api/meal-plan/suggestions';
const MEAL_PLAN_ENTRY_PATH =
  /^\/api\/meal-plan\/entries\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
/** Any segment: validation, not the router, explains a date that is wrong. */
const MEAL_PLAN_WEEK_PATH = /^\/api\/meal-plan\/weeks\/([^/]+)$/u;

// A recipe at every bound is about 134,000 code points; at up to four UTF-8
// bytes each plus JSON framing it stays under 1 MiB. Other routes keep 8 KiB.
const RECIPE_MAX_JSON_BYTES = 1024 * 1024;

// A full week names 126 entries by ID and version, about 7.6 KB of JSON: too
// close to the default 8 KiB, so clearing a week allows 16 KiB.
const MEAL_PLAN_CLEAR_MAX_JSON_BYTES = 16 * 1024;

/**
 * What the member is told about a failed import. Each class says something
 * different and useful, and none of them repeats the URL, names the site's
 * response, or quotes the page.
 */
const IMPORT_FAILURE_MESSAGES: Readonly<Record<RecipeImportFailure, string>> = {
  unsafe_destination:
    'That link cannot be imported. Import works only with https links to a page on one of the supported recipe sites.',
  source_unavailable:
    'The recipe site did not answer. It may be unavailable right now; try again later or enter the recipe yourself.',
  unsupported_source:
    'That page does not publish recipe details this app can read. Enter the recipe yourself instead.',
  too_large:
    'That page is too large to read. Enter the recipe yourself instead.',
  timeout:
    'The recipe site took too long to answer. Try again, or enter the recipe yourself.',
};

/**
 * A refused destination is the member's request to fix; an unreadable page is
 * this application's limitation; the rest happened at the far end, which is
 * what `502` and `504` are for.
 */
const IMPORT_FAILURE_STATUS: Readonly<Record<RecipeImportFailure, number>> = {
  unsafe_destination: 400,
  unsupported_source: 422,
  source_unavailable: 502,
  too_large: 502,
  timeout: 504,
};

const toReadySession = (member: MemberContext): SessionResponse => ({
  status: 'ready',
  member: { id: member.memberId, email: member.email, role: member.role },
  household: { id: member.householdId, name: member.householdName },
});

const bootstrapEmail = (env: AppEnv): string => {
  const configured =
    env.APP_ENV === 'local'
      ? (env.BOOTSTRAP_OWNER_EMAIL ?? LOCAL_BOOTSTRAP_EMAIL)
      : env.BOOTSTRAP_OWNER_EMAIL;
  if (!configured) {
    throw new ApiError(
      503,
      'service_unavailable',
      'Family setup is temporarily unavailable.',
    );
  }
  const normalized = normalizeEmail(configured);
  if (!isValidEmail(normalized)) {
    throw new ApiError(
      503,
      'service_unavailable',
      'Family setup is temporarily unavailable.',
    );
  }
  return normalized;
};

const requireHouseholdName = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw invalidRequest('Household name must be a string.');
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw invalidRequest('Household name must be between 1 and 80 characters.');
  }
  return name;
};

const requirePantryName = (
  value: unknown,
): { displayName: string; normalizedName: string } => {
  if (typeof value !== 'string') {
    throw invalidRequest('Item name must be a string.');
  }
  const displayName = cleanPantryDisplayName(value);
  const normalizedName = normalizePantryName(value);
  if (!isValidPantryName(normalizedName)) {
    throw invalidRequest(
      `Enter an item name between 1 and ${PANTRY_NAME_MAX_LENGTH} characters.`,
    );
  }
  return { displayName, normalizedName };
};

const requirePantryStatus = (value: unknown): PantryStatus => {
  if (!isPantryStatus(value)) {
    throw invalidRequest('Status must be available, low, or needed.');
  }
  return value;
};

const requireVersion = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidRequest('Version must be a positive whole number.');
  }
  return value;
};

const requireRole = (value: unknown): MemberRole => {
  if (value !== 'owner' && value !== 'member') {
    throw invalidRequest('Role must be owner or member.');
  }
  return value;
};

const handleSession = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  const identity = await identityProvider(request, env);
  const member = await resolveMemberContext(env.DB, identity);
  if (member) return json(toReadySession(member));

  if (!(await installationExists(env.DB))) {
    const body: SessionResponse =
      identity.email === bootstrapEmail(env)
        ? { status: 'setup-required' }
        : { status: 'not-a-member' };
    return json(body);
  }

  const body: SessionResponse = { status: 'not-a-member' };
  return json(body);
};

const handleBootstrap = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  requireMutationHeaders(request);
  const identity = await identityProvider(request, env);
  if (identity.email !== bootstrapEmail(env)) {
    throw new ApiError(
      403,
      'not_a_member',
      'This identity cannot set up the family space.',
    );
  }

  const input = await readJsonObject(request);
  requireExactFields(input, ['householdName']);
  const requestBody: BootstrapRequest = {
    householdName: requireHouseholdName(input.householdName),
  };
  const member = await bootstrapHousehold(
    env.DB,
    identity,
    requestBody.householdName,
  );
  return json(toReadySession(member), { status: 201 });
};

const requireMemberForRequest = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<MemberContext> => {
  const identity = await identityProvider(request, env);
  return requireMemberContext(env.DB, identity);
};

const requireOwnerForRequest = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<MemberContext> =>
  requireOwner(await requireMemberForRequest(request, env, identityProvider));

const handleMembersCollection = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  if (request.method === 'GET') {
    const owner = await requireOwnerForRequest(request, env, identityProvider);
    const body: HouseholdMembersResponse = {
      members: await listMembers(env.DB, owner.householdId),
    };
    return json(body);
  }

  if (request.method === 'POST') {
    requireMutationHeaders(request);
    const owner = await requireOwnerForRequest(request, env, identityProvider);
    const input = await readJsonObject(request);
    requireExactFields(input, ['email']);
    const requestBody: AddHouseholdMemberRequest = {
      email: requireNormalizedEmail(input.email),
    };
    const result = await addMember(
      env.DB,
      owner.householdId,
      requestBody.email,
    );
    const body: HouseholdMemberResponse = { member: result.member };
    return json(body, { status: result.created ? 201 : 200 });
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

const handleMember = async (
  request: Request,
  env: AppEnv,
  memberId: string,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  requireMutationHeaders(request);
  const owner = await requireOwnerForRequest(request, env, identityProvider);

  if (request.method === 'PATCH') {
    const input = await readJsonObject(request);
    const keys = Object.keys(input);
    if (keys.length !== 1 || (keys[0] !== 'role' && keys[0] !== 'status')) {
      throw invalidRequest('Provide exactly one of role or status.');
    }

    const member =
      keys[0] === 'role'
        ? await changeMemberRole(
            env.DB,
            owner.householdId,
            memberId,
            requireRole(input.role),
          )
        : await changeMemberStatus(
            env.DB,
            owner.householdId,
            memberId,
            input.status === 'active' || input.status === 'revoked'
              ? input.status
              : (() => {
                  throw invalidRequest('Status must be active or revoked.');
                })(),
          );
    const body: HouseholdMemberResponse = { member };
    return json(body);
  }

  if (request.method === 'DELETE') {
    await deleteMember(env.DB, owner.householdId, memberId);
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

// Every active member shares the pantry; owner role is not required here.
const handlePantryCollection = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  if (request.method === 'GET') {
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const body: PantryItemsResponse = {
      items: await listPantryItems(env.DB, member.householdId),
    };
    return json(body);
  }

  if (request.method === 'POST') {
    requireMutationHeaders(request);
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const input = await readJsonObject(request);
    requireExactFields(input, ['name', 'status']);
    const { displayName, normalizedName } = requirePantryName(input.name);
    const item = await createPantryItem(
      env.DB,
      member.householdId,
      displayName,
      normalizedName,
      requirePantryStatus(input.status),
    );
    const body: PantryItemResponse = { item };
    return json(body, { status: 201 });
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

const readPantryChange = (input: Record<string, unknown>): PantryItemChange => {
  const allowed = ['version', 'name', 'status'];
  const keys = Object.keys(input);
  if (
    !Object.hasOwn(input, 'version') ||
    keys.length < 2 ||
    keys.some((key) => !allowed.includes(key))
  ) {
    throw invalidRequest('Provide version and at least one of name or status.');
  }

  const change: PantryItemChange = {};
  if (Object.hasOwn(input, 'name')) {
    const { displayName, normalizedName } = requirePantryName(input.name);
    change.displayName = displayName;
    change.normalizedName = normalizedName;
  }
  if (Object.hasOwn(input, 'status')) {
    change.status = requirePantryStatus(input.status);
  }
  return change;
};

const handlePantryItem = async (
  request: Request,
  env: AppEnv,
  itemId: string,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  requireMutationHeaders(request);
  const member = await requireMemberForRequest(request, env, identityProvider);
  const input = await readJsonObject(request);

  if (request.method === 'PATCH') {
    const item = await updatePantryItem(
      env.DB,
      member.householdId,
      itemId,
      requireVersion(input.version),
      readPantryChange(input),
    );
    const body: PantryItemResponse = { item };
    return json(body);
  }

  if (request.method === 'DELETE') {
    requireExactFields(input, ['version']);
    await deletePantryItem(
      env.DB,
      member.householdId,
      itemId,
      requireVersion(input.version),
    );
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

const noContent = (): Response =>
  new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

/** Turns shared validation errors into one 400 without echoing input. */
const requireValid = <T>(
  result:
    | { ok: true; value: T }
    | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) {
    throw invalidRequest(result.errors.map((error) => error.message).join(' '));
  }
  return result.value;
};

// Every active member shares the recipe library; owner role is not required.
const handleRecipesCollection = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  if (request.method === 'GET') {
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const body: RecipesResponse = {
      recipes: await listRecipes(env.DB, member.householdId),
    };
    return json(body);
  }

  if (request.method === 'POST') {
    requireMutationHeaders(request);
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const input = await readJsonObject(request, RECIPE_MAX_JSON_BYTES);
    const recipe = await createRecipe(
      env.DB,
      member.householdId,
      requireValid(validateCreateRecipe(input)),
    );
    const body: RecipeResponse = { recipe };
    return json(body, { status: 201 });
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

/**
 * `POST /api/recipes/import-preview`. It has the same identity, membership,
 * same-origin, and JSON boundary as every other recipe mutation, but it
 * writes nothing: the member reviews the draft and saves it through the
 * ordinary create route, or discards it by leaving.
 */
const handleRecipeImportPreview = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
  importFetch: ImportFetch,
): Promise<Response> => {
  if (request.method !== 'POST') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  requireMutationHeaders(request);
  // Authorize first: an identity that is not an active member never causes an
  // outbound request to anyone.
  await requireMemberForRequest(request, env, identityProvider);

  const input = await readJsonObject(request);
  requireExactFields(input, ['url']);
  if (typeof input.url !== 'string') {
    throw invalidRequest('Send the recipe page link as text.');
  }
  const requestBody: RecipeImportPreviewRequest = { url: input.url };

  const result = await importRecipePreview(requestBody.url, {
    fetcher: importFetch,
  });
  if (!result.ok) {
    throw new ApiError(
      IMPORT_FAILURE_STATUS[result.reason],
      'import_failed',
      IMPORT_FAILURE_MESSAGES[result.reason],
      { reason: result.reason },
    );
  }
  return json(result.preview);
};

const handleRecipe = async (
  request: Request,
  env: AppEnv,
  recipeId: string,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method === 'GET') {
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const recipe = await getRecipe(env.DB, member.householdId, recipeId);
    if (!recipe) {
      throw new ApiError(404, 'not_found', 'That recipe no longer exists.');
    }
    const body: RecipeDetailResponse = {
      recipe,
      preferences: await getRecipePreferences(
        env.DB,
        member.householdId,
        recipe.id,
        clock(),
      ),
    };
    return json(body);
  }

  if (request.method === 'PATCH') {
    requireMutationHeaders(request);
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const input = await readJsonObject(request, RECIPE_MAX_JSON_BYTES);
    const recipe = await updateRecipe(
      env.DB,
      member.householdId,
      recipeId,
      requireValid(validateUpdateRecipe(input)),
    );
    const body: RecipeResponse = { recipe };
    return json(body);
  }

  if (request.method === 'DELETE') {
    requireMutationHeaders(request);
    const member = await requireMemberForRequest(
      request,
      env,
      identityProvider,
    );
    const input = await readJsonObject(request);
    requireExactFields(input, ['version']);
    const version = validateRecipeVersion(input.version);
    if (!version.ok) throw invalidRequest(version.message);
    await deleteRecipe(env.DB, member.householdId, recipeId, version.value);
    return noContent();
  }

  throw new ApiError(404, 'not_found', 'Not found.');
};

/**
 * `PUT /api/recipes/{id}/preferences`: sets or clears the household's
 * favourite or "Not now" for one of its recipes (the #78 design). The recipe
 * itself and its version are never changed.
 */
const handleRecipePreferences = async (
  request: Request,
  env: AppEnv,
  recipeId: string,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method !== 'PUT') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  requireMutationHeaders(request);
  const member = await requireMemberForRequest(request, env, identityProvider);
  const change = validateRecipePreferenceChange(await readJsonObject(request));
  if (!change.ok) throw invalidRequest(change.message);
  const body: RecipePreferencesResponse = {
    preferences: await setRecipePreference(
      env.DB,
      member.householdId,
      recipeId.toLowerCase(),
      change.value,
      clock(),
    ),
  };
  return json(body);
};

// Every active member shares the plan; owner role is not required. Household
// scope always comes from the verified member, never from the request.
const handleMealPlan = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<Response> => {
  if (request.method !== 'GET') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  const member = await requireMemberForRequest(request, env, identityProvider);
  const range = requireValid(
    validateMealPlanRange(new URL(request.url).searchParams),
  );
  const body: MealPlanResponse = {
    ...range,
    ...(await readMealPlan(env.DB, member.householdId, range.from, range.to)),
  };
  return json(body);
};

/**
 * Read-only: ranks the household's own recipes for one meal date (the #73
 * design). Membership is checked before the query and before any household
 * statement; nothing is written and nothing leaves the Worker.
 */
const handleMealSuggestions = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method !== 'GET') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  const member = await requireMemberForRequest(request, env, identityProvider);
  const { date } = requireValid(
    validateSuggestionQuery(new URL(request.url).searchParams, clock()),
  );
  const body: MealSuggestionsResponse = {
    suggestions: rankMealSuggestions(
      await readSuggestionInput(env.DB, member.householdId, date, clock()),
    ),
  };
  return json(body);
};

const handleMealPlanEntries = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method !== 'POST') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  requireMutationHeaders(request);
  const member = await requireMemberForRequest(request, env, identityProvider);
  const input = await readJsonObject(request);
  const now = clock();
  const entry = await createMealPlanEntry(
    env.DB,
    member.householdId,
    requireValid(
      validateCreateMealPlanEntry(input, serverPlanWriteWindow(now)),
    ),
    now,
  );
  const body: MealPlanEntryResponse = { entry };
  return json(body, { status: 201 });
};

const handleMealPlanEntry = async (
  request: Request,
  env: AppEnv,
  entryId: string,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method !== 'PATCH' && request.method !== 'DELETE') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  requireMutationHeaders(request);
  const member = await requireMemberForRequest(request, env, identityProvider);
  const input = await readJsonObject(request);

  if (request.method === 'PATCH') {
    const now = clock();
    const window = serverPlanWriteWindow(now);
    const entry = await updateMealPlanEntry(
      env.DB,
      member.householdId,
      entryId,
      requireValid(validateUpdateMealPlanEntry(input)),
      (date) => isWithinPlanWindow(date, window),
      now,
    );
    const body: MealPlanEntryResponse = { entry };
    return json(body);
  }

  requireExactFields(input, ['version']);
  const version = validateMealPlanVersion(input.version);
  if (!version.ok) throw invalidRequest(version.message);
  await deleteMealPlanEntry(env.DB, member.householdId, entryId, version.value);
  return noContent();
};

// Clears one ended week, only as the member saw it (the #56 design).
const handleMealPlanWeek = async (
  request: Request,
  env: AppEnv,
  weekStart: string,
  identityProvider: IdentityProvider,
  clock: Clock,
): Promise<Response> => {
  if (request.method !== 'DELETE') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }
  requireMutationHeaders(request);
  const member = await requireMemberForRequest(request, env, identityProvider);
  const input = await readJsonObject(request, MEAL_PLAN_CLEAR_MAX_JSON_BYTES);
  await clearMealPlanWeek(
    env.DB,
    member.householdId,
    requireValid(
      validateClearMealPlanWeek(
        weekStart,
        input,
        utcPlanDate(clock()),
        MEAL_PLAN_SERVER_SLACK_DAYS,
      ),
    ),
  );
  return noContent();
};

const route = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
  importFetch: ImportFetch,
  clock: Clock,
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === '/api/health' && request.method === 'GET') {
    const body: HealthResponse = {
      status: 'ok',
      environment: env.APP_ENV,
      service: 'family-meal-planner',
    };
    return json(body);
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    return handleSession(request, env, identityProvider);
  }

  if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
    return handleBootstrap(request, env, identityProvider);
  }

  if (url.pathname === '/api/household/members') {
    return handleMembersCollection(request, env, identityProvider);
  }

  const memberMatch = url.pathname.match(MEMBER_PATH);
  if (memberMatch) {
    return handleMember(request, env, memberMatch[1], identityProvider);
  }

  if (url.pathname === '/api/pantry/items') {
    return handlePantryCollection(request, env, identityProvider);
  }

  const pantryMatch = url.pathname.match(PANTRY_ITEM_PATH);
  if (pantryMatch) {
    return handlePantryItem(request, env, pantryMatch[1], identityProvider);
  }

  if (url.pathname === '/api/recipes') {
    return handleRecipesCollection(request, env, identityProvider);
  }

  if (url.pathname === RECIPE_IMPORT_PATH) {
    return handleRecipeImportPreview(
      request,
      env,
      identityProvider,
      importFetch,
    );
  }

  const recipeMatch = RECIPE_PATH.exec(url.pathname);
  if (recipeMatch) {
    return handleRecipe(request, env, recipeMatch[1], identityProvider, clock);
  }

  const preferencesMatch = RECIPE_PREFERENCES_PATH.exec(url.pathname);
  if (preferencesMatch) {
    return handleRecipePreferences(
      request,
      env,
      preferencesMatch[1],
      identityProvider,
      clock,
    );
  }

  if (url.pathname === MEAL_PLAN_PATH) {
    return handleMealPlan(request, env, identityProvider);
  }

  if (url.pathname === MEAL_PLAN_SUGGESTIONS_PATH) {
    return handleMealSuggestions(request, env, identityProvider, clock);
  }

  if (url.pathname === MEAL_PLAN_ENTRIES_PATH) {
    return handleMealPlanEntries(request, env, identityProvider, clock);
  }

  const entryMatch = MEAL_PLAN_ENTRY_PATH.exec(url.pathname);
  if (entryMatch) {
    return handleMealPlanEntry(
      request,
      env,
      entryMatch[1],
      identityProvider,
      clock,
    );
  }

  const weekMatch = MEAL_PLAN_WEEK_PATH.exec(url.pathname);
  if (weekMatch) {
    return handleMealPlanWeek(
      request,
      env,
      weekMatch[1],
      identityProvider,
      clock,
    );
  }

  // The API boundary is unchanged: an unknown API path is still a JSON 404,
  // and never falls through to the shell.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    throw new ApiError(404, 'not_found', 'Not found.');
  }

  // Anything else reaching the Worker matched no static asset, so it belongs
  // to the client router. Serve the application shell so a deep link resolves
  // instead of returning a JSON error.
  //
  // Two deliberate limits: only read methods are answered this way, and the
  // shell is always fetched from "/" rather than the requested path, so this
  // branch can never be used to reach some other asset. The shell carries no
  // household data; every value still comes from an authorised API call.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new ApiError(404, 'not_found', 'Not found.');
  }

  return env.ASSETS.fetch(
    new Request(new URL('/', url), { method: request.method }),
  );
};

/**
 * The page fetcher is injected for the same reason the identity provider is:
 * a test must be able to answer an import without any real site being
 * contacted. The deployed Worker uses the runtime's own `fetch`. The clock is
 * injected so a test can place the plan's write window deterministically.
 */
export const createWorker = (
  identityProvider: IdentityProvider = getVerifiedIdentity,
  importFetch: ImportFetch = (url, init) => fetch(url, init),
  clock: Clock = () => new Date(),
) =>
  ({
    async fetch(request: Request, env: AppEnv): Promise<Response> {
      try {
        return await route(request, env, identityProvider, importFetch, clock);
      } catch (error) {
        if (error instanceof ApiError) return errorResponse(error);
        return errorResponse(
          new ApiError(
            503,
            'service_unavailable',
            'The service is temporarily unavailable.',
          ),
        );
      }
    },
  }) satisfies ExportedHandler<AppEnv>;

export default createWorker();
