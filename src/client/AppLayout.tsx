import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { SessionResponse } from '../shared/api';
import { api, jsonMutation, runMutation, type Notice } from './api';
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

// The plan is home (#49 decision 8), so it comes first.
const SECTIONS = [
  { label: 'Plan', to: '/plan' },
  { label: 'Pantry', to: '/pantry' },
  { label: 'Recipes', to: '/recipes' },
  { label: 'Family', to: '/family' },
] as const;

export function AppLayout() {
  const [sessionState, setSessionState] = useState<SessionState>({
    kind: 'loading',
  });
  const [householdName, setHouseholdName] = useState('Our family kitchen');
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

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

  const bootstrap = () =>
    runMutation(
      {
        setPending,
        notify: setNotice,
        // The dialog closes on both paths: bootstrap can only be attempted
        // once, so there is nothing to retry from inside it.
        reconcile: async () => {
          setConfirming(false);
          await loadSession();
        },
        fallback: 'The family space could not be created. Please try again.',
      },
      () => api('/api/bootstrap', jsonMutation('POST', { householdName })),
      'Your family space is ready.',
    );

  const ready = sessionState.kind === 'ready' ? sessionState.session : null;

  return (
    <>
      <Container
        component="header"
        py="md"
        size="md"
        style={{
          borderBottom: '1px solid var(--mantine-color-paper-3)',
        }}
      >
        <Group align="baseline" justify="space-between" wrap="wrap">
          <Text c="sage.9" fw={700} fz="lg">
            Our family kitchen
          </Text>
          {ready && (
            <Group aria-label="Sections" component="nav" gap="lg">
              {SECTIONS.map((section) => {
                const active = pathname.startsWith(section.to);
                return (
                  <Anchor
                    c={active ? 'sage.9' : 'dimmed'}
                    component={NavLink}
                    fw={active ? 700 : 500}
                    key={section.to}
                    to={section.to}
                    underline={active ? 'always' : 'hover'}
                  >
                    {section.label}
                  </Anchor>
                );
              })}
            </Group>
          )}
          {ready && (
            <Text c="dimmed" fz="sm">
              {ready.household.name} ·{' '}
              {ready.member.role === 'owner' ? 'Family owner' : 'Family member'}
            </Text>
          )}
        </Group>
      </Container>

      <Container component="main" py="lg" size="md">
        <Stack gap="lg">
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
            <Card
              aria-labelledby="page-title"
              component="section"
              padding="lg"
              radius="lg"
              withBorder
            >
              <Title id="page-title" order={1}>
                {headingFor(sessionState)}
              </Title>

              {sessionState.kind === 'loading' && (
                <Text component="output" mt="md">
                  Checking your family space…
                </Text>
              )}

              {sessionState.kind === 'setup-required' && (
                <form onSubmit={(event) => event.preventDefault()}>
                  <Stack gap="sm" mt="md">
                    <Text>
                      Create the first household for this installation. Only the
                      configured family owner can see this step.
                    </Text>
                    <TextInput
                      id="household-name"
                      label="Family space name"
                      maxLength={80}
                      minLength={1}
                      onChange={(event) =>
                        setHouseholdName(event.currentTarget.value)
                      }
                      required
                      value={householdName}
                      withAsterisk={false}
                    />
                    <Button
                      disabled={!householdName.trim() || pending}
                      onClick={() => setConfirming(true)}
                      type="submit"
                      w="fit-content"
                    >
                      Create family space
                    </Button>
                  </Stack>
                </form>
              )}

              {sessionState.kind === 'not-a-member' && (
                <Text mt="md">
                  Your sign-in was successful, but this identity has not been
                  added to this family. Ask a family owner to add your verified
                  email address.
                </Text>
              )}

              {sessionState.kind === 'unavailable' && (
                <Stack align="flex-start" gap="sm" mt="md">
                  <Text component="output">
                    We could not check your family access. Please try again.
                  </Text>
                  <Button onClick={() => void loadSession()} variant="default">
                    Retry
                  </Button>
                </Stack>
              )}
            </Card>
          )}

          {notice && (
            <Alert
              color={notice.tone === 'success' ? 'sage' : 'clay'}
              data-testid="result"
              ref={resultRef}
              role="status"
              tabIndex={-1}
            >
              {notice.message}
            </Alert>
          )}
        </Stack>
      </Container>

      {/*
        The compound API rather than the `Modal` shorthand: bootstrap is a
        one-time, irreversible action, so while it is in flight the dialog has
        to carry aria-busy itself and offer no way out — no close button, no
        Escape, no click-away. That leaves nothing focusable inside, and
        Mantine's focus trap falls back to the dialog element.
      */}
      <Modal.Root
        centered
        closeOnClickOutside={!pending}
        closeOnEscape={!pending}
        onClose={() => setConfirming(false)}
        opened={confirming}
      >
        <Modal.Overlay />
        <Modal.Content aria-busy={pending}>
          <Modal.Header>
            <Modal.Title>Create “{householdName.trim()}”?</Modal.Title>
            {!pending && <Modal.CloseButton />}
          </Modal.Header>
          <Modal.Body>
            <Stack gap="md">
              <Text>
                This creates the family space and makes you its owner. It can
                only be done once.
              </Text>
              <Group justify="flex-end">
                <Button disabled={pending} onClick={() => void bootstrap()}>
                  Create family space
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  variant="default"
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
