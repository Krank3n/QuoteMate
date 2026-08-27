/**
 * The customer's own words when they declined.
 *
 * The acceptance page asks "anything we should know?", the server stores the
 * answer on the quote, and the notification email prints it — then the app
 * threw it away. A tradie who read the email on their phone and came back to
 * the job later found a row that said "Quote rejected" and nothing else: no
 * reason, no lever, nothing to act on. The rejection row now carries the note.
 */
import { describe, it, expect } from 'vitest';

import { deriveTimelineEvents } from './jobTimeline';
import { clientNoteDetail, customerResponseNote } from './customerNote';

function job(over: Record<string, any> = {}): any {
  return {
    id: 'job1',
    name: 'Rear fence',
    stage: 'quoted',
    createdAt: 1_000,
    documentIds: ['doc1'],
    ...over,
  };
}

function rejectedDoc(over: Record<string, any> = {}): any {
  return {
    id: 'doc1',
    jobId: 'job1',
    type: 'quote',
    stage: 'quote_rejected',
    createdAt: 2_000,
    respondedAt: 9_000,
    total: 4_200,
    ...over,
  };
}

const rejectionRow = (doc: any) =>
  deriveTimelineEvents(job(), [doc], 10_000).find((e) => e.kind === 'quote_rejected');

describe('deriveTimelineEvents — the rejection row', () => {
  it('carries the customer note as the row detail', () => {
    const row = rejectionRow(rejectedDoc({ clientNotes: 'Too dear, going with the other mob.' }));
    expect(row?.title).toBe('Quote rejected');
    expect(row?.detail).toBe('Too dear, going with the other mob.');
  });

  it('leaves the detail off when the customer declined without a word', () => {
    expect(rejectionRow(rejectedDoc())?.detail).toBeUndefined();
    expect(rejectionRow(rejectedDoc({ clientNotes: '   ' }))?.detail).toBeUndefined();
  });

  it('elides an over-long note instead of letting it take over the rail', () => {
    const rant = 'We got three other quotes and yours was the dearest by a fair margin, '
      + 'so we are going with the mob down the road who can start next week.';
    const detail = rejectionRow(rejectedDoc({ clientNotes: rant }))!.detail!;
    expect(detail.length).toBeLessThanOrEqual(91); // 90 chars + the ellipsis
    expect(detail.endsWith('…')).toBe(true);
    expect(rant.startsWith(detail.slice(0, -1))).toBe(true);
  });

  it('only reads the note on a doc that was actually rejected', () => {
    // An accepted quote can carry a note too, but it belongs to the accepted
    // row's story, not to a rejection that never happened.
    const rows = deriveTimelineEvents(
      job(),
      [rejectedDoc({ stage: 'quote_accepted', acceptedAt: 9_000, clientNotes: 'Sounds good' })],
      10_000,
    );
    expect(rows.find((e) => e.kind === 'quote_rejected')).toBeUndefined();
  });
});

describe('clientNoteDetail', () => {
  it('collapses newlines so a pasted note stays one line', () => {
    expect(clientNoteDetail('Too dear.\n\nTry again in spring?')).toBe('Too dear. Try again in spring?');
  });

  it('returns undefined for nothing at all', () => {
    expect(clientNoteDetail(undefined)).toBeUndefined();
    expect(clientNoteDetail('')).toBeUndefined();
    expect(clientNoteDetail('\n  \t ')).toBeUndefined();
  });

  it('passes a note that already fits through untouched', () => {
    expect(clientNoteDetail('  Price is fine, timing is not.  ')).toBe('Price is fine, timing is not.');
  });
});

describe('customerResponseNote — what the job screen shows', () => {
  it('heads a declined quote with why they said no, in full', () => {
    const rant = 'We got three other quotes and yours was the dearest by a fair margin, '
      + 'so we are going with the mob down the road who can start next week.';
    expect(customerResponseNote({ stage: 'quote_rejected', clientNotes: rant } as any)).toEqual({
      label: 'Why they said no',
      // The screen has room to wrap — no eliding here, unlike the rail.
      text: rant,
    });
  });

  it('heads a note left on any other stage neutrally', () => {
    expect(customerResponseNote({ stage: 'quote_accepted', clientNotes: 'Can you start after the 14th?' } as any))
      .toEqual({ label: 'What the customer said', text: 'Can you start after the 14th?' });
  });

  it('shows nothing at all when the customer left no note', () => {
    expect(customerResponseNote({ stage: 'quote_rejected' } as any)).toBeNull();
    expect(customerResponseNote({ stage: 'quote_rejected', clientNotes: '   \n ' } as any)).toBeNull();
    expect(customerResponseNote(null)).toBeNull();
    expect(customerResponseNote(undefined)).toBeNull();
  });
});
