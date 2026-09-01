import { describe, it, expect } from 'vitest';
import { claudeText } from './claudeText';

describe('claudeText', () => {
  it('reads text when it is the only block', () => {
    expect(claudeText({ content: [{ type: 'text', text: '{"materials":[]}' }] })).toBe('{"materials":[]}');
  });

  // The regression. Turning on adaptive thinking for Opus 5 put a thinking
  // block at position 0; `content[0].text` was undefined, the JSON parse threw
  // on `.trim()`, and the handler logged a Claude outage and served every
  // quote from the Gemini fallback — so the model switch did nothing except
  // add Claude's latency to each request.
  it('skips a leading thinking block', () => {
    const data = {
      content: [
        { type: 'thinking', thinking: 'weighing the deck framing…', signature: 'sig' },
        { type: 'text', text: '{"materials":[{"name":"Merbau"}]}' },
      ],
    };
    expect(claudeText(data)).toBe('{"materials":[{"name":"Merbau"}]}');
  });

  it('joins text split across several blocks', () => {
    const data = { content: [{ type: 'text', text: '{"mat' }, { type: 'text', text: 'erials":[]}' }] };
    expect(claudeText(data)).toBe('{"materials":[]}');
  });

  it('ignores tool_use and other non-text blocks', () => {
    const data = {
      content: [
        { type: 'tool_use', id: 't1', name: 'search', input: {} },
        { type: 'text', text: 'ok' },
      ],
    };
    expect(claudeText(data)).toBe('ok');
  });

  // Callers branch on empty to raise a real error instead of parsing undefined.
  it('returns empty string rather than throwing on missing or odd shapes', () => {
    expect(claudeText({ content: [{ type: 'thinking', thinking: 'x' }] })).toBe('');
    expect(claudeText({ content: [] })).toBe('');
    expect(claudeText({})).toBe('');
    expect(claudeText(null)).toBe('');
    expect(claudeText({ content: 'not-an-array' })).toBe('');
    expect(claudeText({ content: [{ type: 'text' }] })).toBe('');
  });
});
