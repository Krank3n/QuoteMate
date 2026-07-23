import { describe, it, expect } from 'vitest';

import {
  applyComposedWriteUp,
  deriveReportContext,
  buildInitialReportForm,
  buildReportInput,
  formFromReport,
  latestTechnicianSignature,
  pruneSuggestions,
  reportRowSummary,
  resumableReportId,
  type ReportFormState,
} from './reportDraft';
import type { ServiceReport } from '../../../shared/report/types';
import type { Job } from '../../../shared/job/types';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    userId: 'u-1',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    customerPhone: '0400 000 000',
    jobAddress: '12 Test St, Warragul',
    name: 'Hot water service',
    stage: 'in_progress',
    documentIds: [],
    totalQuoted: 0,
    totalInvoiced: 0,
    totalPaid: 0,
    balanceDue: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Job;
}

describe('deriveReportContext', () => {
  it('lifts the customer + address fields off the job', () => {
    const ctx = deriveReportContext(makeJob());
    expect(ctx).toEqual({
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '0400 000 000',
      jobAddress: '12 Test St, Warragul',
    });
  });

  it('collapses blank optional fields to undefined and trims', () => {
    const ctx = deriveReportContext(
      makeJob({ customerName: '  Jane  ', customerEmail: '', customerPhone: '   ', jobAddress: '' }),
    );
    expect(ctx.customerName).toBe('Jane');
    expect(ctx.customerEmail).toBeUndefined();
    expect(ctx.customerPhone).toBeUndefined();
    expect(ctx.jobAddress).toBeUndefined();
  });
});

describe('buildInitialReportForm', () => {
  it('seeds serviceType from the job name and starts everything else empty', () => {
    const form = buildInitialReportForm(makeJob(), { visitDate: 1234 });
    expect(form.jobId).toBe('job-1');
    expect(form.visitDate).toBe(1234);
    expect(form.serviceType).toBe('Hot water service');
    expect(form.equipment).toEqual([]);
    expect(form.itemsChecked).toEqual([]);
    expect(form.natureOfProblem).toBe('');
    expect(form.photos).toEqual([]);
  });

  it('defaults the visit date to now when none is supplied', () => {
    const before = Date.now();
    const form = buildInitialReportForm(makeJob());
    expect(form.visitDate).toBeGreaterThanOrEqual(before);
  });
});

describe('buildReportInput', () => {
  const base = (): ReportFormState => buildInitialReportForm(makeJob(), { visitDate: 5000 });

  it('trims required fields and prunes blank equipment + checklist rows', () => {
    const state: ReportFormState = {
      ...base(),
      serviceType: '  Annual service  ',
      equipment: ['Ladder', '   ', 'Multimeter'],
      itemsChecked: [
        { id: 'a', text: 'Tested RCD', checked: true },
        { id: 'b', text: '   ', checked: false },
      ],
    };
    const input = buildReportInput(state);
    expect(input.serviceType).toBe('Annual service');
    expect(input.equipment).toEqual(['Ladder', 'Multimeter']);
    expect(input.itemsChecked).toEqual([{ id: 'a', text: 'Tested RCD', checked: true }]);
  });

  it('collapses empty optional narrative fields to undefined', () => {
    const input = buildReportInput({
      ...base(),
      riskAssessment: '   ',
      natureOfProblem: '',
      workCarriedOut: 'Replaced element',
      recommendedWork: '  ',
    });
    expect(input.riskAssessment).toBeUndefined();
    expect(input.natureOfProblem).toBeUndefined();
    expect(input.workCarriedOut).toBe('Replaced element');
    expect(input.recommendedWork).toBeUndefined();
  });

  it('omits photos when there are none', () => {
    expect(buildReportInput(base()).photos).toBeUndefined();
  });

  it('preserves a manually-ticked checklist item exactly (Mate never pre-ticks)', () => {
    const input = buildReportInput({
      ...base(),
      itemsChecked: [{ id: 'x', text: 'Isolation valve replaced', checked: true }],
    });
    expect(input.itemsChecked).toEqual([
      { id: 'x', text: 'Isolation valve replaced', checked: true },
    ]);
  });
});

describe('formFromReport', () => {
  it('round-trips a persisted report back into editable form state', () => {
    const form = formFromReport({
      jobId: 'job-9',
      visitDate: 42,
      serviceType: 'Leak repair',
      riskAssessment: undefined,
      equipment: ['Wrench'],
      itemsChecked: [{ id: 'c', text: 'Pressure test', checked: false }],
      workCarriedOut: 'Resealed joint',
      photos: undefined,
    });
    expect(form.jobId).toBe('job-9');
    expect(form.serviceType).toBe('Leak repair');
    expect(form.riskAssessment).toBe('');
    expect(form.equipment).toEqual(['Wrench']);
    expect(form.workCarriedOut).toBe('Resealed joint');
    expect(form.photos).toEqual([]);
  });
});

describe('applyComposedWriteUp', () => {
  const current = {
    natureOfProblem: 'heater dead. also reckon the flue needs redoing',
    workCarriedOut: 'swapped thermocouple',
    recommendedWork: '',
  };

  it('applies every returned field verbatim, including redistributed facts', () => {
    const composed = {
      natureOfProblem: 'Heater not operating on arrival.',
      workCarriedOut: 'Replaced the thermocouple.',
      recommendedWork: 'Flue requires replacement.',
    };
    expect(applyComposedWriteUp(current, composed)).toEqual(composed);
  });

  it('accepts an emptied source field when its fact moved to another field', () => {
    const composed = {
      natureOfProblem: '',
      workCarriedOut: 'Replaced the thermocouple. Heater was not operating on arrival.',
      recommendedWork: 'Flue requires replacement.',
    };
    const result = applyComposedWriteUp(current, composed);
    expect(result.natureOfProblem).toBe('');
    expect(result.workCarriedOut).toContain('thermocouple');
  });

  it('keeps the tradie text when the compose came back entirely blank', () => {
    const result = applyComposedWriteUp(current, {
      natureOfProblem: '',
      workCarriedOut: '   ',
      recommendedWork: '',
    });
    expect(result).toEqual(current);
  });
});

describe('pruneSuggestions', () => {
  it('trims entries and drops blanks', () => {
    expect(pruneSuggestions(['  Ladder ', '   ', 'Multimeter'], [])).toEqual([
      'Ladder',
      'Multimeter',
    ]);
  });

  it('drops suggestions already on the report, case-insensitively', () => {
    expect(
      pruneSuggestions(['ladder', 'Gas detector'], ['Ladder ', 'Hose kit']),
    ).toEqual(['Gas detector']);
  });

  it('dedupes repeats within the suggestion list, keeping first occurrence order', () => {
    expect(
      pruneSuggestions(['Valve', 'Regulator', ' valve ', 'Regulator'], []),
    ).toEqual(['Valve', 'Regulator']);
  });

  it('returns empty when everything is already covered', () => {
    expect(pruneSuggestions(['Ladder'], ['ladder'])).toEqual([]);
    expect(pruneSuggestions([], ['Ladder'])).toEqual([]);
  });
});

describe('resumableReportId', () => {
  const report = (over: Partial<ServiceReport>): ServiceReport =>
    ({
      id: 'r1',
      jobId: 'j1',
      userId: 'u1',
      number: 'RP-001',
      visitDate: 1,
      serviceType: 'Service',
      equipment: [],
      itemsChecked: [],
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
      ...over,
    }) as ServiceReport;

  it('resumes the newest report when it is still a draft', () => {
    expect(
      resumableReportId([
        report({ id: 'newest-draft', status: 'draft' }),
        report({ id: 'older-sent', status: 'sent' }),
      ]),
    ).toBe('newest-draft');
  });

  it('does not resume when the newest report has been sent', () => {
    expect(
      resumableReportId([
        report({ id: 'newest-sent', status: 'sent' }),
        report({ id: 'older-draft', status: 'draft' }),
      ]),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(resumableReportId([])).toBeNull();
  });
});

describe('latestTechnicianSignature', () => {
  const report = (over: Partial<ServiceReport>): ServiceReport =>
    ({
      id: 'r1',
      jobId: 'j1',
      userId: 'u1',
      number: 'RP-001',
      visitDate: 1,
      serviceType: 'Service',
      equipment: [],
      itemsChecked: [],
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
      ...over,
    }) as ServiceReport;

  const realSig = { svgPath: 'M 10 80 L 60 20 L 110 90', name: 'Jess', signedAt: 1, width: 400, height: 180 };
  const ghostSig = { svgPath: 'M 400 57 L 400 57', name: '', signedAt: 1 };

  it('returns the first (newest) report with real technician ink', () => {
    const found = latestTechnicianSignature([
      report({ id: 'new', technicianSignature: realSig }),
      report({ id: 'old', technicianSignature: { ...realSig, name: 'Older' } }),
    ]);
    expect(found?.name).toBe('Jess');
  });

  it('skips ghost captures without measurable ink', () => {
    const found = latestTechnicianSignature([
      report({ id: 'ghost', technicianSignature: ghostSig }),
      report({ id: 'real', technicianSignature: realSig }),
    ]);
    expect(found?.name).toBe('Jess');
  });

  it('never returns a customer signature', () => {
    const found = latestTechnicianSignature([
      report({ id: 'c', customerSignature: realSig }),
    ]);
    expect(found).toBeNull();
  });

  it('returns null when no report carries technician ink', () => {
    expect(latestTechnicianSignature([])).toBeNull();
    expect(latestTechnicianSignature([report({})])).toBeNull();
  });
});

// Minified report rows on the Job screen — the tradie must see at a glance
// which visits have dockets and whether each went out to the customer.
describe('reportRowSummary', () => {
  const NOW = new Date('2026-07-23T06:00:00Z').getTime();

  it('leads with the service type and shows number + sent date for sent reports', () => {
    const row = reportRowSummary(
      {
        number: 'RP-003',
        serviceType: 'Aircon service',
        status: 'sent',
        sentAt: new Date('2026-07-21T02:00:00Z').getTime(),
        updatedAt: NOW - 1000,
      },
      NOW,
    );
    expect(row.title).toBe('Aircon service');
    expect(row.subtitle).toBe('RP-003 · Sent 21 Jul');
  });

  it('shows Draft with an edited-ago tail for unfinished reports', () => {
    const row = reportRowSummary(
      {
        number: 'RP-004',
        serviceType: 'Filter replacement',
        status: 'draft',
        updatedAt: NOW - 2 * 60 * 60 * 1000,
      },
      NOW,
    );
    expect(row.subtitle).toBe('RP-004 · Draft · edited about 2 hours ago');
  });

  it('falls back to a generic title when serviceType is blank', () => {
    const row = reportRowSummary(
      { number: 'RP-001', serviceType: '  ', status: 'draft', updatedAt: NOW },
      NOW,
    );
    expect(row.title).toBe('Service report');
  });

  it('handles a sent report with no sentAt stamp', () => {
    const row = reportRowSummary(
      { number: 'RP-002', serviceType: 'Ducted heating', status: 'sent', updatedAt: NOW },
      NOW,
    );
    expect(row.subtitle).toBe('RP-002 · Sent');
  });
});
