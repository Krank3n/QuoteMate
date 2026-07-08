import { describe, it, expect } from 'vitest';
import { buildReconcilePrompt, ReconcileItem } from './reconcile.helpers';

const items: ReconcileItem[] = [
  {
    id: 'mat-1',
    name: 'decking screws 50mm',
    requirement: 600,
    requirementUnit: 'each',
    candidates: [
      { name: 'Zenith Decking Screws Box of 500', price: 42.5, packSize: 500, packUnit: 'each' },
      { name: 'Merbau Decking Board 5.4m', price: 38.0 },
    ],
  },
];

describe('buildReconcilePrompt', () => {
  it('embeds the items JSON verbatim so the model sees real candidates', () => {
    const prompt = buildReconcilePrompt(items);
    expect(prompt).toContain('"id": "mat-1"');
    expect(prompt).toContain('Zenith Decking Screws Box of 500');
    expect(prompt).toContain('"packSize": 500');
  });

  it('includes the category gate, price sanity, and requirement sanity rules', () => {
    const prompt = buildReconcilePrompt(items);
    expect(prompt).toContain('CATEGORY GATE');
    expect(prompt).toContain('PRICE SANITY');
    expect(prompt).toContain('REQUIREMENT SANITY');
    expect(prompt).toContain('"apply" | "estimate" | "reject"');
  });

  it('includes the coverage consistency rule and correctedRequirement contract', () => {
    const prompt = buildReconcilePrompt(items);
    expect(prompt).toContain('COVERAGE CONSISTENCY');
    expect(prompt).toContain('"correctedRequirement"');
    expect(prompt).toContain('set correctedRequirement to your corrected requirement');
  });

  it('includes the wrong-spec structural rule in the category gate', () => {
    const prompt = buildReconcilePrompt(items);
    expect(prompt).toContain('Same family, WRONG SPEC');
    expect(prompt).toContain('140x45 rafter request must NOT apply a 70x35');
    expect(prompt).toContain('4-core cable ≠ 2-core cable');
  });

  it('adds the job context block only when job info is provided', () => {
    const bare = buildReconcilePrompt(items);
    expect(bare).not.toContain('JOB CONTEXT');

    const withJob = buildReconcilePrompt(items, 'Deck rebuild', '5m x 2m merbau deck');
    expect(withJob).toContain('JOB CONTEXT');
    expect(withJob).toContain('Job: Deck rebuild');
    expect(withJob).toContain('Description: 5m x 2m merbau deck');
  });

  it('falls back to placeholders when only one job field is present', () => {
    const prompt = buildReconcilePrompt(items, undefined, 'replace kitchen sink');
    expect(prompt).toContain('Job: (unnamed)');
    expect(prompt).toContain('Description: replace kitchen sink');
  });
});
