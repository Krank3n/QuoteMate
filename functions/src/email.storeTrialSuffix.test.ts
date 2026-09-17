import { describe, it, expect } from 'vitest';
import { storeTrialSuffix } from './email';

describe('storeTrialSuffix (admin "new Pro subscriber" email)', () => {
  it('flags a store free-trial start as no money yet, with the first-charge date', () => {
    expect(storeTrialSuffix(new Date('2026-10-01T00:00:00.000Z'))).toBe(' — store free trial, first charge 1 Oct 2026');
  });
  it('adds nothing for a normal paid start', () => {
    expect(storeTrialSuffix(null)).toBe('');
    expect(storeTrialSuffix(undefined)).toBe('');
    expect(storeTrialSuffix(new Date('garbage'))).toBe('');
  });
});
