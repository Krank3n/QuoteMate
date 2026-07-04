import { describe, it, expect } from 'vitest';
import { coverageSanePurchaseCount } from './purchaseCoverage';

describe('coverageSanePurchaseCount', () => {
  describe('the QU-178011 failures it exists to fix', () => {
    it('collapses 19 tubs of decking screws to 1 (unknown pack, bulk price)', () => {
      // ~470 screws for a 10 m² deck; a $151 product with no count token is a
      // 500-screw tub → one purchase covers it.
      const sane = coverageSanePurchaseCount({
        requirement: 470,
        name: 'Stainless Steel Decking Screws 10G x 50mm',
        perPurchasePrice: 151.64,
      });
      expect(sane).toBe(1);
    });

    it('collapses 5 tins of decking oil to 1', () => {
      // ~3 L needed for two coats over 10 m²; a $150 product is a ~10 L drum.
      const sane = coverageSanePurchaseCount({
        requirement: 3,
        name: 'Merbau Decking Oil',
        perPurchasePrice: 150.54,
      });
      expect(sane).toBe(1);
    });
  });

  describe('known pack size is authoritative', () => {
    it('divides the requirement by a known screw pack size', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 470, name: 'Deck Screws', perPurchasePrice: 151, packSize: 500 }),
      ).toBe(1);
      expect(
        coverageSanePurchaseCount({ requirement: 1200, name: 'Deck Screws', perPurchasePrice: 151, packSize: 500 }),
      ).toBe(3);
    });

    it('divides oil litres by a known drum size — preserving legit multi-drum buys', () => {
      // A genuinely large deck needing 20 L from 10 L drums → 2, not clamped to 1.
      expect(
        coverageSanePurchaseCount({ requirement: 20, name: 'Decking Oil', perPurchasePrice: 150, packSize: 10 }),
      ).toBe(2);
    });
  });

  describe('does NOT touch legitimate cases (clamp must never over-reduce)', () => {
    it('collapses cheap retail fastener packs when the requirement is an individual count', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 100,
          name: 'Galvanized Bugle Batten Screws 14G x 100mm',
          perPurchasePrice: 17.02,
        }),
      ).toBe(1);
    });

    it('collapses nail tubs/boxes instead of treating the tub price as per nail', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 200,
          name: 'Pryda Flathead Nails 35x3.15mm Galv',
          perPurchasePrice: 12.01,
        }),
      ).toBe(2);
    });

    it('leaves piece-goods (boards) untouched', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 112, name: 'Merbau Decking Board 90x19mm', perPurchasePrice: 6.24 }),
      ).toBeNull();
    });

    it('leaves individually-sold bolts untouched', () => {
      expect(
        coverageSanePurchaseCount({
          requirement: 96,
          name: 'Galvanized Cup Head Bolts M10 x 120mm',
          perPurchasePrice: 1.9,
        }),
      ).toBeNull();
    });

    it('leaves concrete and other non-fastener/non-liquid rows untouched', () => {
      expect(
        coverageSanePurchaseCount({ requirement: 2, name: 'Quick Set Concrete', perPurchasePrice: 9.75 }),
      ).toBeNull();
    });

    it('does not assume a bulk tub for a small fastener requirement', () => {
      // High price but only ~20 needed → a small pack suffices; leave it alone.
      expect(
        coverageSanePurchaseCount({ requirement: 20, name: 'Specialty Decking Screws', perPurchasePrice: 100 }),
      ).toBeNull();
    });
  });

  describe('guards', () => {
    it('returns null for non-positive requirement or price', () => {
      expect(coverageSanePurchaseCount({ requirement: 0, name: 'Screws', perPurchasePrice: 150 })).toBeNull();
      expect(coverageSanePurchaseCount({ requirement: 100, name: 'Screws', perPurchasePrice: 0 })).toBeNull();
    });

    it('a mid-priced oil tin ($80–120) is treated as ~4 L', () => {
      // 6 L needed from a ~$90 4 L tin → 2 tins.
      expect(
        coverageSanePurchaseCount({ requirement: 6, name: 'Timber Oil', perPurchasePrice: 90 }),
      ).toBe(2);
    });
  });
});
