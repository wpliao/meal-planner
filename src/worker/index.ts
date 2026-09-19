import type { HealthResponse } from '../shared/api';

const json = (value: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');

  return Response.json(value, { ...init, headers });
};

export default {
  fetch(request, env): Response {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      const body: HealthResponse = {
        status: 'ok',
        environment: env.APP_ENV,
        service: 'family-meal-planner',
      };
      return json(body);
    }

    return json({ error: 'Not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
