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
  ApiErrorResponse,
  HouseholdMember,
  HouseholdMemberResponse,
  HouseholdMembersResponse,
  MemberRole,
  SessionResponse,
} from '../shared/api';
import { handleDialogKeyDown, dialogControls } from './dialog';
import { Pantry } from './Pantry';

type SessionState =
  | { kind: 'loading' }
  | { kind: 'ready'; session: Extract<SessionResponse, { status: 'ready' }> }
  | { kind: 'setup-required' }
  | { kind: 'not-a-member' }
  | { kind: 'unavailable' };
type Notice = { tone: 'success' | 'error'; message: string } | null;
type Confirmation =
  | { kind: 'bootstrap'; householdName: string }
  | { kind: 'delete'; member: HouseholdMember }
  | {
      kind: 'member-update';
      member: HouseholdMember;
      update: { role: MemberRole } | { status: 'revoked' };
    }
  | null;

const messageFor = (response: Response, body: unknown) => {
  const error = body as Partial<ApiErrorResponse> | undefined;
  if (error?.error?.message) return error.error.message;
  if (response.status === 409)
    return 'This change cannot be completed because the household has changed.';
  return 'The family space could not be updated. Please try again.';
};

async function api<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(messageFor(response, body));
  return body as T;
}

const headingFor = (state: SessionState) => {
  if (state.kind === 'setup-required') return 'Set up your family space';
  if (state.kind === 'not-a-member') return 'You are not a family member';
  if (state.kind === 'unavailable') return 'The family space is unavailable';
  return 'Our family kitchen';
};

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>({
    kind: 'loading',
  });
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [householdName, setHouseholdName] = useState('Our family kitchen');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const resultRef = useRef<HTMLOutputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadMembers = useCallback(async () => {
    const response = await api<HouseholdMembersResponse>(
      '/api/household/members',
    );
    setMembers(response.members);
  }, []);

  const loadSession = useCallback(async (): Promise<boolean> => {
    setSessionState({ kind: 'loading' });
    setNotice(null);
    try {
      const response = await api<SessionResponse>('/api/session');
      if (response.status === 'ready') {
        setSessionState({ kind: 'ready', session: response });
        if (response.member.role === 'owner') {
          try {
            await loadMembers();
          } catch {
            setNotice({
              tone: 'error',
              message:
                'Member administration could not be loaded. Please retry.',
            });
            return false;
          }
        } else setMembers([]);
      } else {
        setMembers([]);
        setSessionState({ kind: response.status });
      }
      return true;
    } catch {
      setMembers([]);
      setSessionState({ kind: 'unavailable' });
      return false;
    }
  }, [loadMembers]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSession();
    });
  }, [loadSession]);
  useEffect(() => {
    if (notice) resultRef.current?.focus();
  }, [notice]);
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

  const bootstrap = async () => {
    if (confirmation?.kind !== 'bootstrap') return;
    setPending(true);
    setNotice(null);
    try {
      await api('/api/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ householdName: confirmation.householdName }),
      });
      setConfirmation(null);
      await loadSession();
      setNotice({ tone: 'success', message: 'Your family space is ready.' });
    } catch (error: unknown) {
      setConfirmation(null);
      await loadSession();
      setNotice({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The family space could not be created. Please try again.',
      });
    } finally {
      setPending(false);
    }
  };

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
    setNotice(null);
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
      setNotice({
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

  const updateMember = async (
    member: HouseholdMember,
    update: { role: MemberRole } | { status: 'active' | 'revoked' },
  ) => {
    setPending(true);
    setNotice(null);
    try {
      await api<HouseholdMemberResponse>(
        `/api/household/members/${encodeURIComponent(member.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        },
      );
      setConfirmation(null);
      const refreshed = await loadSession();
      setNotice({
        tone: 'success',
        message: refreshed
          ? 'Member access was updated.'
          : 'Member access was updated, but the page could not be refreshed.',
      });
    } catch (error: unknown) {
      setConfirmation(null);
      setNotice({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Member access could not be updated. Please try again.',
      });
    } finally {
      setPending(false);
    }
  };

  const deleteMember = async () => {
    if (confirmation?.kind !== 'delete') return;
    setPending(true);
    setNotice(null);
    try {
      await api(
        `/api/household/members/${encodeURIComponent(confirmation.member.id)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
        },
      );
      setConfirmation(null);
      const refreshed = await loadSession();
      setNotice({
        tone: 'success',
        message: refreshed
          ? 'Member was removed.'
          : 'Member was removed, but the page could not be refreshed.',
      });
    } catch (error: unknown) {
      setConfirmation(null);
      setNotice({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Member could not be removed. Please try again.',
      });
    } finally {
      setPending(false);
    }
  };

  const isOwner =
    sessionState.kind === 'ready' &&
    sessionState.session.member.role === 'owner';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Our family kitchen</p>
        <h1 id="page-title">{headingFor(sessionState)}</h1>
        {sessionState.kind === 'loading' && (
          <output className="lede">Checking your family space…</output>
        )}
        {sessionState.kind === 'setup-required' && (
          <form className="stack" onSubmit={(event) => event.preventDefault()}>
            <p className="lede">
              Create the first household for this installation. Only the
              configured family owner can see this step.
            </p>
            <label htmlFor="household-name">Family space name</label>
            <input
              id="household-name"
              maxLength={80}
              minLength={1}
              onChange={(event) => setHouseholdName(event.target.value)}
              required
              value={householdName}
            />
            <button
              className="button"
              disabled={!householdName.trim() || pending}
              onClick={(event) =>
                openConfirmation(event, {
                  kind: 'bootstrap',
                  householdName: householdName.trim(),
                })
              }
              type="submit"
            >
              Create family space
            </button>
          </form>
        )}
        {sessionState.kind === 'ready' && (
          <div className="stack">
            <p className="lede">
              Signed in to{' '}
              <strong>{sessionState.session.household.name}</strong> as{' '}
              {sessionState.session.member.email}.
            </p>
            <p className="status">
              <span className="status__dot" aria-hidden="true" />
              {sessionState.session.member.role === 'owner'
                ? 'Family owner'
                : 'Family member'}
            </p>
          </div>
        )}
        {sessionState.kind === 'not-a-member' && (
          <p className="lede">
            Your sign-in was successful, but this identity has not been added to
            this family. Ask a family owner to add your verified email address.
          </p>
        )}
        {sessionState.kind === 'unavailable' && (
          <div className="stack">
            <output className="lede">
              We could not check your family access. Please try again.
            </output>
            <button
              className="button"
              onClick={() => void loadSession()}
              type="button"
            >
              Retry
            </button>
          </div>
        )}
        {notice && (
          <output
            className={`notice notice--${notice.tone}`}
            ref={resultRef}
            tabIndex={-1}
          >
            {notice.message}
          </output>
        )}
      </section>
      {sessionState.kind === 'ready' && <Pantry />}
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
          {members.length === 0 ? (
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
              {confirmation.kind === 'bootstrap'
                ? 'Create this family space?'
                : confirmation.kind === 'delete'
                  ? 'Remove this member?'
                  : 'status' in confirmation.update
                    ? 'Revoke this member?'
                    : 'Remove owner permissions?'}
            </h2>
            <p>
              {confirmation.kind === 'bootstrap'
                ? `Create “${confirmation.householdName}” as the first family space?`
                : confirmation.kind === 'delete'
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
                className={
                  confirmation.kind === 'bootstrap'
                    ? 'button'
                    : 'button--danger'
                }
                disabled={pending}
                onClick={() =>
                  void (confirmation.kind === 'bootstrap'
                    ? bootstrap()
                    : confirmation.kind === 'delete'
                      ? deleteMember()
                      : updateMember(confirmation.member, confirmation.update))
                }
                type="button"
              >
                {pending
                  ? 'Working…'
                  : confirmation.kind === 'bootstrap'
                    ? 'Create family space'
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
    </main>
  );
}
