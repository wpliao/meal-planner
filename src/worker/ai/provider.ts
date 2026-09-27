/** The only contract feature code uses to request a structured AI answer. */
export interface AiRequest {
  system: string;
  user: unknown;
  schema: Record<string, unknown>;
}

export type AiFailure =
  'quota' | 'timeout' | 'invalid' | 'unavailable' | 'error';
export type AiResult =
  { ok: true; value: unknown } | { ok: false; failure: AiFailure };

export interface AiProvider {
  readonly name: 'workers-ai' | 'gemini' | 'fake';
  complete(request: AiRequest, signal: AbortSignal): Promise<AiResult>;
}

export const failure = (kind: AiFailure): AiResult => ({
  ok: false,
  failure: kind,
});

export const parseJson = (raw: unknown): AiResult => {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value !== null && typeof value === 'object'
      ? { ok: true, value }
      : failure('invalid');
  } catch {
    return failure('invalid');
  }
};

export const classifyStatus = (status: number): AiFailure => {
  if (status === 429 || status === 402) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  return 'error';
};
