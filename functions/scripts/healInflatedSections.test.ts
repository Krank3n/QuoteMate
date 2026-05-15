import { healSection } from './healInflatedSections';

// Tracy's QU-177865 numbers — the production case that motivated this script.
const tracyDeckSection = {
  id: 's1',
  name: 'Treated Pine Deck Surface (per m²)',
  multiplier: 12,
  laborHours: 27.6,          // inflated: was 2.3 per m², stored as 27.6 total
  laborRate: 1100,
  laborUnit: 'days' as const,
  laborTotal: 30360,         // authoritative dollar figure (correct)
};

describe('healSection', () => {
  it('heals the production bug shape (Tracy QU-177865)', () => {
    const result = healSection(tracyDeckSection);
    expect(result).not.toBeNull();
    expect(result!.after.laborHours).toBe(2.3);
    expect(result!.after.laborHoursTotal).toBe(27.6);
    expect(result!.section.laborTotal).toBe(30360); // unchanged
  });

  it('leaves already-correct sections alone', () => {
    const correct = { ...tracyDeckSection, laborHours: 2.3 };
    expect(healSection(correct)).toBeNull();
  });

  it('leaves sections with multiplier=1 alone', () => {
    const single = { ...tracyDeckSection, multiplier: 1, laborHours: 27.6 };
    expect(healSection(single)).toBeNull();
  });

  it('leaves sections with multiplier omitted alone', () => {
    const noMul: any = { ...tracyDeckSection };
    delete noMul.multiplier;
    noMul.laborHours = 27.6;
    expect(healSection(noMul)).toBeNull();
  });

  it('leaves zero-amount sections alone', () => {
    const zero = { ...tracyDeckSection, laborTotal: 0 };
    expect(healSection(zero)).toBeNull();
  });

  it('leaves zero-rate sections alone', () => {
    const zero = { ...tracyDeckSection, laborRate: 0 };
    expect(healSection(zero)).toBeNull();
  });

  it('leaves zero-hours sections alone', () => {
    const zero = { ...tracyDeckSection, laborHours: 0 };
    expect(healSection(zero)).toBeNull();
  });

  it('refuses to heal when neither interpretation matches', () => {
    // laborHours × rate = 22,000 (not totalled)
    // laborHours × rate × mul = 264,000 (not per-unit either)
    // laborTotal = 30,360 — matches neither
    const garbled = { ...tracyDeckSection, laborHours: 20, laborRate: 1100 };
    expect(healSection(garbled)).toBeNull();
  });

  it('refuses to heal ambiguous case where both interpretations match within tolerance', () => {
    // Engineered: laborHours × rate × mul ≈ laborHours × rate when mul is close
    // to 1. With mul=1.01, both interpretations are within tolerance of total,
    // and the function should refuse (looksPerUnit blocks the heal).
    const ambiguous = {
      ...tracyDeckSection,
      multiplier: 1.01,
      laborHours: 2,
      laborRate: 100,
      laborTotal: 202, // = 2 × 100 × 1.01 (per-unit interp); also ≈ 2 × 100 (totalled)
    };
    expect(healSection(ambiguous)).toBeNull();
  });

  it('respects 2% tolerance — heals when totalled-shape is within 2% of total', () => {
    // laborHours × rate = 27.6 × 1100 = 30,360
    // small rounding drift: total recorded as 30,400 (~0.13% off)
    const drift = { ...tracyDeckSection, laborTotal: 30400 };
    const result = healSection(drift);
    expect(result).not.toBeNull();
    expect(result!.after.laborHours).toBe(2.3);
  });

  it('rejects heal when drift exceeds 2%', () => {
    // 30,360 vs 32,000 = ~5.4% off, well outside tolerance
    const wayOff = { ...tracyDeckSection, laborTotal: 32000 };
    expect(healSection(wayOff)).toBeNull();
  });

  it('handles all four Tracy QU-177865 sections — restores per-unit semantics', () => {
    // From the actual quote — every section should heal cleanly.
    // The heal restores per-unit hours but leaves laborTotal alone. The
    // critical property is consistency: laborHours × multiplier × rate after
    // heal must equal the original laborTotal, so future recalcs (which sum
    // section.laborTotal directly) don't shift the customer-facing price.
    const rate = 1100;
    const sections = [
      { multiplier: 12, laborHours: 27.6, laborRate: rate, laborTotal: 30360 },
      { multiplier: 12, laborHours: 19.2, laborRate: rate, laborTotal: 21120 },
      { multiplier: 12, laborHours: 14.4, laborRate: rate, laborTotal: 15840 },
      { multiplier: 12, laborHours: 9.6,  laborRate: rate, laborTotal: 10560 },
    ];
    const fixed = sections.map(healSection);
    expect(fixed.every((f) => f !== null)).toBe(true);
    expect(fixed[0]!.after.laborHours).toBe(2.3);
    expect(fixed[1]!.after.laborHours).toBe(1.6);
    expect(fixed[2]!.after.laborHours).toBe(1.2);
    expect(fixed[3]!.after.laborHours).toBe(0.8);
    // After heal, recomputing each section's total must round-trip cleanly.
    sections.forEach((orig, i) => {
      const recomputed = fixed[i]!.after.laborHours * orig.multiplier * rate;
      expect(Math.round(recomputed * 100) / 100).toBe(orig.laborTotal);
    });
  });

  it('on a mixed doc: heals only the inflated section, leaves correct ones untouched', () => {
    // Simulates the doc-level orchestration: a quote with three sections where
    // section 0 is correct, section 1 is inflated, section 2 has multiplier=1
    // (untouchable). The script should produce a nextSections array where
    // only section 1 is rewritten.
    const sections = [
      { id: 'a', name: 'Fence', multiplier: 8, laborHours: 1.5, laborRate: 100, laborTotal: 1200 },
      { id: 'b', name: 'Deck', multiplier: 12, laborHours: 27.6, laborRate: 1100, laborTotal: 30360 },
      { id: 'c', name: 'Cleanup', multiplier: 1, laborHours: 4, laborRate: 100, laborTotal: 400 },
    ];
    const fixes = sections.map(healSection);
    const nextSections = sections.map((s, i) => fixes[i]?.section ?? s);
    expect(fixes[0]).toBeNull();          // already correct
    expect(fixes[1]).not.toBeNull();      // inflated, healed
    expect(fixes[2]).toBeNull();          // mul=1, untouchable
    expect(nextSections[0]).toBe(sections[0]); // referential equality — untouched
    expect(nextSections[1].laborHours).toBe(2.3);
    expect(nextSections[2]).toBe(sections[2]); // referential equality — untouched
  });

  it('rounds healed laborHours to 2 decimal places', () => {
    // laborHours = 100/3 ≈ 33.333..., mul = 7 → per-unit = 4.7619...
    const odd = {
      multiplier: 7,
      laborHours: 100 / 3,
      laborRate: 50,
      laborTotal: (100 / 3) * 50, // ≈ 1666.67
    };
    const result = healSection(odd);
    expect(result).not.toBeNull();
    expect(result!.after.laborHours).toBe(4.76);
  });
});
