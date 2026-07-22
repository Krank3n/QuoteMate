import { describe, it, expect } from 'vitest';
import { canUseServiceReports } from './reportEntitlement';

describe('canUseServiceReports', () => {
  it('allows trial and pro', () => {
    expect(canUseServiceReports('trial')).toBe(true);
    expect(canUseServiceReports('pro')).toBe(true);
  });

  it('locks free (expired trial) out', () => {
    expect(canUseServiceReports('free')).toBe(false);
  });
});
