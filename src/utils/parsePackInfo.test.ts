import { describe, expect, it } from 'vitest';
import { parsePackInfo } from './parsePackInfo';

describe('parsePackInfo', () => {
  it('parses leading count box products', () => {
    expect(parsePackInfo('45mm Galvanised Ring Shank Coil Nails 2400 Box')).toEqual({ packSize: 2400, packUnit: 'each' });
  });

  it('parses millilitre products as litres', () => {
    expect(parsePackInfo('Sugar Soap Spray 750ml')).toEqual({ packSize: 0.75, packUnit: 'L' });
  });

  it('still parses litre products as litres', () => {
    expect(parsePackInfo('Decking Oil Natural 4L')).toEqual({ packSize: 4, packUnit: 'L' });
  });

  it('prefers concrete bag weight over wet yield litres', () => {
    expect(parsePackInfo('Dingo 10kg Fast Set Hi-Strength Concrete yields 1.1L')).toEqual({ packSize: 10, packUnit: 'kg' });
  });

  it('parses cable roll lengths even when the brand runs into the number', () => {
    expect(parsePackInfo('Deta10 m 2.5mm² 2-Core + Earth Power Cable')).toEqual({ packSize: 10, packUnit: 'm' });
  });

  it('does not misread cable gauge as square metres', () => {
    expect(parsePackInfo('1.5mm² Twin and Earth TPS Cable')).toBeNull();
  });

  it('parses roll dimensions into area coverage', () => {
    expect(parsePackInfo('Geotextile Filter Fabric 2m x 20m Roll')).toEqual({ packSize: 40, packUnit: 'm²' });
    expect(parsePackInfo('Pre-taped Masking Film 2700mm x 17m Roll')).toEqual({ packSize: 45.9, packUnit: 'm²' });
    expect(parsePackInfo('Vapour Barrier Polyethylene Sheeting 2m x 20m')).toEqual({ packSize: 40, packUnit: 'm²' });
    expect(parsePackInfo('Thermafoil Roof Sarking 1350mm x 30m')).toEqual({ packSize: 40.5, packUnit: 'm²' });
  });

  it('converts gram pack weights to kg', () => {
    expect(parsePackInfo('Mineral Oil Absorbent 900g')).toEqual({ packSize: 0.9, packUnit: 'kg' });
  });
});

describe('parsePackInfo — unit preference and superscript units', () => {
  it('parses the m² spelling, not just m2', () => {
    // The trailing \b after `²` never matched, so this returned the piece count.
    expect(parsePackInfo('Earthwool R2.0 Wall Batt 1160mm 16.0m² 32 Pack', { preferUnit: 'm²' }))
      .toEqual({ packSize: 16, packUnit: 'm²' });
  });

  it('parses the m³ spelling', () => {
    expect(parsePackInfo('Bulk Bag Garden Mix 0.5m³')).toEqual({ packSize: 0.5, packUnit: 'm³' });
  });

  it('prefers a stated coverage over a piece count when the caller needs area', () => {
    const title = 'Earthwool R2.0 Wall Batt 90mm x 430mm x 1160mm 16.0m² 32 Pack';
    expect(parsePackInfo(title)).toEqual({ packSize: 32, packUnit: 'each' });
    expect(parsePackInfo(title, { preferUnit: 'm²' })).toEqual({ packSize: 16, packUnit: 'm²' });
  });

  it('reads a plywood sheet as its face area', () => {
    expect(parsePackInfo('Customply 2400 x 1200 x 12mm Non Structural Plywood', { preferUnit: 'm²' }))
      .toEqual({ packSize: 2.88, packUnit: 'm²' });
  });

  it('does not read a board face dimension as a pack area', () => {
    // 137 x 23mm is one board's profile, not a pack of coverage.
    expect(parsePackInfo('Ekodeck 137 x 23mm 5.4m Composite Decking', { preferUnit: 'm²' })?.packUnit).not.toBe('m²');
  });

  it('keeps the roll-area reading when no unit is preferred', () => {
    expect(parsePackInfo('Coolaroo 2m x 20m Weedmat Roll')).toEqual({ packSize: 40, packUnit: 'm²' });
  });
});

describe('parsePackInfo is total', () => {
  // Callers sit inside best-effort regions guarded by bare catches, so a throw
  // here does not read as a parse failure — it silently kills the surrounding
  // pass. The scraper's bullet-array description did exactly that.
  it('accepts the scraper bullet array and reads a pack size out of it', () => {
    expect(parsePackInfo(['Premium mix', 'Supplied in a 20kg bag'])).toEqual({ packSize: 20, packUnit: 'kg' });
  });

  it('returns null rather than throwing on any non-string input', () => {
    for (const bad of [42, {}, true, [], [1, 2], Symbol('x')] as unknown[]) {
      expect(() => parsePackInfo(bad as never)).not.toThrow();
      expect(parsePackInfo(bad as never)).toBeNull();
    }
  });
});

describe('parsePackInfo — stock length stated in millimetres', () => {
  it('reads a cornice stick length, not its profile', () => {
    expect(parsePackInfo('Gyprock CSR 90mm x 3600mm Cove Plaster Cornice', { preferUnit: 'm' }))
      .toEqual({ packSize: 3.6, packUnit: 'm' });
  });

  it('reads a stopping angle length', () => {
    // 640 lineal metres was billed as 640 x the price of one 3 m length.
    expect(parsePackInfo('Siniat 10 x 3000mm Shadowline Stopping Angle Plaster Trim', { preferUnit: 'm' }))
      .toEqual({ packSize: 3, packUnit: 'm' });
  });

  it('ignores mm figures outside a stock-length band', () => {
    expect(parsePackInfo('Bremick Metal Hex Screw 10g x 16mm B8', { preferUnit: 'm' })?.packUnit).not.toBe('m');
  });

  it('does not change a row counted in pieces', () => {
    expect(parsePackInfo('Gyprock CSR 90mm x 3600mm Cove Plaster Cornice', { preferUnit: 'each' }))
      .not.toEqual({ packSize: 3.6, packUnit: 'm' });
  });
});

describe('the reconcile model\'s own phrasing (QU-178514 corrupted floor)', () => {
  // The reconcile pass states its arithmetic as "N things per container" in
  // its coverage notes, and nothing here could read it — so recoverPackInfo
  // fell to worse sources and the floor divided a 147-paling requirement by a
  // wrong size, RAISING the model's correct 3 bundles to 15 ($3,285 for ~750
  // palings). The one source stating the true size was unreadable.
  it('reads "50 palings per bundle"', () => {
    expect(parsePackInfo('50 palings per bundle')).toEqual({ packSize: 50, packUnit: 'each' });
  });

  it('reads "300 coil nails per pack"', () => {
    expect(parsePackInfo('300 coil nails per pack')).toEqual({ packSize: 300, packUnit: 'each' });
  });

  it('reads "1 paling per purchase" — one-per-purchase is a statement, not noise', () => {
    expect(parsePackInfo('1 paling per purchase')).toEqual({ packSize: 1, packUnit: 'each' });
  });

  it('does not read a PRICE per container as a size', () => {
    expect(parsePackInfo('$219 per bundle')).toBeNull();
    expect(parsePackInfo('about $45.90 per pack at Bunnings')).toBeNull();
    expect(parsePackInfo('45.90 per pack')).toBeNull();
  });

  it('still ignores bare "1 each" title noise', () => {
    expect(parsePackInfo('Gate Hinge 1 each')).toBeNull();
  });

  // A ladder's duty rating was being read as a pack size: a real quote carried
  // "Ladder levelling/stabiliser accessory | 1 pack @ $161.82" with a packSize
  // of 120 kg. A safety rating is not a quantity in a box.
  describe('load ratings are not pack sizes', () => {
    it('does not read a ladder duty rating as a pack size', () => {
      expect(parsePackInfo('Bailey Ladder Leveller 120kg Rated')).toBeNull();
      expect(parsePackInfo('Ladder Stabiliser Accessory 150 kg Rating')).toBeNull();
    });

    it('does not read a rating stated word-first', () => {
      expect(parsePackInfo('Werner Extension Ladder rated to 120kg')).toBeNull();
      expect(parsePackInfo('Trestle Platform, max load 150kg')).toBeNull();
      expect(parsePackInfo('Fall Arrest Harness WLL 140kg')).toBeNull();
      expect(parsePackInfo('Storage Bracket holds up to 30kg')).toBeNull();
    });

    it('masks a bare weight on access gear, where kg is always what it holds', () => {
      expect(parsePackInfo('Gorilla 1.8m 120kg Fibreglass Stepladder')).toEqual({ packSize: 1.8, packUnit: 'm' });
      expect(parsePackInfo('Aluminium Scaffold Plank 225kg')).toBeNull();
    });

    it('masks every weight on access gear — a trestle\'s own weight is not a pack either', () => {
      expect(parsePackInfo('120kg rated trestle, 15kg each')).toBeNull();
    });

    it('a rating phrase is surgical: another weight in the same title survives', () => {
      expect(parsePackInfo('Cement 20kg bag, rated to 200kg per pallet')).toEqual({ packSize: 20, packUnit: 'kg' });
    });

    // parsePackInfo is not only fed product titles. recoverPackInfo hands it the
    // reconcile model's own coverage note, and on an estimate row that note is
    // the ONLY statement of a pack size — blank it and the under-buy guard has
    // nothing to divide by.
    it('never blanks a pack size stated in prose', () => {
      const prose = { proseSource: true } as const;
      expect(parsePackInfo('Each bag holds 20kg; 5 bags needed', prose)).toEqual({ packSize: 20, packUnit: 'kg' });
      expect(parsePackInfo('20kg per bag, 11 bags total 220kg for the post holes and brackets', prose)).toEqual({
        packSize: 20,
        packUnit: 'kg',
      });
      expect(
        parsePackInfo('Ideal for setting fence posts, clothes hoists, letterboxes and brackets. 20kg bag.', prose),
      ).toEqual({ packSize: 20, packUnit: 'kg' });
    });

    it('still strips a real rating out of prose', () => {
      expect(parsePackInfo('Ladder platform rated to 120kg', { proseSource: true })).toBeNull();
    });

    it('"holds" alone is a pack statement, not a rating — only "holds up to" is', () => {
      expect(parsePackInfo('Each bag holds 20kg')).toEqual({ packSize: 20, packUnit: 'kg' });
      expect(parsePackInfo('Storage Bracket holds up to 30kg')).toBeNull();
    });

    it('"Heavy Duty" is a marketing word, not a duty rating', () => {
      expect(parsePackInfo('Heavy Duty 20kg Concrete Mix')).toEqual({ packSize: 20, packUnit: 'kg' });
      expect(parsePackInfo('Ladder 120kg Duty Rating')).toBeNull();
    });

    it('leaves ordinary bagged goods alone', () => {
      expect(parsePackInfo('Boral 20kg General Purpose Cement')).toEqual({ packSize: 20, packUnit: 'kg' });
      expect(parsePackInfo('Rapid Set Concrete 20kg Bag')).toEqual({ packSize: 20, packUnit: 'kg' });
      expect(parsePackInfo('Tile Adhesive 20kg')).toEqual({ packSize: 20, packUnit: 'kg' });
    });
  });
});
