import { describe, expect, it } from 'vitest';
import {
  aiRequestBody,
  attemptAfterStatus,
  chatContent,
  freeModelsFrom,
  intentPrompt,
  isFreeModelId,
  orderFreeModels,
  parseAiIntent,
} from '../../src/shared/ai-intent';

const catalog = {
  data: [
    {
      id: 'meta/llama-free:free',
      context_length: 8000,
      pricing: { prompt: '0', completion: '0', request: '0' },
    },
    { id: 'big/model:free', context_length: 128000, pricing: { prompt: '0', completion: '0' } },
    { id: 'paid/model', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'sneaky/model:free', context_length: 4000, pricing: { prompt: '0', completion: '0.00001' } },
    { id: 'no-pricing:free', context_length: 4000 },
    { id: 'image:free', pricing: { prompt: '0', completion: '0', image: '0.001' } },
  ],
};

describe('freeModelsFrom', () => {
  it('keeps only models that are free on every price', () => {
    const models = freeModelsFrom(catalog);
    expect(models.map((model) => model.id)).toEqual(['meta/llama-free:free', 'big/model:free']);
    expect(isFreeModelId('paid/model', models)).toBe(false);
    expect(isFreeModelId('big/model:free', models)).toBe(true);
    expect(freeModelsFrom(null)).toEqual([]);
  });
});

describe('parseAiIntent', () => {
  it('reads a JSON action even with extra text around it', () => {
    expect(parseAiIntent('Sure! {"action":"play","query":"Blinding Lights","reply":"Playing it"}')).toEqual({
      action: 'play',
      query: 'Blinding Lights',
      reply: 'Playing it',
    });
    expect(parseAiIntent('{"action":"none","query":"","reply":"I only do music"}')?.action).toBe('none');
  });

  it('rejects unknown actions and junk', () => {
    expect(parseAiIntent('{"action":"deleteEverything"}')).toBeNull();
    expect(parseAiIntent('no json here')).toBeNull();
    expect(parseAiIntent(42)).toBeNull();
  });
});

describe('chatContent and intentPrompt', () => {
  it('extracts the first choice', () => {
    expect(chatContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    expect(chatContent({})).toBeNull();
  });

  it('mentions offline preference only when offline', () => {
    expect(intentPrompt('play something', true)[0]?.content).toContain('offline');
    expect(intentPrompt('play something', false)[0]?.content).not.toContain('offline');
  });
});

describe('free model rotation', () => {
  const models = [
    { id: 'a:free', contextLength: 1 },
    { id: 'b:free', contextLength: 1 },
    { id: 'c:free', contextLength: 1 },
  ];

  it('keeps the popularity order, puts the last working model first, and skips cooling models', () => {
    expect(orderFreeModels(models, null, new Map(), 0).map((m) => m.id)).toEqual([
      'a:free',
      'b:free',
      'c:free',
    ]);
    expect(orderFreeModels(models, 'c:free', new Map(), 0).map((m) => m.id)).toEqual([
      'c:free',
      'a:free',
      'b:free',
    ]);
    const cooling = new Map([['a:free', 100]]);
    expect(orderFreeModels(models, null, cooling, 50).map((m) => m.id)).toEqual(['b:free', 'c:free']);
    expect(orderFreeModels(models, null, cooling, 150).map((m) => m.id)).toEqual([
      'a:free',
      'b:free',
      'c:free',
    ]);
    const allCooling = new Map(models.map((m) => [m.id, 100] as const));
    expect(orderFreeModels(models, null, allCooling, 50)).toHaveLength(3);
  });

  it('stops only when the key is refused and never builds a paid request', () => {
    expect(attemptAfterStatus(401)).toBe('stop');
    expect(attemptAfterStatus(429)).toBe('next');
    expect(attemptAfterStatus(404)).toBe('next');
    expect(attemptAfterStatus(403, 'Input was flagged by moderation')).toBe('next');
    expect(attemptAfterStatus(403, 'Key limit exceeded')).toBe('stop');
    expect(() => aiRequestBody('openai/gpt-5', [])).toThrow();
    expect(JSON.parse(aiRequestBody('a:free', []))).toMatchObject({ model: 'a:free', temperature: 0 });
  });
});
