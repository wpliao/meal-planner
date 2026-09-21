import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import type { ApiErrorResponse } from '../shared/api';
import { dialogControls, handleDialogKeyDown } from './dialog';
import {
  comparePantryItems,
  isShoppingItem,
  PANTRY_NAME_MAX_LENGTH,
  type PantryItem,
  type PantryItemResponse,
  type PantryItemsResponse,
  type PantryStatus,
} from '../shared/pantry';

type LoadState = 'loading' | 'ready' | 'unavailable';
type View = 'all' | 'shopping';
type Notice = { tone: 'success' | 'error'; message: string } | null;

const STATUS_LABEL: Record<PantryStatus, string> = {
  available: 'Available',
  low: 'Low',
  needed: 'Needed',
};

const STATUS_ORDER: readonly PantryStatus[] = ['available', 'low', 'needed'];

const messageFor = (response: Response, body: unknown): string => {
  const error = body as Partial<ApiErrorResponse> | undefined;
  if (error?.error?.message) return error.error.message;
  return 'The pantry could not be updated. Please try again.';
};

async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(messageFor(response, body));
  return body as T;
}

const mutation = (method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function Pantry() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [items, setItems] = useState<PantryItem[]>([]);
  const [view, setView] = useState<View>('all');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<PantryStatus>('available');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<PantryItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const resultRef = useRef<HTMLOutputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const response = await api<PantryItemsResponse>('/api/pantry/items');
      setItems(response.items.slice().sort(comparePantryItems));
      setLoadState('ready');
      return true;
    } catch {
      setItems([]);
      setLoadState('unavailable');
      return false;
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    if (notice) resultRef.current?.focus();
  }, [notice]);

  useEffect(() => {
    if (!confirming) return;
    const [firstControl] = dialogControls(dialogRef.current);
    (firstControl ?? dialogRef.current)?.focus();
    return () => triggerRef.current?.focus();
  }, [confirming, pending]);

  // Every mutation reconciles from the server; a conflict reloads rather than
  // letting one member's stale screen overwrite another's change.
  const run = async (
    action: () => Promise<void>,
    success: string,
  ): Promise<void> => {
    setPending(true);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice({ tone: 'success', message: success });
    } catch (error: unknown) {
      await load();
      setNotice({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The pantry could not be updated. Please try again.',
      });
    } finally {
      setPending(false);
    }
  };

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Enter the name of the item to add.');
      return;
    }
    setFormError(null);
    await run(async () => {
      await api<PantryItemResponse>(
        '/api/pantry/items',
        mutation('POST', { name: trimmed, status }),
      );
      setName('');
      setStatus('available');
    }, `${trimmed} was added to the pantry.`);
  };

  const changeStatus = (item: PantryItem, next: PantryStatus) =>
    run(async () => {
      await api<PantryItemResponse>(
        `/api/pantry/items/${item.id}`,
        mutation('PATCH', { version: item.version, status: next }),
      );
    }, `${item.name} is now marked ${STATUS_LABEL[next]}.`);

  const startRename = (item: PantryItem) => {
    setRenamingId(item.id);
    setRenameValue(item.name);
    setFormError(null);
  };

  const submitRename = async (
    event: FormEvent<HTMLFormElement>,
    item: PantryItem,
  ) => {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setFormError('Enter a new name for this item.');
      return;
    }
    if (trimmed === item.name) {
      setRenamingId(null);
      return;
    }
    setFormError(null);
    setRenamingId(null);
    await run(async () => {
      await api<PantryItemResponse>(
        `/api/pantry/items/${item.id}`,
        mutation('PATCH', { version: item.version, name: trimmed }),
      );
    }, `The item was renamed to ${trimmed}.`);
  };

  const removeItem = async () => {
    if (!confirming) return;
    const target = confirming;
    // The trigger button disappears with the row, so restoring focus to it
    // would drop the user at <body>. The result notice takes focus instead.
    triggerRef.current = null;
    setConfirming(null);
    await run(async () => {
      await api<void>(
        `/api/pantry/items/${target.id}`,
        mutation('DELETE', { version: target.version }),
      );
    }, `${target.name} was removed from the pantry.`);
  };

  const visible = view === 'shopping' ? items.filter(isShoppingItem) : items;
  const shoppingCount = items.filter(isShoppingItem).length;

  return (
    <aside className="card" aria-labelledby="pantry-title">
      <p className="card__number">Kitchen</p>
      <h2 id="pantry-title">Pantry</h2>

      <div className="pantry-views" role="group" aria-label="Pantry view">
        <button
          aria-pressed={view === 'all'}
          className="button button--quiet"
          onClick={() => setView('all')}
          type="button"
        >
          All items ({items.length})
        </button>
        <button
          aria-pressed={view === 'shopping'}
          className="button button--quiet"
          onClick={() => setView('shopping')}
          type="button"
        >
          Shopping ({shoppingCount})
        </button>
      </div>

      <form
        className="stack"
        noValidate
        onSubmit={(event) => void addItem(event)}
      >
        <label htmlFor="pantry-name">Item name</label>
        <input
          aria-describedby={formError ? 'pantry-name-error' : undefined}
          id="pantry-name"
          maxLength={PANTRY_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        {formError && (
          <p className="field-error" id="pantry-name-error" role="alert">
            {formError}
          </p>
        )}
        <fieldset className="pantry-signals">
          <legend>Signal</legend>
          {STATUS_ORDER.map((option) => (
            <label key={option} htmlFor={`pantry-status-${option}`}>
              <input
                checked={status === option}
                id={`pantry-status-${option}`}
                name="pantry-status"
                onChange={() => setStatus(option)}
                type="radio"
                value={option}
              />
              {STATUS_LABEL[option]}
            </label>
          ))}
        </fieldset>
        <button className="button" disabled={pending} type="submit">
          Add item
        </button>
      </form>

      {loadState === 'loading' && (
        <output className="lede">Checking your pantry…</output>
      )}

      {loadState === 'unavailable' && (
        <div className="stack">
          <output className="lede">
            We could not load the pantry. Please try again.
          </output>
          <button className="button" onClick={() => void load()} type="button">
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && visible.length === 0 && (
        <p className="empty-state">
          {view === 'shopping'
            ? 'Nothing is marked Low or Needed right now. This does not mean the family owns everything.'
            : 'The pantry is empty. Add an item and mark it Available, Low, or Needed — no quantities needed.'}
        </p>
      )}

      {loadState === 'ready' && visible.length > 0 && (
        <ul className="pantry-list">
          {visible.map((item) => (
            <li className="pantry-item" key={item.id}>
              <div className="pantry-item__head">
                <span className="pantry-item__name">{item.name}</span>
                <span className="pantry-item__status">
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="pantry-item__meta">
                Last changed {new Date(item.updatedAt).toLocaleDateString()}
              </p>
              <div
                className="pantry-item__signals"
                role="group"
                aria-label={`Signal for ${item.name}`}
              >
                {STATUS_ORDER.map((option) => (
                  <button
                    aria-pressed={item.status === option}
                    disabled={pending || item.status === option}
                    key={option}
                    onClick={() => void changeStatus(item, option)}
                    type="button"
                  >
                    {STATUS_LABEL[option]}
                  </button>
                ))}
              </div>
              {renamingId === item.id && (
                <form
                  className="pantry-item__rename"
                  noValidate
                  onSubmit={(event) => void submitRename(event, item)}
                >
                  <label htmlFor={`pantry-rename-${item.id}`}>New name</label>
                  <input
                    autoFocus
                    id={`pantry-rename-${item.id}`}
                    maxLength={PANTRY_NAME_MAX_LENGTH}
                    onChange={(event) => setRenameValue(event.target.value)}
                    value={renameValue}
                  />
                  <button className="button" disabled={pending} type="submit">
                    Save name
                  </button>
                  <button
                    className="button button--quiet"
                    disabled={pending}
                    onClick={() => setRenamingId(null)}
                    type="button"
                  >
                    Cancel rename
                  </button>
                </form>
              )}
              <div className="pantry-item__actions">
                <button
                  disabled={pending}
                  onClick={() => startRename(item)}
                  type="button"
                >
                  Rename
                </button>
                <button
                  className="button--danger"
                  disabled={pending}
                  onClick={(event: MouseEvent<HTMLElement>) => {
                    triggerRef.current = event.currentTarget;
                    setConfirming(item);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
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

      {confirming && (
        <div className="dialog-backdrop">
          <div
            aria-labelledby="pantry-confirm-title"
            aria-modal="true"
            className="dialog"
            onKeyDown={(event) =>
              handleDialogKeyDown(event, {
                dialog: dialogRef,
                pending,
                onDismiss: () => setConfirming(null),
              })
            }
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="pantry-confirm-title">Remove {confirming.name}?</h2>
            <p>
              This removes the item from the shared family pantry. It cannot be
              undone.
            </p>
            <div className="dialog__actions">
              <button
                className="button button--danger"
                disabled={pending}
                onClick={() => void removeItem()}
                type="button"
              >
                Remove item
              </button>
              <button
                className="button"
                disabled={pending}
                onClick={() => setConfirming(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
