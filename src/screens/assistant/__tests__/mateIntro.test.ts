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
  it('offers the most recently touched draft as a tappable chip', () => {
    const intro = getMateIntro(
      [
        quote({ status: 'draft', updatedAt: new Date('2026-08-10'), job: { name: 'Old deck' } }),
        quote({ status: 'draft', updatedAt: new Date('2026-08-20'), job: { name: 'Kitchen paint' } }),
        quote({ status: 'sent', updatedAt: new Date('2026-08-21'), job: { name: 'Sent job' } }),
      ],
      NOON,
    );
    // A sentence asking "finish it, or start something new?" can only be
    // answered by typing the name of your own quote. A chip answers itself.
    expect(intro.draftChip?.label).toContain('Kitchen paint');
    expect(intro.draftChip?.prefill).toContain('Kitchen paint');
    expect(intro.draftChip?.label).toMatch(/^Finish/);
  });

  it('names the customer when the draft has no job name', () => {
    const intro = getMateIntro([quote({ status: 'draft', customerName: 'Dee' })], NOON);
    expect(intro.draftChip?.label).toContain("Dee's job");
  });

  it('offers no draft chip when nothing is unfinished', () => {
    expect(getMateIntro([quote()], NOON).draftChip).toBeUndefined();
  });

  it('always uses a time-of-day opener as the headline', () => {
    expect(OPENERS).toContain(getMateIntro([quote()], NOON).primary);
    expect(OPENERS).toContain(
      getMateIntro([quote({ status: 'draft', job: { name: 'Fence' } })], NOON).primary,
    );
  });

  it('always returns the one-line capability', () => {
    const withDraft = getMateIntro([quote({ status: 'draft', job: { name: 'Fence' } })], NOON);
    const without = getMateIntro([], NOON);
    for (const intro of [withDraft, without]) {
      expect(intro.capability).toBe(
        "Tell me the job in plain words — I'll price it up and draft the quote. Nothing saves ’til you say.",
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

  it('prefills stems to type into, not worked examples to delete', () => {
    // A 70-character example is more to delete than to type, and one tapped
    // and sent unread mints a quote for a customer who does not exist.
    const intro = getMateIntro([], NOON);
    const quoteChip = intro.chips.find((c) => c.label === 'Quote a job')!;
    expect(quoteChip.prefill.length).toBeLessThan(24);
    expect(quoteChip.prefill).toMatch(/ $/); // cursor lands after a trailing space
    expect(intro.chips.some((c) => /Smith St|\bSam\b|\bDee\b/.test(c.prefill))).toBe(false);
  });

  it('no copy anywhere contains the word "AI"', () => {
    // Hard rule: tradies dismiss the app the moment copy says "AI".
    const withDraft = getMateIntro([quote({ status: 'draft', job: { name: 'Fence' } })], NOON);
    const without = getMateIntro([], NOON);
    const allStrings = [withDraft, without].flatMap((intro) => [
      intro.primary,
      intro.capability,
      ...(intro.draftChip ? [intro.draftChip.label, intro.draftChip.prefill] : []),
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
