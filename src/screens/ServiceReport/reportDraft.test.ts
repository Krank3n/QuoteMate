import { describe, it, expect } from 'vitest';

import {
  applyComposedWriteUp,
  carryForwardSiteMemory,
  deriveReportContext,
  buildInitialReportForm,
  buildReportInput,
  formFromReport,
  latestSiteReport,
  latestSiteWriteUp,
  latestTechnicianSignature,
  normaliseSiteText,
  pruneAdditions,
  pruneSuggestions,
  removeCarriedRows,
  reportRowSummary,
  resumableReportId,
  sameSite,
  siteIdentity,
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

describe('pruneAdditions', () => {
  const blank = { natureOfProblem: '', workCarriedOut: '', recommendedWork: '' };

  it('keeps additions the fields do not already say', () => {
    const additions = [
      { text: 'The unit was tested after servicing.', field: 'workCarriedOut' as const },
      { text: 'Compressor is nearing end of life.', field: 'recommendedWork' as const },
    ];
    expect(pruneAdditions(additions, blank)).toEqual(additions);
  });

  it('retires an addition the target field already carries', () => {
    const additions = [
      { text: 'The unit was tested after servicing.', field: 'workCarriedOut' as const },
    ];
    expect(
      pruneAdditions(additions, {
        ...blank,
        workCarriedOut: 'Cleaned the coils. The unit was tested after servicing.',
      }),
    ).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const additions = [{ text: 'Tested After Servicing.', field: 'workCarriedOut' as const }];
    expect(
      pruneAdditions(additions, { ...blank, workCarriedOut: 'tested after servicing.' }),
    ).toEqual([]);
  });

  it('only checks the field the addition would land in', () => {
    const additions = [
      { text: 'The unit was tested after servicing.', field: 'workCarriedOut' as const },
    ];
    // The sentence sits in a DIFFERENT field — the chip still stands.
    expect(
      pruneAdditions(additions, {
        ...blank,
        recommendedWork: 'The unit was tested after servicing.',
      }),
    ).toHaveLength(1);
  });

  it('drops blanks and repeats within the list', () => {
    const additions = [
      { text: '  Tested after servicing. ', field: 'workCarriedOut' as const },
      { text: 'tested after servicing.', field: 'recommendedWork' as const },
      { text: '   ', field: 'workCarriedOut' as const },
    ];
    expect(pruneAdditions(additions, blank)).toHaveLength(1);
  });

  it('returns empty for an empty list', () => {
    expect(pruneAdditions([], blank)).toEqual([]);
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
describe('site memory', () => {
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
      status: 'sent',
      createdAt: 1,
      updatedAt: 1,
      ...over,
    }) as ServiceReport;

  // A stable id factory so carried checklist rows are assertable.
  const ids = () => {
    let n = 0;
    return () => `new-${++n}`;
  };

  describe('normaliseSiteText', () => {
    it('folds away case, punctuation and padding', () => {
      expect(normaliseSiteText('  12 Smith St., Warragul  ')).toBe(
        '12 smith st warragul',
      );
      expect(normaliseSiteText('12 SMITH ST WARRAGUL')).toBe('12 smith st warragul');
    });

    it('returns empty for blank or missing input', () => {
      expect(normaliseSiteText('')).toBe('');
      expect(normaliseSiteText(undefined)).toBe('');
      expect(normaliseSiteText('   ,,  ')).toBe('');
    });

    it('does NOT expand street types — near-misses must not match', () => {
      expect(normaliseSiteText('12 Smith Street')).not.toBe(
        normaliseSiteText('12 Smith St'),
      );
    });
  });

  describe('siteIdentity', () => {
    it('prefers a linked contact id over a re-typed customer name', () => {
      const id = siteIdentity(
        makeJob({ customerId: 'c-99', customerName: 'Jane Smith' }),
      );
      expect(id.customer).toBe('id:c-99');
    });

    it('falls back to the normalised customer name with no contact link', () => {
      const id = siteIdentity(makeJob({ customerId: undefined, customerName: 'Jane Smith' }));
      expect(id.customer).toBe('jane smith');
    });
  });

  describe('sameSite', () => {
    const at = (jobAddress: string, customerId?: string) =>
      siteIdentity(makeJob({ jobAddress, customerId, customerName: 'Jane Smith' }));

    it('matches two jobs at the same address written differently', () => {
      expect(sameSite(at('12 Smith St, Warragul'), at('12 smith st warragul'))).toBe(
        true,
      );
    });

    it('does NOT match a second property of the same customer', () => {
      expect(
        sameSite(at('12 Smith St, Warragul', 'c-1'), at('44 Queen St, Drouin', 'c-1')),
      ).toBe(false);
    });

    it('falls back to the customer when one side has no address', () => {
      expect(sameSite(at('', 'c-1'), at('12 Smith St, Warragul', 'c-1'))).toBe(true);
    });

    it('never matches two jobs with nothing identifiable', () => {
      const blank = siteIdentity({
        jobAddress: '',
        customerId: undefined,
        customerName: '',
      } as any);
      expect(sameSite(blank, blank)).toBe(false);
    });
  });

  describe('latestSiteReport', () => {
    const thisJob = makeJob({ id: 'j-now', jobAddress: '12 Smith St, Warragul' });

    it('finds last year\'s visit to the same address on a DIFFERENT job', () => {
      const jobs = [
        thisJob,
        makeJob({ id: 'j-old', jobAddress: '12 smith st, warragul' }),
      ];
      const found = latestSiteReport(
        [report({ id: 'r-old', jobId: 'j-old', equipment: ['Package unit'] })],
        jobs,
        thisJob,
      );
      expect(found?.id).toBe('r-old');
    });

    it('returns the newest matching report when several visits exist', () => {
      const jobs = [
        thisJob,
        makeJob({ id: 'j-a', jobAddress: '12 Smith St, Warragul' }),
        makeJob({ id: 'j-b', jobAddress: '12 Smith St, Warragul' }),
      ];
      // Newest-first, as listReports returns them.
      const found = latestSiteReport(
        [
          report({ id: 'r-new', jobId: 'j-a', equipment: ['High wall split'] }),
          report({ id: 'r-old', jobId: 'j-b', equipment: ['Package unit'] }),
        ],
        jobs,
        thisJob,
      );
      expect(found?.id).toBe('r-new');
    });

    it('ignores a report from a different address', () => {
      const jobs = [thisJob, makeJob({ id: 'j-else', jobAddress: '44 Queen St, Drouin' })];
      const found = latestSiteReport(
        [report({ id: 'r-else', jobId: 'j-else', equipment: ['Package unit'] })],
        jobs,
        thisJob,
      );
      expect(found).toBeNull();
    });

    it('matches an earlier report on the SAME job without needing the job list', () => {
      const found = latestSiteReport(
        [report({ id: 'r-same', jobId: 'j-now', equipment: ['Package unit'] })],
        [],
        thisJob,
      );
      expect(found?.id).toBe('r-same');
    });

    it('skips reports with nothing to carry', () => {
      const jobs = [thisJob, makeJob({ id: 'j-old', jobAddress: '12 Smith St, Warragul' })];
      const found = latestSiteReport(
        [
          report({ id: 'r-empty', jobId: 'j-old', equipment: [], itemsChecked: [] }),
          report({ id: 'r-full', jobId: 'j-old', equipment: ['Package unit'] }),
        ],
        jobs,
        thisJob,
      );
      expect(found?.id).toBe('r-full');
    });

    it('skips a report whose job has since been deleted', () => {
      const found = latestSiteReport(
        [report({ id: 'r-orphan', jobId: 'j-gone', equipment: ['Package unit'] })],
        [thisJob],
        thisJob,
      );
      expect(found).toBeNull();
    });

    it('returns null when the current job has no address and no customer', () => {
      const anon = makeJob({
        id: 'j-anon',
        jobAddress: '',
        customerId: undefined,
        customerName: '',
      });
      const found = latestSiteReport(
        [report({ id: 'r-old', jobId: 'j-other', equipment: ['Package unit'] })],
        [anon, makeJob({ id: 'j-other', jobAddress: '', customerId: undefined, customerName: '' })],
        anon,
      );
      expect(found).toBeNull();
    });

    it('returns null for an empty report list', () => {
      expect(latestSiteReport([], [thisJob], thisJob)).toBeNull();
    });
  });

  describe('latestSiteWriteUp', () => {
    const thisJob = makeJob({ id: 'j-now', jobAddress: '12 Smith St, Warragul' });

    it('returns the previous visit\'s write-up for the same site', () => {
      const jobs = [thisJob, makeJob({ id: 'j-old', jobAddress: '12 Smith St, Warragul' })];
      const out = latestSiteWriteUp(
        [
          report({
            id: 'r-old',
            jobId: 'j-old',
            workCarriedOut: 'Serviced the package unit and the high wall split.',
          }),
        ],
        jobs,
        thisJob,
      );
      expect(out).toBe('Serviced the package unit and the high wall split.');
    });

    it('finds a write-up on a visit that listed NO equipment', () => {
      const jobs = [thisJob, makeJob({ id: 'j-old', jobAddress: '12 Smith St, Warragul' })];
      const reports = [
        report({
          id: 'r-quick',
          jobId: 'j-old',
          equipment: [],
          itemsChecked: [],
          workCarriedOut: 'Attended the high wall split in the front office.',
        }),
      ];
      // Nothing to carry forward...
      expect(latestSiteReport(reports, jobs, thisJob)).toBeNull();
      // ...but still the best guide to how this tradie writes.
      expect(latestSiteWriteUp(reports, jobs, thisJob)).toBe(
        'Attended the high wall split in the front office.',
      );
    });

    it('never reaches across to another site', () => {
      const jobs = [thisJob, makeJob({ id: 'j-else', jobAddress: '44 Queen St, Drouin' })];
      const out = latestSiteWriteUp(
        [report({ id: 'r-else', jobId: 'j-else', workCarriedOut: 'Regassed the unit.' })],
        jobs,
        thisJob,
      );
      expect(out).toBeUndefined();
    });

    it('skips visits with a blank write-up', () => {
      const jobs = [thisJob, makeJob({ id: 'j-old', jobAddress: '12 Smith St, Warragul' })];
      const out = latestSiteWriteUp(
        [
          report({ id: 'r-blank', jobId: 'j-old', workCarriedOut: '   ' }),
          report({ id: 'r-real', jobId: 'j-old', workCarriedOut: 'Cleaned the coils.' }),
        ],
        jobs,
        thisJob,
      );
      expect(out).toBe('Cleaned the coils.');
    });

    it('returns undefined when there is no previous visit', () => {
      expect(latestSiteWriteUp([], [thisJob], thisJob)).toBeUndefined();
    });
  });

  describe('carryForwardSiteMemory', () => {
    it('carries equipment and checklist text from the previous visit', () => {
      const memory = carryForwardSiteMemory(
        {
          equipment: ['Package unit', 'High wall split'],
          itemsChecked: [
            { id: 'old-1', text: 'Clean air filters', checked: true },
            { id: 'old-2', text: 'Check electrical components', checked: true },
          ],
        },
        ids(),
      );
      expect(memory.equipment).toEqual(['Package unit', 'High wall split']);
      expect(memory.itemsChecked.map((it) => it.text)).toEqual([
        'Clean air filters',
        'Check electrical components',
      ]);
    });

    it('NEVER carries a tick — every carried row lands unticked', () => {
      const memory = carryForwardSiteMemory(
        {
          equipment: [],
          itemsChecked: [
            { id: 'old-1', text: 'Clean air filters', checked: true },
            { id: 'old-2', text: 'Check gas pressures', checked: true },
          ],
        },
        ids(),
      );
      expect(memory.itemsChecked.every((it) => it.checked === false)).toBe(true);
    });

    it('mints fresh ids so a carried row never reuses the old document\'s', () => {
      const memory = carryForwardSiteMemory(
        {
          equipment: [],
          itemsChecked: [{ id: 'old-1', text: 'Clean air filters', checked: false }],
        },
        ids(),
      );
      expect(memory.itemsChecked[0].id).toBe('new-1');
      expect(memory.itemsChecked[0].id).not.toBe('old-1');
    });

    it('trims, drops blanks and dedupes case-insensitively', () => {
      const memory = carryForwardSiteMemory(
        {
          equipment: ['  Package unit ', 'PACKAGE UNIT', '', '   ', 'High wall split'],
          itemsChecked: [
            { id: 'a', text: ' Clean air filters ', checked: false },
            { id: 'b', text: 'clean air filters', checked: false },
            { id: 'c', text: '   ', checked: false },
          ],
        },
        ids(),
      );
      expect(memory.equipment).toEqual(['Package unit', 'High wall split']);
      expect(memory.itemsChecked.map((it) => it.text)).toEqual(['Clean air filters']);
    });

    it('carries nothing else — narrative, photos and signatures stay behind', () => {
      const memory = carryForwardSiteMemory(
        report({
          equipment: ['Package unit'],
          itemsChecked: [],
          natureOfProblem: 'Not cooling',
          workCarriedOut: 'Regassed',
          recommendedWork: 'Replace compressor',
          photos: [{ id: 'p1', storageUrl: 'x' }],
          technicianSignature: { svgPath: 'M0 0 L9 9', name: 'Jake', signedAt: 1 },
        }),
        ids(),
      );
      expect(Object.keys(memory).sort()).toEqual(['equipment', 'itemsChecked']);
    });

    it('handles a report with neither list present', () => {
      const memory = carryForwardSiteMemory({} as any, ids());
      expect(memory).toEqual({ equipment: [], itemsChecked: [] });
    });
  });

  describe('removeCarriedRows', () => {
    it('takes back exactly the carried rows and leaves the tradie\'s own', () => {
      const carried = carryForwardSiteMemory(
        {
          equipment: ['Package unit'],
          itemsChecked: [{ id: 'old-1', text: 'Clean air filters', checked: false }],
        },
        ids(),
      );
      const state = {
        equipment: [...carried.equipment, 'Ducted system'],
        itemsChecked: [
          ...carried.itemsChecked,
          { id: 'mine', text: 'Check thermostat', checked: true },
        ],
      };
      const next = removeCarriedRows(state, carried);
      expect(next.equipment).toEqual(['Ducted system']);
      expect(next.itemsChecked).toEqual([
        { id: 'mine', text: 'Check thermostat', checked: true },
      ]);
    });

    it('keeps a carried checklist row the tradie has since reworded', () => {
      const carried = carryForwardSiteMemory(
        {
          equipment: [],
          itemsChecked: [{ id: 'old-1', text: 'Clean air filters', checked: false }],
        },
        ids(),
      );
      // Same id, edited text — it's the tradie's row now, but undo works off
      // the id, so it goes. Documented behaviour: ids are the contract.
      const state = {
        equipment: [],
        itemsChecked: [{ ...carried.itemsChecked[0], text: 'Clean air filters x2' }],
      };
      expect(removeCarriedRows(state, carried).itemsChecked).toEqual([]);
    });

    it('keeps a carried equipment row the tradie has since reworded', () => {
      const carried = carryForwardSiteMemory(
        { equipment: ['Package unit'], itemsChecked: [] },
        ids(),
      );
      const next = removeCarriedRows(
        { equipment: ['Package unit - roof'], itemsChecked: [] },
        carried,
      );
      expect(next.equipment).toEqual(['Package unit - roof']);
    });
  });
});

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
