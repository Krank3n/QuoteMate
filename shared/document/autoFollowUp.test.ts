/**
 * The default is the whole point of this module. It flipped from opt-in to
 * opt-out without a backfill, so `undefined` — every account that never
 * touched the switch — now has to read as ON, on the phone and in the
 * schedulers alike. A regression here silently stops chasing for every tradie
 * who never opened Business Defaults, which is most of them.
 */
import { describe, it, expect } from 'vitest';

import { resolveAutoCustomerFollowUp, isAutoCustomerFollowUpDefaulted } from './autoFollowUp';

describe('resolveAutoCustomerFollowUp', () => {
  it('is on for an account that never touched the switch', () => {
    expect(resolveAutoCustomerFollowUp(undefined)).toBe(true);
  });

  it('is on for a settings doc with no such field at all', () => {
    expect(resolveAutoCustomerFollowUp(null)).toBe(true);
  });

  it('stays on when explicitly enabled', () => {
    expect(resolveAutoCustomerFollowUp(true)).toBe(true);
  });

  it('is off only when explicitly disabled', () => {
    expect(resolveAutoCustomerFollowUp(false)).toBe(false);
  });
});

describe('isAutoCustomerFollowUpDefaulted', () => {
  it('treats an account that never touched the switch as defaulted', () => {
    expect(isAutoCustomerFollowUpDefaulted(undefined)).toBe(true);
    expect(isAutoCustomerFollowUpDefaulted(null)).toBe(true);
  });

  it('does not treat an explicit opt-in as defaulted', () => {
    // These accounts have chases already running. Applying the enrolment
    // floor to them would silently kill every one of them.
    expect(isAutoCustomerFollowUpDefaulted(true)).toBe(false);
  });

  it('does not treat an explicit opt-out as defaulted', () => {
    expect(isAutoCustomerFollowUpDefaulted(false)).toBe(false);
  });
});
