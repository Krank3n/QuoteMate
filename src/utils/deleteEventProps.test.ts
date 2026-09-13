import { describe, expect, it } from 'vitest';
import { describeDeletedDoc, describeDeletedJob } from './deleteEventProps';

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

describe('describeDeletedJob', () => {
  it('describes a job the actions sheet deleted after cascading its docs', () => {
    expect(
      describeDeletedJob(
        'j1',
        { id: 'j1', createdAt: NOW - 2 * 3600e3, stage: 'inquiry', name: 'Forbes Ave slab', customerEmail: 'b@x.y', documentIds: [] },
        'job_actions_sheet',
        NOW,
      ),
    ).toEqual({
      job_id: 'j1',
      source: 'job_actions_sheet',
      stage: 'inquiry',
      attached_doc_count: 0,
      has_name: true,
      has_customer_email: true,
      has_customer_phone: false,
      age_hours: 2,
      record_found: true,
    });
  });

  it('still emits a row for an id with no local job, and never carries the customer details', () => {
    const missing = describeDeletedJob('gone', null, 'mate_cascade', NOW);
    expect(missing).toMatchObject({ job_id: 'gone', source: 'mate_cascade', stage: 'unknown', record_found: false, age_hours: null });
    const blob = JSON.stringify(
      describeDeletedJob('j', { id: 'j', name: 'Brian Forbes Ave', customerEmail: 'brian@example.com', customerPhone: '0400 000 000', documentIds: ['a', 'b'] }, 'unknown', NOW),
    );
    expect(blob).not.toContain('brian');
    expect(blob).not.toContain('0400');
    expect(blob).toContain('"attached_doc_count":2');
  });
});
