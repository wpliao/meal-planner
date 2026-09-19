import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('client bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.replaceChildren();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('mounts the application into the root element', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            status: 'ok',
            environment: 'test',
            service: 'family-meal-planner',
          }),
        ),
      ),
    );

    await import('./main');

    expect(
      await screen.findByRole('heading', {
        name: 'Good meals start with a simple plan.',
      }),
    ).toBeInTheDocument();
  });

  it('fails clearly when the root element is absent', async () => {
    await expect(import('./main')).rejects.toThrow(
      'Application root element is missing',
    );
  });
});
