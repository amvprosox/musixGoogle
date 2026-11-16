import { describe, expect, it } from 'vitest';
import {
  chatContent,
  freeModelsFrom,
  intentPrompt,
  isFreeModelId,
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
    expect(models.map((model) => model.id)).toEqual(['big/model:free', 'meta/llama-free:free']);
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
