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

export type TypicalRateUnit = 'hour' | 'm²' | 'm' | 'call-out' | 'room' | 'sheet';

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
  /** Lower-case words a tradie might use for it; the first match wins. */
  aliases: string[];
  rates: TypicalRate[];
  /** After-hours / weekend loading, when a source gives one. */
  afterHours?: string;
  /** "hipages cost guide (2025)" — named sources, shown with the figures. */
  sources: string[];
}

/** When the table was last checked against its sources. */
export const TYPICAL_RATES_AS_OF = '';

export const TYPICAL_RATES: TradeRates[] = [];

const CAVEAT =
  'Published typical ranges, not their price. Where they sit depends on their area, experience, licence and overheads — ask what they want to use, and save only the figure they pick.';

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The table entry for a trade as the tradie or the business names it. */
export function findTradeRates(trade: string): TradeRates | null {
  const said = normalise(trade);
  if (!said.trim()) return null;
  for (const entry of TYPICAL_RATES) {
    if (entry.aliases.some((alias) => said.includes(` ${alias} `) || said.includes(` ${alias}s `))) return entry;
  }
  return null;
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
