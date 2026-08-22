import { describe, it, expect } from 'vitest';
import { getMateIntro, isBlankSlate } from '../mateIntro';

const NOON = new Date('2026-08-21T12:00:00');

function quote(overrides: Partial<{ status: string; updatedAt: Date; job: { name?: string }; customerName: string }> = {}) {
  return {
    status: 'sent',
    updatedAt: new Date('2026-08-01T09:00:00'),
    ...overrides,
  };
}

// Every opener getMateIntro can pick from, across all times of day — the
// pick is random, so tests assert membership.
const OPENERS = [
  'Mornin’. What are we quoting?',
  'G’day. What’s the job?',
  'What are we quoting?',
  'What’s the job?',
  'Arvo. What are we quoting?',
  'What’s next on the list?',
  'Evenin’. What are we quoting?',
];

describe('getMateIntro', () => {
  it('surfaces the most recently touched draft in the primary line', () => {
    const intro = getMateIntro(
      [
        quote({ status: 'draft', updatedAt: new Date('2026-08-10'), job: { name: 'Old deck' } }),
        quote({ status: 'draft', updatedAt: new Date('2026-08-20'), job: { name: 'Kitchen paint' } }),
        quote({ status: 'sent', updatedAt: new Date('2026-08-21'), job: { name: 'Sent job' } }),
      ],
      NOON,
    );
    expect(intro.primary).toContain('Kitchen paint');
    expect(intro.primary).toContain('still a draft');
  });

  it('falls back to a time-of-day opener when no drafts exist', () => {
    const intro = getMateIntro([quote()], NOON);
    expect(OPENERS).toContain(intro.primary);
  });

  it('always returns the fixed hint and a capability line', () => {
    const withDraft = getMateIntro([quote({ status: 'draft', job: { name: 'Fence' } })], NOON);
    const without = getMateIntro([], NOON);
    for (const intro of [withDraft, without]) {
      expect(intro.hint).toBe('I draft. You tap to confirm. Nothing saves ’til you say.');
      expect(intro.capability).toBe(
        "Tell me the job in plain words — I'll price the materials, draft the quote, and tee it up to send.",
      );
    }
  });

  it('returns exactly 3 chips with non-empty label and prefill', () => {
    const intro = getMateIntro([], NOON);
    expect(intro.chips).toHaveLength(3);
    for (const chip of intro.chips) {
      expect(chip.label.trim().length).toBeGreaterThan(0);
      expect(chip.prefill.trim().length).toBeGreaterThan(0);
    }
  });

  it('no copy anywhere contains the word "AI"', () => {
    // Hard rule: tradies dismiss the app the moment copy says "AI".
    const withDraft = getMateIntro([quote({ status: 'draft', job: { name: 'Fence' } })], NOON);
    const without = getMateIntro([], NOON);
    const allStrings = [withDraft, without].flatMap((intro) => [
      intro.primary,
      intro.capability,
      intro.hint,
      ...intro.chips.flatMap((c) => [c.label, c.prefill]),
    ]);
    for (const s of allStrings) {
      expect(s).not.toMatch(/\bAI\b/);
    }
  });
});

describe('isBlankSlate', () => {
  it('isBlankSlate: true for undefined/empty', () => {
    expect(isBlankSlate(undefined)).toBe(true);
    expect(isBlankSlate([])).toBe(true);
  });

  it('true when only hidden context messages exist', () => {
    expect(isBlankSlate([{ hidden: true }, { hidden: true }])).toBe(true);
  });

  it('true when only error bubbles exist', () => {
    expect(isBlankSlate([{ errorMessage: 'Voice mode is offline.' }])).toBe(true);
    expect(isBlankSlate([{ hidden: true }, { errorMessage: 'Too many requests.' }])).toBe(true);
  });

  it('false once any substantive message exists', () => {
    expect(isBlankSlate([{ errorMessage: 'offline' }, {}])).toBe(false);
    expect(isBlankSlate([{}])).toBe(false);
  });
});
