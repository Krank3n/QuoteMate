/**
 * get_typical_rates — what tradies in a trade typically charge in Australia,
 * from published cost guides, for the tradie who asks Mate what to charge.
 *
 * The 23 Sep 2026 audit found five tradies in one week asking exactly that
 * ("I don't know what to charge, that's why I downloaded you", "What is the
 * standard amount for the industry", "I'm asking you to find the after hours
 * rate … so your useless"). Mate had no answer, so it refused — or passed the
 * app's pre-filled starting rate off as theirs.
 *
 * Every figure here is a published range with its source and date, never a
 * number worked out. A range is a starting point: Mate says it as one, asks
 * what they want to use, and only saves the figure the tradie picks. Trades
 * with no sourced figure are absent on purpose — found:false tells Mate to say
 * so and ask, which beats a guess on a customer's quote.
 */

export type TypicalRateUnit = 'hour' | 'm²' | 'm' | 'call-out' | 'room' | 'job';

export interface TypicalRate {
  /** What the range is for, as a tradie would say it ("hourly labour", "exposed aggregate, supply and lay"). */
  what: string;
  low: number;
  high: number;
  unit: TypicalRateUnit;
  /** The GST basis the source states, or 'unstated'. */
  gst: 'inc' | 'ex' | 'unstated';
}

export interface TradeRates {
  /** The trade as Mate says it back. */
  trade: string;
  /** Names for the trade itself ("sparky", "chippie"). Checked across every entry first. */
  aliases: string[];
  /** Words for its jobs ("downlights", "deck"). Only consulted when no trade name matched. */
  jobWords: string[];
  rates: TypicalRate[];
  /** After-hours / weekend loading, when a source gives one. */
  afterHours?: string;
  /** "hipages cost guide (2025)" — named sources, shown with the figures. */
  sources: string[];
}

/** When the table was last checked against its sources. */
export const TYPICAL_RATES_AS_OF = '2026-09-24';

// Consensus of the published ranges (rounded to $5), from pages fetched on
// 24 Sep 2026: hipages cost guides (/article, dated Jan–Sep 2026),
// service.com.au price guides (mostly updated Apr 2026) and ServiceSeeking
// 2026 price guides (platform averages — read as a point inside the range,
// never as a bound: its minimums of $10–$40 are not a real floor). None of the
// sources states a GST basis, so every figure is 'unstated'.
//
// Left out on purpose, because the sources disagree too far or there is only
// one: glaziers ($50–$260 an hour across three guides), labourers (no
// homeowner guide; only labour-hire agencies), and hourly rates for
// plasterers, fencers, flooring installers and pest control — those trades
// keep only the per-unit figures the guides do agree on. No guide publishes a
// labour-only per-m² concreting rate, so there isn't one here either.
const HIPAGES = 'hipages cost guide (2026)';
const SERVICE = 'service.com.au price guide (2026)';
const SEEKING = 'ServiceSeeking price guide (2026)';

export const TYPICAL_RATES: TradeRates[] = [
  {
    trade: 'electrician',
    aliases: ['electrician', 'electrical', 'sparky', 'sparkie', 'sparkies'],
    jobWords: ['lighting', 'downlight', 'downlights', 'power point', 'powerpoint', 'switchboard'],
    rates: [
      { what: 'hourly labour', low: 80, high: 120, unit: 'hour', gst: 'unstated' },
      { what: 'call-out / service fee', low: 80, high: 130, unit: 'call-out', gst: 'unstated' },
    ],
    afterHours: 'Emergency and after-hours work runs about $150–$300 an hour (service.com.au, Apr 2026).',
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'plumber',
    aliases: ['plumber', 'plumbing', 'plumbers', 'gasfitter', 'gas fitter'],
    jobWords: ['hot water', 'tap', 'toilet', 'drain'],
    rates: [
      { what: 'hourly labour', low: 100, high: 150, unit: 'hour', gst: 'unstated' },
      { what: 'call-out fee, business hours', low: 80, high: 250, unit: 'call-out', gst: 'unstated' },
    ],
    afterHours: 'After hours: a call-out of about $150–$300, then about $180–$350 an hour (hipages, Jul 2026).',
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'carpenter',
    aliases: ['carpenter', 'carpentry', 'chippie', 'chippy', 'joiner', 'joinery'],
    jobWords: ['deck', 'decking', 'pergola', 'framing', 'builder'],
    rates: [{ what: 'hourly labour', low: 75, high: 100, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'painter',
    aliases: ['painter', 'painting', 'painters', 'decorator'],
    jobWords: ['paint', 'repaint'],
    rates: [
      { what: 'hourly labour', low: 45, high: 65, unit: 'hour', gst: 'unstated' },
      { what: 'interior walls', low: 20, high: 45, unit: 'm²', gst: 'unstated' },
      { what: 'a standard bedroom', low: 300, high: 750, unit: 'room', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'tiler',
    aliases: ['tiler', 'tiling', 'tilers'],
    jobWords: ['tile', 'tiles', 'splashback'],
    rates: [
      { what: 'tiling labour', low: 50, high: 80, unit: 'm²', gst: 'unstated' },
      { what: 'hourly labour', low: 60, high: 85, unit: 'hour', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'concreter',
    aliases: ['concreter', 'concreting', 'concreters'],
    jobWords: ['concrete', 'slab', 'driveway', 'footpath'],
    rates: [
      { what: 'hourly labour', low: 70, high: 110, unit: 'hour', gst: 'unstated' },
      { what: 'plain slab, supply and lay', low: 85, high: 130, unit: 'm²', gst: 'unstated' },
      { what: 'exposed aggregate, supply and lay', low: 125, high: 160, unit: 'm²', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'plasterer',
    aliases: ['plasterer', 'plastering', 'gyprocker'],
    jobWords: ['plaster', 'gyprock', 'plasterboard', 'cornice'],
    rates: [
      { what: 'plasterboard, supply and install', low: 15, high: 20, unit: 'm²', gst: 'unstated' },
      { what: 'plasterboard, install only', low: 8, high: 16, unit: 'm²', gst: 'unstated' },
    ],
    sources: [HIPAGES, SEEKING],
  },
  {
    trade: 'landscaper',
    aliases: ['landscaper', 'landscaping', 'landscape'],
    jobWords: ['retaining', 'turf', 'paver', 'paving'],
    rates: [{ what: 'hourly labour', low: 55, high: 80, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'gardener',
    aliases: ['gardener', 'gardening'],
    jobWords: ['garden', 'lawn', 'mowing', 'yard', 'hedge'],
    rates: [{ what: 'hourly labour', low: 50, high: 70, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'handyman',
    aliases: ['handyman', 'handymen', 'handy man', 'property maintenance'],
    jobWords: ['maintenance', 'odd jobs'],
    rates: [
      { what: 'hourly labour', low: 60, high: 90, unit: 'hour', gst: 'unstated' },
      { what: 'call-out fee', low: 50, high: 150, unit: 'call-out', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'fencer',
    aliases: ['fencer', 'fencing'],
    jobWords: ['fence', 'fences'],
    rates: [
      { what: 'treated pine paling fence, supply and install', low: 75, high: 120, unit: 'm', gst: 'unstated' },
      { what: 'Colorbond fence, supply and install', low: 85, high: 120, unit: 'm', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'roofer',
    aliases: ['roofer', 'roofing'],
    jobWords: ['roof', 'guttering', 'gutters'],
    rates: [{ what: 'hourly labour', low: 60, high: 90, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES, SEEKING],
  },
  {
    trade: 'bricklayer',
    aliases: ['bricklayer', 'bricklaying', 'brickie', 'brickies', 'blocklayer'],
    jobWords: ['brick', 'bricks'],
    rates: [{ what: 'hourly labour', low: 55, high: 75, unit: 'hour', gst: 'unstated' }],
    sources: [SERVICE, SEEKING],
  },
  {
    trade: 'cleaner',
    aliases: ['cleaner', 'cleaning', 'cleaners'],
    jobWords: ['end of lease', 'bond clean'],
    rates: [{ what: 'hourly labour', low: 45, high: 60, unit: 'hour', gst: 'unstated' }],
    sources: [SERVICE, SEEKING],
  },
  {
    trade: 'air-conditioning technician',
    aliases: ['air conditioning', 'hvac', 'refrigeration', 'air conditioner'],
    jobWords: ['air con', 'aircon', 'split system'],
    rates: [{ what: 'hourly labour', low: 80, high: 115, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES, SEEKING],
  },
  {
    trade: 'floor sander',
    aliases: ['floor sanding', 'floor sander', 'flooring', 'floor polishing'],
    jobWords: ['timber floor', 'floorboards', 'floating floor', 'hybrid floor'],
    rates: [
      { what: 'sanding and finishing', low: 40, high: 75, unit: 'm²', gst: 'unstated' },
      { what: 'floating / hybrid floor installation, labour', low: 25, high: 40, unit: 'm²', gst: 'unstated' },
    ],
    sources: [HIPAGES, SERVICE, SEEKING],
  },
  {
    trade: 'pest controller',
    aliases: ['pest control', 'pest controller', 'exterminator'],
    jobWords: ['termite', 'termites', 'pests'],
    rates: [{ what: 'general treatment of a house', low: 130, high: 190, unit: 'job', gst: 'unstated' }],
    sources: [HIPAGES, SERVICE],
  },
  {
    trade: 'cabinet maker',
    aliases: ['cabinet maker', 'cabinetmaker', 'cabinet making', 'cabinetry'],
    jobWords: ['kitchen', 'cabinets', 'wardrobe', 'wardrobes'],
    rates: [{ what: 'hourly labour', low: 60, high: 100, unit: 'hour', gst: 'unstated' }],
    sources: [HIPAGES],
  },
];

const CAVEAT =
  'Published typical ranges, not their price. Where they sit depends on their area, experience, licence and overheads — ask what they want to use, and save only the figure they pick.';

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The table entry for a trade as the tradie or the business names it. */
export function findTradeRates(trade: string): TradeRates | null {
  const said = normalise(trade);
  if (!said.trim()) return null;
  // Where in the line a word first appears, or Infinity.
  const at = (word: string) => {
    const hits = [said.indexOf(` ${word} `), said.indexOf(` ${word}s `)].filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : Infinity;
  };
  const earliest = (field: 'aliases' | 'jobWords'): TradeRates | null => {
    let best: TradeRates | null = null;
    let bestAt = Infinity;
    for (const entry of TYPICAL_RATES) {
      const i = Math.min(...entry[field].map(at));
      if (i < bestAt) {
        best = entry;
        bestAt = i;
      }
    }
    return best;
  };
  // A trade name wins over a job word anywhere in the line ("a painter for the
  // deck" is a painter); within a tier, the word said first wins ("sand and
  // paint the deck" is painting, not carpentry).
  return earliest('aliases') ?? earliest('jobWords');
}

export function typicalRatesFor(trade: string): unknown {
  const entry = findTradeRates(trade);
  if (!entry) {
    return {
      found: false,
      trade,
      note:
        "No published range for that trade in the table. Say you haven't got a figure for it and ask what they charge — never make one up. Suggest their supplier or a local tradie in the same line of work as a sanity check.",
    };
  }
  return {
    found: true,
    trade: entry.trade,
    rates: entry.rates,
    ...(entry.afterHours ? { afterHours: entry.afterHours } : {}),
    sources: entry.sources,
    asOf: TYPICAL_RATES_AS_OF,
    caveat: CAVEAT,
  };
}
