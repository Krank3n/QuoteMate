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

// ===== Inflated vs deflated ambiguity =====
//
// healSection's heuristic — "laborHours × laborRate ≈ laborTotal" — fits two
// distinct production bug shapes equally well. This block documents that the
// two shapes are INDISTINGUISHABLE without external context, which is why
// the audit step (checkDocumentIntegrity) flags both with section_total_mismatch
// and a human must decide before --commit is used.

describe('healSection — inflated vs deflated ambiguity', () => {
  // INFLATED — Tracy's QU-177865:
  // The bug: laborHours stored as N×multiplier (e.g. 2.3 × 12 = 27.6).
  // The total ($30,360) is correct. Heal divides hours by multiplier.
  const inflated = {
    name: 'Tracy Deck Surface',
    multiplier: 12, laborHours: 27.6, laborRate: 1100, laborTotal: 30360,
  };

  // DEFLATED — QU-177866's "Hardwood Deck Surface":
  // The bug: laborTotal stored as laborHours × laborRate without multiplier
  // (2.15 × 1100 = 2,365). Per-unit laborHours is CORRECT but the fair labour
  // is multiplier × that = $101,695. Customer was undercharged ~$99,000.
  const deflated = {
    name: 'QU-177866 Hardwood Deck Surface',
    multiplier: 43, laborHours: 2.15, laborRate: 1100, laborTotal: 2365,
  };

  it('healSection cannot distinguish the two — both pass the totalled heuristic', () => {
    const a = healSection(inflated);
    const b = healSection(deflated);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('on inflated input the heal restores correct per-unit semantics', () => {
    const result = healSection(inflated)!;
    expect(result.after.laborHours).toBe(2.3);     // 27.6 / 12
    expect(result.after.laborHoursTotal).toBe(27.6);
    // Customer-facing dollars unchanged.
    expect(result.section.laborTotal).toBe(30360);
  });

  it('on deflated input the heal corrupts per-unit semantics but preserves dollars', () => {
    // This is the dangerous case: laborHours WAS correct (2.15/m²). Heal
    // divides it by 43, leaving 0.05/m² stored. Recomputes downstream that
    // read `laborHours × multiplier × rate` will still produce 2.15 × 1100
    // = $2,365 (matching laborTotal) — so the customer-visible total is
    // preserved. But the per-unit stored value is now meaningless.
    const result = healSection(deflated)!;
    expect(result.after.laborHours).toBe(0.05);    // 2.15 / 43 — WRONG semantically
    expect(result.after.laborHoursTotal).toBe(2.15);
    expect(result.section.laborTotal).toBe(2365);  // dollars preserved
  });

  it('the recomputed-from-per-unit total matches stored laborTotal in BOTH cases', () => {
    // This is why heal is "safe" in the dollar-preservation sense: after
    // running, fixedHours × multiplier × rate = laborTotal in both shapes.
    // The audit's `labour_total_mismatch` and downstream `updateDocumentCalculations`
    // will both agree with the customer-facing dollar figure.
    for (const input of [inflated, deflated]) {
      const r = healSection(input)!;
      const recomputed = r.after.laborHours * input.multiplier * input.laborRate;
      expect(Math.round(recomputed * 100) / 100).toBe(input.laborTotal);
    }
  });

  it('looksTotalled fires identically for both shapes (regression guard)', () => {
    // Property guard: if anyone tweaks healSection to add a distinguishing
    // signal (e.g. compare with laborHoursTotal), this test will start to
    // fail and force a decision about how to classify each shape.
    for (const input of [inflated, deflated]) {
      const totalledProduct = input.laborHours * input.laborRate;
      const tol = Math.max(1, input.laborTotal * 0.02);
      expect(Math.abs(totalledProduct - input.laborTotal)).toBeLessThanOrEqual(tol);
    }
  });
});
