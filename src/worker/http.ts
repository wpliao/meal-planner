import type { ApiErrorResponse } from '../shared/api';
import { ApiError, invalidRequest } from './errors';

const MAX_JSON_BYTES = 8 * 1024;

export const json = (value: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'content-security-policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('referrer-policy', 'no-referrer');

  return Response.json(value, { ...init, headers });
};

export const errorResponse = (error: ApiError): Response => {
  const body: ApiErrorResponse = {
    error: { code: error.code, message: error.message },
  };
  return json(error.details ? { ...error.details, ...body } : body, {
    status: error.status,
  });
};

export const requireMutationHeaders = (request: Request): void => {
  const contentType = request.headers.get('content-type');
  if (
    !contentType ||
    contentType.split(';', 1)[0].trim() !== 'application/json'
  ) {
    throw new ApiError(
      415,
      'unsupported_media_type',
      'Mutations require application/json.',
    );
  }

  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw new ApiError(
      403,
      'invalid_origin',
      'A same-origin request is required.',
    );
  }
};

export const readJsonObject = async (
  request: Request,
  maxBytes: number = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> => {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const requestBody = request.body as ReadableStream<Uint8Array> | null;
  const reader = requestBody?.getReader();

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        byteLength += value.byteLength;
        if (byteLength > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ApiError(
            413,
            'payload_too_large',
            'Request body is too large.',
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidRequest('Request body must be valid JSON.');
  }

  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw invalidRequest('Request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
};

export const requireExactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
): void => {
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw invalidRequest(`Expected fields: ${fields.join(', ')}.`);
  }
};
