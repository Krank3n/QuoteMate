import { describe, it, expect } from 'vitest';
import { freeTierGateApplies, FREE_TIER_GATE_MESSAGE } from './deliveryGate.helpers';

describe('freeTierGateApplies', () => {
  it('never gates a plain quote — the client stopped doing so in #175', () => {
    expect(freeTierGateApplies({ kind: 'quote', doc: { requireDeposit: false } })).toBe(false);
    expect(freeTierGateApplies({ kind: 'quote', doc: {} })).toBe(false);
    expect(freeTierGateApplies({ kind: 'quote', doc: null })).toBe(false);
  });

  it('gates a quote that asks for a deposit', () => {
    expect(freeTierGateApplies({ kind: 'quote', doc: { requireDeposit: true, depositPercentage: 25 } })).toBe(true);
  });

  it('a deposit flag with nothing to collect is not a deposit', () => {
    expect(freeTierGateApplies({ kind: 'quote', doc: { requireDeposit: true, depositPercentage: 0 } })).toBe(false);
    expect(freeTierGateApplies({ kind: 'quote', doc: { requireDeposit: true } })).toBe(false);
    expect(freeTierGateApplies({ kind: 'quote', doc: { requireDeposit: 'true', depositPercentage: 25 } })).toBe(false);
  });

  it('always gates an invoice', () => {
    expect(freeTierGateApplies({ kind: 'invoice' })).toBe(true);
    expect(freeTierGateApplies({ kind: 'invoice', doc: { requireDeposit: false } })).toBe(true);
  });

  it('uses the client gate wording', () => {
    expect(FREE_TIER_GATE_MESSAGE).toMatch(/Connect Square/);
    expect(FREE_TIER_GATE_MESSAGE).toMatch(/invoices and deposit quotes/);
  });
});
