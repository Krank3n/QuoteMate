/**
 * The one place the platform-fee schedule is resolved. The server's ledger
 * and the phone's Tap to Pay call both read it — until Sep 2026 the phone
 * hardcoded the Pro in-person rate, so a free tradie's ledger row said 1.7%
 * while Square had been told 1.5%.
 */
import { describe, it, expect } from 'vitest';
import {
  squareAppFeePct,
  QM_APP_FEE_PCT_IN_PERSON,
  QM_APP_FEE_PCT_IN_PERSON_FREE,
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_ONLINE_FREE,
} from './squareFees';

describe('squareAppFeePct', () => {
  it('in person: free pays 1.7%, Pro and trial pay 1.5%', () => {
    expect(squareAppFeePct('in_person', 'free')).toBe(QM_APP_FEE_PCT_IN_PERSON_FREE);
    expect(squareAppFeePct('in_person', 'free')).toBe(1.7);
    expect(squareAppFeePct('in_person', 'pro')).toBe(QM_APP_FEE_PCT_IN_PERSON);
    expect(squareAppFeePct('in_person', 'pro')).toBe(1.5);
    expect(squareAppFeePct('in_person', 'trial')).toBe(QM_APP_FEE_PCT_IN_PERSON);
  });

  it('online: free pays 1.7%, Pro and trial pay 1%', () => {
    expect(squareAppFeePct('online', 'free')).toBe(QM_APP_FEE_PCT_ONLINE_FREE);
    expect(squareAppFeePct('online', 'pro')).toBe(QM_APP_FEE_PCT_ONLINE);
    expect(squareAppFeePct('online', 'trial')).toBe(QM_APP_FEE_PCT_ONLINE);
  });
});
