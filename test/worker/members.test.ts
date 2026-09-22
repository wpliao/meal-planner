import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HouseholdMember } from '../../src/shared/api';
import {
  changeMemberRole,
  resolveMemberContext,
} from '../../src/worker/data/household-repository';
import { createWorker } from '../../src/worker/index';
import {
  applyMigrations,
  bootstrapOwner,
  fetchWorker,
  mutationInit,
  testEnv,
} from './helpers';

const memberIdentity = {
  subject: 'member-subject',
  email: 'member@example.test',
};

const requestAs = (
  identity: { subject: string; email: string },
  request: Request,
): Promise<Response> => {
  const worker = createWorker(() => Promise.resolve(identity));
  return worker.fetch(request, testEnv);
};

const addMember = async (
  email = memberIdentity.email,
): Promise<HouseholdMember> => {
  const response = await fetchWorker(
    new Request(
      'https://example.test/api/household/members',
      mutationInit('POST', { email }),
    ),
  );
  expect(response.status).toBe(201);
  const body: { member: HouseholdMember } = await response.json();
  return body.member;
};

const patchMember = (
  memberId: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  fetchWorker(
    new Request(
      `https://example.test/api/household/members/${memberId}`,
      mutationInit('PATCH', body),
    ),
  );

describe('household member APIs', () => {
  beforeEach(async () => {
    await applyMigrations();
    expect((await bootstrapOwner()).status).toBe(201);
  });

  it('lets an owner add and list a normalized invitation idempotently', async () => {
    const invited = await addMember('  Member@Example.test  ');
    expect(invited).toMatchObject({
      email: 'member@example.test',
      role: 'member',
      status: 'invited',
    });

    const duplicate = await fetchWorker(
      new Request(
        'https://example.test/api/household/members',
        mutationInit('POST', { email: 'member@example.test' }),
      ),
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ member: invited });

    const list = await fetchWorker(
      new Request('https://example.test/api/household/members'),
    );
    expect(list.status).toBe(200);
    const body: { members: HouseholdMember[] } = await list.json();
    const members = body.members;
    expect(members).toHaveLength(2);
    expect(members.every((member) => !('access_subject' in member))).toBe(true);
  });

  it('activates an invitation on first matching identity request', async () => {
    await addMember();
    const response = await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      member: { email: memberIdentity.email, role: 'member' },
    });
  });

  it('returns the activated membership to concurrent first requests', async () => {
    let initialLookups = 0;
    let activated = false;
    let releaseInitialLookups: (() => void) | undefined;
    const bothInitialLookups = new Promise<void>((resolve) => {
      releaseInitialLookups = resolve;
    });
    const row = {
      member_id: 'member-id',
      household_id: 'household-id',
      household_name: 'Liao Family',
      normalized_email: memberIdentity.email,
      role: 'member',
    };

    const racingDb = {
      prepare(sql: string) {
        if (sql.includes('FROM household_members hm')) {
          return {
            bind() {
              return {
                async first() {
                  initialLookups += 1;
                  if (initialLookups <= 2) {
                    if (initialLookups === 2) releaseInitialLookups?.();
                    await bothInitialLookups;
                    return null;
                  }
                  return activated ? row : null;
                },
              };
            },
          };
        }

        return {
          bind() {
            return {
              run() {
                if (activated) {
                  return Promise.resolve({ meta: { changes: 0 } });
                }
                activated = true;
                return Promise.resolve({ meta: { changes: 1 } });
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const contexts = await Promise.all([
      resolveMemberContext(racingDb, memberIdentity),
      resolveMemberContext(racingDb, memberIdentity),
    ]);

    expect(contexts).toEqual([
      {
        memberId: 'member-id',
        householdId: 'household-id',
        householdName: 'Liao Family',
        email: memberIdentity.email,
        role: 'member',
      },
      {
        memberId: 'member-id',
        householdId: 'household-id',
        householdName: 'Liao Family',
        email: memberIdentity.email,
        role: 'member',
      },
    ]);
  });

  it('denies non-members and regular members from owner operations', async () => {
    const denied = await requestAs(
      { subject: 'outsider', email: 'outsider@example.test' },
      new Request('https://example.test/api/household/members'),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: 'not_a_member' },
    });

    await addMember();
    await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    const memberDenied = await requestAs(
      memberIdentity,
      new Request('https://example.test/api/household/members'),
    );
    expect(memberDenied.status).toBe(403);
    await expect(memberDenied.json()).resolves.toMatchObject({
      error: { code: 'owner_required' },
    });
  });

  it('denies every member-management mutation to a regular member', async () => {
    const activeMember = await addMember();
    await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    const target = await addMember('target@example.test');
    const requests = [
      new Request(
        'https://example.test/api/household/members',
        mutationInit('POST', { email: 'another@example.test' }),
      ),
      new Request(
        `https://example.test/api/household/members/${target.id}`,
        mutationInit('PATCH', { role: 'owner' }),
      ),
      new Request(
        `https://example.test/api/household/members/${target.id}`,
        mutationInit('DELETE'),
      ),
    ];

    expect(activeMember.status).toBe('invited');
    for (const request of requests) {
      const response = await requestAs(memberIdentity, request);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'owner_required' },
      });
    }
  });

  it('supports role, revocation, reactivation, and immediate denial', async () => {
    const invited = await addMember();
    await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );

    const promoted = await patchMember(invited.id, { role: 'owner' });
    expect(promoted.status).toBe(200);
    await expect(promoted.json()).resolves.toMatchObject({
      member: { role: 'owner', status: 'active' },
    });

    const revoked = await patchMember(invited.id, { status: 'revoked' });
    expect(revoked.status).toBe(200);

    const nextRequest = await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    await expect(nextRequest.json()).resolves.toEqual({
      status: 'not-a-member',
    });

    const reactivated = await patchMember(invited.id, { status: 'active' });
    expect(reactivated.status).toBe(200);
    await expect(reactivated.json()).resolves.toMatchObject({
      member: { role: 'owner', status: 'active' },
    });
  });

  it('protects the final active owner from demotion and revocation', async () => {
    const session = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    const body: { member: { id: string } } = await session.json();
    const ownerId = body.member.id;

    expect((await patchMember(ownerId, { role: 'member' })).status).toBe(409);
    expect((await patchMember(ownerId, { status: 'revoked' })).status).toBe(
      409,
    );
  });

  it('transfers ownership only after an active successor confirms owner access', async () => {
    const initialSession = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    const initial: { member: { id: string } } = await initialSession.json();
    const successor = await addMember();

    expect((await patchMember(successor.id, { role: 'owner' })).status).toBe(
      409,
    );
    expect(
      (
        await requestAs(
          memberIdentity,
          new Request('https://example.test/api/session'),
        )
      ).status,
    ).toBe(200);
    expect((await patchMember(successor.id, { role: 'owner' })).status).toBe(
      200,
    );

    const successorOwnerView = await requestAs(
      memberIdentity,
      new Request('https://example.test/api/household/members'),
    );
    expect(successorOwnerView.status).toBe(200);
    const successorView: { members: HouseholdMember[] } =
      await successorOwnerView.json();
    expect(
      successorView.members.find((member) => member.id === successor.id),
    ).toMatchObject({ role: 'owner' });

    expect(
      (await patchMember(initial.member.id, { role: 'member' })).status,
    ).toBe(200);
    expect(
      (
        await fetchWorker(
          new Request('https://example.test/api/household/members'),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await requestAs(
          memberIdentity,
          new Request('https://example.test/api/household/members'),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await requestAs(
          memberIdentity,
          new Request(
            `https://example.test/api/household/members/${successor.id}`,
            mutationInit('PATCH', { role: 'member' }),
          ),
        )
      ).status,
    ).toBe(409);
  });

  it('preserves an active owner under concurrent owner demotions', async () => {
    const session = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    const ownerSession: {
      member: { id: string };
      household: { id: string };
    } = await session.json();
    const secondOwner = await addMember();
    await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    expect((await patchMember(secondOwner.id, { role: 'owner' })).status).toBe(
      200,
    );

    const outcomes = await Promise.allSettled([
      changeMemberRole(
        testEnv.DB,
        ownerSession.household.id,
        ownerSession.member.id,
        'member',
      ),
      changeMemberRole(
        testEnv.DB,
        ownerSession.household.id,
        secondOwner.id,
        'member',
      ),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);

    const activeOwners = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM household_members
        WHERE household_id = ? AND role = 'owner' AND status = 'active'`,
    )
      .bind(ownerSession.household.id)
      .first<{ count: number }>();
    expect(activeOwners?.count).toBe(1);
  });

  it('requires revocation before deletion and removes revoked identity data', async () => {
    const invited = await addMember();
    const deleteInvited = await fetchWorker(
      new Request(
        `https://example.test/api/household/members/${invited.id}`,
        mutationInit('DELETE'),
      ),
    );
    expect(deleteInvited.status).toBe(204);

    const active = await addMember();
    await requestAs(
      memberIdentity,
      new Request('https://example.test/api/session'),
    );
    const deleteActive = await fetchWorker(
      new Request(
        `https://example.test/api/household/members/${active.id}`,
        mutationInit('DELETE'),
      ),
    );
    expect(deleteActive.status).toBe(409);

    expect((await patchMember(active.id, { status: 'revoked' })).status).toBe(
      200,
    );
    const deleteRevoked = await fetchWorker(
      new Request(
        `https://example.test/api/household/members/${active.id}`,
        mutationInit('DELETE'),
      ),
    );
    expect(deleteRevoked.status).toBe(204);
    const stored = await testEnv.DB.prepare(
      'SELECT normalized_email, access_subject FROM household_members WHERE id = ?',
    )
      .bind(active.id)
      .first();
    expect(stored).toBeNull();
  });

  it('keeps target operations scoped to the actor household', async () => {
    const now = new Date().toISOString();
    const otherHousehold = crypto.randomUUID();
    const otherMember = crypto.randomUUID();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'Other Family', ?, ?)`,
      ).bind(otherHousehold, now, now),
      testEnv.DB.prepare(
        `INSERT INTO household_members (
           id, household_id, normalized_email, access_subject, role, status,
           invited_at, activated_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, 'other@example.test', ?, 'member', 'active', ?, ?, NULL, ?, ?)`,
      ).bind(otherMember, otherHousehold, 'other-subject', now, now, now, now),
    ]);

    const crossHousehold = await patchMember(otherMember, {
      status: 'revoked',
    });
    expect(crossHousehold.status).toBe(404);
    const row = await testEnv.DB.prepare(
      `SELECT status FROM household_members
        WHERE household_id = ? AND id = ?`,
    )
      .bind(otherHousehold, otherMember)
      .first<{ status: string }>();
    expect(row?.status).toBe('active');
  });

  it('rejects malformed patches and cross-origin member mutations', async () => {
    const invited = await addMember();
    expect(
      (await patchMember(invited.id, { role: 'owner', status: 'active' }))
        .status,
    ).toBe(400);

    const response = await fetchWorker(
      new Request(`https://example.test/api/household/members/${invited.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example',
        },
        body: JSON.stringify({ status: 'revoked' }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('does not log member identity data during requests', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await addMember('private-person@example.test');

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
