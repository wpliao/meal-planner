import type {
  AddHouseholdMemberRequest,
  BootstrapRequest,
  HealthResponse,
  HouseholdMemberResponse,
  HouseholdMembersResponse,
  MemberRole,
  SessionResponse,
} from '../shared/api';
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
import { ApiError, invalidRequest } from './errors';
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

const LOCAL_BOOTSTRAP_EMAIL = 'owner@example.test';
const MEMBER_PATH =
  /^\/api\/household\/members\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

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

const requireOwnerForRequest = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
): Promise<MemberContext> => {
  const identity = await identityProvider(request, env);
  return requireOwner(await requireMemberContext(env.DB, identity));
};

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

const route = async (
  request: Request,
  env: AppEnv,
  identityProvider: IdentityProvider,
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

  throw new ApiError(404, 'not_found', 'Not found.');
};

export const createWorker = (
  identityProvider: IdentityProvider = getVerifiedIdentity,
) =>
  ({
    async fetch(request: Request, env: AppEnv): Promise<Response> {
      try {
        return await route(request, env, identityProvider);
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
