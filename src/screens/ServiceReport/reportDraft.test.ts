import { describe, it, expect } from 'vitest';

import {
  deriveReportContext,
  buildInitialReportForm,
  buildReportInput,
  formFromReport,
  type ReportFormState,
} from './reportDraft';
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
