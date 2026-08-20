// @vitest-environment jsdom
/**
 * Which rows the job kebab offers — and the two it must withhold when a job
 * carries competing quote options.
 *
 * Every row here acts on ONE document, whichever `primaryDocForJob` picks, and
 * cannot say which. That is harmless for Export or Duplicate, where the tradie
 * sees what they got. It is not harmless for the two that COMMIT TO A PRICE:
 * Send puts one arbitrary option in front of the customer, and Convert to
 * Invoice bills for it. The sticky action bar had the same flaw and was fixed
 * first; this is its sibling, and it was missed on the first pass.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
  StyleSheet: { create: (s: any) => s },
  View: 'View',
  Pressable: 'Pressable',
}));
vi.mock('react-native-paper', () => ({ Text: 'Text' }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'Icon' }));
vi.mock('../theme', () => ({ makeStyles: () => () => ({}), useThemeColors: () => ({}) }));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));
vi.mock('./BottomSheet', () => ({ BottomSheet: () => null }));
vi.mock('./StageOptionRow', () => ({ StageOptionRow: () => null }));
vi.mock('./JobStageSheet', () => ({ jobStageMetaFor: () => ({}) }));

import { ROWS } from './JobActionsSheet';
import type { Document } from '../types/document';
import type { Job } from '../../shared/job/types';

const job = { id: 'job-1', stage: 'quoted' } as unknown as Job;

const quote = (over: Partial<Document> = {}): Document => ({
  id: 'q1',
  type: 'quote',
  stage: 'quote_sent',
  jobId: 'job-1',
  total: 100,
  ...over,
} as unknown as Document);

/** Row ids offered for this context. */
function rowsFor(primaryDoc: Document | null, competingOptions = false): string[] {
  const ctx = { job, primaryDoc, xeroConnected: false, competingOptions };
  return ROWS.filter((r) => r.when(ctx as any)).map((r) => r.id);
}

describe('the job kebab on an ordinary job', () => {
  it('offers Send', () => {
    expect(rowsFor(quote())).toContain('send');
  });

  it('offers Convert to Invoice on a convertible quote', () => {
    expect(rowsFor(quote({ stage: 'quote_accepted' }))).toContain('convertToInvoice');
  });

  it('offers Add another option', () => {
    expect(rowsFor(quote())).toContain('addOption');
  });
});

describe('the job kebab when the job carries competing options', () => {
  it('WITHHOLDS Send — it would put one arbitrary option in front of the customer', () => {
    expect(rowsFor(quote(), true)).not.toContain('send');
  });

  it('WITHHOLDS Convert to Invoice — it would bill for an option nobody picked', () => {
    expect(rowsFor(quote({ stage: 'quote_accepted' }), true)).not.toContain('convertToInvoice');
  });

  it('still offers the rows that only ever show the tradie something', () => {
    const rows = rowsFor(quote(), true);

    // Withholding these too would gut the menu for no safety gain — the
    // tradie sees which document they got.
    expect(rows).toContain('exportPdf');
    expect(rows).toContain('duplicate');
    expect(rows).toContain('archive');
    expect(rows).toContain('delete');
  });

  it('still offers Add another option — a third price is the whole point', () => {
    expect(rowsFor(quote(), true)).toContain('addOption');
  });
});

describe('Add another option follows the shared gate', () => {
  it('is withheld once the customer has chosen', () => {
    expect(rowsFor(quote({ stage: 'quote_accepted' }))).not.toContain('addOption');
  });

  it('is withheld on an invoice', () => {
    expect(rowsFor(quote({ type: 'invoice', stage: 'invoice_sent' }))).not.toContain('addOption');
  });

  it('is withheld on a quote with no job to hang off', () => {
    expect(rowsFor(quote({ jobId: undefined }))).not.toContain('addOption');
  });

  it('is offered on a rejected quote — that is when a cheaper one earns its place', () => {
    expect(rowsFor(quote({ stage: 'quote_rejected' }))).toContain('addOption');
  });
});
