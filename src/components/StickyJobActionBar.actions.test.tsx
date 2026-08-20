// @vitest-environment jsdom
/**
 * What the sticky action bar offers, and the two actions it withholds while a
 * job carries competing quote options.
 *
 * Both resolve to ONE document — whichever pickPrimaryDoc lands on — which the
 * bar cannot name. On a job showing two equal options that makes them big
 * primary buttons which silently pick one: Send puts an arbitrary option in
 * front of the customer, and Generate Invoice bills for it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  StyleSheet: { create: (s: any) => s },
  View: 'View',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('react-native-paper', () => ({ Text: 'Text' }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'Icon' }));
vi.mock('../theme', () => ({ makeStyles: () => () => ({}), useThemeColors: () => ({}) }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

import { resolveJobActions } from './StickyJobActionBar';
import type { Document } from '../types/document';

const quote = (over: Partial<Document> = {}): Document => ({
  id: 'q1',
  type: 'quote',
  stage: 'draft',
  jobId: 'job-1',
  total: 100,
  ...over,
} as unknown as Document);

const ids = (
  stage: string,
  doc: Document | null,
  stillBooked = false,
  competingOptions = false,
): string[] =>
  resolveJobActions(stage as any, doc, stillBooked, competingOptions).map((a) => a.id);

describe('an ordinary job', () => {
  it('offers Send on a finished draft quote', () => {
    expect(ids('quoted', quote({ stage: 'draft' }))).toContain('sendQuote');
  });

  it('offers Generate Invoice once the job is accepted', () => {
    expect(ids('accepted', quote({ stage: 'quote_accepted' }))).toContain('generateInvoice');
  });
});

describe('a job carrying competing options', () => {
  it('WITHHOLDS Send', () => {
    expect(ids('quoted', quote({ stage: 'draft' }), false, true))
      .not.toContain('sendQuote');
  });

  it('WITHHOLDS Resend', () => {
    expect(ids('quoted', quote({ stage: 'quote_sent' }), false, true))
      .not.toContain('resendQuote');
  });

  it('WITHHOLDS Generate Invoice — it would bill for an option nobody chose', () => {
    expect(ids('accepted', quote({ stage: 'quote_accepted' }), false, true))
      .not.toContain('generateInvoice');
  });

  it('keeps everything that does not commit to a price', () => {
    const ordinary = ids('accepted', quote({ stage: 'quote_accepted' }));
    const withOptions = ids('accepted', quote({ stage: 'quote_accepted' }), false, true);
    const removed = ordinary.filter((id) => !withOptions.includes(id));

    // Exactly the price-committing ones, nothing else swept up with them.
    expect(removed.every((id) => ['sendQuote', 'resendQuote', 'generateInvoice'].includes(id)))
      .toBe(true);
  });

  it('can end up with nothing to offer, which is how the bar hides itself', () => {
    // A finished draft's only action is Send. Withheld, the bar has no reason
    // to be on screen — and StickyJobActionBar returns null on an empty list.
    const rows = ids('quoted', quote({ stage: 'draft' }), false, true);

    expect(rows).not.toContain('sendQuote');
  });

  it('does not change a job with no document at all', () => {
    expect(ids('inquiry', null, false, true)).toEqual(['createQuote']);
  });
});
