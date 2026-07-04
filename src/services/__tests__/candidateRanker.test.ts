import { describe, it, expect } from 'vitest';
import { pickBestCandidate, type RankableCandidate } from '../candidateRanker';

const c = (
  price: number,
  productName: string,
  extra: Partial<RankableCandidate> = {},
): RankableCandidate => ({ price, productName, ...extra });

describe('pickBestCandidate', () => {
  it('returns null for empty list', () => {
    expect(pickBestCandidate([])).toBeNull();
  });

  it('returns the only candidate unchanged', () => {
    const only = c(100, 'Tap');
    expect(pickBestCandidate([only])).toBe(only);
  });

  it('returns first candidate when none are priced', () => {
    const list = [c(0, 'Tap A'), c(0, 'Tap B')];
    expect(pickBestCandidate(list)).toBe(list[0]);
  });

  describe('quality tier bias', () => {
    // Real-world spread for "kitchen mixer tap" on Bunnings
    const taps = [
      c(38, 'Basic Kitchen Mixer Tap'),
      c(86, 'Chrome Kitchen Mixer Tap'),
      c(150, 'Standard Kitchen Mixer Tap'),
      c(280, 'Premium Kitchen Mixer Tap'),
      c(420, 'Designer Kitchen Mixer Tap', { brand: 'Phoenix' }),
    ];

    it('premium tier picks a high-priced candidate, not the $86 default', () => {
      const picked = pickBestCandidate(taps, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'premium',
      });
      expect(picked).not.toBeNull();
      expect(picked!.price).toBeGreaterThanOrEqual(280);
    });

    it('budget tier picks a low-priced candidate', () => {
      const picked = pickBestCandidate(taps, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'budget',
      });
      expect(picked!.price).toBeLessThanOrEqual(150);
    });

    it('standard tier stays near the median', () => {
      const picked = pickBestCandidate(taps, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'standard',
      });
      // median is $150 — within ±30% should be $105–$195
      expect(picked!.price).toBe(150);
    });

    it('falls back to jobQualityTier when material lacks one', () => {
      const picked = pickBestCandidate(
        taps,
        { searchTerm: 'kitchen mixer tap' },
        { jobQualityTier: 'premium' },
      );
      expect(picked!.price).toBeGreaterThanOrEqual(280);
    });
  });

  describe('name match', () => {
    it('prefers candidates whose name matches the search term tokens', () => {
      const list = [
        c(100, 'Tap Aerator Replacement'),
        c(120, 'Kitchen Mixer Tap Chrome'),
        c(90, 'Bathroom Spout'),
      ];
      const picked = pickBestCandidate(list, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'standard',
      });
      expect(picked!.productName).toBe('Kitchen Mixer Tap Chrome');
    });
  });

  describe('junk-price penalty', () => {
    it('skips accessories priced absurdly below the median', () => {
      // $4 aerator mis-ranked into a mixer-tap result set
      const list = [
        c(4, 'Tap Aerator'),
        c(86, 'Kitchen Mixer Tap'),
        c(150, 'Kitchen Mixer Tap Premium'),
        c(200, 'Kitchen Mixer Tap Designer'),
      ];
      const picked = pickBestCandidate(list, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'budget',
      });
      // Even on budget tier, the $4 aerator should be skipped
      expect(picked!.price).not.toBe(4);
    });
  });

  describe('premium brand bonus', () => {
    it('breaks ties toward a known premium brand on premium tier', () => {
      const list = [
        c(300, 'Kitchen Mixer Tap', { brand: 'NoName' }),
        c(300, 'Kitchen Mixer Tap', { brand: 'Phoenix' }),
      ];
      const picked = pickBestCandidate(list, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'premium',
      });
      expect(picked!.brand).toBe('Phoenix');
    });

    it('does not boost premium brand on budget tier', () => {
      const list = [
        c(80, 'Kitchen Mixer Tap', { brand: 'NoName' }),
        c(300, 'Kitchen Mixer Tap', { brand: 'Phoenix' }),
      ];
      const picked = pickBestCandidate(list, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'budget',
      });
      expect(picked!.brand).toBe('NoName');
    });
  });

  describe('confidence tiebreaker', () => {
    it('prefers high-confidence when scores are otherwise tied', () => {
      const list = [
        c(150, 'Kitchen Mixer Tap', { confidence: 'low' }),
        c(150, 'Kitchen Mixer Tap', { confidence: 'high' }),
      ];
      const picked = pickBestCandidate(list, {
        searchTerm: 'kitchen mixer tap',
        qualityTier: 'standard',
      });
      expect(picked!.confidence).toBe('high');
    });
  });

  describe('backwards-compat default behaviour', () => {
    it('without tier info, still picks a sensible name-matched candidate', () => {
      // No qualityTier and no jobQualityTier — should fall back to
      // standard (median-band) behaviour, NOT just hits[0].
      const list = [
        c(50, 'Random Unrelated Product'),
        c(150, 'Kitchen Mixer Tap'),
        c(300, 'Kitchen Mixer Tap Premium'),
      ];
      const picked = pickBestCandidate(list, { searchTerm: 'kitchen mixer tap' });
      expect(picked!.productName).toContain('Kitchen Mixer Tap');
    });
  });

  describe('semantic category guard', () => {
    it('does not pick drill bits for hardwood decking boards', () => {
      const picked = pickBestCandidate([
        c(24, 'Hardwood Drill Bit Set'),
        c(82, 'Australian Hardwood Decking 140x19mm 5.4m'),
      ], { searchTerm: 'Australian mixed hardwood decking board 140x19mm 5.4m' });
      expect(picked!.productName).toContain('Decking');
    });

    it('returns null instead of applying unrelated timber hardware', () => {
      const picked = pickBestCandidate([
        c(13, 'Hitch Pin 140mm Zinc'),
        c(9, 'Angle Bracket Galvanised'),
      ], { searchTerm: 'Pine Structural Treated H3 140x45mm Joists' });
      expect(picked).toBeNull();
    });

    it('rejects roof tile accessory/compound matches', () => {
      const picked = pickBestCandidate([
        c(18, 'Flexible Roof Pointing Compound'),
        c(9, 'Silicone Nozzle Pack'),
        c(6, 'Concrete Roof Tile Charcoal'),
      ], { searchTerm: 'Concrete Roof Tile' });
      expect(picked!.productName).toBe('Concrete Roof Tile Charcoal');
    });

    it('does not price diesel fuel as injector cleaner', () => {
      const picked = pickBestCandidate([
        c(21, 'Diesel Fuel System Cleaner'),
        c(14, 'Diesel Additive Treatment'),
      ], { searchTerm: 'Diesel Fuel' });
      expect(picked).toBeNull();
    });

    it('does not price electrical wire connectors as irrigation fittings', () => {
      const picked = pickBestCandidate([
        c(7, '13mm Irrigation Barbed Connector'),
        c(12, 'Electrical Wire Connector 10 Pack'),
      ], { searchTerm: 'Wire Connectors BP Connectors Electrical' });
      expect(picked!.productName).toContain('Electrical Wire Connector');
    });
  });
});
