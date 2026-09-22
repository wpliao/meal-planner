import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type {
  HouseholdMember,
  HouseholdMemberResponse,
  HouseholdMembersResponse,
  MemberRole,
} from '../shared/api';
import { api } from './api';
import { useFamily } from './family-context';
import { dialogControls, handleDialogKeyDown } from './dialog';

type Confirmation =
  | { kind: 'delete'; member: HouseholdMember }
  | {
      kind: 'member-update';
      member: HouseholdMember;
      update: { role: MemberRole } | { status: 'revoked' };
    }
  | null;

/** The family space: who is signed in, and owner-only member administration. */
export function FamilySpace() {
  const { session, reloadSession, notify } = useFamily();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isOwner = session.member.role === 'owner';

  const loadMembers = useCallback(async () => {
    const response = await api<HouseholdMembersResponse>(
      '/api/household/members',
    );
    setMembers(response.members);
    setMembersLoaded(true);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    queueMicrotask(() => {
      void loadMembers().catch(() =>
        notify({
          tone: 'error',
          message: 'Member administration could not be loaded. Please retry.',
        }),
      );
    });
  }, [isOwner, loadMembers, notify]);

  useEffect(() => {
    if (!confirmation) return;
    const [firstControl] = dialogControls(dialogRef.current);
    (firstControl ?? dialogRef.current)?.focus();
    return () => triggerRef.current?.focus();
  }, [confirmation, pending]);

  const openConfirmation = (
    event: MouseEvent<HTMLElement>,
    next: Confirmation,
  ) => {
    triggerRef.current = event.currentTarget;
    setConfirmation(next);
  };

  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) =>
    handleDialogKeyDown(event, {
      dialog: dialogRef,
      pending,
      onDismiss: () => setConfirmation(null),
    });

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setFormError('Enter the email address of the person to add.');
      return;
    }
    if (!event.currentTarget.reportValidity()) return;
    setPending(true);
    setFormError(null);
    notify(null);
    try {
      const response = await api<HouseholdMemberResponse>(
        '/api/household/members',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail }),
        },
      );
      setEmail('');
      await loadMembers();
      notify({
        tone: 'success',
        message: `${response.member.email} is invited. No invitation email was sent.`,
      });
    } catch (error: unknown) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'The member could not be added. Please try again.',
      );
    } finally {
      setPending(false);
    }
  };

  /**
   * Every owner mutation follows the same shape: close the confirmation,
   * reconcile from the server, then report. Sharing it keeps the two callers
   * from drifting apart, and keeps the recovery wording consistent when the
   * refresh itself fails.
   */
  const runMemberAction = async (
    action: () => Promise<unknown>,
    done: string,
    failed: string,
  ) => {
    setPending(true);
    notify(null);
    try {
      await action();
      setConfirmation(null);
      await reloadSession();
      const refreshed = await loadMembers()
        .then(() => true)
        .catch(() => false);
      notify({
        tone: 'success',
        message: refreshed
          ? done
          : `${done.replace(/\.$/u, '')}, but the page could not be refreshed.`,
      });
    } catch (error: unknown) {
      setConfirmation(null);
      notify({
        tone: 'error',
        message: error instanceof Error ? error.message : failed,
      });
    } finally {
      setPending(false);
    }
  };

  const updateMember = (
    member: HouseholdMember,
    update: { role: MemberRole } | { status: 'active' | 'revoked' },
  ) =>
    runMemberAction(
      () =>
        api<HouseholdMemberResponse>(
          `/api/household/members/${encodeURIComponent(member.id)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(update),
          },
        ),
      'Member access was updated.',
      'Member access could not be updated. Please try again.',
    );

  const deleteMember = async () => {
    if (confirmation?.kind !== 'delete') return;
    const { member } = confirmation;
    await runMemberAction(
      () =>
        api(`/api/household/members/${encodeURIComponent(member.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        }),
      'Member was removed.',
      'Member could not be removed. Please try again.',
    );
  };

  return (
    <>
      <section className="panel" aria-labelledby="family-title">
        <h1 id="family-title">Family</h1>
        <p className="lede">
          Signed in to <strong>{session.household.name}</strong> as{' '}
          {session.member.email}.
        </p>
        <p className="status">
          <span className="status__dot" aria-hidden="true" />
          {isOwner ? 'Family owner' : 'Family member'}
        </p>
      </section>

      {isOwner ? (
        <aside className="card" aria-labelledby="members-title">
          <p className="card__number">Family access</p>
          <h2 id="members-title">Members</h2>
          <form
            className="stack"
            noValidate
            onSubmit={(event) => void addMember(event)}
          >
            <label htmlFor="member-email">Verified email address</label>
            <input
              aria-describedby={formError ? 'member-email-error' : undefined}
              id="member-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            {formError && (
              <p className="field-error" id="member-email-error" role="alert">
                {formError}
              </p>
            )}
            <button className="button" disabled={pending} type="submit">
              Add member
            </button>
          </form>
          {!membersLoaded ? (
            <output className="lede">Checking family members…</output>
          ) : members.length === 0 ? (
            <p className="empty-state">
              No family members have been added yet.
            </p>
          ) : (
            <div className="member-table-wrap">
              <table>
                <colgroup>
                  <col className="member-column" />
                  <col className="role-column" />
                  <col className="status-column" />
                  <col className="actions-column" />
                </colgroup>
                <caption className="sr-only">
                  Family members and access controls
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th className="member-actions-heading" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td data-label="Member">{member.email}</td>
                      <td data-label="Role">{member.role}</td>
                      <td data-label="Status">{member.status}</td>
                      <td className="member-actions-cell" data-label="Actions">
                        <div className="member-actions">
                          {member.status === 'active' && (
                            <>
                              <button
                                disabled={pending}
                                onClick={(event) => {
                                  const update = {
                                    role:
                                      member.role === 'owner'
                                        ? ('member' as const)
                                        : ('owner' as const),
                                  };
                                  if (update.role === 'member') {
                                    openConfirmation(event, {
                                      kind: 'member-update',
                                      member,
                                      update,
                                    });
                                    return;
                                  }
                                  void updateMember(member, update);
                                }}
                                type="button"
                              >
                                {member.role === 'owner'
                                  ? 'Make member'
                                  : 'Make owner'}
                              </button>
                              <button
                                disabled={pending}
                                onClick={(event) =>
                                  openConfirmation(event, {
                                    kind: 'member-update',
                                    member,
                                    update: { status: 'revoked' },
                                  })
                                }
                                type="button"
                              >
                                Revoke
                              </button>
                            </>
                          )}
                          {member.status === 'revoked' && (
                            <button
                              disabled={pending}
                              onClick={() =>
                                void updateMember(member, { status: 'active' })
                              }
                              type="button"
                            >
                              Reactivate
                            </button>
                          )}
                          {member.status !== 'active' && (
                            <button
                              className="button--danger"
                              disabled={pending}
                              onClick={(event) =>
                                openConfirmation(event, {
                                  kind: 'delete',
                                  member,
                                })
                              }
                              type="button"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      ) : (
        <aside className="card" aria-label="Family access">
          <p className="card__number">Family access</p>
          <h2>Private by default</h2>
          <p>
            Your family owner manages who can access this shared space. More
            meal planning tools will arrive in a future phase.
          </p>
        </aside>
      )}

      {confirmation && (
        <div className="dialog-backdrop">
          <div
            aria-labelledby="confirmation-title"
            aria-modal="true"
            aria-busy={pending}
            className="dialog"
            onKeyDown={trapDialogFocus}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="confirmation-title">
              {confirmation.kind === 'delete'
                ? 'Remove this member?'
                : 'status' in confirmation.update
                  ? 'Revoke this member?'
                  : 'Remove owner permissions?'}
            </h2>
            <p>
              {confirmation.kind === 'delete'
                ? `Remove ${confirmation.member.email}? This permanently removes their stored family membership.`
                : 'status' in confirmation.update
                  ? `Revoke ${confirmation.member.email}? They will immediately lose access to this family space.`
                  : `Make ${confirmation.member.email} a family member? They will immediately lose owner permissions.`}
            </p>
            <div className="dialog__actions">
              <button
                disabled={pending}
                onClick={() => setConfirmation(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button--danger"
                disabled={pending}
                onClick={() =>
                  void (confirmation.kind === 'delete'
                    ? deleteMember()
                    : updateMember(confirmation.member, confirmation.update))
                }
                type="button"
              >
                {pending
                  ? 'Working…'
                  : confirmation.kind === 'delete'
                    ? 'Remove member'
                    : 'status' in confirmation.update
                      ? 'Revoke member'
                      : 'Make member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
