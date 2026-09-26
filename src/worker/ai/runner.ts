import {
  failure,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './provider';

export interface AiAnswer<T> {
  provider: AiProvider['name'] | null;
  value: T | null;
}

export const runStructured = async <T>(
  providers: readonly AiProvider[],
  request: AiRequest,
  validate: (value: unknown) => T | null,
  lineCount: number,
  timeoutMs = 15_000,
): Promise<AiAnswer<T>> => {
  for (const provider of providers) {
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: AiResult;
    try {
      result = await Promise.race([
        provider.complete(request, controller.signal),
        new Promise<AiResult>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(failure('timeout'));
          }, timeoutMs);
        }),
      ]);
    } catch {
      result = failure('error');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const value = result.ok ? validate(result.value) : null;
    const outcome = result.ok
      ? value === null
        ? 'invalid'
        : 'ok'
      : result.failure;
    console.info('ai_proposal', {
      provider: provider.name,
      outcome,
      latencyMs: Date.now() - started,
      lineCount,
    });
    if (value !== null) return { provider: provider.name, value };
  }
  return { provider: null, value: null };
};
