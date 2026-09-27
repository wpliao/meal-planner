import { describe, expect, it, vi } from 'vitest';
import {
  choosePrompt,
  normalizePrompt,
  validateChoices,
  validateNormalized,
} from '../../src/worker/ai/nutrition-proposals';
import { runStructured } from '../../src/worker/ai/runner';
import {
  geminiProvider,
  workersAiProvider,
} from '../../src/worker/ai/providers';
import type { AiProvider, AiResult } from '../../src/worker/ai/provider';
import { classifyStatus, parseJson } from '../../src/worker/ai/provider';

const request = {
  system: 'instruction',
  user: { lines: [] },
  schema: { type: 'object' },
};
const good = {
  lines: [
    {
      position: 1,
      phrase: 'soy sauce',
      quantity: 2,
      unit: 'tbsp',
      notFood: false,
    },
  ],
};
const line = [{ position: 1, text: '2 tbsp soy sauce' }];

describe('nutrition AI payloads', () => {
  it('sends only the title, requested lines, USDA names and portions', () => {
    const recipe = {
      title: 'Dinner',
      ingredients: ['2 tbsp soy sauce'],
      notes: 'private note',
      steps: ['private step'],
      source: { submittedUrl: 'https://private.example' },
      id: 'recipe-secret',
      householdId: 'house-secret',
      memberId: 'member-secret',
    };
    const normalized = normalizePrompt(recipe.title, line);
    const chosen = choosePrompt(
      recipe.title,
      line,
      new Map([
        [
          1,
          [
            {
              fdcId: 174278,
              name: 'Soy sauce',
              category: 'Condiments',
              dataType: 'sr_legacy',
              volumeSeq: 1,
              portions: [{ seq: 1, amount: 1, label: 'tbsp', gramWeight: 18 }],
            },
          ],
        ],
      ]),
      good.lines,
    );
    const sent = JSON.stringify([normalized, chosen]);
    expect(sent).toContain('Dinner');
    expect(sent).toContain('Soy sauce');
    for (const secret of [
      'private note',
      'private step',
      'private.example',
      'recipe-secret',
      'house-secret',
      'member-secret',
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).not.toContain('energyKj');
    expect(sent).not.toContain('category');
  });

  it('rejects malformed or foreign positions but ignores extra fields', () => {
    expect(validateNormalized(good, line)).toHaveLength(1);
    expect(
      validateNormalized({ lines: [{ ...good.lines[0], position: 9 }] }, line),
    ).toBeNull();
    expect(
      validateNormalized(
        { lines: [{ ...good.lines[0], quantity: 'two' }] },
        line,
      ),
    ).toBeNull();
    expect(
      validateChoices(
        {
          lines: [
            {
              position: 1,
              fdcId: 174278,
              quantity: 2,
              unit: 'tbsp',
              energyKj: 999,
            },
          ],
        },
        line,
      ),
    ).toHaveLength(1);
    expect(
      validateChoices(
        { lines: [{ position: 9, fdcId: 174278, quantity: 2, unit: 'tbsp' }] },
        line,
      ),
    ).toBeNull();
    expect(
      validateChoices(
        {
          lines: [{ position: 1, fdcId: '174278', quantity: 2, unit: 'tbsp' }],
        },
        line,
      ),
    ).toBeNull();
  });
});

const provider = (name: AiProvider['name'], result: AiResult): AiProvider => ({
  name,
  complete: () => Promise.resolve(result),
});

describe('provider fallback', () => {
  it.each(['quota', 'invalid', 'unavailable', 'error'] as const)(
    'tries Gemini after %s',
    async (kind) => {
      const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const answer = await runStructured(
        [
          provider('workers-ai', { ok: false, failure: kind }),
          provider('gemini', { ok: true, value: good }),
        ],
        request,
        (value) => validateNormalized(value, line),
        1,
      );
      expect(answer.provider).toBe('gemini');
      expect(log).toHaveBeenCalledTimes(2);
      log.mockRestore();
    },
  );

  it('times out Workers AI, aborts it, then tries Gemini', async () => {
    let aborted = false;
    const slow: AiProvider = {
      name: 'workers-ai',
      complete: (_request, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise<AiResult>(() => undefined);
      },
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const answer = await runStructured(
      [slow, provider('gemini', { ok: true, value: good })],
      request,
      (value) => validateNormalized(value, line),
      1,
      5,
    );
    expect(aborted).toBe(true);
    expect(answer.provider).toBe('gemini');
    vi.restoreAllMocks();
  });

  it('treats structurally invalid success as failure', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const answer = await runStructured(
      [
        provider('workers-ai', { ok: true, value: { lines: 'wrong' } }),
        provider('gemini', { ok: true, value: good }),
      ],
      request,
      (value) => validateNormalized(value, line),
      1,
    );
    expect(answer.provider).toBe('gemini');
    vi.restoreAllMocks();
  });

  it('does not attempt an unconfigured fallback', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const answer = await runStructured(
      [provider('workers-ai', { ok: false, failure: 'quota' })],
      request,
      (value) => validateNormalized(value, line),
      1,
    );
    expect(answer).toEqual({ provider: null, value: null });
    vi.restoreAllMocks();
  });

  it('tries the next provider when the first throws', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const throwing: AiProvider = {
      name: 'workers-ai',
      complete: () => Promise.reject(new TypeError('provider failed')),
    };
    const answer = await runStructured(
      [throwing, provider('gemini', { ok: true, value: good })],
      request,
      (value) => validateNormalized(value, line),
      1,
    );
    expect(answer.provider).toBe('gemini');
    vi.restoreAllMocks();
  });
});

describe('provider response boundary', () => {
  it('parses an object or JSON string, and refuses invalid content', () => {
    expect(parseJson(good)).toEqual({ ok: true, value: good });
    expect(parseJson(JSON.stringify(good))).toEqual({ ok: true, value: good });
    expect(parseJson('not JSON')).toEqual({ ok: false, failure: 'invalid' });
    expect(parseJson(null)).toEqual({ ok: false, failure: 'invalid' });
    expect(parseJson('42')).toEqual({ ok: false, failure: 'invalid' });
  });

  it.each([
    [429, 'quota'],
    [402, 'quota'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'error'],
  ] as const)('classifies provider HTTP %s', (status, outcome) => {
    expect(classifyStatus(status)).toBe(outcome);
  });
});

describe('gateway adapters', () => {
  it('runs Workers AI in JSON mode through the named gateway', async () => {
    const run = vi.fn().mockResolvedValue({ response: good });
    const adapter = workersAiProvider(
      { run } as unknown as Ai,
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'development-gateway',
    );
    const result = await adapter.complete(
      request,
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: true, value: good });
    expect(run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      expect.objectContaining({
        response_format: { type: 'json_schema', json_schema: request.schema },
      }),
      { gateway: { id: 'development-gateway', skipCache: true } },
    );
  });

  it('sends Gemini through the authenticated Google AI Studio gateway endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(good) }] } },
          ],
        }),
        { status: 200 },
      ),
    );
    const adapter = geminiProvider(
      'account-id',
      'development-gateway',
      'gemini-3.5-flash-lite',
      'fake-key',
      'fake-token',
      fetcher,
    );
    const result = await adapter.complete(
      request,
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: true, value: good });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://gateway.ai.cloudflare.com/v1/account-id/development-gateway/google-ai-studio/v1/models/gemini-3.5-flash-lite:generateContent',
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('fake-key');
    expect(headers['cf-aig-authorization']).toBe('Bearer fake-token');
    expect(
      JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
    ).toMatchObject({
      systemInstruction: { parts: [{ text: request.system }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: request.schema,
      },
    });
  });

  it('does not call Gemini without every required secret', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = geminiProvider(
      undefined,
      'development-gateway',
      'gemini-3.5-flash-lite',
      'fake-key',
      'fake-token',
      fetcher,
    );
    expect(
      await adapter.complete(request, new AbortController().signal),
    ).toEqual({ ok: false, failure: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an unconfigured Workers AI binding', async () => {
    expect(
      await workersAiProvider(undefined, 'off', 'development-gateway').complete(
        request,
        new AbortController().signal,
      ),
    ).toEqual({ ok: false, failure: 'unavailable' });
  });

  it('classifies a Workers AI quota error and rejects malformed JSON', async () => {
    const quota = workersAiProvider(
      { run: vi.fn().mockRejectedValue({ status: 429 }) } as unknown as Ai,
      'model',
      'development-gateway',
    );
    expect(await quota.complete(request, new AbortController().signal)).toEqual(
      { ok: false, failure: 'quota' },
    );
    const malformed = workersAiProvider(
      { run: vi.fn().mockResolvedValue({ response: '{' }) } as unknown as Ai,
      'model',
      'development-gateway',
    );
    expect(
      await malformed.complete(request, new AbortController().signal),
    ).toEqual({ ok: false, failure: 'invalid' });
  });

  it('classifies Gemini quota and malformed answers', async () => {
    const quota = geminiProvider(
      'account',
      'gateway',
      'model',
      'fake-key',
      'fake-token',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('', { status: 429 })),
    );
    expect(await quota.complete(request, new AbortController().signal)).toEqual(
      { ok: false, failure: 'quota' },
    );
    const malformed = geminiProvider(
      'account',
      'gateway',
      'model',
      'fake-key',
      'fake-token',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
        ),
    );
    expect(
      await malformed.complete(request, new AbortController().signal),
    ).toEqual({ ok: false, failure: 'invalid' });
  });

  it('classifies Gemini aborts and transport errors', async () => {
    for (const [error, outcome] of [
      [new DOMException('aborted', 'AbortError'), 'timeout'],
      [new TypeError('offline'), 'error'],
    ] as const) {
      const adapter = geminiProvider(
        'account',
        'gateway',
        'model',
        'fake-key',
        'fake-token',
        vi.fn<typeof fetch>().mockRejectedValue(error),
      );
      expect(
        await adapter.complete(request, new AbortController().signal),
      ).toEqual({ ok: false, failure: outcome });
    }
  });
});
