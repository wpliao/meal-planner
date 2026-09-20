import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';

import { ApiError } from '../errors';
import { isValidEmail, normalizeEmail } from './email';
import type { IdentityEnv, VerifiedIdentity } from './types';

const ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';
const LOCAL_IDENTITY: VerifiedIdentity = {
  subject: 'local-owner',
  email: 'owner@example.test',
};

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

const invalidIdentity = (): ApiError =>
  new ApiError(401, 'invalid_identity', 'A valid user identity is required.');

const unavailable = (): ApiError =>
  new ApiError(
    503,
    'service_unavailable',
    'Identity verification is temporarily unavailable.',
  );

const isKeyServiceFailure = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  if (!(error instanceof joseErrors.JOSEError)) return false;

  return [
    'ERR_JOSE_GENERIC',
    'ERR_JWK_INVALID',
    'ERR_JWKS_INVALID',
    'ERR_JWKS_TIMEOUT',
  ].includes(error.code);
};

const configuredIssuer = (env: IdentityEnv): string => {
  if (!env.CF_ACCESS_TEAM_DOMAIN) {
    throw unavailable();
  }

  try {
    const url = new URL(env.CF_ACCESS_TEAM_DOMAIN);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      throw new Error('Invalid team domain');
    }
    return url.origin;
  } catch {
    throw unavailable();
  }
};

const remoteKeysFor = (issuer: string): JWTVerifyGetKey => {
  const existing = remoteKeySets.get(issuer);
  if (existing) return existing;

  const keys = createRemoteJWKSet(
    new URL('/cdn-cgi/access/certs', `${issuer}/`),
  );
  remoteKeySets.set(issuer, keys);
  return keys;
};

export interface VerifyAccessIdentityOptions {
  keySet?: JWTVerifyGetKey;
  now?: number;
}

export const verifyAccessIdentity = async (
  request: Request,
  env: IdentityEnv,
  options: VerifyAccessIdentityOptions = {},
): Promise<VerifiedIdentity> => {
  const assertion = request.headers.get(ASSERTION_HEADER);
  if (!assertion) throw invalidIdentity();
  if (!env.CF_ACCESS_AUD) throw unavailable();

  const issuer = configuredIssuer(env);
  const now = options.now ?? Math.floor(Date.now() / 1000);

  try {
    const { payload } = await jwtVerify(
      assertion,
      options.keySet ?? remoteKeysFor(issuer),
      {
        algorithms: ['RS256'],
        audience: env.CF_ACCESS_AUD,
        issuer,
        clockTolerance: 5,
        currentDate: new Date(now * 1000),
      },
    );

    if (
      payload.type !== 'app' ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      payload.iat > now + 5
    ) {
      throw invalidIdentity();
    }

    const email = normalizeEmail(payload.email);
    if (!isValidEmail(email)) throw invalidIdentity();

    return { subject: payload.sub, email };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isKeyServiceFailure(error)) {
      throw unavailable();
    }
    throw invalidIdentity();
  }
};

export const getVerifiedIdentity = (
  request: Request,
  env: IdentityEnv,
): Promise<VerifiedIdentity> => {
  if (env.APP_ENV === 'local') return Promise.resolve(LOCAL_IDENTITY);
  return verifyAccessIdentity(request, env);
};
