// The loading line is built from real tool calls, never from model reasoning.
// These cases pin the two things that matter: it reads like a tradie's mate,
// and it never leaks a tool name or an id to the screen.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THINKING_LABEL,
  labelForToolCall,
  labelForToolCalls,
} from '../thinkingLabels';
import { READ_TOOL_NAMES, PROPOSAL_TOOL_NAMES } from '../../../services/assistant/toolSchemas';

describe('labelForToolCall', () => {
  it('names the customer being looked up', () => {
    expect(labelForToolCall('find_customer', { name: 'Sam' })).toBe('Looking up Sam…');
  });

  it('falls back to a generic line when no name was given', () => {
    expect(labelForToolCall('find_customer', {})).toBe('Looking up the customer…');
    expect(labelForToolCall('find_customer')).toBe('Looking up the customer…');
  });

  it('ignores a blank or non-string name', () => {
    expect(labelForToolCall('find_customer', { name: '   ' })).toBe('Looking up the customer…');
    expect(labelForToolCall('find_customer', { name: 42 })).toBe('Looking up the customer…');
  });

  it('describes the read tools in plain words', () => {
    expect(labelForToolCall('get_job_requirements')).toBe('Working out what this job needs…');
    expect(labelForToolCall('review_quote')).toBe('Checking the prices…');
    expect(labelForToolCall('list_recent_quotes')).toBe('Going through your recent quotes…');
  });

  it('falls back to a neutral line for an unknown tool', () => {
    expect(labelForToolCall('some_future_tool')).toBe(DEFAULT_THINKING_LABEL);
  });

  it('gives every declared tool a line that never leaks the tool name or an id', () => {
    // A missing case must not put "propose_mark_paid" on a tradie's screen.
    for (const name of [...READ_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES, 'show_quote']) {
      const label = labelForToolCall(name, { quoteId: 'abc123', contactId: 'xyz789' });
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toContain('_');
      expect(label).not.toContain('abc123');
      expect(label).not.toContain('xyz789');
      expect(label).toMatch(/…$/);
    }
  });
});

describe('labelForToolCalls', () => {
  it('describes the first call when the model asks for several at once', () => {
    expect(
      labelForToolCalls([
        { name: 'find_customer', args: { name: 'Dee' } },
        { name: 'get_job_requirements' },
      ]),
    ).toBe('Looking up Dee…');
  });

  it('falls back to the neutral line with no calls', () => {
    expect(labelForToolCalls([])).toBe(DEFAULT_THINKING_LABEL);
  });
});
