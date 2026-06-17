/**
 * Labour-rate presets.
 *
 * Pure computation: given a preset of "amount per N units" and a measured
 * area/length/each-count, return the labour dollars (2dp). UI layers can
 * still nudge the final figure on the preview screen \u2014 the snapshot on
 * Quote.labourPresetSnapshot preserves the original intent.
 */

import type { LabourRatePreset } from '../types';

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Compute the labour total in dollars for a given preset and measured
 * quantity.
 *
 *   total = preset.amount * (measured / preset.denominator)
 *
 * Examples:
 *   { amount: 1500, denominator: 100, unit: 'm\u00b2' } at 240 m\u00b2 \u2192 $3,600
 *   { amount: 2500, denominator: 100, unit: 'm\u00b2' } at  50 m\u00b2 \u2192 $1,250
 */
export function computeLabourFromPreset(
  preset: LabourRatePreset,
  measured: number,
): number {
  if (!preset) return 0;
  const amount = Number(preset.amount);
  const denom = Number(preset.denominator);
  const m = Number(measured);
  if (!Number.isFinite(amount) || !Number.isFinite(denom) || !Number.isFinite(m)) return 0;
  if (denom <= 0 || m <= 0) return 0;
  return round2(amount * (m / denom));
}

/**
 * Decision helper for LaborMarkupScreen's "auto-default to days" branch.
 *
 * The screen used to flip into days mode whenever the total labour hit 6h
 * or more, multiplying the displayed rate by 8 on the way in. That breaks
 * spectacularly when the stored `laborRate` isn't actually a per-hour rate
 * — the labour-rate preset apply path used to stash the entire computed
 * job total in `laborRate` with `laborHours: 1`, so the ×8 conversion
 * inflated the quote 8× (“QU-177892” / Lisa @ Mackay = $396,000 instead of
 * $49,500).
 *
 * We now skip the auto-convert when:
 *  - the quote already has a `labourPresetSnapshot` (the rate field is a
 *    lump-sum disguised as a rate; multiplying it makes no sense), OR
 *  - the rate looks implausibly high for a per-hour figure (> $500/hr).
 *    No Australian trade hourly rate is that high in 2026; if it is, the
 *    field has been repurposed and we shouldn't touch it.
 */
export function shouldAutoConvertHoursToDays(opts: {
  alreadyInDays: boolean;
  totalStored: number;
  rateForInput: number;
  hasLabourPresetSnapshot: boolean;
}): boolean {
  const { alreadyInDays, totalStored, rateForInput, hasLabourPresetSnapshot } = opts;
  if (alreadyInDays) return false;
  if (hasLabourPresetSnapshot) return false;
  if (rateForInput > 500) return false;
  return totalStored >= 6;
}

/**
 * Format a preset for chip/badge display.
 *   "$1,500 per 100 m\u00b2" \u2014 used on the LaborMarkupScreen chip row.
 */
export function formatPresetRate(preset: LabourRatePreset): string {
  const amount = Number(preset.amount) || 0;
  const denom = Number(preset.denominator) || 1;
  const amountStr = amount.toLocaleString(undefined, { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  return `${amountStr} per ${denom} ${preset.unit}`;
}
