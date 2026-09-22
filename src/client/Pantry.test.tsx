import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { Pantry } from './Pantry';
import { theme } from './theme';
import type { PantryItem } from '../shared/pantry';

const item = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 'item-1',
  name: 'Rice',
  status: 'available',
  version: 1,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

/** Narrows the recorded RequestInit body, which is typed as BodyInit | null. */
const sentBody = (init: RequestInit | undefined): unknown => {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error('expected a JSON string request body');
  }
  return JSON.parse(body);
};

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);

const listOnce = (items: PantryItem[]) => jsonResponse({ items });

/** Rename and Remove now live behind the per-item actions menu. */
const openItemMenu = async (name = 'Rice') => {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await screen.findByRole('menu');
};

/** Mantine components need the provider and this project's theme. */
const renderPantry = () =>
  render(
    <MantineProvider env="test" theme={theme}>
      <Pantry />
    </MantineProvider>,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pantry', () => {
  it('announces loading and then shows the empty state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => listOnce([]));

    renderPantry();
    expect(screen.getByText('Checking your pantry…')).toBeInTheDocument();

    expect(await screen.findByText(/The pantry is empty/u)).toBeInTheDocument();
  });

  it('shows a retry action when the pantry cannot be loaded', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => jsonResponse({}, 503))
      .mockImplementation(() => listOnce([item()]));

    renderPantry();

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText('We could not load the pantry. Please try again.'),
    ).toBeInTheDocument();

    fireEvent.click(retry);

    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('filters the shopping view to low and needed items', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      listOnce([
        item({ id: 'a', name: 'Rice', status: 'available' }),
        item({ id: 'b', name: 'Milk', status: 'low' }),
        item({ id: 'c', name: 'Eggs', status: 'needed' }),
      ]),
    );

    renderPantry();
    await screen.findByText('Rice');

    fireEvent.click(screen.getByRole('button', { name: 'Shopping (2)' }));

    expect(screen.getByText('Eggs')).toBeInTheDocument();
    expect(screen.getByText('Milk')).toBeInTheDocument();
    expect(screen.queryByText('Rice')).not.toBeInTheDocument();
  });

  it('explains an empty shopping view without implying full shelves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      listOnce([item({ status: 'available' })]),
    );

    renderPantry();
    await screen.findByText('Rice');
    fireEvent.click(screen.getByRole('button', { name: 'Shopping (0)' }));

    expect(
      screen.getByText(/does not mean the family owns everything/u),
    ).toBeInTheDocument();
  });

  it('requires a name before submitting', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => listOnce([]));

    renderPantry();
    await screen.findByText(/The pantry is empty/u);

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(
      screen.getByText('Enter the name of the item to add.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds an item with the chosen signal and reconciles from the server', async () => {
    const added = item({ id: 'new', name: 'Flour', status: 'needed' });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([]))
      .mockImplementationOnce(() => jsonResponse({ item: added }, 201))
      .mockImplementation(() => listOnce([added]));

    renderPantry();
    await screen.findByText(/The pantry is empty/u);

    fireEvent.change(screen.getByLabelText('Item name'), {
      target: { value: 'Flour' },
    });
    fireEvent.click(screen.getByLabelText('Needed'));
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(
      await screen.findByText('Flour was added to the pantry.'),
    ).toBeInTheDocument();

    const [, createCall] = fetchMock.mock.calls;
    expect(createCall[0]).toBe('/api/pantry/items');
    expect(sentBody(createCall[1] as RequestInit)).toEqual({
      name: 'Flour',
      status: 'needed',
    });
  });

  it('sends the current version when changing a signal', async () => {
    const current = item({ status: 'low', version: 4 });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([current]))
      .mockImplementationOnce(() =>
        jsonResponse({ item: { ...current, status: 'available', version: 5 } }),
      )
      .mockImplementation(() =>
        listOnce([{ ...current, status: 'available', version: 5 }]),
      );

    renderPantry();
    await screen.findByText('Rice');

    const signals = screen.getByRole('group', { name: 'Status for Rice' });
    fireEvent.click(within(signals).getByRole('button', { name: 'Available' }));

    expect(
      await screen.findByText('Rice is now marked Available.'),
    ).toBeInTheDocument();

    const [, patchCall] = fetchMock.mock.calls;
    expect(sentBody(patchCall[1] as RequestInit)).toEqual({
      version: 4,
      status: 'available',
    });
  });

  it('surfaces a stale-version conflict and reloads the latest item', async () => {
    const stale = item({ status: 'low', version: 1 });
    const fresh = item({ status: 'needed', version: 2 });
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([stale]))
      .mockImplementationOnce(() =>
        jsonResponse(
          {
            error: {
              code: 'stale_version',
              message:
                'Someone else changed this item. Reload to see the latest version.',
            },
          },
          409,
        ),
      )
      .mockImplementation(() => listOnce([fresh]));

    renderPantry();
    await screen.findByText('Rice');

    const signals = screen.getByRole('group', { name: 'Status for Rice' });
    fireEvent.click(within(signals).getByRole('button', { name: 'Available' }));

    expect(
      await screen.findByText(
        'Someone else changed this item. Reload to see the latest version.',
      ),
    ).toBeInTheDocument();
    const refreshed = screen.getByRole('group', { name: 'Status for Rice' });
    expect(
      within(refreshed).getByRole('button', { name: 'Needed' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports a duplicate name from the server', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([]))
      .mockImplementationOnce(() =>
        jsonResponse(
          {
            error: {
              code: 'duplicate_name',
              message: 'That item is already in your pantry.',
            },
          },
          409,
        ),
      )
      .mockImplementation(() => listOnce([item()]));

    renderPantry();
    await screen.findByText(/The pantry is empty/u);

    fireEvent.change(screen.getByLabelText('Item name'), {
      target: { value: 'Rice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(
      await screen.findByText('That item is already in your pantry.'),
    ).toBeInTheDocument();
  });

  it('renames an item through an inline form', async () => {
    const current = item({ version: 2 });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([current]))
      .mockImplementationOnce(() =>
        jsonResponse({ item: { ...current, name: 'Brown rice', version: 3 } }),
      )
      .mockImplementation(() =>
        listOnce([{ ...current, name: 'Brown rice', version: 3 }]),
      );

    renderPantry();
    await screen.findByText('Rice');

    await openItemMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New name'), {
      target: { value: 'Brown rice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('The item was renamed to Brown rice.'),
    ).toBeInTheDocument();

    const [, patchCall] = fetchMock.mock.calls;
    expect(sentBody(patchCall[1] as RequestInit)).toEqual({
      version: 2,
      name: 'Brown rice',
    });
  });

  it('confirms removal, names the item, and can be cancelled', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => listOnce([item()]));

    renderPantry();
    await screen.findByText('Rice');

    await openItemMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remove Rice?')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('closes the confirmation dialog on Escape without deleting', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => listOnce([item()]));

    renderPantry();
    await screen.findByText('Rice');
    await openItemMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deletes with the current version and announces the result', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([item({ version: 7 })]))
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: true, status: 204 } as Response),
      )
      .mockImplementation(() => listOnce([]));

    renderPantry();
    await screen.findByText('Rice');

    await openItemMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));

    expect(
      await screen.findByText('Rice was removed from the pantry.'),
    ).toBeInTheDocument();

    const [, deleteCall] = fetchMock.mock.calls;
    expect((deleteCall[1] as RequestInit).method).toBe('DELETE');
    expect(sentBody(deleteCall[1] as RequestInit)).toEqual({
      version: 7,
    });
  });

  it('keeps focus inside the confirmation dialog and closes on Escape', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => listOnce([item()]));

    renderPantry();
    await screen.findByText('Rice');
    await openItemMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    // The dialog is modal, so focus must move into it rather than stay behind
    // it on the page.
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    expect(
      within(dialog).getByRole('button', { name: 'Remove item' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('restores focus to the trigger when the dialog is cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => listOnce([item()]));

    renderPantry();
    await screen.findByText('Rice');
    await openItemMenu();
    const trigger = screen.getByRole('button', { name: 'Actions for Rice' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens the actions menu and closes it on Escape', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => listOnce([item()]));

    render(
      <MantineProvider env="test" theme={theme}>
        <Pantry />
      </MantineProvider>,
    );
    await screen.findByText('Rice');

    const trigger = screen.getByRole('button', { name: 'Actions for Rice' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await openItemMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      await screen.findByRole('menuitem', { name: 'Rename' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Remove' }),
    ).toBeInTheDocument();

    // Keyboard navigation inside the dropdown is the library's; what matters
    // here is that the menu is dismissible without a mouse.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('moves focus to the result message after a change', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => listOnce([item({ status: 'low' })]))
      .mockImplementationOnce(() =>
        jsonResponse({ item: item({ status: 'available', version: 2 }) }),
      )
      .mockImplementation(() => listOnce([item({ status: 'available' })]));

    renderPantry();
    await screen.findByText('Rice');

    const signals = screen.getByRole('group', { name: 'Status for Rice' });
    fireEvent.click(within(signals).getByRole('button', { name: 'Available' }));

    await screen.findByText('Rice is now marked Available.');
    // The alert root is what takes focus; findByText returns its inner text
    // element, which never does.
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
  });
});
