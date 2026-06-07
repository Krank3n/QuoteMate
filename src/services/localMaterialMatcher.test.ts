/**
 * Behavioural spec for the local supplier search.
 *
 * The matcher's job is small but high-leverage: turn a noisy AI-generated
 * searchTerm like "R2.5 HD insulation batts" into the right row from the
 * tradie's supplier book — without over-matching (a query for R2.5 batts
 * shouldn't match an R6.0 batt just because both say "Pink Batts").
 *
 * These tests pin down the behaviour at three levels:
 *   1. scoreMatch + looseMatch — the pure matcher.
 *   2. searchFavorites — how favourite rows are filtered, scored, and ranked.
 *   3. searchTemplates — template-level surfacing rules.
 */

import { describe, it, expect } from 'vitest';

import {
  scoreMatch,
  looseMatch,
  classifyTokens,
  searchFavorites,
  searchTemplates,
  LOCAL_MATCH_THRESHOLD,
} from './localMaterialMatcher';
import type {
  FavoriteProductMapping,
  SectionTemplate,
  SupplierGroup,
  Material,
} from '../types';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const fletcher: SupplierGroup = {
  id: 'fletcher',
  name: 'Fletcher Insulation',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const bunningsGroup: SupplierGroup = {
  id: 'bunnings-local',
  name: 'Bunnings',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const joesTimber: SupplierGroup = {
  id: 'joes-timber',
  name: "Joe's Timber Yard",
  sortOrder: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function fav(overrides: Partial<FavoriteProductMapping>): FavoriteProductMapping {
  return {
    productName: 'Product',
    store: 'Fletcher Insulation',
    price: 10,
    unit: 'each' as Material['unit'],
    isPersonalRate: true,
    ...overrides,
  };
}

// ─── 1. scoreMatch / looseMatch ─────────────────────────────────────────────

describe('scoreMatch — core behaviour', () => {
  it('scores an identical normalised string at 1.0', () => {
    expect(scoreMatch('Pink Batts R2.5', 'Pink Batts R2.5')).toBe(1.0);
  });

  it('returns 0 for empty query or empty target', () => {
    expect(scoreMatch('', 'Pink Batts')).toBe(0);
    expect(scoreMatch('Pink Batts', '')).toBe(0);
    expect(scoreMatch('', '')).toBe(0);
  });

  it('returns 0 when the query is only noise words', () => {
    expect(scoreMatch('install supply fit', 'Pink Batts R2.5 HD')).toBe(0);
  });

  it('short-circuits to a high score when the query is a clean substring of the target', () => {
    const s = scoreMatch('Pink Batts R2.5', 'Pink Batts R2.5 HD 1160x580x90 12PK');
    expect(s).toBeGreaterThanOrEqual(0.9);
  });
});

describe('scoreMatch — the regression case', () => {
  // The user's original failing case: AI emits "R2.5 HD insulation batts",
  // supplier book has "Pink Batts Wall R2.5 HD 1160x580x90 12PK". The strict
  // "every token must hit" rule rejected this 3/4 match. The new matcher
  // must accept it cleanly.
  it('matches "R2.5 HD insulation batts" against "Pink Batts Wall R2.5 HD 1160x580x90 12PK"', () => {
    const score = scoreMatch(
      'R2.5 HD insulation batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    );
    expect(score).toBeGreaterThanOrEqual(LOCAL_MATCH_THRESHOLD);
    expect(looseMatch(
      'R2.5 HD insulation batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    )).toBe(true);
  });

  it('matches against the Floor variant too — caller is expected to rank between them', () => {
    expect(looseMatch(
      'R2.5 HD insulation batts',
      'Pink Batt Floor R2.5 HD 1160x430x90 12PK',
    )).toBe(true);
  });
});

describe('scoreMatch — spec sensitivity', () => {
  it('rejects an R6.0 product when the user asked for R2.5', () => {
    expect(looseMatch(
      'R2.5 HD insulation batts',
      'Pink Batts Ceiling R6.0 HD 1160x430x230 6PK',
    )).toBe(false);
  });

  it('rejects an R3.1 product when the user asked for R2.5', () => {
    expect(looseMatch(
      'R2.5 wall batts',
      'Pink Soundbreak R3.1 1160x430x110 6PK',
    )).toBe(false);
  });

  it('accepts an R2.5 product despite extra spec tokens on the target', () => {
    expect(looseMatch(
      'R2.5 batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    )).toBe(true);
  });

  it('treats "90x45" and "90 x 45" as the same spec token', () => {
    expect(scoreMatch('treated pine 90x45', 'Treated Pine 90 x 45 H3 2.4m'))
      .toBeGreaterThanOrEqual(LOCAL_MATCH_THRESHOLD);
  });

  it('requires at least half of supplied spec tokens to hit', () => {
    // "90x45" and "h3" both supplied; target has neither → reject even if
    // the WORD tokens all line up.
    expect(looseMatch(
      'treated pine 90x45 H3 decking',
      'Untreated Pine Decking Board Generic',
    )).toBe(false);
  });
});

describe('scoreMatch — guard against spec-only matches', () => {
  // R2.5 alone is a spec — without a WORD hit we shouldn't return any
  // R2.5-containing SKU. Stops a stray "R2.5" in a job description from
  // matching every R2.5 batt in the book.
  it('returns 0 when only a spec token would hit (no word backup)', () => {
    expect(scoreMatch('R2.5', 'Pink Batts Wall R2.5 HD')).toBe(0);
  });

  it('still accepts "R2.5 batts" because batts is a real word hit', () => {
    expect(looseMatch('R2.5 batts', 'Pink Batts Wall R2.5 HD')).toBe(true);
  });
});

describe('scoreMatch — noise filtering', () => {
  it('does not let noise words drag the ratio down', () => {
    const withNoise = scoreMatch(
      'supply and install R2.5 HD insulation batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    );
    const withoutNoise = scoreMatch(
      'R2.5 HD insulation batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    );
    expect(withNoise).toBeCloseTo(withoutNoise, 5);
  });

  it('drops "thermal" and "premium" from scoring', () => {
    expect(looseMatch(
      'premium thermal R2.5 HD batts',
      'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
    )).toBe(true);
  });
});

describe('scoreMatch — synonyms', () => {
  it('treats "insulation" and "batts" as synonyms', () => {
    // The target has "batts" but not "insulation".
    expect(scoreMatch('insulation', 'Pink Batts Wall R2.5 HD'))
      .toBeGreaterThanOrEqual(LOCAL_MATCH_THRESHOLD);
  });

  it('treats "screws" and "fasteners" as synonyms', () => {
    expect(scoreMatch('50mm fasteners box', 'Bugle Head Screws 50mm Box 500'))
      .toBeGreaterThanOrEqual(LOCAL_MATCH_THRESHOLD);
  });

  it('treats "plasterboard" and "gyprock" as synonyms', () => {
    expect(looseMatch('plasterboard 10mm 1200x2400', 'Gyprock 10mm 1200x2400 Sheet'))
      .toBe(true);
  });

  it('does not over-synonymise — "concrete" should not match a screw row', () => {
    expect(looseMatch('concrete bag 20kg', 'Bugle Head Screws 50mm Box 500')).toBe(false);
  });
});

describe('scoreMatch — plural / singular', () => {
  it('matches singular query against plural target', () => {
    expect(looseMatch('decking board 90x19', 'Merbau Decking Boards 90x19 5.4m')).toBe(true);
  });

  it('matches plural query against singular target', () => {
    expect(looseMatch('treated pine posts', 'Treated Pine Post H4 90x90 2.4m')).toBe(true);
  });
});

describe('scoreMatch — punctuation tolerance', () => {
  it('ignores commas, parens, quotes', () => {
    expect(looseMatch(
      'R2.5, HD (insulation) batts',
      'Pink Batts Wall R2.5 HD',
    )).toBe(true);
  });

  it('tolerates dashes/underscores as separators', () => {
    expect(looseMatch('treated_pine-90x45 H3', 'Treated Pine 90x45 H3 2.4m')).toBe(true);
  });
});

describe('classifyTokens', () => {
  it('classifies R-values as spec', () => {
    const toks = classifyTokens('R2.5 HD batts');
    expect(toks.find((t) => t.raw === 'r2.5')?.kind).toBe('spec');
  });

  it('classifies dimensions as spec', () => {
    const toks = classifyTokens('Pine 90x45 H3 2.4m');
    expect(toks.find((t) => t.raw === '90x45')?.kind).toBe('spec');
    expect(toks.find((t) => t.raw === 'h3')?.kind).toBe('spec');
    expect(toks.find((t) => t.raw === '2.4m')?.kind).toBe('spec');
  });

  it('classifies noise verbs as noise', () => {
    const toks = classifyTokens('Supply and install insulation');
    expect(toks.find((t) => t.raw === 'supply')?.kind).toBe('noise');
    expect(toks.find((t) => t.raw === 'install')?.kind).toBe('noise');
    expect(toks.find((t) => t.raw === 'insulation')?.kind).toBe('word');
  });

  it('drops single-character fragments', () => {
    const toks = classifyTokens('A b CD ef');
    expect(toks.map((t) => t.raw)).not.toContain('a');
    expect(toks.map((t) => t.raw)).not.toContain('b');
    expect(toks.map((t) => t.raw)).toContain('cd');
  });
});

// ─── 2. searchFavorites ─────────────────────────────────────────────────────

describe('searchFavorites — filtering', () => {
  it('returns nothing when no favourites match', () => {
    const favs = [
      fav({ productName: 'Tile adhesive 20kg', store: 'Bunnings', isPersonalRate: false }),
    ];
    const out = searchFavorites('R2.5 batts', favs, [bunningsGroup]);
    expect(out).toEqual([]);
  });

  it('drops favourites with no SupplierGroup AND no isPersonalRate flag', () => {
    const favs = [
      fav({
        productName: 'Pink Batts Wall R2.5 HD',
        store: 'Some Random Store',
        isPersonalRate: false,
      }),
    ];
    // No matching supplier group, not flagged personal → filtered out.
    const out = searchFavorites('R2.5 batts', favs, []);
    expect(out).toEqual([]);
  });

  it('keeps favourites flagged isPersonalRate even when no SupplierGroup is registered', () => {
    // This is the safety-net path for older imports that wrote favourites
    // without registering a SupplierGroup.
    const favs = [
      fav({
        productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
        store: 'Fletcher Insulation',
        price: 72.86,
        isPersonalRate: true,
      }),
    ];
    const out = searchFavorites('R2.5 HD insulation batts', favs, []);
    expect(out).toHaveLength(1);
    expect(out[0].productName).toContain('Pink Batts Wall');
  });

  it('respects the SupplierGroup match for non-personal favourites', () => {
    const favs = [
      fav({
        productName: 'Pink Batts Wall R2.5 HD',
        store: 'Fletcher Insulation',
        isPersonalRate: false,
      }),
    ];
    expect(searchFavorites('R2.5 batts', favs, [fletcher])).toHaveLength(1);
    expect(searchFavorites('R2.5 batts', favs, [bunningsGroup])).toHaveLength(0);
  });

  it('skips favourites with no price', () => {
    const favs = [
      fav({ productName: 'Pink Batts Wall R2.5 HD', price: 0 }),
      fav({ productName: 'Pink Batts Wall R2.5 HD', price: undefined }),
    ];
    expect(searchFavorites('R2.5 batts', favs, [fletcher])).toEqual([]);
  });

  it('uses keywords as a search target', () => {
    const favs = [
      fav({
        productName: 'Wonderbatt 580x90',                 // name doesn't hint at insulation
        keywords: ['insulation', 'batts', 'thermal', 'r2.5'],
      }),
    ];
    const out = searchFavorites('R2.5 HD insulation batts', favs, [fletcher]);
    expect(out).toHaveLength(1);
  });

  it('uses notes as a search target', () => {
    const favs = [
      fav({
        productName: 'WB-580',
        notes: 'Wall insulation batts R2.5 HD',
      }),
    ];
    expect(searchFavorites('R2.5 insulation batts', favs, [fletcher])).toHaveLength(1);
  });
});

describe('searchFavorites — ranking', () => {
  it('ranks higher-scoring match above lower within the same supplier', () => {
    // Both are valid R2.5 HD batts at Fletcher; the wall variant matches a
    // wall-specific query more tightly than the floor variant.
    const wall = fav({
      productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
      price: 72.86,
    });
    const floor = fav({
      productName: 'Pink Batt Floor R2.5 HD 1160x430x90 12PK',
      price: 58.68,
    });
    const out = searchFavorites('R2.5 HD wall batts', [floor, wall], [fletcher]);
    expect(out).toHaveLength(2);
    expect(out.sort((a, b) => a._sortHint - b._sortHint)[0].productName)
      .toContain('Wall');
  });

  it('honours BusinessSettings.supplierPriority for cross-supplier ordering', () => {
    const fletcherFav = fav({
      productName: 'Pink Batts Wall R2.5 HD',
      store: 'Fletcher Insulation',
      price: 72.86,
    });
    const bunningsFav = fav({
      productName: 'Pink Batts Wall R2.5 HD',
      store: 'Bunnings',
      price: 80.00,
    });
    // Priority: Bunnings first, Fletcher second.
    const outA = searchFavorites(
      'R2.5 batts',
      [fletcherFav, bunningsFav],
      [fletcher, bunningsGroup],
      ['bunnings-local', 'fletcher'],
    ).sort((a, b) => a._sortHint - b._sortHint);
    expect(outA[0].store).toBe('Bunnings');

    // Priority: Fletcher first, Bunnings second.
    const outB = searchFavorites(
      'R2.5 batts',
      [fletcherFav, bunningsFav],
      [fletcher, bunningsGroup],
      ['fletcher', 'bunnings-local'],
    ).sort((a, b) => a._sortHint - b._sortHint);
    expect(outB[0].store).toBe('Fletcher Insulation');
  });

  it('breaks within-supplier ties by match score, not the original array order', () => {
    const great = fav({
      productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
      price: 72.86,
    });
    const okay = fav({
      productName: 'Acoustic R2.5 wall infill',
      price: 60,
    });
    // Putting the worse-match first should NOT win.
    const out = searchFavorites(
      'Pink Batts R2.5 HD insulation',
      [okay, great],
      [fletcher],
    ).sort((a, b) => a._sortHint - b._sortHint);
    expect(out[0].productName).toContain('Pink Batts Wall');
  });

  it('attaches the match score so callers can introspect', () => {
    const out = searchFavorites(
      'R2.5 HD insulation batts',
      [fav({ productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK' })],
      [fletcher],
    );
    expect(out[0]._matchScore).toBeGreaterThan(0);
    expect(out[0]._matchScore).toBeLessThanOrEqual(1);
  });
});

describe('searchFavorites — store-name fuzzy linking', () => {
  it('matches a supplier whose name is a substring of the favourite store tag', () => {
    // Bunnings web import tags favourites with "bunnings.com.au".
    const favs = [
      fav({
        productName: '70L Concrete Mix Bag',
        store: 'bunnings.com.au',
        isPersonalRate: false,
      }),
    ];
    const out = searchFavorites('concrete mix bag', favs, [bunningsGroup]);
    expect(out).toHaveLength(1);
  });
});

// ─── 3. searchTemplates ─────────────────────────────────────────────────────

function tpl(overrides: Partial<SectionTemplate>): SectionTemplate {
  return {
    id: 'tpl-1',
    name: 'Standard Fence Bay',
    keywords: ['fence', 'fence bay', 'colorbond fence'],
    materials: [
      { name: 'Treated Pine Post 90x90 H4', quantity: 1, unit: 'each', price: 35 },
      { name: 'Colorbond Sheet 2400x800', quantity: 1, unit: 'each', price: 78 },
    ],
    laborHours: 1.5,
    laborRate: 85,
    laborUnit: 'hours',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as SectionTemplate;
}

describe('searchTemplates', () => {
  it('surfaces all materials when the template name matches', () => {
    const out = searchTemplates('fence bay', [tpl({})]);
    expect(out.map((r) => r.productName)).toEqual([
      'Treated Pine Post 90x90 H4',
      'Colorbond Sheet 2400x800',
    ]);
  });

  it('surfaces only the material that matches when the template name does not', () => {
    const out = searchTemplates('treated pine post', [tpl({ keywords: [] })]);
    expect(out.map((r) => r.productName)).toEqual(['Treated Pine Post 90x90 H4']);
  });

  it('uses keywords for template-level matching', () => {
    const out = searchTemplates('colorbond fence', [tpl({})]);
    expect(out.length).toBeGreaterThan(0);
  });

  it('skips materials with no price', () => {
    const t = tpl({
      materials: [
        { name: 'Treated Pine Post 90x90 H4', quantity: 1, unit: 'each', price: 0 },
      ],
    });
    const out = searchTemplates('fence bay', [t]);
    expect(out).toEqual([]);
  });

  it('emits negative _sortHint so templates rank above favourites', () => {
    const out = searchTemplates('fence bay', [tpl({})]);
    expect(out[0]._sortHint).toBeLessThanOrEqual(0);
  });
});

// ─── 4. End-to-end ranking sanity ───────────────────────────────────────────

describe('end-to-end — local search rankings line up with tradie intuition', () => {
  it('picks the wall batt over the floor batt for a wall job', () => {
    const wall = fav({
      productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
      price: 72.86,
    });
    const floor = fav({
      productName: 'Pink Batt Floor R2.5 HD 1160x430x90 12PK',
      price: 58.68,
    });
    const out = searchFavorites('R2.5 HD wall batts', [floor, wall], [fletcher])
      .sort((a, b) => a._sortHint - b._sortHint);
    expect(out[0].productName).toContain('Wall');
  });

  it("picks 'treated' over 'untreated' when the query mentions treated", () => {
    const treated = fav({
      productName: 'Treated Pine 90x45 H3 2.4m',
      store: "Joe's Timber Yard",
      price: 12.40,
    });
    const untreated = fav({
      productName: 'Untreated Pine 90x45 2.4m',
      store: "Joe's Timber Yard",
      price: 9.80,
    });
    const out = searchFavorites(
      'treated pine 90x45 H3',
      [untreated, treated],
      [joesTimber],
    ).sort((a, b) => a._sortHint - b._sortHint);
    expect(out[0].productName).toContain('Treated Pine');
  });

  it('rejects close-but-wrong spec batts', () => {
    const r6 = fav({
      productName: 'Pink Batts Ceiling R6.0 HD 1160x430x230 6PK',
      price: 95,
    });
    const r25 = fav({
      productName: 'Pink Batts Wall R2.5 HD 1160x580x90 12PK',
      price: 72.86,
    });
    const out = searchFavorites('R2.5 HD insulation batts', [r6, r25], [fletcher]);
    expect(out).toHaveLength(1);
    expect(out[0].productName).toContain('R2.5');
  });
});
