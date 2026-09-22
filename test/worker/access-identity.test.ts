import {
  createRemoteJWKSet,
  createLocalJWKSet,
  customFetch,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  getVerifiedIdentity,
  verifyAccessIdentity,
} from '../../src/worker/auth/access-identity';
import { ApiError } from '../../src/worker/errors';
import { createWorker } from '../../src/worker/index';
import { applyMigrations, testEnv } from './helpers';

const issuer = 'https://family.cloudflareaccess.com';
const audience = 'development-audience';
const now = 1_800_000_000;

describe('Cloudflare Access identity verification', () => {
  let privateKey: CryptoKey;
  let keySet: JWTVerifyGetKey;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const jwk: JWK = await exportJWK(keyPair.publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    keySet = createLocalJWKSet({ keys: [jwk] });
  });

  const token = async (claims: Record<string, unknown> = {}): Promise<string> =>
    new SignJWT({
      type: 'app',
      email: 'Owner@Example.test',
      iss: issuer,
      aud: audience,
      sub: 'access-subject',
      iat: now,
      exp: now + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(privateKey);

  const verify = async (assertion?: string) =>
    verifyAccessIdentity(
      new Request('https://example.test/api/session', {
        headers: assertion
          ? { 'Cf-Access-Jwt-Assertion': assertion }
          : undefined,
      }),
      {
        APP_ENV: 'development',
        CF_ACCESS_AUD: audience,
        CF_ACCESS_TEAM_DOMAIN: issuer,
      },
      { keySet, now },
    );

  const expectInvalid = async (assertion?: string): Promise<void> => {
    try {
      await verify(assertion);
      throw new Error('Expected identity verification to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 401, code: 'invalid_identity' });
    }
  };

  it('returns only a normalized subject and email for a valid user token', async () => {
    await expect(verify(await token())).resolves.toEqual({
      subject: 'access-subject',
      email: 'owner@example.test',
    });
  });

  it('rejects missing and malformed assertions', async () => {
    await expectInvalid();
    await expectInvalid('not-a-jwt');

    const otherKeyPair = await generateKeyPair('RS256');
    const wrongSignature = await new SignJWT({
      type: 'app',
      email: 'owner@example.test',
      iss: issuer,
      aud: audience,
      sub: 'access-subject',
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(otherKeyPair.privateKey);
    await expectInvalid(wrongSignature);
  });

  it('rejects expired and future tokens', async () => {
    await expectInvalid(await token({ exp: now - 10 }));
    await expectInvalid(await token({ nbf: now + 60 }));
    await expectInvalid(await token({ iat: now + 60 }));
  });

  it('rejects wrong issuer and audience claims', async () => {
    await expectInvalid(
      await token({ iss: 'https://other.cloudflareaccess.com' }),
    );
    await expectInvalid(await token({ aud: 'production-audience' }));
  });

  it('rejects service, missing-subject, and invalid-email identities', async () => {
    await expectInvalid(await token({ type: 'service' }));
    await expectInvalid(await token({ sub: '' }));
    await expectInvalid(await token({ email: 'not-an-email' }));
  });

  it('fails closed when required Access configuration is missing', async () => {
    const assertion = await token();
    await expect(
      verifyAccessIdentity(
        new Request('https://example.test/api/session', {
          headers: { 'Cf-Access-Jwt-Assertion': assertion },
        }),
        { APP_ENV: 'development' },
        { keySet, now },
      ),
    ).rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
  });

  it('fails closed when the signing key service is unavailable', async () => {
    const assertion = await token();
    await expect(
      verifyAccessIdentity(
        new Request('https://example.test/api/session', {
          headers: { 'Cf-Access-Jwt-Assertion': assertion },
        }),
        {
          APP_ENV: 'development',
          CF_ACCESS_AUD: audience,
          CF_ACCESS_TEAM_DOMAIN: issuer,
        },
        {
          keySet: () => Promise.reject(new TypeError('Network unavailable')),
          now,
        },
      ),
    ).rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
  });

  it.each([
    ['returns an upstream error', () => new Response(null, { status: 502 })],
    [
      'returns malformed JSON',
      () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'returns a malformed key set',
      () => Response.json({ keys: 'not-an-array' }),
    ],
  ])('returns 503 when the signing key service %s', async (_, response) => {
    const assertion = await token();
    const remoteKeySet = createRemoteJWKSet(
      new URL('https://keys.example.test/certs'),
      { [customFetch]: () => Promise.resolve(response()) },
    );

    await expect(
      verifyAccessIdentity(
        new Request('https://example.test/api/session', {
          headers: { 'Cf-Access-Jwt-Assertion': assertion },
        }),
        {
          APP_ENV: 'development',
          CF_ACCESS_AUD: audience,
          CF_ACCESS_TEAM_DOMAIN: issuer,
        },
        { keySet: remoteKeySet, now },
      ),
    ).rejects.toMatchObject({ status: 503, code: 'service_unavailable' });
  });

  it('keeps an unknown signing key classified as an invalid identity', async () => {
    const assertion = await token();
    const remoteKeySet = createRemoteJWKSet(
      new URL('https://keys.example.test/certs'),
      {
        [customFetch]: () => Promise.resolve(Response.json({ keys: [] })),
      },
    );

    await expect(
      verifyAccessIdentity(
        new Request('https://example.test/api/session', {
          headers: { 'Cf-Access-Jwt-Assertion': assertion },
        }),
        {
          APP_ENV: 'development',
          CF_ACCESS_AUD: audience,
          CF_ACCESS_TEAM_DOMAIN: issuer,
        },
        { keySet: remoteKeySet, now },
      ),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_identity' });
  });

  it('does not accept caller-supplied identity hints in a deployed environment', async () => {
    await applyMigrations();
    const worker = createWorker();
    const response = await worker.fetch(
      new Request('https://example.test/api/session?email=owner@example.test', {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'owner@example.test',
          'x-access-subject': 'local-owner',
          'x-user-email': 'owner@example.test',
        },
      }),
      {
        DB: testEnv.DB,
        UPLOADS: testEnv.UPLOADS,
        ASSETS: testEnv.ASSETS,
        APP_ENV: 'development',
        CF_ACCESS_TEAM_DOMAIN: 'https://dannyliao.cloudflareaccess.com',
        CF_ACCESS_AUD: audience,
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.test',
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_identity' },
    });
  });
  describe('identity adapter selection', () => {
    const deployed = ['development', 'production'] as const;

    it('uses the deterministic local identity only for the local environment', async () => {
      await expect(
        getVerifiedIdentity(new Request('https://example.test/api/session'), {
          APP_ENV: 'local',
        }),
      ).resolves.toStrictEqual({
        subject: 'local-owner',
        email: 'owner@example.test',
      });
    });

    it.each(deployed)(
      'never falls back to the local identity in the %s environment',
      async (appEnv) => {
        await expect(
          getVerifiedIdentity(new Request('https://example.test/api/session'), {
            APP_ENV: appEnv,
            CF_ACCESS_AUD: audience,
            CF_ACCESS_TEAM_DOMAIN: issuer,
          }),
        ).rejects.toMatchObject({ status: 401, code: 'invalid_identity' });
      },
    );

    it.each(deployed)(
      'fails closed in the %s environment when Access configuration is absent',
      async (appEnv) => {
        const assertion = await token();

        await expect(
          getVerifiedIdentity(
            new Request('https://example.test/api/session', {
              headers: { 'Cf-Access-Jwt-Assertion': assertion },
            }),
            { APP_ENV: appEnv },
          ),
        ).rejects.toMatchObject({
          status: 503,
          code: 'service_unavailable',
        });
      },
    );
  });
});
