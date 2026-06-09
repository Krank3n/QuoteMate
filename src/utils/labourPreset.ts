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
 * Format a preset for chip/badge display.
 *   "$1,500 per 100 m\u00b2" \u2014 used on the LaborMarkupScreen chip row.
 */
export function formatPresetRate(preset: LabourRatePreset): string {
  const amount = Number(preset.amount) || 0;
  const denom = Number(preset.denominator) || 1;
  const amountStr = amount.toLocaleString(undefined, { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  return `${amountStr} per ${denom} ${preset.unit}`;
}
