import type { VerifiedIdentity } from './types';
import { ApiError } from '../errors';
import {
  resolveMemberContext,
  type MemberContext,
} from '../data/household-repository';

export const requireMemberContext = async (
  db: D1Database,
  identity: VerifiedIdentity,
): Promise<MemberContext> => {
  const member = await resolveMemberContext(db, identity);
  if (!member) {
    throw new ApiError(
      403,
      'not_a_member',
      'This identity is not an active family member.',
    );
  }
  return member;
};

export const requireOwner = (member: MemberContext): MemberContext => {
  if (member.role !== 'owner') {
    throw new ApiError(403, 'owner_required', 'Owner access is required.');
  }
  return member;
};
