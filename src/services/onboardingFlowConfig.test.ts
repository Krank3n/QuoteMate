import { beforeEach, describe, expect, it, vi } from 'vitest';

// config/onboarding as the client would read it. `null` means the document
// does not exist at all, which is the state on the day this ships.
let onboardingDoc: Record<string, unknown> | null = null;
let readThrows = false;
// A read that never comes back — one bar of reception, no server, no error.
let readHangs = false;

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => {
    if (readHangs) return new Promise(() => undefined);
    if (readThrows) throw new Error('offline');
    return {
      exists: () => onboardingDoc !== null,
      data: () => onboardingDoc ?? undefined,
    };
  }),
}));

import { parseLongFlowFlag, readLongFlowFlag } from './onboardingFlowConfig';

beforeEach(() => {
  onboardingDoc = null;
  readThrows = false;
  readHangs = false;
});

describe('parseLongFlowFlag', () => {
  it('only a literal true turns the long flow on', () => {
    expect(parseLongFlowFlag(true)).toBe(true);
  });

  it('treats every other value as the short flow', () => {
    for (const raw of [false, undefined, null, 0, 1, 'true', 'yes', {}, []]) {
      expect(parseLongFlowFlag(raw)).toBe(false);
    }
  });
});

describe('readLongFlowFlag', () => {
  it('defaults to the SHORT flow when config/onboarding does not exist', async () => {
    onboardingDoc = null;
    await expect(readLongFlowFlag()).resolves.toBe(false);
  });

  it('defaults to the SHORT flow when the document exists without the field', async () => {
    onboardingDoc = { somethingElse: true };
    await expect(readLongFlowFlag()).resolves.toBe(false);
  });

  it('restores the long flow when the field is true', async () => {
    onboardingDoc = { longFlow: true };
    await expect(readLongFlowFlag()).resolves.toBe(true);
  });

  it('stays short when the field is explicitly false', async () => {
    onboardingDoc = { longFlow: false };
    await expect(readLongFlowFlag()).resolves.toBe(false);
  });

  it('stays short when the field holds a non-boolean', async () => {
    onboardingDoc = { longFlow: 'true' };
    await expect(readLongFlowFlag()).resolves.toBe(false);
  });

  it('fails short when the read hangs past the deadline', async () => {
    // getDoc has no deadline of its own. The flag sits in front of draft
    // hydration, so a read that never returns must not hold onboarding up.
    readHangs = true;
    onboardingDoc = { longFlow: true };
    await expect(readLongFlowFlag(20)).resolves.toBe(false);
  });

  it('fails short rather than throwing when the read fails', async () => {
    // Offline first launch, or a rules change that breaks the read. A tradie
    // on bad reception must not be handed the seven-step wizard.
    readThrows = true;
    await expect(readLongFlowFlag()).resolves.toBe(false);
  });
});
