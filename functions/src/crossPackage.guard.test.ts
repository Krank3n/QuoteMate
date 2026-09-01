import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_PRICE_AUD, TRIAL_DAYS, TRIAL_MS } from './subscription.helpers';
import { ENDING_THRESHOLD_DAYS } from './lifecycleEmails.helpers';

/**
 * Cross-package mirror guards. TRIAL_DAYS and the charged prices are
 * duplicated across the functions/RN boundary (no shared module is possible),
 * so each side pins the agreed literal and drift fails CI on whichever side
 * moved.
 *
 * Mirrors: src/config/crossPackageMirrors.guard.test.ts (app side) — update
 * BOTH together, along with the live store/Stripe products for prices.
 */

describe('trial length mirror (src/utils/trialConfig.ts TRIAL_DAYS)', () => {
  it('is 14 days', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe('price mirror (app ACTUAL_PRICE_AUD + live store/Stripe products)', () => {
  it('charged prices are $49/mo, $328/yr AUD', () => {
    expect(SUB_PRICE_AUD).toEqual({ monthly: 49, yearly: 328 });
  });
});

describe('trial-ending threshold mirror (app src/utils/nextBestAction.ts NBA_ENDING_THRESHOLD_DAYS)', () => {
  it('is 3 days — the in-app continuity_choice state mirrors when trial_ending fires', () => {
    expect(ENDING_THRESHOLD_DAYS).toBe(3);
  });
});

describe('reconcile batch-size mirror (src/services/llmService.ts RECONCILE_MAX_ITEMS_PER_REQUEST)', () => {
  it('the handler cap is 50 and the client batches to match', () => {
    // The 400 this cap raises is caught and swallowed by the pricing pipeline,
    // so a mismatch does not surface as an error — it silently voids pack-size
    // correction, the over-buy clamp and the category gate on the largest,
    // highest-value quotes. Only this pair of guards makes drift visible.
    const handler = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    expect(handler).toContain('items.length > 50');
    const client = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'services', 'llmService.ts'),
      'utf8',
    );
    expect(client).toContain('RECONCILE_MAX_ITEMS_PER_REQUEST = 50');
  });
});

describe('estimated-price pack info (src/services/webSearchPricing.ts)', () => {
  const handler = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const client = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'services', 'webSearchPricing.ts'),
    'utf8',
  );

  it('asks the estimator what one purchase contains, on both sides', () => {
    // Drop this from the prompt and the pipeline goes back to multiplying a
    // purchase price by the job's requirement — $25,051 of invented money
    // across 16 lines in five real quotes.
    for (const src of [handler, client]) {
      expect(src).toContain('"packSize"');
      expect(src).toContain('"packUnit"');
    }
  });

  it('returns the pack info to the caller', () => {
    expect(handler).toMatch(/packSize:\s*Number\.isFinite/);
    expect(client).toMatch(/packSize:\s*positivePack/);
  });

  it('normalises ASCII m2 to canonical m² on both sides', () => {
    // The prompt asks for 'm2'; every guard downstream compares against 'm²'.
    // An unnormalised unit silently discards the pack size.
    for (const src of [handler, client]) {
      expect(src).toMatch(/m2:\s*'m²'/);
      expect(src).toMatch(/m3:\s*'m³'/);
    }
  });
});

describe('price estimator must not decline trade-supply goods', () => {
  const handler = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const client = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'services', 'webSearchPricing.ts'),
    'utf8',
  );
  const pipeline = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'services', 'materialsPipeline.ts'),
    'utf8',
  );

  it('tells the model to price trade-supply items rather than return null', () => {
    // The prompt was framed entirely around Bunnings and told to return null
    // when it could not estimate, so a 14kW ducted system returned null, fell
    // past the trade table, and landed on the nominal placeholder at $25 —
    // roughly $8,000 short on the headline line of the quote.
    for (const src of [handler, client]) {
      expect(src).toMatch(/TRADE SUPPLIER/i);
      expect(src).not.toMatch(/- If you cannot estimate, return \{ "price": null \}/);
    }
  });

  it('only allows null for genuinely unidentifiable materials', () => {
    for (const src of [handler, client]) {
      // Prompt text wraps, so tolerate a line break between the words.
      expect(src).toMatch(/too vague to\s+identify/i);
    }
  });

  it('tries a real estimate before falling back to the placeholder', () => {
    // Order matters: the placeholder is a fixed nominal price, so anything
    // that can produce a material-specific estimate must run ahead of it.
    const byName = pipeline.indexOf('searchMaterialPrice(m.name, hardwareStores)');
    const placeholder = pipeline.indexOf('applyLastResortGuess(m, gstInclusive)');
    expect(byName).toBeGreaterThan(-1);
    expect(placeholder).toBeGreaterThan(-1);
    expect(byName).toBeLessThan(placeholder);
  });
});
