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

    it('does not price unleaded petrol as engine oil', () => {
      const picked = pickBestCandidate([
        c(15, 'Husqvarna XP 4-Stroke Engine Oil 1L'),
        c(22, 'Fuel System Cleaner'),
      ], { searchTerm: 'Unleaded Petrol' });
      expect(picked).toBeNull();
    });

    it('does not price electrical wire connectors as irrigation fittings', () => {
      const picked = pickBestCandidate([
        c(7, '13mm Irrigation Barbed Connector'),
        c(12, 'Electrical Wire Connector 10 Pack'),
      ], { searchTerm: 'Wire Connectors BP Connectors Electrical' });
      expect(picked!.productName).toContain('Electrical Wire Connector');
    });

    it('does not map steel RHS to retaining wall H posts', () => {
      const picked = pickBestCandidate([
        c(50, 'Galvanised Retaining Wall H Post 900mm'),
        c(120, 'Galvanised Steel RHS 100 x 50 x 2.0mm'),
      ], { searchTerm: '100x50mm Galvanised Steel RHS' });
      expect(picked!.productName).toContain('RHS');
    });

    it('does not map sliding gate wheels to tracks', () => {
      const picked = pickBestCandidate([
        c(60, 'Sliding Gate Track 3m'),
        c(28, 'Sliding Gate Wheel 90mm'),
      ], { searchTerm: 'Sliding Gate Wheels 90mm' });
      expect(picked!.productName).toContain('Wheel');
    });

    it('does not map geotextile to irrigation stakes', () => {
      const picked = pickBestCandidate([
        c(6, 'Irrigation Spray Stake 10 Pack'),
        c(85, 'Geotextile Filter Fabric Roll'),
      ], { searchTerm: 'Geotextile Filter Wrap AS140' });
      expect(picked!.productName).toContain('Geotextile');
    });

    it('does not map disposal fees to retail products', () => {
      const picked = pickBestCandidate([
        c(20, 'Organic Fertiliser Bag'),
        c(12, 'Garden Waste Bags'),
      ], { searchTerm: 'Green Waste Disposal Allowance' });
      expect(picked).toBeNull();
    });

    it('does not map rapid set concrete to liquid membrane', () => {
      const picked = pickBestCandidate([
        c(188, 'Liquid Waterproofing Membrane 15L'),
        c(9, 'Rapid Set Concrete Mix 20kg'),
      ], { searchTerm: 'Rapid Set Concrete Mix 20kg' });
      expect(picked!.productName).toContain('Concrete');
    });

    it('does not map pool gates to posts', () => {
      const picked = pickBestCandidate([
        c(35, 'Black Aluminium Fence Post'),
        c(220, 'Black Aluminium Pool Gate 975x1200mm'),
      ], { searchTerm: 'Black Aluminium Standard Pool Gate 975x1200mm' });
      expect(picked!.productName).toContain('Gate');
    });

    it('does not map roof tiles to carpet tiles', () => {
      const picked = pickBestCandidate([
        c(9, 'Charcoal Carpet Tile'),
        c(7, 'Concrete Roof Tile Charcoal'),
      ], { searchTerm: 'Concrete Roof Tile standard profile' });
      expect(picked!.productName).toContain('Roof Tile');
    });

    it('does not map wire connectors to EV charging cables', () => {
      const picked = pickBestCandidate([
        c(180, 'EV Charging Cable Type 2'),
        c(12, 'Wago Wire Connector 10 Pack'),
      ], { searchTerm: 'wire connectors wago bp' });
      expect(picked!.productName).toContain('Wago');
    });

    it('does not map fence rail timber to brackets', () => {
      const picked = pickBestCandidate([
        c(4, 'Galvanised Angle Bracket'),
        c(18, 'Treated Pine Fence Rail 75x38mm'),
      ], { searchTerm: '75x38mm Treated Pine Fence Rail' });
      expect(picked!.productName).toContain('Rail');
    });

    it('does not accept undersized screws for a longer screw requirement', () => {
      const picked = pickBestCandidate([
        c(20, 'Self Drilling Metal Screws 10g x 16mm'),
        c(28, 'Self Drilling Metal Screws 10g x 45mm'),
      ], { searchTerm: 'Self-Drilling Metal Screws 10g x 45mm' });
      expect(picked!.productName).toContain('45mm');
    });

    it('does not select different TPS cable gauge', () => {
      const picked = pickBestCandidate([
        c(40, 'Deta10 m 2.5mm² 2-Core + Earth Power Cable'),
        c(32, 'Deta 10m 1.5mm² Twin and Earth Cable'),
      ], { searchTerm: '1.5mm 2 core and earth TPS electrical cable' });
      expect(picked!.productName).toContain('1.5mm');
    });

    it('does not select a different RHS profile dimension', () => {
      const picked = pickBestCandidate([
        c(50, 'Australian Handyman Supplies 50 x 50mm x 2.4m Galvanised Steel Fence Post'),
        c(90, '100 x 50mm Galvanised Steel RHS 2.4m'),
      ], { searchTerm: '100x50mm Galvanised Steel RHS' });
      expect(picked!.productName).toContain('100 x 50');
    });

    it('does not map electrical tape to anti-slip tape', () => {
      const picked = pickBestCandidate([
        c(12, 'Black Anti-Slip Grip Tape'),
        c(4, 'PVC Electrical Insulation Tape Black'),
      ], { searchTerm: 'black electrical tape roll' });
      expect(picked!.productName).toContain('Electrical');
    });

    it('does not match formwork pegs to formply sheets', () => {
      const picked = pickBestCandidate([
        c(80, 'Formply Sheet 2400 x 1200mm'),
        c(3, 'Hardwood Formwork Peg 450mm'),
      ], { searchTerm: 'hardwood formwork pegs' });
      expect(picked!.productName).toContain('Peg');
    });

    it('does not use retail bag products for bulk road base or crusher dust', () => {
      const picked = pickBestCandidate([
        c(9, 'Road Base 20kg Bag'),
        c(12, 'Crusher Dust 20kg Bag'),
      ], { searchTerm: 'Road base bulk 2m³' });
      expect(picked).toBeNull();
    });

    it('rejects dimensionless structural/profile products when an exact profile is required', () => {
      const picked = pickBestCandidate([
        c(65, 'Galvanised Steel Fence Post 2.4m'),
        c(90, '100 x 50mm Galvanised Steel RHS 2.4m'),
      ], { searchTerm: '100x50mm Galvanised Steel RHS' });
      expect(picked!.productName).toContain('100 x 50');
    });

    it('does not accept the wrong cable core count', () => {
      const picked = pickBestCandidate([
        c(80, 'Deta 10m 2.5mm² 4-Core + Earth Cable'),
        c(45, 'Deta 10m 2.5mm² 2-Core + Earth Cable'),
      ], { searchTerm: '2.5mm 2 core and earth TPS electrical cable' });
      expect(picked!.productName).toContain('2-Core');
    });

    it('does not match gate catchers to hinges or tracks', () => {
      const picked = pickBestCandidate([
        c(40, 'Heavy Duty Gate Hinge'),
        c(60, 'Sliding Gate Track 3m'),
        c(28, 'Sliding Gate Catcher Receiver'),
      ], { searchTerm: 'Sliding gate catcher receiver' });
      expect(picked!.productName).toContain('Catcher');
    });

    it('rejects a single priced incompatible candidate instead of blindly accepting it', () => {
      const picked = pickBestCandidate([
        c(36.67, 'Australian Handyman Supplies 50 x 50mm x 2.4m Galvanised Steel Fence Post'),
      ], { searchTerm: '100x50x2.0mm Galvanised RHS' });
      expect(picked).toBeNull();
    });

    it('does not match copper pipe to fittings or saddle clips', () => {
      const picked = pickBestCandidate([
        c(4.38, 'Brasshards 20mm 90 Degrees Copper Capillary Elbow'),
        c(35, '20mm Copper Pipe 3m Length'),
      ], { searchTerm: '20mm copper pipe B type' });
      expect(picked!.productName).toContain('Pipe');
    });

    it('does not match pipe lagging to saddle clips', () => {
      const picked = pickBestCandidate([
        c(11.02, 'Kinetic 15mm Galvanised BSP Pipe Saddle Clips - 10 Pack'),
        c(6, '15mm Foam Pipe Insulation Lagging 1m'),
      ], { searchTerm: '15mm pipe insulation lagging' });
      expect(picked!.productName).toContain('Insulation');
    });

    it('does not substitute shower diverters for non-return isolation valves', () => {
      const picked = pickBestCandidate([
        c(25.2, 'Kinetic 15mm Chrome Dual Valve Handspray Water Diverter'),
        c(18, '15mm Non Return Isolation Valve'),
      ], { searchTerm: '15mm non-return isolation duo valve' });
      expect(picked!.productName).toContain('Non Return');
    });

    it('does not match structural base plates to plumbing cover plates', () => {
      const picked = pickBestCandidate([
        c(2.32, 'Kinetic 20mm BSP Stainless Steel Cover Plate'),
      ], { searchTerm: '150x150x10 steel base plate' });
      expect(picked).toBeNull();
    });

    it('does not match plasterboard sheets to tape', () => {
      const picked = pickBestCandidate([
        c(12, 'Plasterboard Jointing Tape 75m'),
        c(18, '10mm Plasterboard Sheet 2400 x 1200mm'),
      ], { searchTerm: '10mm plasterboard sheets 2400x1200' });
      expect(picked!.productName).toContain('Sheet');
    });

    it('does not match Colorbond fence rails or sheets to posts', () => {
      expect(pickBestCandidate([
        c(30, 'Colorbond Fence Post Surfmist'),
        c(18, 'Colorbond Fence Rail 2.4m Surfmist'),
      ], { searchTerm: 'Colorbond fence rail 2.4m Surfmist' })!.productName).toContain('Rail');
      expect(pickBestCandidate([
        c(30, 'Colorbond Fence Post Surfmist'),
        c(38, 'Colorbond Fence Sheet 1.8m Surfmist'),
      ], { searchTerm: 'Colorbond fence sheet 1.8m Surfmist' })!.productName).toContain('Sheet');
    });

    it('rejects much-too-long nails for a shorter nail requirement', () => {
      const picked = pickBestCandidate([
        c(12, 'Galvanised Bullet Head Nails 100mm'),
        c(18, 'Galvanised Flat Head Nails 50mm'),
      ], { searchTerm: 'Galvanised flat head nails 50mm' });
      expect(picked!.productName).toContain('50mm');
    });
  });
});

describe('spec-mismatch gate — the QU-178270/178227/178239 audit failures', () => {
  it('refuses undersized framing pine for a 140x45 rafter request', () => {
    // The garage-roof failure: "dangerously undersized structural timber".
    expect(pickBestCandidate([
      c(15.9, '70 x 35mm Outdoor Framing H3 Treated Pine'),
      c(29.9, '100 x 100mm H4 Treated Pine Post'),
    ], { searchTerm: 'Rafters 140x45mm H2 Treated Pine' })).toBeNull();
  });

  it('refuses 70x35 for a 90x45 MGP10 request but accepts the right section', () => {
    const picked = pickBestCandidate([
      c(12.5, '70 x 35mm Outdoor Framing H3 Treated Pine'),
      c(19.8, '90 x 45mm MGP10 Untreated Framing Pine'),
    ], { searchTerm: '90x45mm H3 Treated Pine MGP10' });
    expect(picked!.productName).toContain('90 x 45');
  });

  it('treats a 45x90 SKU as the same cross-section as a 90x45 request', () => {
    const picked = pickBestCandidate([
      c(19.8, '45 x 90mm MGP10 Framing Pine'),
    ], { searchTerm: '90x45 framing pine stud' });
    expect(picked).not.toBeNull();
  });

  it('reads three-number dims as cross-section + length', () => {
    // "2400x100x100mm" request ↔ "100 x 100mm 2.4m" SKU: same 100x100 section.
    const picked = pickBestCandidate([
      c(41.5, '100 x 100mm 2.4m H4 Treated Hardwood Post'),
    ], { searchTerm: '2400x100x100mm CCA Treated Hardwood Post' });
    expect(picked).not.toBeNull();
    // "100x75x3000mm" request must NOT accept a 100x100 candidate.
    expect(pickBestCandidate([
      c(41.5, '100 x 100mm 3.6m H4 Treated Pine Sawn CCA'),
    ], { searchTerm: '100x75x3000mm H4 Treated Hardwood Fence Post' })).toBeNull();
  });

  it('refuses 2-core cable for a 4-core requirement', () => {
    expect(pickBestCandidate([
      c(89, 'Deta 20m 2.5mm² 2-Core + Earth Power Cable'),
    ], { searchTerm: '2.5mm² 4 Core + Earth TPS Cable' })).toBeNull();
  });

  it('refuses the cable itself when the request is for cable CLIPS', () => {
    expect(pickBestCandidate([
      c(45, 'Olex 20m 1.5mm² 2-Core + Earth Flat Power Cable'),
    ], { searchTerm: '1.5mm² Flat Cable Clips' })).toBeNull();
  });

  it('refuses a powerboard for a circuit identification label request', () => {
    expect(pickBestCandidate([
      c(32, 'Click 4 Outlet Individually Switched Surge Powerboard'),
    ], { searchTerm: 'Circuit Identification Label' })).toBeNull();
  });

  it('refuses a decking panel for a decking oil request', () => {
    expect(pickBestCandidate([
      c(120, 'Good Times Decking 1113 x 555mm Merbau Single Panel Modular Decking'),
    ], { searchTerm: 'Merbau Decking Oil' })).toBeNull();
  });

  it('still accepts a real decking oil', () => {
    const picked = pickBestCandidate([
      c(89, 'Intergrain UltraDeck Timber Oil 4L Merbau'),
    ], { searchTerm: 'Merbau Decking Oil' });
    expect(picked).not.toBeNull();
  });

  it('refuses BBQ charcoal for a fuel allowance row', () => {
    expect(pickBestCandidate([
      c(19.98, 'Jumbuck 7kg Lumpwood Charcoal BBQ Fuel'),
    ], { searchTerm: 'Fuel Allowance' })).toBeNull();
  });
});
