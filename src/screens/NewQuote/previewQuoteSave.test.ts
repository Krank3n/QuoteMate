/**
 * Regression: JobPreview's save must STAMP draftStep 'JobPreview', not
 * clear it. When it cleared the marker, finished-but-unsent quotes (the
 * biggest stall bucket in the Jul 2026 send audit) were invisible to the
 * dashboard draft banner and the unsent_quote nudge unless a stale
 * background save happened to re-write the marker.
 */
import { describe, it, expect } from 'vitest';

import { buildPreviewQuoteSave } from './previewQuoteSave';
import type { Quote } from '../../types';

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'q1',
    status: 'draft',
    notes: 'old',
    ...overrides,
  } as Quote;
}

describe('buildPreviewQuoteSave', () => {
  it('stamps draftStep JobPreview when the marker is missing', () => {
    const saved = buildPreviewQuoteSave(quote({ draftStep: undefined }), 'notes');
    expect(saved.draftStep).toBe('JobPreview');
  });

  it('upgrades a stale mid-wizard marker to JobPreview', () => {
    const saved = buildPreviewQuoteSave(quote({ draftStep: 'LaborMarkup' }), 'notes');
    expect(saved.draftStep).toBe('JobPreview');
  });

  it('applies notes and preserves identity fields', () => {
    const saved = buildPreviewQuoteSave(quote(), 'updated notes');
    expect(saved.notes).toBe('updated notes');
    expect(saved.id).toBe('q1');
    expect(saved.status).toBe('draft');
  });

  it('sets quoteNumber only when a reference number is provided', () => {
    expect(buildPreviewQuoteSave(quote(), 'n', 'Q-007').quoteNumber).toBe('Q-007');
    expect(buildPreviewQuoteSave(quote({ quoteNumber: 'Q-001' }), 'n').quoteNumber).toBe('Q-001');
  });

  it('bumps updatedAt', () => {
    const saved = buildPreviewQuoteSave(quote(), 'n');
    expect(saved.updatedAt).toBeInstanceOf(Date);
  });
});
