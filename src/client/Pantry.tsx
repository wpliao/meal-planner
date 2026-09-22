import {
  Alert,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { api, jsonMutation, runMutation, type Notice } from './api';
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

/** Shown only when the server returns no message of its own. */
const PANTRY_FALLBACK = 'The pantry could not be updated. Please try again.';

const STATUS_LABEL: Record<PantryStatus, string> = {
  available: 'Available',
  low: 'Low',
  needed: 'Needed',
};

const STATUS_ORDER: readonly PantryStatus[] = ['available', 'low', 'needed'];

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
  const resultRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  // A conflict reloads rather than letting one member's stale screen
  // overwrite another's change.
  const run = (action: () => Promise<unknown>, success: string) =>
    runMutation(
      {
        setPending,
        notify: setNotice,
        reconcile: load,
        fallback: PANTRY_FALLBACK,
      },
      action,
      success,
    );

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
        jsonMutation('POST', { name: trimmed, status }),
      );
      setName('');
      setStatus('available');
    }, `${trimmed} was added to the pantry.`);
  };

  const changeStatus = (item: PantryItem, next: PantryStatus) =>
    run(async () => {
      await api<PantryItemResponse>(
        `/api/pantry/items/${item.id}`,
        jsonMutation('PATCH', { version: item.version, status: next }),
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
        jsonMutation('PATCH', { version: item.version, name: trimmed }),
      );
    }, `The item was renamed to ${trimmed}.`);
  };

  // Cancelling and dismissing must both land back on the actions button: the
  // menu item that opened the dialog has unmounted, so Mantine's own return
  // focus would go to <body>.
  const closeConfirmation = () => {
    setConfirming(null);
    menuTriggerRef.current?.focus();
  };

  const removeItem = async () => {
    if (!confirming) return;
    const target = confirming;
    // Mantine's Modal restores focus to whatever opened it. That trigger
    // disappears with the removed row, so the result message takes focus
    // instead — see the effect above.
    setConfirming(null);
    await run(async () => {
      await api<void>(
        `/api/pantry/items/${target.id}`,
        jsonMutation('DELETE', { version: target.version }),
      );
    }, `${target.name} was removed from the pantry.`);
  };

  const visible = view === 'shopping' ? items.filter(isShoppingItem) : items;
  const shoppingCount = items.filter(isShoppingItem).length;

  return (
    <Card
      aria-labelledby="pantry-title"
      component="section"
      data-testid="pantry-panel"
      padding="lg"
      radius="lg"
      withBorder
    >
      <Text c="clay.8" fw={700} fz="xs" tt="uppercase">
        Kitchen
      </Text>
      <Title id="pantry-title" mb="md" order={1}>
        Pantry
      </Title>

      {/*
        Button.Group's own props do not include `role`, so the grouping
        semantics go on the root element itself. Without them the two views
        read as unrelated buttons.
      */}
      <Button.Group
        mb="md"
        renderRoot={(props) => (
          <div {...props} aria-label="Pantry view" role="group" />
        )}
      >
        <Button
          aria-pressed={view === 'all'}
          onClick={() => setView('all')}
          variant={view === 'all' ? 'filled' : 'default'}
        >
          All items ({items.length})
        </Button>
        <Button
          aria-pressed={view === 'shopping'}
          onClick={() => setView('shopping')}
          variant={view === 'shopping' ? 'filled' : 'default'}
        >
          Shopping ({shoppingCount})
        </Button>
      </Button.Group>

      <form noValidate onSubmit={(event) => void addItem(event)}>
        <Stack gap="sm">
          <TextInput
            error={formError}
            label="Item name"
            maxLength={PANTRY_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.currentTarget.value)}
            value={name}
          />
          <Radio.Group
            data-testid="status-field"
            label="Status"
            onChange={(value) => setStatus(value)}
            value={status}
          >
            <Group gap="lg" mt="xs">
              {STATUS_ORDER.map((option) => (
                <Radio
                  key={option}
                  label={STATUS_LABEL[option]}
                  value={option}
                />
              ))}
            </Group>
          </Radio.Group>
          <Button disabled={pending} type="submit" w="fit-content">
            Add item
          </Button>
        </Stack>
      </form>

      {loadState === 'loading' && (
        <Text component="output" mt="md">
          Checking your pantry…
        </Text>
      )}

      {loadState === 'unavailable' && (
        <Stack align="flex-start" gap="sm" mt="md">
          <Text component="output">
            We could not load the pantry. Please try again.
          </Text>
          <Button onClick={() => void load()} variant="default">
            Retry
          </Button>
        </Stack>
      )}

      {loadState === 'ready' && visible.length === 0 && (
        <Text c="dimmed" mt="md">
          {view === 'shopping'
            ? 'Nothing is marked Low or Needed right now. This does not mean the family owns everything.'
            : 'The pantry is empty. Add an item and mark it Available, Low, or Needed — no quantities needed.'}
        </Text>
      )}

      {loadState === 'ready' && visible.length > 0 && (
        <Stack
          component="ul"
          gap="sm"
          mt="md"
          p={0}
          style={{ listStyle: 'none' }}
        >
          {visible.map((item) => (
            <Card
              component="li"
              data-testid="pantry-item"
              key={item.id}
              padding="md"
              radius="md"
              withBorder
            >
              {renamingId === item.id ? (
                <form
                  noValidate
                  onSubmit={(event) => void submitRename(event, item)}
                >
                  <Stack gap="xs">
                    <TextInput
                      aria-label="New name"
                      data-autofocus
                      maxLength={PANTRY_NAME_MAX_LENGTH}
                      onChange={(event) =>
                        setRenameValue(event.currentTarget.value)
                      }
                      value={renameValue}
                    />
                    <Group gap="xs">
                      <Button disabled={pending} size="sm" type="submit">
                        Save
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() => setRenamingId(null)}
                        size="sm"
                        variant="default"
                      >
                        Cancel
                      </Button>
                    </Group>
                  </Stack>
                </form>
              ) : (
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} fz="lg" style={{ overflowWrap: 'anywhere' }}>
                    {item.name}
                  </Text>
                  <Menu position="bottom-end" shadow="md" withinPortal={false}>
                    <Menu.Target>
                      <Button
                        aria-label={`Actions for ${item.name}`}
                        disabled={pending}
                        onClick={(event) => {
                          menuTriggerRef.current = event.currentTarget;
                        }}
                        px="xs"
                        variant="subtle"
                      >
                        <span aria-hidden="true">…</span>
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => startRename(item)}>
                        Rename
                      </Menu.Item>
                      <Menu.Item c="clay.8" onClick={() => setConfirming(item)}>
                        Remove
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              )}

              <Text c="dimmed" fz="sm" mt={4}>
                Last changed {new Date(item.updatedAt).toLocaleDateString()}
              </Text>

              {/* Named so a screen reader says which item these belong to. */}
              <Button.Group
                mt="sm"
                renderRoot={(props) => (
                  <div
                    {...props}
                    aria-label={`Status for ${item.name}`}
                    data-testid="item-status"
                    role="group"
                  />
                )}
              >
                {STATUS_ORDER.map((option) => (
                  <Button
                    aria-pressed={item.status === option}
                    disabled={pending}
                    key={option}
                    onClick={() => {
                      // Pressing the current status is a no-op rather than a
                      // disabled control: Mantine greys a disabled button, so
                      // the current status read as the unavailable one.
                      if (item.status === option) return;
                      void changeStatus(item, option);
                    }}
                    size="sm"
                    variant={item.status === option ? 'filled' : 'default'}
                  >
                    {STATUS_LABEL[option]}
                  </Button>
                ))}
              </Button.Group>
            </Card>
          ))}
        </Stack>
      )}

      {notice && (
        <Alert
          color={notice.tone === 'success' ? 'sage' : 'clay'}
          mt="md"
          ref={resultRef}
          role="status"
          tabIndex={-1}
        >
          {notice.message}
        </Alert>
      )}

      <Modal
        centered
        onClose={closeConfirmation}
        opened={confirming !== null}
        title={confirming ? `Remove ${confirming.name}?` : ''}
      >
        <Text>
          This removes the item from the shared family pantry. It cannot be
          undone.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button
            color="clay"
            disabled={pending}
            onClick={() => void removeItem()}
          >
            Remove item
          </Button>
          <Button
            disabled={pending}
            onClick={closeConfirmation}
            variant="default"
          >
            Cancel
          </Button>
        </Group>
      </Modal>
    </Card>
  );
}
