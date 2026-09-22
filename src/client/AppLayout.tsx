import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import type { SessionResponse } from '../shared/api';
import { api, jsonMutation, type Notice } from './api';
import { dialogControls, handleDialogKeyDown } from './dialog';
import type { FamilyContext, ReadySession } from './family-context';

type SessionState =
  | { kind: 'loading' }
  | { kind: 'ready'; session: ReadySession }
  | { kind: 'setup-required' }
  | { kind: 'not-a-member' }
  | { kind: 'unavailable' };

const headingFor = (state: SessionState) => {
  if (state.kind === 'setup-required') return 'Set up your family space';
  if (state.kind === 'not-a-member') return 'You are not a family member';
  if (state.kind === 'unavailable') return 'The family space is unavailable';
  return 'Our family kitchen';
};

export function AppLayout() {
  const [sessionState, setSessionState] = useState<SessionState>({
    kind: 'loading',
  });
  const [householdName, setHouseholdName] = useState('Our family kitchen');
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const resultRef = useRef<HTMLOutputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadSession = useCallback(async (): Promise<void> => {
    setSessionState({ kind: 'loading' });
    try {
      const response = await api<SessionResponse>('/api/session');
      setSessionState(
        response.status === 'ready'
          ? { kind: 'ready', session: response }
          : { kind: response.status },
      );
    } catch {
      setSessionState({ kind: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadSession());
  }, [loadSession]);

  useEffect(() => {
    if (notice) resultRef.current?.focus();
  }, [notice]);

  useEffect(() => {
    if (!confirming) return;
    const [first] = dialogControls(dialogRef.current);
    (first ?? dialogRef.current)?.focus();
    return () => triggerRef.current?.focus();
  }, [confirming, pending]);

  const bootstrap = async () => {
    setPending(true);
    setNotice(null);
    try {
      await api('/api/bootstrap', jsonMutation('POST', { householdName }));
      setConfirming(false);
      await loadSession();
      setNotice({ tone: 'success', message: 'Your family space is ready.' });
    } catch (error: unknown) {
      setConfirming(false);
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

  const ready = sessionState.kind === 'ready' ? sessionState.session : null;

  return (
    <div className="app">
      <header className="app__bar">
        <p className="app__brand">Our family kitchen</p>
        {ready && (
          <nav className="app__nav" aria-label="Sections">
            <NavLink to="/pantry">Pantry</NavLink>
            <NavLink to="/family">Family</NavLink>
          </nav>
        )}
        {ready && (
          <p className="app__who">
            {ready.household.name} ·{' '}
            {ready.member.role === 'owner' ? 'Family owner' : 'Family member'}
          </p>
        )}
      </header>

      <main className="app__main">
        {ready ? (
          <Outlet
            context={
              {
                session: ready,
                reloadSession: loadSession,
                notify: setNotice,
              } satisfies FamilyContext
            }
          />
        ) : (
          <section className="panel" aria-labelledby="page-title">
            <h1 id="page-title">{headingFor(sessionState)}</h1>

            {sessionState.kind === 'loading' && (
              <output className="lede">Checking your family space…</output>
            )}

            {sessionState.kind === 'setup-required' && (
              <form
                className="stack"
                onSubmit={(event) => event.preventDefault()}
              >
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
                  onClick={(event: MouseEvent<HTMLElement>) => {
                    triggerRef.current = event.currentTarget;
                    setConfirming(true);
                  }}
                  type="submit"
                >
                  Create family space
                </button>
              </form>
            )}

            {sessionState.kind === 'not-a-member' && (
              <p className="lede">
                Your sign-in was successful, but this identity has not been
                added to this family. Ask a family owner to add your verified
                email address.
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
          </section>
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
      </main>

      {confirming && (
        <div className="dialog-backdrop">
          <div
            aria-busy={pending}
            aria-labelledby="bootstrap-confirm-title"
            aria-modal="true"
            className="dialog"
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) =>
              handleDialogKeyDown(event, {
                dialog: dialogRef,
                pending,
                onDismiss: () => setConfirming(false),
              })
            }
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="bootstrap-confirm-title">
              Create “{householdName.trim()}”?
            </h2>
            <p>
              This creates the family space and makes you its owner. It can only
              be done once.
            </p>
            <div className="dialog__actions">
              <button
                className="button"
                disabled={pending}
                onClick={() => void bootstrap()}
                type="button"
              >
                Create family space
              </button>
              <button
                className="button button--quiet"
                disabled={pending}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
