/**
 * The owned-gear filter drops rows that name the tradie's own tools or PPE,
 * and nothing else — a false drop of a real material is the worse failure.
 */
import { describe, it, expect } from 'vitest';
import { dropOwnedGear, matchOwnedGear } from './ownedGear';

const row = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  quantity: 1,
  unit: 'each',
  section: 'Test Section',
  ...extra,
});

describe('dropOwnedGear', () => {
  it('drops a club hammer, pry bar and finishing broom from a small concrete path', () => {
    const description = 'Pour a 5 m² concrete path beside the garage, broom finish';
    const { materials, dropped } = dropOwnedGear(
      [
        row('Concrete mix 20kg', { quantity: 30 }),
        row('Club Hammer 1.25kg'),
        row('Demolition wrecking/pry bar 1200mm'),
        row('Concrete finishing broom'),
        row('Concreting gloves and safety glasses'),
        row('Reinforcing mesh SL72', { unit: 'm²', quantity: 6 }),
      ],
      description,
    );
    expect(materials.map((m) => m.name)).toEqual(['Concrete mix 20kg', 'Reinforcing mesh SL72']);
    expect(dropped).toEqual([
      'Club Hammer 1.25kg',
      'Demolition wrecking/pry bar 1200mm',
      'Concrete finishing broom',
      'Concreting gloves and safety glasses',
    ]);
  });

  it('drops the cleaning kit a cleaner brings, but keeps the chemicals used up on the job', () => {
    const { materials, dropped } = dropOwnedGear(
      [
        row('Extension pole 1.8-3m telescopic'),
        row('Twin compartment mop bucket 15L'),
        row('Flat mop with microfibre pads'),
        row('Stiff bristle broom and dustpan set'),
        row('Window squeegee 35cm'),
        row('Oven cleaner 500ml', { unit: 'L', quantity: 0.5 }),
        row('Glass cleaner 750ml', { unit: 'L', quantity: 0.75 }),
      ],
      'Vacate clean of a 2 bedroom unit',
    );
    expect(materials.map((m) => m.name)).toEqual(['Oven cleaner 500ml', 'Glass cleaner 750ml']);
    expect(dropped).toHaveLength(5);
  });

  it('keeps hammer-drill bits, saw blades, hammer-in fixings and disposable gloves — they are consumables', () => {
    const rows = [
      row('Hammer drill bits 6.5mm masonry', { quantity: 4 }),
      row('Circular saw blade 184mm'),
      row('Hammer-in fixings 8x80mm', { quantity: 40 }),
      row('Disposable nitrile gloves', { unit: 'box' }),
      row('Mop head refill microfibre'),
    ];
    const { materials, dropped } = dropOwnedGear(rows, 'Fix battens to a brick wall');
    expect(materials).toBe(rows);
    expect(dropped).toEqual([]);
  });

  it('keeps paint, sandpaper, drop sheets and a skip bin hire the description asked for', () => {
    const rows = [
      row('Low sheen interior paint', { unit: 'L', quantity: 10 }),
      row('Sandpaper 120 grit', { quantity: 6 }),
      row('Plastic drop sheets 4x5m', { quantity: 2 }),
      row('Skip bin hire 4m³'),
    ];
    const { materials, dropped } = dropOwnedGear(
      rows,
      'Repaint the lounge and hallway, skip needed for the old carpet',
    );
    expect(materials).toBe(rows);
    expect(dropped).toEqual([]);
  });

  it('keeps gear the job description itself mentions', () => {
    const { materials, dropped } = dropOwnedGear(
      [row('Pressure washer hire (per day)'), row('Extension ladder hire 6m')],
      'Pressure clean the driveway; hire an extension ladder for the gutters',
    );
    expect(materials.map((m) => m.name)).toEqual(['Pressure washer hire (per day)', 'Extension ladder hire 6m']);
    expect(dropped).toEqual([]);
  });

  it('drops a gerni hire the description never asked for', () => {
    const { dropped } = dropOwnedGear(
      [row('Pressure washer surface cleaner attachment / gerni hire (per day)')],
      'Garden tidy up, mow, edge and weed the beds',
    );
    expect(dropped).toEqual(['Pressure washer surface cleaner attachment / gerni hire (per day)']);
  });

  it('never touches rows from the tradie\'s own saved rates, Reece SKUs, or lump-sum work lines', () => {
    const rows = [
      row('Gerni hire', { pricingSource: 'saved_rate', savedRateName: 'Gerni hire' }),
      row('Ladder hire', { savedRateName: 'Ladder day rate' }),
      row('Drill', { reeceProductId: 12345 }),
      row('Broom down and tidy', { kind: 'work' }),
    ];
    const { materials, dropped } = dropOwnedGear(rows, 'Clean the eaves');
    expect(materials).toBe(rows);
    expect(dropped).toEqual([]);
  });

  it('returns the same array untouched when nothing matches', () => {
    const rows = [row('Treated pine H3 90x45 2.4m', { quantity: 12 })];
    const { materials, dropped } = dropOwnedGear(rows, 'Build a small deck');
    expect(materials).toBe(rows);
    expect(dropped).toEqual([]);
  });
});

describe('matchOwnedGear', () => {
  it('matches on whole words only, so drilling, mopping and brooming do not match', () => {
    expect(matchOwnedGear('Core drilling service 100mm', '')).toBeNull();
    expect(matchOwnedGear('Mopping compound 5L', '')).toBeNull();
    expect(matchOwnedGear('Cordless drill driver', '')).toBe('drill');
    expect(matchOwnedGear('Rubber mallet', '')).toBe('hammer');
  });

  it('ignores blank and non-string names', () => {
    expect(matchOwnedGear('', 'anything')).toBeNull();
    expect(matchOwnedGear(undefined, 'anything')).toBeNull();
    expect(matchOwnedGear(42, 'anything')).toBeNull();
  });
});
