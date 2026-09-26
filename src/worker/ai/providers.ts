import {
  classifyStatus,
  failure,
  parseJson,
  type AiProvider,
} from './provider';

/** Cloudflare's generated `Ai` type permits many models; this route uses JSON mode. */
export const workersAiProvider = (
  ai: Ai | undefined,
  model: string,
  gatewayId: string,
): AiProvider => ({
  name: 'workers-ai',
  async complete(request) {
    if (!ai || model === 'off' || !gatewayId) return failure('unavailable');
    try {
      const answer: unknown = await ai.run(
        model,
        {
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: JSON.stringify(request.user) },
          ],
          response_format: { type: 'json_schema', json_schema: request.schema },
        } as Parameters<Ai['run']>[1],
        { gateway: { id: gatewayId, skipCache: true } },
      );
      if (answer && typeof answer === 'object' && 'response' in answer) {
        return parseJson(answer.response);
      }
      return parseJson(answer);
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : 0;
      return failure(classifyStatus(status));
    }
  },
});

export const geminiProvider = (
  accountId: string | undefined,
  gatewayId: string,
  model: string,
  apiKey: string | undefined,
  gatewayToken: string | undefined,
  fetcher: typeof fetch = fetch,
): AiProvider => ({
  name: 'gemini',
  async complete(request, signal) {
    if (
      !apiKey ||
      !gatewayToken ||
      !accountId ||
      !gatewayId ||
      model === 'off'
    ) {
      return failure('unavailable');
    }
    const url = `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/google-ai-studio/v1/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          'cf-aig-authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [
            { role: 'user', parts: [{ text: JSON.stringify(request.user) }] },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: request.schema,
            temperature: 0,
          },
        }),
      });
      if (!response.ok) return failure(classifyStatus(response.status));
      const body: unknown = await response.json();
      const text =
        body && typeof body === 'object' && 'candidates' in body
          ? (
              body.candidates as { content?: { parts?: { text?: string }[] } }[]
            )?.[0]?.content?.parts?.[0]?.text
          : undefined;
      return parseJson(text);
    } catch (error) {
      return failure(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'timeout'
          : 'error',
      );
    }
  },
});

/** Local answers are deterministic and never contact a model or gateway. */
export const fakeProvider = (): AiProvider => ({
  name: 'fake',
  complete(request) {
    const user = request.user as {
      step: string;
      lines: {
        position: number;
        text: string;
        suggestedQuantity?: number;
        suggestedUnit?: string;
        candidates?: {
          fdcId: number;
          portions?: { seq: number; label: string }[];
        }[];
      }[];
    };
    if (user.lines.some((line) => line.text.includes('[AI_UNAVAILABLE]'))) {
      return Promise.resolve(failure('unavailable'));
    }
    if (user.step === 'normalize') {
      return Promise.resolve({
        ok: true,
        value: {
          lines: user.lines.map((line) => ({
            position: line.position,
            phrase: line.text
              .replace(
                /^\s*[\d.,/]+\s*(?:g|kg|ml|l|tsp|tbsp|cups?|large)?\s*/iu,
                '',
              )
              .trim(),
            quantity: Number(line.text.match(/\d+(?:\.\d+)?/u)?.[0] ?? 1),
            unit:
              line.text
                .match(/\b(tbsp|tsp|kg|g|ml|l|cup)\b/iu)?.[0]
                ?.toLowerCase() ?? 'g',
            notFood: /\b(?:salt|water)\b/iu.test(line.text),
          })),
        },
      });
    }
    return Promise.resolve({
      ok: true,
      value: {
        lines: user.lines.map((line) => ({
          position: line.position,
          fdcId: line.candidates?.[0]?.fdcId ?? 0,
          quantity: line.candidates?.[0] ? (line.suggestedQuantity ?? 1) : 1,
          unit:
            line.suggestedUnit &&
            ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup'].includes(
              line.suggestedUnit,
            )
              ? line.suggestedUnit
              : 'g',
        })),
      },
    });
  },
});
