/**
 * "Quote it" — service-report Recommended Work → new draft quote.
 *
 * Covers the pure decision logic (name building, blank guards, verbatim
 * description, customer carry-over) and the thin orchestrator's contract
 * (deps call order, null short-circuit, navigation payload).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  buildFollowUpJobName,
  buildFollowUpQuoteSeed,
  applySeedToQuote,
  createQuoteFromRecommendedWork,
  type CreateQuoteFromReportDeps,
} from './quoteFromReport';
import type { Quote } from '../types';
import type { Job } from '../../shared/job/types';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    userId: 'user-1',
    customerId: 'contact-9',
    customerName: 'Sam Nguyen',
    customerEmail: 'sam@example.com',
    customerPhone: '0400 000 000',
    jobAddress: '12 Wattle St, Warragul VIC',
    name: 'Nguyen aircon service',
    stage: 'completed',
    documentIds: [],
    ...overrides,
  } as Job;
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    customerName: '',
    job: { id: 'jobspec-1', name: '', description: '', template: 'custom' },
    materials: [],
    laborRate: 95,
    laborHours: 0,
    laborUnit: 'hours',
    laborTotal: 0,
    materialsSubtotal: 0,
    markup: 25,
    markupAmount: 0,
    subtotal: 0,
    gst: 0,
    total: 0,
    status: 'draft',
    ...overrides,
  };
}

describe('buildFollowUpJobName', () => {
  it('appends "follow-up work" to the service type', () => {
    expect(buildFollowUpJobName('Aircon service')).toBe(
      'Aircon service — follow-up work',
    );
  });

  it('trims whitespace around the service type', () => {
    expect(buildFollowUpJobName('  Gutter clean  ')).toBe(
      'Gutter clean — follow-up work',
    );
  });

  it('falls back to a plain name when the service type is blank or missing', () => {
    expect(buildFollowUpJobName('')).toBe('Follow-up work');
    expect(buildFollowUpJobName('   ')).toBe('Follow-up work');
    expect(buildFollowUpJobName(undefined)).toBe('Follow-up work');
    expect(buildFollowUpJobName(null)).toBe('Follow-up work');
  });
});

describe('buildFollowUpQuoteSeed', () => {
  it('returns null when recommendedWork is missing', () => {
    expect(buildFollowUpQuoteSeed({ job: makeJob() })).toBeNull();
    expect(
      buildFollowUpQuoteSeed({ job: makeJob(), recommendedWork: null }),
    ).toBeNull();
  });

  it('returns null when recommendedWork is blank or whitespace-only', () => {
    expect(
      buildFollowUpQuoteSeed({ job: makeJob(), recommendedWork: '' }),
    ).toBeNull();
    expect(
      buildFollowUpQuoteSeed({ job: makeJob(), recommendedWork: '  \n\t ' }),
    ).toBeNull();
  });

  it('keeps the recommended work verbatim as the job description', () => {
    const text =
      'Replace the zone 2 damper motor.\nRe-gas the outdoor unit — pressure was low at 350 kPa.';
    const seed = buildFollowUpQuoteSeed({
      job: makeJob(),
      recommendedWork: text,
      serviceTypeLabel: 'Aircon service',
    });
    expect(seed?.jobDescription).toBe(text);
  });

  it('trims only outer whitespace, never inner content', () => {
    const seed = buildFollowUpQuoteSeed({
      job: makeJob(),
      recommendedWork: '  Fix the leak.\n  Then re-test.  \n',
    });
    expect(seed?.jobDescription).toBe('Fix the leak.\n  Then re-test.');
  });

  it('carries the customer over from the source job, including the contact link', () => {
    const seed = buildFollowUpQuoteSeed({
      job: makeJob(),
      recommendedWork: 'Replace the damper motor.',
      serviceTypeLabel: 'Aircon service',
    });
    expect(seed).toEqual({
      jobName: 'Aircon service — follow-up work',
      jobDescription: 'Replace the damper motor.',
      customerName: 'Sam Nguyen',
      customerEmail: 'sam@example.com',
      customerPhone: '0400 000 000',
      jobAddress: '12 Wattle St, Warragul VIC',
      contactId: 'contact-9',
    });
  });

  it('leaves contactId undefined when the job has no linked contact', () => {
    const seed = buildFollowUpQuoteSeed({
      job: makeJob({ customerId: undefined }),
      recommendedWork: 'Replace the damper motor.',
    });
    expect(seed?.contactId).toBeUndefined();
  });

  it('maps an empty job address to undefined rather than an empty string', () => {
    const seed = buildFollowUpQuoteSeed({
      job: makeJob({ jobAddress: '' }),
      recommendedWork: 'Replace the damper motor.',
    });
    expect(seed?.jobAddress).toBeUndefined();
  });
});

describe('applySeedToQuote', () => {
  const seed = {
    jobName: 'Aircon service — follow-up work',
    jobDescription: 'Replace the damper motor.',
    customerName: 'Sam Nguyen',
    customerEmail: 'sam@example.com',
    customerPhone: '0400 000 000',
    jobAddress: '12 Wattle St, Warragul VIC',
    contactId: 'contact-9',
  };

  it('stamps customer and scope onto the fresh draft', () => {
    const out = applySeedToQuote(makeQuote(), seed);
    expect(out.customerName).toBe('Sam Nguyen');
    expect(out.customerEmail).toBe('sam@example.com');
    expect(out.customerPhone).toBe('0400 000 000');
    expect(out.jobAddress).toBe('12 Wattle St, Warragul VIC');
    expect(out.contactId).toBe('contact-9');
    expect(out.job.name).toBe('Aircon service — follow-up work');
    expect(out.job.description).toBe('Replace the damper motor.');
  });

  it('keeps the draft business defaults and identity untouched', () => {
    const fresh = makeQuote();
    const out = applySeedToQuote(fresh, seed);
    expect(out.id).toBe(fresh.id);
    expect(out.laborRate).toBe(95);
    expect(out.markup).toBe(25);
    expect(out.status).toBe('draft');
    expect(out.job.id).toBe(fresh.job.id);
    expect(out.materials).toEqual([]);
  });
});

describe('createQuoteFromRecommendedWork', () => {
  function makeDeps(): CreateQuoteFromReportDeps & { current: Quote | null } {
    const deps = {
      current: null as Quote | null,
      createNewQuote: vi.fn(() => {
        deps.current = makeQuote();
      }),
      getCurrentQuote: vi.fn(() => deps.current),
      updateQuote: vi.fn((q: Quote) => {
        deps.current = q;
      }),
      saveDraft: vi.fn(async () => {}),
    };
    return deps;
  }

  it('returns null and touches no deps when there is no recommended work', async () => {
    const deps = makeDeps();
    const result = await createQuoteFromRecommendedWork(
      { job: makeJob(), recommendedWork: '   ' },
      deps,
    );
    expect(result).toBeNull();
    expect(deps.createNewQuote).not.toHaveBeenCalled();
    expect(deps.saveDraft).not.toHaveBeenCalled();
  });

  it('mints, seeds, saves, and returns the wizard navigation payload', async () => {
    const deps = makeDeps();
    const result = await createQuoteFromRecommendedWork(
      {
        job: makeJob(),
        recommendedWork: 'Replace the damper motor.',
        serviceTypeLabel: 'Aircon service',
      },
      deps,
    );

    expect(deps.createNewQuote).toHaveBeenCalledOnce();
    expect(deps.updateQuote).toHaveBeenCalledOnce();
    const seeded = deps.updateQuote.mock.calls[0][0] as Quote;
    expect(seeded.job.name).toBe('Aircon service — follow-up work');
    expect(seeded.job.description).toBe('Replace the damper motor.');
    expect(seeded.contactId).toBe('contact-9');

    // saveDraft receives the post-update currentQuote (calculation pass ran).
    expect(deps.saveDraft).toHaveBeenCalledOnce();
    expect(deps.saveDraft).toHaveBeenCalledWith(deps.current);

    expect(result).toEqual({
      quoteId: 'quote-1',
      navigate: {
        navigator: 'NewJob',
        screen: 'MaterialsList',
        params: { autoGenerate: true },
      },
    });
  });

  it('throws when the store fails to mint a draft', async () => {
    const deps = makeDeps();
    deps.createNewQuote = vi.fn(() => {
      deps.current = null;
    });
    await expect(
      createQuoteFromRecommendedWork(
        { job: makeJob(), recommendedWork: 'Replace the damper motor.' },
        deps,
      ),
    ).rejects.toThrow('Failed to create draft quote.');
    expect(deps.saveDraft).not.toHaveBeenCalled();
  });
});
