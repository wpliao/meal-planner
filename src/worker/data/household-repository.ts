import type {
  HouseholdMember,
  MemberRole,
  MemberStatus,
} from '../../shared/api';
import type { VerifiedIdentity } from '../auth/types';
import { ApiError, stateConflict } from '../errors';

export interface MemberContext {
  memberId: string;
  householdId: string;
  householdName: string;
  email: string;
  role: MemberRole;
}

interface MemberContextRow {
  member_id: string;
  household_id: string;
  household_name: string;
  normalized_email: string;
  role: MemberRole;
}

interface MemberRow {
  id: string;
  normalized_email: string;
  role: MemberRole;
  status: MemberStatus;
  access_subject: string | null;
}

const CONTEXT_SELECT = `
  SELECT hm.id AS member_id,
         hm.household_id,
         h.name AS household_name,
         hm.normalized_email,
         hm.role
    FROM household_members hm
    JOIN households h ON h.id = hm.household_id
   WHERE hm.access_subject = ?
     AND hm.status = 'active'
`;

const toContext = (row: MemberContextRow): MemberContext => ({
  memberId: row.member_id,
  householdId: row.household_id,
  householdName: row.household_name,
  email: row.normalized_email,
  role: row.role,
});

const toMember = (row: MemberRow): HouseholdMember => ({
  id: row.id,
  email: row.normalized_email,
  role: row.role,
  status: row.status,
});

const getContextBySubject = async (
  db: D1Database,
  subject: string,
): Promise<MemberContext | null> => {
  const row = await db
    .prepare(CONTEXT_SELECT)
    .bind(subject)
    .first<MemberContextRow>();
  return row ? toContext(row) : null;
};

export const resolveMemberContext = async (
  db: D1Database,
  identity: VerifiedIdentity,
): Promise<MemberContext | null> => {
  const existing = await getContextBySubject(db, identity.subject);
  if (existing) return existing;

  const now = new Date().toISOString();
  try {
    const activation = await db
      .prepare(
        `UPDATE household_members
            SET access_subject = ?,
                status = 'active',
                activated_at = ?,
                revoked_at = NULL,
                updated_at = ?
          WHERE normalized_email = ?
            AND status = 'invited'
            AND access_subject IS NULL`,
      )
      .bind(identity.subject, now, now, identity.email)
      .run();

    if (activation.meta.changes > 0) {
      return getContextBySubject(db, identity.subject);
    }
  } catch {
    // A competing activation can make this conditional update lose its race.
  }

  // A concurrent request for the same identity may have activated this
  // invitation after the initial lookup but before this update completed.
  return getContextBySubject(db, identity.subject);
};

export const installationExists = async (db: D1Database): Promise<boolean> =>
  (await db
    .prepare('SELECT singleton_id FROM app_installation WHERE singleton_id = 1')
    .first()) !== null;

export const bootstrapHousehold = async (
  db: D1Database,
  identity: VerifiedIdentity,
  householdName: string,
): Promise<MemberContext> => {
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO households (id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(householdId, householdName, now, now),
      db
        .prepare(
          `INSERT INTO app_installation (singleton_id, household_id, created_at)
           VALUES (1, ?, ?)`,
        )
        .bind(householdId, now),
      db
        .prepare(
          `INSERT INTO household_members (
             id, household_id, normalized_email, access_subject, role, status,
             invited_at, activated_at, revoked_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?, NULL, ?, ?)`,
        )
        .bind(
          memberId,
          householdId,
          identity.email,
          identity.subject,
          now,
          now,
          now,
          now,
        ),
    ]);
  } catch {
    throw stateConflict('The family space has already been set up.');
  }

  return {
    memberId,
    householdId,
    householdName,
    email: identity.email,
    role: 'owner',
  };
};

export const listMembers = async (
  db: D1Database,
  householdId: string,
): Promise<HouseholdMember[]> => {
  const result = await db
    .prepare(
      `SELECT id, normalized_email, role, status, access_subject
         FROM household_members
        WHERE household_id = ?
        ORDER BY normalized_email, id`,
    )
    .bind(householdId)
    .all<MemberRow>();
  return result.results.map(toMember);
};

export const addMember = async (
  db: D1Database,
  householdId: string,
  email: string,
): Promise<{ member: HouseholdMember; created: boolean }> => {
  const existing = await db
    .prepare(
      `SELECT id, normalized_email, role, status, access_subject
         FROM household_members
        WHERE household_id = ? AND normalized_email = ?`,
    )
    .bind(householdId, email)
    .first<MemberRow>();

  if (existing) {
    if (existing.status === 'invited') {
      return { member: toMember(existing), created: false };
    }
    throw stateConflict('That person already has a membership.');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO household_members (
           id, household_id, normalized_email, access_subject, role, status,
           invited_at, activated_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, 'member', 'invited', ?, NULL, NULL, ?, ?)`,
      )
      .bind(id, householdId, email, now, now, now)
      .run();
  } catch {
    throw stateConflict('That person already has a membership.');
  }

  return {
    created: true,
    member: { id, email, role: 'member', status: 'invited' },
  };
};

const getScopedMember = async (
  db: D1Database,
  householdId: string,
  memberId: string,
): Promise<MemberRow | null> =>
  db
    .prepare(
      `SELECT id, normalized_email, role, status, access_subject
         FROM household_members
        WHERE household_id = ? AND id = ?`,
    )
    .bind(householdId, memberId)
    .first<MemberRow>();

const requireChangedMember = async (
  db: D1Database,
  householdId: string,
  memberId: string,
  changes: number,
): Promise<HouseholdMember> => {
  const member = await getScopedMember(db, householdId, memberId);
  if (!member) {
    throw new ApiError(404, 'not_found', 'Member not found.');
  }
  if (changes === 0) {
    throw stateConflict('The member cannot be changed in the current state.');
  }
  return toMember(member);
};

export const changeMemberRole = async (
  db: D1Database,
  householdId: string,
  memberId: string,
  role: MemberRole,
): Promise<HouseholdMember> => {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE household_members
          SET role = ?, updated_at = ?
        WHERE household_id = ?
          AND id = ?
          AND status = 'active'
          AND role <> ?
          AND (
            role <> 'owner'
            OR ? <> 'member'
            OR (SELECT COUNT(*)
                  FROM household_members owners
                 WHERE owners.household_id = ?
                   AND owners.role = 'owner'
                   AND owners.status = 'active') > 1
          )`,
    )
    .bind(role, now, householdId, memberId, role, role, householdId)
    .run();

  return requireChangedMember(db, householdId, memberId, result.meta.changes);
};

export const changeMemberStatus = async (
  db: D1Database,
  householdId: string,
  memberId: string,
  status: 'active' | 'revoked',
): Promise<HouseholdMember> => {
  const now = new Date().toISOString();
  const isRevoking = status === 'revoked';
  const result = await db
    .prepare(
      `UPDATE household_members
          SET status = ?,
              revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE NULL END,
              updated_at = ?
        WHERE household_id = ?
          AND id = ?
          AND access_subject IS NOT NULL
          AND status = ?
          AND (
            ? <> 'revoked'
            OR role <> 'owner'
            OR (SELECT COUNT(*)
                  FROM household_members owners
                 WHERE owners.household_id = ?
                   AND owners.role = 'owner'
                   AND owners.status = 'active') > 1
          )`,
    )
    .bind(
      status,
      status,
      now,
      now,
      householdId,
      memberId,
      isRevoking ? 'active' : 'revoked',
      status,
      householdId,
    )
    .run();

  return requireChangedMember(db, householdId, memberId, result.meta.changes);
};

export const deleteMember = async (
  db: D1Database,
  householdId: string,
  memberId: string,
): Promise<void> => {
  const result = await db
    .prepare(
      `DELETE FROM household_members
        WHERE household_id = ?
          AND id = ?
          AND status IN ('invited', 'revoked')`,
    )
    .bind(householdId, memberId)
    .run();

  if (result.meta.changes === 0) {
    const member = await getScopedMember(db, householdId, memberId);
    if (!member) throw new ApiError(404, 'not_found', 'Member not found.');
    throw stateConflict('Active members must be revoked before deletion.');
  }
};
