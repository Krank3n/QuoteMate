import { describe, it, expect } from 'vitest';
import { costLoading, costStampFor, labourCostOf, stampedCost, superPercentOf } from './labourCost';
import type { TimeEntry } from './types';

const crew = [
  { id: 'app', name: 'Sam', costRate: 30 },
  { id: 'sub', name: 'Dave', costRate: 70, contractor: true },
  { id: 'new', name: 'Mia' },
];
const settings = { crewSuperPercent: 12, crewOnCostPercent: 5 };
const e = (workerId: string, hours: number, over: Partial<TimeEntry> = {}) => ({ workerId, hours, ...over });

describe('what labour cost', () => {
  it('an employee: $30/h × 10 h with 12% super and 5% on-costs is $351', () => {
    expect(labourCostOf([e('crew:app', 10)], crew, settings)).toMatchObject({ wages: 300, superAndOnCosts: 51, total: 351, costedHours: 10 });
  });

  it('a contractor carries no super or on-costs', () => {
    expect(labourCostOf([e('crew:sub', 8)], crew, settings)).toMatchObject({ wages: 560, superAndOnCosts: 0, total: 560 });
  });

  it("counts the owner's hours apart and never costs them", () => {
    const c = labourCostOf([e('owner-uid', 6), e('crew:app', 1)], crew, settings);
    expect(c.ownerHours).toBe(6);
    expect(c.total).toBe(35.1);
  });

  it('leaves out hours still waiting for approval', () => {
    expect(labourCostOf([e('crew:app', 10, { status: 'pending' })], crew, settings).total).toBe(0);
  });

  it("includes hours that aren't charged to the customer — they still cost wages", () => {
    expect(labourCostOf([e('crew:app', 2, { billable: false })], crew, settings).total).toBe(70.2);
  });

  it('uses the cost stamped on the entry over today’s rate, so a pay rise doesn’t re-cost old jobs', () => {
    expect(labourCostOf([e('crew:app', 10, { cost: { rate: 25, loading: 0.12 } })], crew, settings).total).toBe(280);
  });

  it('names who has hours but no cost rate', () => {
    const c = labourCostOf([e('crew:new', 4), e('crew:gone', 2, { workerName: 'Old Pete' } as any)], crew, settings);
    expect(c).toMatchObject({ total: 0, uncostedCrewHours: 6, uncostedNames: ['Mia', 'Old Pete'] });
  });

  it('super defaults to 12%, can be set to 0, and nonsense falls back', () => {
    expect(superPercentOf(undefined)).toBe(12);
    expect(superPercentOf({ crewSuperPercent: 0 })).toBe(0);
    expect(superPercentOf({ crewSuperPercent: 400 })).toBe(12);
    expect(costLoading({}, { crewSuperPercent: 0 })).toBe(0);
  });

  it('stamps crew entries with a rate, never the owner or someone without one', () => {
    expect(costStampFor({ workerId: 'crew:app' }, crew, settings)).toEqual({ rate: 30, loading: 0.17 });
    expect(costStampFor({ workerId: 'crew:sub' }, crew, settings)).toEqual({ rate: 70, loading: 0 });
    expect(costStampFor({ workerId: 'owner-uid' }, crew, settings)).toBeUndefined();
    expect(costStampFor({ workerId: 'crew:new' }, crew, settings)).toBeUndefined();
  });
});

describe('stamping the cost when hours start counting', () => {
  const stamp = { rate: 25, loading: 0.12 };
  it('takes today’s rate when hours are approved', () => {
    expect(stampedCost({ workerId: 'crew:app', status: 'approved' }, { workerId: 'crew:app', status: 'pending' }, crew, settings)).toEqual({ rate: 30, loading: 0.17 });
  });
  it('keeps the old stamp when counted hours are only edited', () => {
    expect(stampedCost({ workerId: 'crew:app' }, { workerId: 'crew:app', cost: stamp }, crew, settings)).toBe(stamp);
  });
  it('re-stamps when the hours move to someone else', () => {
    expect(stampedCost({ workerId: 'crew:sub' }, { workerId: 'crew:app', cost: stamp }, crew, settings)).toEqual({ rate: 70, loading: 0 });
  });
  it('waiting hours and the owner carry nothing', () => {
    expect(stampedCost({ workerId: 'crew:app', status: 'pending' }, undefined, crew, settings)).toBeUndefined();
    expect(stampedCost({ workerId: 'owner-uid' }, undefined, crew, settings)).toBeUndefined();
  });
});
