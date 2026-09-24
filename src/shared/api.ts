export interface HealthResponse {
  status: 'ok';
  environment: string;
  service: 'family-meal-planner';
}

export type MemberRole = 'owner' | 'member';
export type MemberStatus = 'invited' | 'active' | 'revoked';

export interface SessionMember {
  id: string;
  email: string;
  role: MemberRole;
}

export interface SessionHousehold {
  id: string;
  name: string;
}

export type SessionResponse =
  | {
      status: 'ready';
      member: SessionMember;
      household: SessionHousehold;
    }
  | { status: 'setup-required' }
  | { status: 'not-a-member' };

export interface HouseholdMember {
  id: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface HouseholdMembersResponse {
  members: HouseholdMember[];
}

export interface BootstrapRequest {
  householdName: string;
}

export interface AddHouseholdMemberRequest {
  email: string;
}

export type UpdateHouseholdMemberRequest =
  | { role: MemberRole }
  | { status: Extract<MemberStatus, 'active' | 'revoked'> };

export interface HouseholdMemberResponse {
  member: HouseholdMember;
}

export type ApiErrorCode =
  | 'not_found'
  | 'invalid_request'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'invalid_origin'
  | 'invalid_identity'
  | 'not_a_member'
  | 'owner_required'
  | 'state_conflict'
  | 'duplicate_name'
  | 'stale_version'
  /** A meal-plan week no longer holds what the member saw; nothing was cleared. */
  | 'week_changed'
  | 'limit_reached'
  /** A website import produced no draft; the body carries the failure class. */
  | 'import_failed'
  | 'service_unavailable';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
