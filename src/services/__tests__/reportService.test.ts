import { describe, it, expect } from 'vitest';
import {
  computeNextReportNumber,
  stripUndefined,
  normaliseReport,
  sortReportsNewestFirst,
} from '../reportService';

describe('sortReportsNewestFirst', () => {
  it('orders job reports by updatedAt without mutating the input', () => {
    const reports = [
      { id: 'old', updatedAt: 10 },
      { id: 'new', updatedAt: 30 },
      { id: 'middle', updatedAt: 20 },
    ] as any;
    const sorted = sortReportsNewestFirst(reports);
    expect(sorted.map((report) => report.id)).toEqual(['new', 'middle', 'old']);
    expect(reports.map((report: any) => report.id)).toEqual(['old', 'new', 'middle']);
  });
});

describe('computeNextReportNumber', () => {
  it('starts at RP-001 when there are no existing reports', () => {
    expect(computeNextReportNumber([])).toBe('RP-001');
  });

  it('zero-pads to three digits', () => {
    expect(computeNextReportNumber([{ number: 'RP-008' }])).toBe('RP-009');
    expect(computeNextReportNumber([{ number: 'RP-099' }])).toBe('RP-100');
  });

  it('reconciles against the existing max, not the count', () => {
    // Gaps + out-of-order: max is 42, so next is 43 (never count-based).
    const reports = [
      { number: 'RP-001' },
      { number: 'RP-042' },
      { number: 'RP-007' },
    ];
    expect(computeNextReportNumber(reports)).toBe('RP-043');
  });

  it('ignores foreign prefixes and malformed numbers', () => {
    const reports = [
      { number: 'Q-999' }, // wrong prefix
      { number: 'INV-500' }, // wrong prefix
      { number: 'RP-005' },
      { number: undefined }, // no number yet
    ];
    expect(computeNextReportNumber(reports)).toBe('RP-006');
  });

  it('matches case-insensitively', () => {
    expect(computeNextReportNumber([{ number: 'rp-011' }])).toBe('RP-012');
  });

  it('respects a cached floor that is ahead of the derived max', () => {
    expect(computeNextReportNumber([{ number: 'RP-003' }], 50)).toBe('RP-050');
  });
});

describe('stripUndefined', () => {
  it('drops undefined keys while keeping null and falsy-but-defined values', () => {
    const input = {
      a: 1,
      b: undefined,
      c: null,
      d: 0,
      e: '',
      f: false,
    };
    expect(stripUndefined(input)).toEqual({
      a: 1,
      c: null,
      d: 0,
      e: '',
      f: false,
    });
    expect('b' in stripUndefined(input)).toBe(false);
  });

  it('recurses into nested objects and arrays', () => {
    const input = {
      keep: 'yes',
      drop: undefined,
      nested: { inner: 1, gone: undefined },
      list: [{ x: 1, y: undefined }],
    };
    expect(stripUndefined(input)).toEqual({
      keep: 'yes',
      nested: { inner: 1 },
      list: [{ x: 1 }],
    });
  });

  it('round-trips a report payload so it is Firestore-safe', () => {
    const report = {
      id: 'r1',
      jobId: 'j1',
      userId: 'u1',
      number: 'RP-001',
      visitDate: 1_753_000_000_000,
      serviceType: 'Annual service',
      riskAssessment: undefined, // optional, not filled in
      equipment: ['Ladder', 'Multimeter'],
      itemsChecked: [{ id: 'c1', text: 'Test RCDs', checked: true }],
      natureOfProblem: 'Tripping RCD',
      workCarriedOut: undefined, // still a draft
      recommendedWork: undefined,
      customerSignature: { svgPath: 'M0 0', name: 'Sam', signedAt: 1 },
      technicianSignature: undefined,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    };
    const cleaned = stripUndefined(report);
    expect(cleaned).not.toHaveProperty('riskAssessment');
    expect(cleaned).not.toHaveProperty('workCarriedOut');
    expect(cleaned).not.toHaveProperty('recommendedWork');
    expect(cleaned).not.toHaveProperty('technicianSignature');
    expect(cleaned.customerSignature).toEqual({
      svgPath: 'M0 0',
      name: 'Sam',
      signedAt: 1,
    });
    expect(cleaned.itemsChecked).toEqual([
      { id: 'c1', text: 'Test RCDs', checked: true },
    ]);
    expect(JSON.stringify(cleaned)).not.toContain('undefined');
  });
});

describe('normaliseReport', () => {
  it('coerces numeric strings and injects the doc id', () => {
    const raw = {
      jobId: 'j1',
      userId: 'u1',
      number: 'RP-002',
      visitDate: '1753000000000',
      serviceType: 'Repair',
      equipment: ['Drill'],
      itemsChecked: [{ id: 'c1', text: 'Check', checked: false }],
      status: 'sent',
      createdAt: '5',
      updatedAt: '10',
    };
    const report = normaliseReport(raw, 'doc-id');
    expect(report.id).toBe('doc-id');
    expect(report.visitDate).toBe(1_753_000_000_000);
    expect(report.createdAt).toBe(5);
    expect(report.updatedAt).toBe(10);
    expect(report.status).toBe('sent');
  });

  it('defaults missing/invalid fields to safe values', () => {
    const report = normaliseReport({}, 'doc-id');
    expect(report.jobId).toBe('');
    expect(report.userId).toBe('');
    expect(report.number).toBe('');
    expect(report.serviceType).toBe('');
    expect(report.visitDate).toBe(0);
    expect(report.createdAt).toBe(0);
    expect(report.updatedAt).toBe(0);
    expect(report.equipment).toEqual([]);
    expect(report.itemsChecked).toEqual([]);
    expect(report.photos).toBeUndefined();
    // Any non-'sent' value normalises to the safe default 'draft'.
    expect(report.status).toBe('draft');
  });

  it('coerces an unknown status to draft', () => {
    expect(normaliseReport({ status: 'archived' }, 'x').status).toBe('draft');
  });
});
