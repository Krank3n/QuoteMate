import { describe, it, expect } from 'vitest';
import { matchEvidence, stampMatchConfidence, WEAK_MATCH_NOTE } from '../../shared/pricing/matchEvidence';
import type { Material } from '../types';

describe('matchEvidence', () => {
  describe("'none' — nothing in common, must never be applied", () => {
    it('refuses a grout-removal bit for a tie wire roll (QU-178711)', () => {
      expect(
        matchEvidence('builders tie wire roll 1.5mm', 'Ryobi 1.6mm Rotary Tool Grout Removal Bit'),
      ).toBe('none');
    });

    it('refuses a bottle trap for a plumber subcontractor row', () => {
      expect(
        matchEvidence(
          'Plumber Subcontractor',
          'Kinetic 40mm PVC Trap Bottle Trap with Adjustable Outlet',
        ),
      ).toBe('none');
    });

    it('refuses a hand saw for survey pegs', () => {
      expect(matchEvidence('Hardwood Survey Pegs 450mm', 'Bahco 350mm Toolbox Hand Saw')).toBe(
        'none',
      );
    });

    it('refuses an EV charger for a call-out fee', () => {
      expect(
        matchEvidence('vehicle charge call out fee', 'Dewalt Smart Mini 7/22kW Type 2 EV Charger'),
      ).toBe('none');
    });

    it('treats an empty product name as no evidence', () => {
      expect(matchEvidence('90x45 pine', '')).toBe('none');
    });
  });

  describe("'weak' — one incidental word, apply but flag", () => {
    it('is where a verbose query lands even on a correct match', () => {
      // Known and accepted cost. "punched metal strap bracing hoop iron"
      // names the thing four ways; the product uses one of them, so coverage
      // is 1/6 and this correct match is refused to an estimate. Loosening
      // coverage far enough to catch it is what lets a towel bar through for
      // "N12 starter bar" — a flagged estimate is the cheaper mistake.
      expect(
        matchEvidence('punched metal strap bracing hoop iron', 'Bremick 25mm x 0.8mm x 30 Metres Galvanised Strapping'),
      ).toBe('weak');
    });

    it('grades a chrome towel bar against N12 starter bars as weak (QU-178711)', () => {
      // The only tie is the word "bar". This shipped 30 × $85 = $2,550.
      expect(
        matchEvidence(
          'N12 starter bar 600mm dowel',
          'Mondella 935mm Chrome Resonance Double Towel Bar',
        ),
      ).toBe('weak');
    });

    it('grades a gas-strut bracket against joist hangers as weak', () => {
      expect(
        matchEvidence(
          'Joist hangers framing brackets',
          'Goliath 20 x 25mm Stainless Steel Gas Strut Bracket With Ball Stud',
        ),
      ).toBe('weak');
    });

    it('grades a mini plaster repair panel against a full plasterboard sheet as weak', () => {
      expect(
        matchEvidence('Plasterboard 2400x1200x10mm', 'Gyprock CSR 530 x 530 x 10mm Mini Plaster Repair Panel'),
      ).toBe('weak');
    });
  });

  describe("'strong' — enough overlap to trust", () => {
    it('accepts the matching bar chair pack', () => {
      expect(
        matchEvidence(
          'concrete bar chairs 50/65mm',
          'Jack 50 - 65mm Plastic Reinforcing Bar Chair - 20 Pack',
        ),
      ).toBe('strong');
    });

    it('accepts a same-spec timber match with no shared noun', () => {
      // "Rafters" vs "Framing" share no word, but the whole dimension chain
      // agrees — for dimensional goods the spec IS the identity.
      expect(matchEvidence('Rafters 140x45mm 3.6m', '140 x 45mm MGP10 Pine Framing 3.6m')).toBe(
        'strong',
      );
    });

    it('normalises metres against millimetres', () => {
      expect(
        matchEvidence('Ceiling joists 90x45mm H2 6.0m', 'Framing Timber H2 Treated 90 x 45 x 6000mm'),
      ).toBe('strong');
    });

    it('matches a closed-up compound against the spaced form', () => {
      expect(matchEvidence('Hole Saw Kit for Plumbing', 'Full Boar 35mm Bi-Metal Holesaw FBMH-35')).toBe(
        'strong',
      );
    });

    it('folds plurals without mangling the stem', () => {
      // A blunt -es rule turns "hinges" into "hing" and loses a real match.
      expect(
        matchEvidence('heavy duty galvanised gate hinges', 'Pinnacle 250mm Zinc Plated Heavy Duty Tee Hinge'),
      ).toBe('strong');
      expect(matchEvidence('storage boxes', 'Ezy Storage 32L Box')).toBe('strong');
    });

    it('keeps packaging nouns that are really the head noun', () => {
      expect(
        matchEvidence('heavy duty builders rubbish bags', 'Glad 70L Heavy Duty Clear Garbage Bags - 50pk'),
      ).toBe('strong');
      expect(matchEvidence('Junction Box 4-Way IP54', 'DETA Junction Box With 4 x 40A Connectors')).toBe(
        'strong',
      );
    });

    it('meets an inflected form of the same word (found by the replay audit)', () => {
      // "Spotting" vs "Spot" was refused outright before the -ing arm, and it
      // is a correct match — a carpet cleaner's spotting chemical.
      expect(matchEvidence('Spotting chemicals', 'No Vac 550g Instant Spot And Stain Remover')).toBe('strong');
    });

    it('does not fold a derived word onto its root', () => {
      // -er and -all are derivational, not inflectional. Folding them is how
      // "Disposable painters coveralls" got priced as a paint roller cover.
      expect(
        matchEvidence('Disposable painters coveralls', 'Paint Partner 230mm Paint Roller Cover - 8 Pack'),
      ).toBe('none');
    });

    it('counts agreement on both what it is and what size it is', () => {
      // Word coverage alone dropped the 20mm corrugated conduit this row had
      // matched in favour of a 2.5m washing-machine drain hose at 2.3x.
      expect(
        matchEvidence('20mm corrugated condensate drain pipe', 'Deta 20m Medium Duty 20mm Corrugated Conduit'),
      ).toBe('strong');
    });

    it('accepts an exact product-family hit', () => {
      expect(
        matchEvidence('chemical anchor epoxy injection', 'Ramset 410mL Chemical Anchor Epoxy Injection Adhesive'),
      ).toBe('strong');
    });

    it('never reads an unjudgeable query as a bad match', () => {
      expect(matchEvidence('', 'Anything At All')).toBe('strong');
      expect(matchEvidence('the and for', 'Anything At All')).toBe('strong');
    });
  });
});

function mat(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'N12 Starter Bars 600mm',
    searchTerm: 'N12 starter bar 600mm dowel',
    quantity: 30,
    unit: 'each',
    price: 85,
    totalPrice: 2550,
    manualPriceOverride: false,
    ...overrides,
  } as Material;
}

const TOWEL_BAR = 'Mondella 935mm Chrome Resonance Double Towel Bar';

describe('stampMatchConfidence', () => {
  it('downgrades a weak match the supplier reported as high confidence', () => {
    // Every Bunnings hit comes back confidence:'high' — that describes the
    // scrape, not the match. QU-178711 shipped this row at 30 x $85 unflagged.
    const m = mat({ priceConfidence: 'high' });
    stampMatchConfidence(m, TOWEL_BAR);
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toBe(WEAK_MATCH_NOTE);
  });

  it('leaves a strong match alone', () => {
    const m = mat({
      name: 'Bar Chairs 50/65mm',
      searchTerm: 'concrete bar chairs 50/65mm',
      priceConfidence: 'high',
      description: 'Supports reinforcing mesh when pouring concrete',
    });
    stampMatchConfidence(m, 'Jack 50 - 65mm Plastic Reinforcing Bar Chair - 20 Pack');
    expect(m.priceConfidence).toBe('high');
    expect(m.description).toBe('Supports reinforcing mesh when pouring concrete');
  });

  it('keeps an existing coverage note alongside the warning', () => {
    const m = mat({ priceConfidence: 'high', description: '20 per pack (need 30)' });
    stampMatchConfidence(m, TOWEL_BAR);
    expect(m.description).toBe(`${WEAK_MATCH_NOTE}. 20 per pack (need 30)`);
  });

  it("replaces the wrong product's marketing bullets", () => {
    // applyProduct assigns the supplier's description array verbatim; on a
    // weak match those bullets describe a different product entirely.
    const m = mat({ priceConfidence: 'high', description: ['Chrome plated finish'] as never });
    stampMatchConfidence(m, TOWEL_BAR);
    expect(m.description).toBe(WEAK_MATCH_NOTE);
  });

  it('is idempotent across a re-price', () => {
    const m = mat({ priceConfidence: 'high' });
    stampMatchConfidence(m, TOWEL_BAR);
    stampMatchConfidence(m, TOWEL_BAR);
    expect(m.description).toBe(WEAK_MATCH_NOTE);
  });
});

describe('stampMatchConfidence — implausible money', () => {
  function row(over: Partial<Material> = {}): Material {
    return {
      id: 'm1',
      name: 'Ekodeck Colour Matched Decking Screws',
      searchTerm: 'Ekodeck decking screws',
      quantity: 50,
      unit: 'each',
      price: 98.23,
      totalPrice: 4911.5,
      manualPriceOverride: false,
      ...over,
    } as Material;
  }

  it('flags screws priced at a decking board, which word overlap graded strong', () => {
    // The real row: 50 x $98.23 = $4,911.50, matched to an Ekodeck BOARD.
    const product = 'Ekodeck 137 x 23mm 5.4m Riverbank Red Estate Brown Designer Series Composite Decking';
    expect(matchEvidence('Ekodeck decking screws', product)).toBe('strong');
    const m = row();
    stampMatchConfidence(m, product);
    expect(m.weakProductMatch).toBe(true);
    expect(m.priceConfidence).toBe('low');
    expect(m.description).toContain('far above what this normally costs');
  });

  it('leaves a sanely priced screw row alone', () => {
    const m = row({ price: 0.14, totalPrice: 7 });
    stampMatchConfidence(m, 'Buildex 10g x 50mm Stainless Decking Screws 50 Pack');
    expect(m.weakProductMatch).toBeUndefined();
  });

  it('does not second-guess a price the tradie typed in', () => {
    const m = row({ manualPriceOverride: true });
    stampMatchConfidence(m, 'Ekodeck 137 x 23mm 5.4m Composite Decking');
    expect(m.weakProductMatch).toBeUndefined();
  });

  it('only compares a price against an opinion in the same unit', () => {
    // The table's screw opinion is per-each; it says nothing about a pack.
    const m = row({ unit: 'pack', price: 98.23 });
    stampMatchConfidence(m, 'Buildex Decking Screws 1000 Pack');
    expect(m.weakProductMatch).toBeUndefined();
  });

  it('still clears a stale flag when the row re-prices cleanly', () => {
    const m = row({ price: 0.14, weakProductMatch: true });
    stampMatchConfidence(m, 'Buildex 10g x 50mm Stainless Decking Screws 50 Pack');
    expect(m.weakProductMatch).toBeUndefined();
  });
});
