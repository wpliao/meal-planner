import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  HouseholdMember,
  HouseholdMemberResponse,
  HouseholdMembersResponse,
  MemberRole,
} from '../shared/api';
import { api } from './api';
import { useFamily } from './family-context';
import './members-table.css';

type Confirmation =
  | { kind: 'delete'; member: HouseholdMember }
  | {
      kind: 'member-update';
      member: HouseholdMember;
      update: { role: MemberRole } | { status: 'revoked' };
    }
  | null;

/**
 * Each confirmation variant differs only in its wording, so the three strings
 * are resolved together rather than branching three times in the markup.
 */
const wordingFor = (
  confirmation: NonNullable<Confirmation>,
): { title: string; body: string; confirm: string } => {
  if (confirmation.kind === 'delete') {
    return {
      title: 'Remove this member?',
      body: `Remove ${confirmation.member.email}? This permanently removes their stored family membership.`,
      confirm: 'Remove member',
    };
  }
  if ('status' in confirmation.update) {
    return {
      title: 'Revoke this member?',
      body: `Revoke ${confirmation.member.email}? They will immediately lose access to this family space.`,
      confirm: 'Revoke member',
    };
  }
  return {
    title: 'Remove owner permissions?',
    body: `Make ${confirmation.member.email} a family member? They will immediately lose owner permissions.`,
    confirm: 'Make member',
  };
};

/** The family space: who is signed in, and owner-only member administration. */
export function FamilySpace() {
  const { session, reloadSession, notify } = useFamily();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

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

  const toggleRole = (member: HouseholdMember) => {
    const update = {
      role: member.role === 'owner' ? ('member' as const) : ('owner' as const),
    };
    // Granting ownership is recoverable; taking it away is not, so only the
    // demotion asks first.
    if (update.role === 'member') {
      setConfirmation({ kind: 'member-update', member, update });
      return;
    }
    void updateMember(member, update);
  };

  const wording = confirmation ? wordingFor(confirmation) : null;

  let memberList: ReactNode;
  if (!membersLoaded) {
    memberList = (
      <Text component="output" mt="md">
        Checking family members…
      </Text>
    );
  } else if (members.length === 0) {
    memberList = (
      <Text c="dimmed" mt="md">
        No family members have been added yet.
      </Text>
    );
  } else {
    memberList = (
      <Table.ScrollContainer
        data-testid="member-table"
        minWidth={30}
        mt="md"
        type="native"
      >
        <Table verticalSpacing="sm">
          {/* Named for assistive technology; the visible heading above already
              says what this table is. */}
          <VisuallyHidden component="caption">
            Family members and access controls
          </VisuallyHidden>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Member</Table.Th>
              <Table.Th scope="col">Role</Table.Th>
              <Table.Th scope="col">Status</Table.Th>
              <Table.Th scope="col">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((member) => (
              <Table.Tr key={member.id}>
                <Table.Td
                  data-label="Member"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {member.email}
                </Table.Td>
                <Table.Td data-label="Role">{member.role}</Table.Td>
                <Table.Td data-label="Status">
                  <Badge
                    color={member.status === 'active' ? 'sage' : 'paper'}
                    variant="light"
                  >
                    {member.status}
                  </Badge>
                </Table.Td>
                <Table.Td data-label="Actions" data-testid="member-actions">
                  <Group gap="xs" wrap="wrap">
                    {member.status === 'active' && (
                      <>
                        <Button
                          disabled={pending}
                          onClick={() => toggleRole(member)}
                          size="xs"
                          variant="default"
                        >
                          {member.role === 'owner'
                            ? 'Make member'
                            : 'Make owner'}
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() =>
                            setConfirmation({
                              kind: 'member-update',
                              member,
                              update: { status: 'revoked' },
                            })
                          }
                          size="xs"
                          variant="default"
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                    {member.status === 'revoked' && (
                      <Button
                        disabled={pending}
                        onClick={() =>
                          void updateMember(member, { status: 'active' })
                        }
                        size="xs"
                        variant="default"
                      >
                        Reactivate
                      </Button>
                    )}
                    {member.status !== 'active' && (
                      <Button
                        color="clay"
                        disabled={pending}
                        onClick={() =>
                          setConfirmation({ kind: 'delete', member })
                        }
                        size="xs"
                      >
                        Remove
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  }

  return (
    <>
      <Card
        aria-labelledby="family-title"
        component="section"
        data-testid="family-panel"
        padding="lg"
        radius="lg"
        withBorder
      >
        <Title id="family-title" order={1}>
          Family
        </Title>
        <Text mt="xs">
          Signed in to <strong>{session.household.name}</strong> as{' '}
          {session.member.email}.
        </Text>
        <Badge color="sage" mt="sm" variant="light">
          {isOwner ? 'Family owner' : 'Family member'}
        </Badge>
      </Card>

      {isOwner ? (
        <Card
          aria-labelledby="members-title"
          component="aside"
          padding="lg"
          radius="lg"
          withBorder
        >
          <Text c="clay.8" fw={700} fz="xs" tt="uppercase">
            Family access
          </Text>
          <Title id="members-title" order={2}>
            Members
          </Title>
          <form noValidate onSubmit={(event) => void addMember(event)}>
            <Stack gap="sm" mt="md">
              <TextInput
                error={formError && <span role="alert">{formError}</span>}
                id="member-email"
                label="Verified email address"
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
                withAsterisk={false}
              />
              <Button disabled={pending} type="submit" w="fit-content">
                Add member
              </Button>
            </Stack>
          </form>
          {memberList}
        </Card>
      ) : (
        <Card
          aria-label="Family access"
          component="aside"
          padding="lg"
          radius="lg"
          withBorder
        >
          <Text c="clay.8" fw={700} fz="xs" tt="uppercase">
            Family access
          </Text>
          <Title order={2}>Private by default</Title>
          <Text mt="xs">
            Your family owner manages who can access this shared space. More
            meal planning tools will arrive in a future phase.
          </Text>
        </Card>
      )}

      <Modal
        centered
        onClose={() => setConfirmation(null)}
        opened={confirmation !== null}
        title={wording?.title ?? ''}
      >
        {confirmation && wording && (
          <Stack gap="md">
            <Text>{wording.body}</Text>
            <Group justify="flex-end">
              <Button
                disabled={pending}
                onClick={() => setConfirmation(null)}
                variant="default"
              >
                Cancel
              </Button>
              <Button
                color="clay"
                disabled={pending}
                onClick={() =>
                  void (confirmation.kind === 'delete'
                    ? deleteMember()
                    : updateMember(confirmation.member, confirmation.update))
                }
              >
                {pending ? 'Working…' : wording.confirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
