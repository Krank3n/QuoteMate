/**
 * The tradie's standing rules reach the materials prompt as part of the
 * trade-context section — and are capped again at the boundary, because the
 * request body is whatever the client sent.
 */
import { describe, it, expect } from 'vitest';
import { renderQuotingPreferences } from './materialsPrompt';

describe('renderQuotingPreferences', () => {
  it('renders nothing for a missing, empty or malformed list', () => {
    expect(renderQuotingPreferences(undefined)).toBe('');
    expect(renderQuotingPreferences(null)).toBe('');
    expect(renderQuotingPreferences([])).toBe('');
    expect(renderQuotingPreferences('labour only')).toBe('');
    expect(renderQuotingPreferences([42, '', '   '])).toBe('');
  });

  it('renders each rule on its own line under a heading that says to follow them', () => {
    const block = renderQuotingPreferences(['  customers supply their own\n materials ', 'we only quote labour']);
    expect(block).toBe(
      '\n- How this tradie quotes (their own standing rules — follow them when deciding what to list and how):' +
        '\n  - customers supply their own materials' +
        '\n  - we only quote labour',
    );
  });

  it('caps the count and the length at the boundary', () => {
    const many = Array.from({ length: 30 }, (_, i) => `rule ${i} ${'x'.repeat(200)}`);
    const block = renderQuotingPreferences(many);
    const lines = block.split('\n').filter((l) => l.startsWith('  - '));
    expect(lines).toHaveLength(20);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(4 + 160);
  });
});
