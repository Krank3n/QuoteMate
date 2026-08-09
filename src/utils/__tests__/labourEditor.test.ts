/**
 * Regression tests for the day-rate inflation bug (Aug 2026).
 *
 * Every fixture here is a real production document shape. The old screen
 * turned each of them into a quote billing 8× the tradie's own rate — one
 * ($33,620, right roofing QU-178558) reached a customer. Three earlier fixes
 * all guarded the conversion; this suite instead asserts the property that
 * makes the conversion unnecessary:
 *
 *   opening the labour editor, any number of times, cannot change the price.
 */

import { describe, it, expect } from 'vitest';
import { hydrateLabourEditor, applyLabourEditor, LabourEditorState } from '../labourEditor';
import { normaliseLabourToHours, totalLabourHours } from '../../../shared/document/labourUnits';
import { LaborUnit, QuoteSection } from '../../types';

const HOURLY = 85;

function section(
  name: string,
  laborHours: number,
  laborUnit: LaborUnit,
  multiplier: number,
  laborRate: number,
): QuoteSection {
  return {
    id: name,
    name,
    multiplier,
    laborHours,
    laborHoursTotal: Math.round(laborHours * multiplier * 100) / 100,
    laborRate,
    laborUnit,
    laborTotal: Math.round(laborHours * laborRate * multiplier * 100) / 100,
    sortOrder: 0,
  };
}

function doc(sections: QuoteSection[], overrides: Record<string, unknown> = {}) {
  return {
    laborHours: 0,
    laborRate: HOURLY,
    laborUnit: 'hours' as LaborUnit,
    laborExtraHours: 0,
    sections,
    ...overrides,
  };
}

/** What the sections actually bill, summed. */
function labourDollars(d: { sections?: QuoteSection[]; laborExtraHours?: number; laborRate: number }): number {
  const fromSections = (d.sections || []).reduce((sum, s) => sum + s.laborTotal, 0);
  return Math.round((fromSections + (d.laborExtraHours || 0) * d.laborRate) * 100) / 100;
}

/** Open the editor and leave it again, touching nothing. */
function visit<T extends Parameters<typeof hydrateLabourEditor>[0]>(d: T): T {
  const state = hydrateLabourEditor(d);
  return { ...d, ...applyLabourEditor(d, state) };
}

describe('labour editor — visiting the screen cannot move the price', () => {
  // markmcfadden259 QU-178468: hours section first, two day sections after.
  // Old behaviour: the save stamped 85/hours onto the day sections, dropping
  // $2,252 of labour to $323 — a silent 7× UNDERCHARGE nobody reports.
  it('mixed units with an hours section first (QU-178468) keeps its dollars', () => {
    const original = doc([
      section('Deck Footings', 0.5, 'hours', 1, HOURLY),
      section('Deck Framing', 1.5, 'days', 1, HOURLY * 8),
      section('Merbau Decking', 1.75, 'days', 1, HOURLY * 8),
    ]);
    const before = labourDollars(normaliseLabourToHours(original));
    expect(before).toBe(2252.5);

    let d: any = original;
    for (let i = 0; i < 10; i++) d = visit(d);
    expect(labourDollars(d)).toBe(before);
    expect(totalLabourHours(d)).toBeCloseTo(26.5, 2);
  });

  // Karls deck QU-178463: day section first. Old behaviour adopted $680/day as
  // the hourly rate for the whole quote — $1,020 of labour became $3,400.
  it('mixed units with a days section first (QU-178463) keeps its dollars', () => {
    const original = doc([
      section('Table Frame & Top', 1, 'days', 1, HOURLY * 8),
      section('Custom Drawers', 2, 'hours', 1, HOURLY),
      section('Finishing & Sealing', 2, 'hours', 1, HOURLY),
    ]);
    const before = labourDollars(normaliseLabourToHours(original));
    expect(before).toBe(1020);

    let d: any = original;
    for (let i = 0; i < 10; i++) d = visit(d);
    expect(labourDollars(d)).toBe(before);
  });

  // Bob's Fencing QU-178621, the report that started this: a day rate adopted
  // as hourly, then the ×8 "promote to days" applied on top → $5,440/day.
  it('never lets the ×8 day promotion compound (QU-178621)', () => {
    const original = doc([
      section('2.4m Timber Fence Bay', 1.52, 'days', 1, HOURLY * 8),
      section('Demolition & Disposal', 0.8, 'hours', 1, HOURLY),
      section('Final End Post', 0.8, 'hours', 1, HOURLY),
    ]);

    // Visit once, then the tradie enters the fence length — the multiplier
    // change that used to push the blind sum past the promotion threshold.
    let d: any = visit(original);
    d = {
      ...d,
      sections: d.sections.map((s: QuoteSection) =>
        s.name === '2.4m Timber Fence Bay'
          ? { ...s, multiplier: 21, laborHoursTotal: Math.round(s.laborHours * 21 * 100) / 100, laborTotal: Math.round(s.laborHours * s.laborRate * 21 * 100) / 100 }
          : s),
    };

    const afterMultiplier = labourDollars(d);
    const rateAfterMultiplier = d.laborRate;

    // Now visit repeatedly. The old code produced 5,440/day here.
    for (let i = 0; i < 10; i++) d = visit(d);

    expect(d.laborRate).toBe(rateAfterMultiplier);
    expect(d.laborRate).toBe(HOURLY);
    expect(labourDollars(d)).toBe(afterMultiplier);
    // 21 bays × 12.16h + 0.8 + 0.8 = 256.96h at $85 — the AI's estimate,
    // priced once rather than eight times.
    expect(labourDollars(d)).toBeCloseTo(21841.6, 2);
  });

  it('is idempotent for a plain hours quote regardless of size', () => {
    for (const hours of [0.5, 4, 7.9, 8, 13.5, 33.52, 120]) {
      const original = doc([section('Work', hours, 'hours', 1, HOURLY)]);
      const first = visit(original);
      const second = visit(first);
      expect(second.laborRate).toBe(HOURLY);
      expect(labourDollars(second)).toBe(labourDollars(first));
    }
  });

  it('keeps the extra-labour buffer in hours across a days-display round trip', () => {
    const original = doc([section('Work', 20, 'hours', 1, HOURLY)], { laborExtraHours: 4 });
    const state = hydrateLabourEditor(original);
    expect(state.displayUnit).toBe('days'); // 24h of work reads better as days
    expect(state.rateInput).toBe(String(HOURLY * 8));

    const patch = applyLabourEditor(original, state);
    expect(patch.laborRate).toBe(HOURLY);
    expect(patch.laborUnit).toBe('hours');
    expect(patch.labourDisplayUnit).toBe('days');
    expect(patch.laborExtraHours).toBeCloseTo(4, 1);
    expect(patch.laborHours).toBeCloseTo(24, 1);
  });

  it('honours an explicit display preference over the size heuristic', () => {
    const short = doc([section('Work', 3, 'hours', 1, HOURLY)], { labourDisplayUnit: 'days' as LaborUnit });
    expect(hydrateLabourEditor(short).displayUnit).toBe('days');

    const long = doc([section('Work', 40, 'hours', 1, HOURLY)], { labourDisplayUnit: 'hours' as LaborUnit });
    expect(hydrateLabourEditor(long).displayUnit).toBe('hours');
  });

  it('typing a rate in days mode stores dollars per hour', () => {
    const original = doc([section('Work', 24, 'hours', 1, HOURLY)]);
    const state: LabourEditorState = {
      displayUnit: 'days',
      totalInput: '3',
      rateInput: '800', // tradie types their day rate
      sectionTotals: { Work: '3' },
    };
    const patch = applyLabourEditor(original, state);
    expect(patch.laborRate).toBe(100); // stored per hour
    expect(patch.laborHours).toBe(24);
    expect(patch.sections![0].laborTotal).toBe(2400);
  });
});

describe('normaliseLabourToHours', () => {
  it('preserves the stored dollar figure exactly on awkward fractions', () => {
    // Ross Fencing QU-178233 — 0.1285714… days × 7 at $1,500/day.
    const s = section('Posts & Footings', 0.1285714285714286, 'days', 7, 1500);
    s.laborTotal = 1350.0000000000002;
    const [normalised] = normaliseLabourToHours(doc([s])).sections!;
    expect(normalised.laborUnit).toBe('hours');
    expect(normalised.laborRate).toBe(187.5);
    expect(normalised.laborTotal).toBe(1350.0000000000002);
    // The identity the integrity checker asserts must still hold.
    expect(normalised.laborHours * normalised.laborRate * normalised.multiplier)
      .toBeCloseTo(normalised.laborTotal, 2);
  });

  it('remembers that a day-stored quote wanted days on screen', () => {
    const d = normaliseLabourToHours(doc([section('Work', 2, 'days', 1, 680)], {
      laborUnit: 'days' as LaborUnit,
      laborRate: 680,
      laborHours: 2,
    }));
    expect(d.laborUnit).toBe('hours');
    expect(d.laborRate).toBe(85);
    expect(d.laborHours).toBe(16);
    expect(d.labourDisplayUnit).toBe('days');
  });

  it('returns the same object when there is nothing to convert', () => {
    const d = doc([section('Work', 4, 'hours', 1, HOURLY)]);
    expect(normaliseLabourToHours(d)).toBe(d);
  });
});

describe('labour editor — edge cases', () => {
  it('a section added after hydration keeps its labour instead of being cancelled', () => {
    // The screen stays mounted while the user adds a section over in the
    // materials list, so its per-section map can go stale. Hydration is keyed
    // on the section IDs for exactly this reason; this test pins the
    // behaviour of the save path if a stale map ever reaches it anyway.
    const original = doc([section('A', 10, 'hours', 1, HOURLY)]);
    const state = hydrateLabourEditor(original);

    const withNewSection = {
      ...original,
      sections: [...original.sections, section('B', 5, 'hours', 1, HOURLY)],
    };
    const patch = applyLabourEditor(withNewSection, state);

    // B's own hours survive rather than being zeroed…
    expect(patch.sections!.find((s) => s.name === 'B')!.laborHours).toBe(5);
    expect(patch.sections!.find((s) => s.name === 'B')!.laborTotal).toBe(425);
    // …and the shortfall lands in the visible buffer, not silently in a section.
    expect(patch.laborExtraHours).toBe(-5);
  });

  it('survives a zero rate without producing NaN', () => {
    const original = doc([section('A', 4, 'hours', 1, 0)], { laborRate: 0 });
    const state = hydrateLabourEditor(original);
    const patch = applyLabourEditor(original, state);
    expect(patch.laborRate).toBe(0);
    expect(patch.sections![0].laborTotal).toBe(0);
    expect(Number.isFinite(patch.laborHours)).toBe(true);
    expect(Number.isFinite(patch.laborExtraHours)).toBe(true);
  });

  it('survives an empty document with no sections', () => {
    const original = { laborHours: 0, laborRate: HOURLY, laborUnit: 'hours' as LaborUnit, laborExtraHours: 0, sections: [] };
    const state = hydrateLabourEditor(original);
    expect(state.displayUnit).toBe('hours');
    const patch = applyLabourEditor(original, state);
    expect(patch.laborHours).toBe(0);
    expect(patch.laborExtraHours).toBe(0);
  });

  it('treats a blank or half-typed field as untouched, never as zero', () => {
    // A field being edited is not an instruction to price the job at nothing.
    const original = doc([section('A', 4, 'hours', 1, HOURLY)]);
    const patch = applyLabourEditor(original, {
      displayUnit: 'hours',
      totalInput: '',
      rateInput: 'abc',
      sectionTotals: { A: '' },
    });
    expect(patch.laborRate).toBe(HOURLY);
    expect(patch.laborHours).toBe(4);
    expect(patch.sections![0].laborHours).toBe(4);
    expect(Number.isFinite(patch.laborExtraHours)).toBe(true);
  });

  it('still honours a deliberate zero', () => {
    const original = doc([section('A', 4, 'hours', 1, HOURLY)]);
    const patch = applyLabourEditor(original, {
      displayUnit: 'hours',
      totalInput: '0',
      rateInput: '0',
      sectionTotals: { A: '0' },
    });
    expect(patch.laborRate).toBe(0);
    expect(patch.laborHours).toBe(0);
    expect(patch.sections![0].laborTotal).toBe(0);
  });

  it('preserves a negative buffer through a round trip', () => {
    const original = doc([section('A', 20, 'hours', 1, HOURLY)], { laborExtraHours: -4 });
    const once = visit(original);
    expect(once.laborExtraHours).toBeCloseTo(-4, 2);
    expect(labourDollars(once)).toBe(labourDollars(normaliseLabourToHours(original)));
    const twice = visit(once);
    expect(twice.laborExtraHours).toBeCloseTo(-4, 2);
  });

  it('keeps a multi-section quote stable across a manual unit flip', () => {
    // Hours → days → hours, as the toggle does, must be value-preserving.
    const original = doc([
      section('A', 12, 'hours', 1, HOURLY),
      section('B', 20, 'hours', 1, HOURLY),
    ]);
    const asDays = applyLabourEditor(original, { ...hydrateLabourEditor(original), displayUnit: 'days' });
    const flipped = { ...original, ...asDays };
    expect(labourDollars(flipped)).toBe(labourDollars(original));
    expect(flipped.laborRate).toBe(HOURLY); // stored per hour whichever way it is shown
    expect(flipped.labourDisplayUnit).toBe('days');
  });

  it('applies an edited section without disturbing its neighbours', () => {
    // Kept under 16h so the editor shows hours — the steppers and the inputs
    // are always in the displayed unit, which is what the state below encodes.
    const original = doc([
      section('A', 5, 'hours', 1, HOURLY),
      section('B', 2, 'hours', 2, HOURLY),
    ], { laborExtraHours: 0 });
    const state = hydrateLabourEditor(original);
    expect(state.displayUnit).toBe('hours');

    // The tradie bumps A from 5h to 8h and the total with it.
    const edited = { ...state, sectionTotals: { ...state.sectionTotals, A: '8' }, totalInput: '12' };
    const patch = applyLabourEditor(original, edited);

    expect(patch.sections!.find((s) => s.name === 'A')!.laborHours).toBe(8);
    expect(patch.sections!.find((s) => s.name === 'B')!.laborHours).toBe(2); // per-unit untouched
    expect(patch.sections!.find((s) => s.name === 'B')!.laborTotal).toBe(340); // 2 × 2 × 85
    expect(patch.laborExtraHours).toBe(0);
  });

  it('an edit made in days mode lands as the right number of hours', () => {
    const original = doc([section('A', 24, 'hours', 1, HOURLY)]);
    const state = hydrateLabourEditor(original);
    expect(state.displayUnit).toBe('days'); // 24h → 3 days

    // Tradie steps the section from 3 days to 4.
    const patch = applyLabourEditor(original, {
      ...state,
      sectionTotals: { A: '4' },
      totalInput: '4',
    });
    expect(patch.sections![0].laborHours).toBe(32);
    expect(patch.laborHours).toBe(32);
    expect(patch.laborRate).toBe(HOURLY);
    expect(patch.sections![0].laborTotal).toBe(2720);
  });
});

describe('labour editor — legacy records that disagree with themselves', () => {
  // The May 2026 projectShared bug persisted laborHours as an already-totalled
  // value while multiplier stayed above 1. Three such documents are still in
  // production. Deriving hours from those fields would multiply the price by
  // the multiplier again just for opening the screen.
  const corrupt = (name: string, totalledHours: number, multiplier: number, rate: number, dollars: number) => ({
    id: name, name, multiplier,
    laborHours: totalledHours,        // a total wearing the per-unit field
    laborRate: rate,
    laborUnit: 'hours' as LaborUnit,
    laborTotal: dollars,              // authoritative
    sortOrder: 0,
  }) as QuoteSection;

  it('trusts the stored dollars over self-contradicting hours (QU-177702)', () => {
    // 4h × $85 = $340 stored, but multiplier 5 — hours × rate × mul says $1,700.
    const original = doc([corrupt('Garden Bed Mulching', 4, 5, HOURLY, 340)]);
    expect(hydrateLabourEditor(original).totalInput).toBe('4');

    let d: any = original;
    for (let i = 0; i < 5; i++) d = visit(d);
    expect(labourDollars(d)).toBe(340);
    expect(d.sections[0].laborHours).toBeCloseTo(0.8, 6); // repaired to a real per-unit
  });

  it('holds the price on a day-shaped corrupt record (QU-177742)', () => {
    const d0 = doc([
      { id: 'a', name: 'Deck Footings', multiplier: 30, laborHours: 2.8, laborRate: 2400, laborUnit: 'days', laborTotal: 6720, sortOrder: 0 } as QuoteSection,
    ], { laborRate: 2400, laborUnit: 'days' as LaborUnit, laborHours: 9.7 });

    let d: any = d0;
    for (let i = 0; i < 5; i++) d = visit(d);
    expect(labourDollars(d)).toBe(6720);
    expect(d.laborRate).toBe(300); // $2,400/day → $300/hour
    expect(d.sections[0].laborUnit).toBe('hours');
  });

  it('holds the price when laborHoursTotal is the only honest field (QU-177857)', () => {
    const s = corrupt('Colorbond Fence Bay', 9, 9, 80, 720);
    (s as any).laborHoursTotal = 9;
    let d: any = doc([s], { laborRate: 80 });
    for (let i = 0; i < 5; i++) d = visit(d);
    expect(labourDollars(d)).toBe(720);
  });

  it('falls back to the hours fields when there are no dollars to trust', () => {
    const zeroed = doc([{
      id: 'a', name: 'Unpriced', multiplier: 2, laborHours: 3, laborHoursTotal: 6,
      laborRate: HOURLY, laborUnit: 'hours' as LaborUnit, laborTotal: 0, sortOrder: 0,
    } as QuoteSection]);
    // 6h of work at $85 that was stored at $0 — the hours survive and get priced.
    expect(hydrateLabourEditor(zeroed).totalInput).toBe('6');
    expect(labourDollars(visit(zeroed))).toBe(510);
  });
});

describe('labour editor — per-section rates', () => {
  // A template applied at its own price can leave one section on a different
  // rate. The single rate box must not silently reprice it on a visit.
  const mixedRates = () => doc([
    section('Standard work', 4, 'hours', 1, HOURLY),
    section('Specialist bay', 3, 'hours', 2, 140),
  ]);

  it('leaves a section on its own rate when the rate box is untouched', () => {
    const before = labourDollars(mixedRates());
    expect(before).toBe(1180); // 4×85 + 3×2×140

    let d: any = mixedRates();
    for (let i = 0; i < 5; i++) d = visit(d);
    expect(labourDollars(d)).toBe(before);
    expect(d.sections.find((s: QuoteSection) => s.name === 'Specialist bay').laborRate).toBe(140);
  });

  it('applies a rate the tradie actually changed to every section', () => {
    const original = mixedRates();
    const state = hydrateLabourEditor(original);
    const patch = applyLabourEditor(original, { ...state, rateInput: '100' });
    expect(patch.sections!.every((s) => s.laborRate === 100)).toBe(true);
    expect(patch.sections!.find((s) => s.name === 'Specialist bay')!.laborTotal).toBe(600); // 3 × 2 × 100
  });
});
