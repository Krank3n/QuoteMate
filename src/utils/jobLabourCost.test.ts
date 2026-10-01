import { describe, it, expect } from 'vitest';
import { jobLabourCostLine } from './jobLabourCost';
import type { TimeEntry } from '../../shared/time/types';

const e = (workerId: string, hours: number, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `${workerId}-${hours}`, userId: 'u', jobId: 'j', date: '2026-10-01', hours, workerId, billable: true, source: 'manual', createdAt: 1, updatedAt: 1, ...over,
});
const crew = [{ id: 'sam', name: 'Sam', costRate: 30, createdAt: 1 }, { id: 'mia', name: 'Mia', createdAt: 1 }];

describe("a job's labour cost line", () => {
  it('shows crew cost with super against the labour invoiced or quoted', () => {
    const line = jobLabourCostLine([e('crew:sam', 10)], crew, undefined, { laborTotal: 2400, type: 'invoice' });
    expect(line?.headline).toBe('Crew cost about $336.00 incl. super · labour invoiced $2,400.00');
    expect(jobLabourCostLine([e('crew:sam', 10)], crew, undefined, { laborTotal: 2400, type: 'quote' })?.headline).toContain('labour quoted $2,400.00');
    expect(line?.overCharged).toBe(false);
  });

  it('says super & on-costs when on-costs are set', () => {
    expect(jobLabourCostLine([e('crew:sam', 10)], crew, { crewOnCostPercent: 5 }, null)?.headline).toBe('Crew cost about $351.00 incl. super & on-costs');
  });

  it("notes the owner's hours aren't costed and whose rate is missing", () => {
    const line = jobLabourCostLine([e('crew:sam', 1), e('u', 12), e('crew:mia', 4)], crew, undefined, null);
    expect(line?.notes).toEqual(['Plus your 12 h, not costed', "Mia's 4 h have no cost rate — set it in Settings → Crew"]);
  });

  it("doesn't claim super is in when only contractors worked it", () => {
    const sub = [{ id: 'dave', name: 'Dave', costRate: 70, contractor: true, createdAt: 1 }];
    expect(jobLabourCostLine([e('crew:dave', 8)], sub, undefined, null)?.headline).toBe('Crew cost $560.00');
  });

  it('flags crew costing more than the labour charged', () => {
    expect(jobLabourCostLine([e('crew:sam', 100)], crew, undefined, { laborTotal: 2000 })?.overCharged).toBe(true);
  });

  it('says nothing on an owner-only job, or when the hours are still waiting', () => {
    expect(jobLabourCostLine([e('u', 8)], crew, undefined, { laborTotal: 900 })).toBeNull();
    expect(jobLabourCostLine([e('crew:sam', 8, { status: 'pending' })], crew, undefined, null)).toBeNull();
  });
});
