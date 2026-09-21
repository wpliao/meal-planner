import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const ownerSession = {
  status: 'ready' as const,
  member: {
    id: 'owner-1',
    email: 'owner@example.test',
    role: 'owner' as const,
  },
  household: { id: 'household-1', name: 'Liao family' },
};

const memberSession = {
  ...ownerSession,
  member: {
    id: 'member-1',
    email: 'member@example.test',
    role: 'member' as const,
  },
};

const members = [
  {
    id: 'owner-1',
    email: 'owner@example.test',
    role: 'owner' as const,
    status: 'active' as const,
  },
  {
    id: 'invite-1',
    email: 'invitee@example.test',
    role: 'member' as const,
    status: 'invited' as const,
  },
  {
    id: 'revoked-1',
    email: 'former@example.test',
    role: 'member' as const,
    status: 'revoked' as const,
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the member-only family view without management controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(memberSession)));
    render(<App />);

    expect(await screen.findByText('Liao family')).toBeInTheDocument();
    expect(
      screen.getByText('Family member', { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Members' }),
    ).not.toBeInTheDocument();
  });

  it('explains the not-a-member state without revealing a household', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ status: 'not-a-member' })),
    );
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'You are not a family member',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/has not been added to this family/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Liao family')).not.toBeInTheDocument();
  });

  it('shows the shared pantry to a regular member', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        input === '/api/session' ? json(memberSession) : json({ items: [] }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Pantry' }),
    ).toBeInTheDocument();
    // The pantry is shared; the owner-only members panel stays hidden.
    expect(
      screen.queryByRole('heading', { name: 'Members' }),
    ).not.toBeInTheDocument();
  });

  it('does not load the pantry before a session is ready', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        input === '/api/session'
          ? json({ status: 'not-a-member' })
          : json({ items: [] }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'You are not a family member',
      }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/pantry/items'),
    ).toHaveLength(0);
  });

  it('retries an unavailable session', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json(memberSession))
      // The ready session also mounts the pantry, which loads its own items.
      .mockResolvedValue(json({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(
      await screen.findByRole('heading', {
        name: 'The family space is unavailable',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Liao family')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/session'),
    ).toHaveLength(2);
  });

  it('confirms first-owner setup and focuses the success result', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/bootstrap') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(
          JSON.stringify({ householdName: 'Family table' }),
        );
        return Promise.resolve(json({}));
      }
      if (
        fetchMock.mock.calls.filter(([url]) => url === '/api/session')
          .length === 1
      )
        return Promise.resolve(json({ status: 'setup-required' }));
      if (input === '/api/household/members')
        return Promise.resolve(json({ members: [] }));
      return Promise.resolve(json(ownerSession));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Set up your family space' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Family space name'), {
      target: { value: 'Family table' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create family space' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Create “Family table”');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create family space' }),
    );

    const result = await screen.findByText('Your family space is ready.');
    await waitFor(() => expect(result).toHaveFocus());
  });

  it('lets an owner add members and renders lifecycle actions', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') return Promise.resolve(json(ownerSession));
      if (input === '/api/household/members' && init?.method === 'POST')
        return Promise.resolve(
          json({ member: { ...members[1], email: 'new@example.test' } }),
        );
      return Promise.resolve(json({ members }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Members' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Make member' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reactivate' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verified email address'), {
      target: { value: 'new@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    const result = await screen.findByText(/new@example.test is invited/i);
    expect(result).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/members',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a safe conflict message when adding a member fails without an error body', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') return Promise.resolve(json(ownerSession));
      if (input === '/api/household/members' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      return Promise.resolve(json({ members: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Members' });
    fireEvent.change(screen.getByLabelText('Verified email address'), {
      target: { value: 'duplicate@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This change cannot be completed because the household has changed.',
    );
  });

  it('promotes an active member without destructive confirmation', async () => {
    const activeMember = {
      ...members[1],
      id: 'active-1',
      email: 'active@example.test',
      status: 'active' as const,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') return Promise.resolve(json(ownerSession));
      if (init?.method === 'PATCH') {
        return Promise.resolve(
          json({ member: { ...activeMember, role: 'owner' } }),
        );
      }
      return Promise.resolve(json({ members: [members[0], activeMember] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const row = await screen.findByRole('row', {
      name: /active@example\.test/i,
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Make owner' }));

    expect(
      await screen.findByText('Member access was updated.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/members/active-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'owner' }),
      }),
    );
  });

  it('labels, dismisses, and restores focus from member removal confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          json(input === '/api/session' ? ownerSession : { members }),
        ),
      ),
    );
    render(<App />);

    const remove = (
      await screen.findAllByRole('button', { name: 'Remove' })
    )[0];
    remove.focus();
    fireEvent.click(remove);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove invitee@example.test?');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Remove member' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(remove).toHaveFocus();
  });

  it('sends the required JSON content type when removing a member', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') return Promise.resolve(json(ownerSession));
      if (init?.method === 'DELETE')
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json({ members }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Remove' }))[0],
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Remove member',
      }),
    );

    expect(await screen.findByText('Member was removed.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/members/invite-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('confirms a self-demotion and immediately renders the member-only view', async () => {
    let sessionRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') {
        sessionRequests += 1;
        return Promise.resolve(
          json(sessionRequests === 1 ? ownerSession : memberSession),
        );
      }
      if (init?.method === 'PATCH')
        return Promise.resolve(json({ member: members[0] }));
      return Promise.resolve(json({ members }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make member' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('immediately lose owner permissions');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Make member' }),
    );

    expect(
      await screen.findByText('Family member', { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Members' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Member access was updated.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/members/owner-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'member' }),
      }),
    );
  });

  it('confirms self-revocation and immediately removes the owner view', async () => {
    let sessionRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/session') {
        sessionRequests += 1;
        return Promise.resolve(
          json(
            sessionRequests === 1 ? ownerSession : { status: 'not-a-member' },
          ),
        );
      }
      if (init?.method === 'PATCH')
        return Promise.resolve(json({ member: members[0] }));
      return Promise.resolve(json({ members }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Revoke' }))[0],
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('immediately lose access');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Revoke member' }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'You are not a family member',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Member access was updated.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/household/members/owner-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked' }),
      }),
    );
  });

  it('keeps a bootstrap failure visible after refreshing the session', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input === '/api/bootstrap') {
        return Promise.resolve(
          json(
            {
              error: {
                code: 'state_conflict',
                message: 'A family space has already been created.',
              },
            },
            409,
          ),
        );
      }
      return Promise.resolve(json({ status: 'setup-required' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Set up your family space' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create family space' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create family space',
      }),
    );

    expect(
      await screen.findByText('A family space has already been created.'),
    ).toBeInTheDocument();
  });

  it('keeps focus within a pending confirmation when all dialog controls are disabled', async () => {
    let resolveBootstrap: (response: Response) => void;
    const bootstrapResponse = new Promise<Response>((resolve) => {
      resolveBootstrap = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (input === '/api/bootstrap') return bootstrapResponse;
        return Promise.resolve(json({ status: 'setup-required' }));
      }),
    );
    render(<App />);

    await screen.findByRole('heading', { name: 'Set up your family space' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create family space' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create family space',
      }),
    );

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();

    resolveBootstrap!(json({}));
    expect(
      await screen.findByText('Your family space is ready.'),
    ).toBeInTheDocument();
  });

  it('associates a visible inline validation error with the email field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          json(input === '/api/session' ? ownerSession : { members: [] }),
        ),
      ),
    );
    render(<App />);

    await screen.findByRole('heading', { name: 'Members' });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    const field = screen.getByLabelText('Verified email address');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the email address',
    );
    expect(field).toHaveAttribute('aria-describedby', 'member-email-error');
  });
});
