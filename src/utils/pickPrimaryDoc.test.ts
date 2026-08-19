/**
 * Which document a job leads with.
 *
 * The rule got sharper when a job could hold competing quote options:
 * accepting one saves the winner and then cancels the loser a moment later,
 * so ordering on `updatedAt` alone made the job headline the option the
 * customer had just turned down.
 */
import { describe, it, expect } from 'vitest';

import { pickPrimaryDoc } from '../utils/pickPrimaryDoc';
import type { Document } from '../types/document';

const d = (over: Partial<Document> & { id: string }): Document => ({
  type: 'quote',
  stage: 'quote_sent',
  updatedAt: 0,
  ...over,
} as unknown as Document);

describe('pickPrimaryDoc', () => {
  it('is null with nothing attached', () => {
    expect(pickPrimaryDoc([])).toBeNull();
  });

  it('leads with the newest quote', () => {
    const picked = pickPrimaryDoc([
      d({ id: 'old', updatedAt: 1 }),
      d({ id: 'new', updatedAt: 2 }),
    ]);
    expect(picked?.id).toBe('new');
  });

  it('lets any invoice beat the latest quote', () => {
    const picked = pickPrimaryDoc([
      d({ id: 'quote', updatedAt: 99 }),
      d({ id: 'inv', type: 'invoice', stage: 'invoice_sent', updatedAt: 1 }),
    ]);
    expect(picked?.id).toBe('inv');
  });

  it('REGRESSION: never leads with a superseded option, however recently written', () => {
    // Accepting one option saves the winner, then cancels the loser — so the
    // loser is always the newer write.
    const picked = pickPrimaryDoc([
      d({ id: 'accepted', stage: 'quote_accepted', updatedAt: 100 }),
      d({ id: 'superseded', stage: 'cancelled', updatedAt: 101 }),
    ]);
    expect(picked?.id).toBe('accepted');
  });

  it('ignores a cancelled invoice in favour of a live quote', () => {
    const picked = pickPrimaryDoc([
      d({ id: 'quote', stage: 'quote_sent', updatedAt: 1 }),
      d({ id: 'deadInv', type: 'invoice', stage: 'cancelled', updatedAt: 99 }),
    ]);
    expect(picked?.id).toBe('quote');
  });

  it('falls back to the newest cancelled doc when everything is cancelled', () => {
    // The job still has to show something.
    const picked = pickPrimaryDoc([
      d({ id: 'a', stage: 'cancelled', updatedAt: 1 }),
      d({ id: 'b', stage: 'cancelled', updatedAt: 2 }),
    ]);
    expect(picked?.id).toBe('b');
  });

  it('does not mutate the list it is given', () => {
    const docs = [d({ id: 'a', updatedAt: 1 }), d({ id: 'b', updatedAt: 2 })];
    pickPrimaryDoc(docs);
    expect(docs.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
