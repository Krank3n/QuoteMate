import { describe, expect, it } from 'vitest';
import { describeDeletedDoc } from './deleteEventProps';

const NOW = Date.parse('2026-09-13T01:21:54Z');

describe('describeDeletedDoc', () => {
  it('describes a fresh Mate draft: draft, unsent, no contact, age in hours', () => {
    const props = describeDeletedDoc(
      'quote',
      '1789221713-abc',
      {
        id: '1789221713-abc',
        createdAt: new Date('2026-09-12T14:01:53Z'),
        status: 'draft',
        draftStep: 'JobPreview',
        total: 23100,
        materials: [{}, {}, {}],
      },
      'job_cascade',
      NOW,
    );
    expect(props).toEqual({
      doc_type: 'quote',
      doc_id: '1789221713-abc',
      source: 'job_cascade',
      stage: 'draft',
      draft_step: 'JobPreview',
      was_sent: false,
      total: 23100,
      material_count: 3,
      has_customer_email: false,
      has_customer_phone: false,
      age_hours: 11.3,
      record_found: true,
    });
  });

  it('marks a sent quote as sent from either the stage or a sentAt stamp', () => {
    const base = { id: 'q', createdAt: NOW - 3600e3, total: 100 };
    expect(describeDeletedDoc('quote', 'q', { ...base, status: 'sent' }, 'dashboard_quote_card', NOW).was_sent).toBe(true);
    expect(describeDeletedDoc('quote', 'q', { ...base, status: 'draft', sentAt: NOW - 60e3 }, 'dashboard_quote_card', NOW).was_sent).toBe(true);
    expect(describeDeletedDoc('quote', 'q', { ...base, status: 'draft' }, 'dashboard_quote_card', NOW).was_sent).toBe(false);
  });

  it('prefers the unified stage over the legacy status and reads contact flags', () => {
    const props = describeDeletedDoc(
      'invoice',
      'i1',
      { id: 'i1', stage: 'invoice_sent', status: 'draft', customerEmail: ' a@b.c ', customerPhone: '', createdAt: 'not a date' },
      'mate_proposal',
      NOW,
    );
    expect(props.stage).toBe('invoice_sent');
    expect(props.has_customer_email).toBe(true);
    expect(props.has_customer_phone).toBe(false);
    expect(props.age_hours).toBeNull();
    expect(props.doc_type).toBe('invoice');
  });

  it('still emits a row when there is no local record to describe', () => {
    const props = describeDeletedDoc('quote', 'gone', null, 'unknown', NOW);
    expect(props.record_found).toBe(false);
    expect(props.doc_id).toBe('gone');
    expect(props.stage).toBe('unknown');
    expect(props.age_hours).toBeNull();
  });

  it('never puts PII in the payload', () => {
    const props = describeDeletedDoc(
      'quote',
      'q',
      { id: 'q', customerEmail: 'brian@example.com', customerPhone: '0400 000 000', createdAt: NOW },
      'dashboard_delete_modal',
      NOW,
    );
    const blob = JSON.stringify(props);
    expect(blob).not.toContain('brian@');
    expect(blob).not.toContain('0400');
  });
});
