import { describe, it, expect } from 'vitest';
import { evaluateTracking } from './trackingAlarm';

const day = (date: string, sessions: number, pageViews: number, ctaEvents: number) => ({
  date,
  sessions,
  pageViews,
  ctaEvents,
});

const healthyWeek = [
  day('20260706', 20, 45, 3),
  day('20260707', 25, 50, 2),
  day('20260708', 18, 40, 1),
  day('20260709', 22, 48, 4),
  day('20260710', 24, 52, 2),
  day('20260711', 19, 41, 3),
  day('20260712', 21, 44, 2),
  day('20260713', 23, 47, 3),
];

describe('evaluateTracking', () => {
  it('is quiet on a healthy week', () => {
    expect(evaluateTracking(healthyWeek)).toEqual([]);
  });

  it('alarms when GA returns nothing at all', () => {
    expect(evaluateTracking([])).toHaveLength(1);
  });

  it('alarms on zero page views yesterday', () => {
    const rows = [...healthyWeek.slice(0, -1), day('20260713', 0, 0, 0)];
    const problems = evaluateTracking(rows);
    expect(problems.some((p) => p.includes('Zero page_views'))).toBe(true);
  });

  it('alarms on a sessions collapse vs the trailing average', () => {
    const rows = [...healthyWeek.slice(0, -1), day('20260713', 3, 7, 0)];
    const problems = evaluateTracking(rows);
    expect(problems.some((p) => p.includes('Sessions collapsed'))).toBe(true);
  });

  it('does NOT alarm on a collapse when baseline traffic is tiny', () => {
    const tiny = healthyWeek.map((r) => ({ ...r, sessions: 5, pageViews: 9, ctaEvents: 1 }));
    const rows = [...tiny.slice(0, -1), day('20260713', 1, 2, 0)];
    expect(evaluateTracking(rows)).toEqual([]);
  });

  it('alarms when CTA events flatline for 3 days despite real traffic', () => {
    const rows = [
      ...healthyWeek.slice(0, 5),
      day('20260711', 19, 41, 0),
      day('20260712', 21, 44, 0),
      day('20260713', 23, 47, 0),
    ];
    const problems = evaluateTracking(rows);
    expect(problems.some((p) => p.includes('Zero store/CTA key events'))).toBe(true);
  });

  it('does NOT alarm on a single zero-CTA day (normal at this volume)', () => {
    const rows = [...healthyWeek.slice(0, -1), day('20260713', 23, 47, 0)];
    expect(evaluateTracking(rows)).toEqual([]);
  });
});
