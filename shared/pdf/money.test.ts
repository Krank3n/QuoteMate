import { dollarsToCents, centsToDollars } from './money';

describe('money helpers', () => {
  describe('dollarsToCents', () => {
    it('converts whole dollars', () => {
      expect(dollarsToCents(100)).toBe(10000);
      expect(dollarsToCents(0)).toBe(0);
    });

    it('rounds binary-float drift correctly', () => {
      // Classic 0.1 + 0.2 = 0.30000000000000004 — must not round to 29.
      expect(dollarsToCents(0.1 + 0.2)).toBe(30);
      expect(dollarsToCents(19.99)).toBe(1999);
      expect(dollarsToCents(123.456)).toBe(12346);
    });

    it('handles negatives', () => {
      expect(dollarsToCents(-50)).toBe(-5000);
    });

    it('returns 0 for NaN/Infinity', () => {
      expect(dollarsToCents(NaN)).toBe(0);
      expect(dollarsToCents(Infinity)).toBe(0);
    });
  });

  describe('centsToDollars', () => {
    it('converts integer cents', () => {
      expect(centsToDollars(10000)).toBe(100);
      expect(centsToDollars(1999)).toBe(19.99);
    });

    it('round-trips with dollarsToCents', () => {
      for (const d of [0, 0.01, 19.99, 100, 1234.56, 999999.99]) {
        expect(centsToDollars(dollarsToCents(d))).toBe(d);
      }
    });

    it('returns 0 for NaN', () => {
      expect(centsToDollars(NaN)).toBe(0);
    });
  });
});
