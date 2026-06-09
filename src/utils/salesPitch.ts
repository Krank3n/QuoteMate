/**
 * Sales-pitch resolution and rendering.
 *
 * A SalesPitch is a reusable text block (Jesse's "owner-operator" pitch,
 * his "R-value upgrade" pitch, etc.) that lives on BusinessSettings.
 * Each pitch can declare named {{double_curly}} variables with optional
 * defaults and optional derived values (e.g. total_R = existing_R + added_R).
 *
 * Pure functions. PDF/email layers do HTML-escaping; this module returns
 * raw text so the same machinery can drive plain-text email bodies.
 */

import type { SalesPitch, SalesPitchVariable } from '../types';

/**
 * Resolve every variable on a pitch:
 *   1. Start from each variable's `defaultValue`.
 *   2. Apply overrides supplied by the caller.
 *   3. Evaluate `derive` expressions (currently just `add`) in input order
 *      so a derived value can read previously-resolved values.
 *
 * Returns a flat string map ready for `renderPitch`. Numbers are stringified
 * via `String()` so `2 + 4.1 = 6.1` stays `6.1` (no trailing zeros).
 */
export function resolvePitchVariables(
  pitch: SalesPitch,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const vars = pitch.variables || [];

  // Pass 1 — defaults + overrides for non-derived vars.
  for (const v of vars) {
    if (v.derive) continue;
    if (overrides[v.key] !== undefined && overrides[v.key] !== '') {
      resolved[v.key] = overrides[v.key];
    } else if (v.defaultValue !== undefined) {
      resolved[v.key] = v.defaultValue;
    } else {
      resolved[v.key] = '';
    }
  }

  // Pass 2 — derived. Honour caller overrides first (let a user pin a
  // total_R manually). Otherwise compute from previously-resolved values.
  for (const v of vars) {
    if (!v.derive) continue;
    if (overrides[v.key] !== undefined && overrides[v.key] !== '') {
      resolved[v.key] = overrides[v.key];
      continue;
    }
    resolved[v.key] = computeDerived(v, resolved);
  }

  return resolved;
}

function computeDerived(
  variable: SalesPitchVariable,
  resolved: Record<string, string>,
): string {
  const derive = variable.derive;
  if (!derive) return '';
  if (derive.op === 'add') {
    const sum = derive.from.reduce((acc, key) => {
      const raw = resolved[key];
      const n = parseFloat(raw || '0');
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    // Strip pointless trailing .0 (e.g. 6 not 6.0) but keep 6.1 intact.
    return formatNumber(sum);
  }
  // Unknown ops fall back to empty string. Lint surfaces typos as warnings.
  // eslint-disable-next-line no-console
  console.warn(`[salesPitch] unknown derive op "${(derive as any).op}"`);
  return '';
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  // Trim 6.10 → 6.1, 6.00 → 6, but keep 6.5 → 6.5.
  const s = (Math.round(n * 100) / 100).toString();
  return s;
}

/**
 * Substitute every {{key}} occurrence in `pitch.body` with the matching
 * resolved value. Unknown variables render as empty string (with a console
 * warning) so a typo in a template doesn't leak raw `{{foo}}` to a customer.
 */
export function renderPitch(
  pitch: SalesPitch,
  resolved: Record<string, string>,
): string {
  return pitch.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(resolved, key)) {
      return resolved[key];
    }
    // eslint-disable-next-line no-console
    console.warn(`[salesPitch] unresolved variable {{${key}}} in pitch "${pitch.name}"`);
    return '';
  });
}

/**
 * Convenience: resolve + render in one call.
 */
export function resolveAndRenderPitch(
  pitch: SalesPitch,
  overrides: Record<string, string> = {},
): string {
  const resolved = resolvePitchVariables(pitch, overrides);
  return renderPitch(pitch, resolved);
}
