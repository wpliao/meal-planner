import { useEffect, useState } from 'react';
import type { HealthResponse } from '../shared/api';

type ApiState =
  | { kind: 'loading' }
  | { kind: 'ready'; environment: string }
  | { kind: 'error' };

export function App() {
  const [apiState, setApiState] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Health check failed');
        return (await response.json()) as HealthResponse;
      })
      .then((health) =>
        setApiState({ kind: 'ready', environment: health.environment }),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setApiState({ kind: 'error' });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Our family kitchen</p>
        <h1 id="page-title">Good meals start with a simple plan.</h1>
        <p className="lede">
          The table is being set. Pantry, recipes, and weekly planning will
          arrive in a future phase.
        </p>
        <div className={`status status--${apiState.kind}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {apiState.kind === 'loading' && 'Checking the kitchen service…'}
          {apiState.kind === 'ready' &&
            `Kitchen service ready · ${apiState.environment}`}
          {apiState.kind === 'error' && 'Kitchen service is unavailable'}
        </div>
      </section>
      <aside className="card" aria-label="Foundation status">
        <p className="card__number">Phase 0</p>
        <h2>Foundation ready</h2>
        <p>
          A responsive React client and Cloudflare Worker now share one tested,
          deployable foundation.
        </p>
      </aside>
    </main>
  );
}
