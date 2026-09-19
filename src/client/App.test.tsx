import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the Worker environment when the health check succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          status: 'ok',
          environment: 'test',
          service: 'family-meal-planner',
        }),
      ),
    );

    render(<App />);

    expect(
      await screen.findByText('Kitchen service ready · test'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Good meals start with a simple plan.',
      }),
    ).toBeInTheDocument();
  });

  it('shows an accessible failure state when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<App />);

    expect(
      await screen.findByText('Kitchen service is unavailable'),
    ).toBeInTheDocument();
  });
});
