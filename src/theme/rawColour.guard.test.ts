/**
 * A ratchet on hardcoded colours.
 *
 * This stopped being a tidiness concern the moment light mode shipped. In a
 * dark-only app `color: '#FFFFFF'` was harmless; in a two-theme app it is a
 * white-on-white bug waiting for someone to switch themes. One of exactly that
 * kind ("Welcome back" on the sign-in screen) shipped into the first light
 * build and was only caught by opening the app.
 *
 * The rule: colours come from tokens. Where a literal is genuinely correct,
 * the file needs an entry below WITH A REASON.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

/**
 * Files whose literals are legitimately not theme tokens.
 * Every entry is a claim that must stay true.
 */
const ALLOWED_FILES: Array<[string, string]> = [
  ['screens/settings/PDFTemplateScreen.tsx', 'mirrors the printed PDF palettes, which never follow app appearance'],
  ['constants/tradeCategories.ts', 'per-trade categorical accents — data, not theme'],
  ['components/PhotoAnnotator.tsx', 'the annotation pen palette the tradie draws with'],
  ['components/SupplierListCaptureModal.tsx', 'camera capture UI drawn over the live camera preview — white in both themes'],
  ['components/JobPhotos.tsx', 'controls over photo thumbnails'],
  ['components/JobPhotoStrip.tsx', 'lightbox controls over a full-screen photo'],
  ['components/LogoCropper.tsx', 'cropper chrome over the image being cropped'],
  ['components/MaterialItemCard.tsx', 'supplier brand marks (Reece blue, Bunnings green)'],
  ['components/ActionSheet.tsx', 'per-icon categorical tints, same role as tradeCategories'],
  ['screens/settings/FeedbackScreen.tsx', 'WhatsApp brand green — fixed by the brand, not by us'],
  ['screens/settings/ReferralScreen.tsx', 'QR codes must stay black-on-white to remain scannable'],
  ['screens/AuthScreen.tsx', 'Apple and Google sign-in buttons follow each provider brand guide'],
  ['services/notificationService.ts', 'Android notification LED colour, not a UI surface'],
  ['components/RevenueChart.tsx', 'a white highlight painted ON a coloured bar — lightens it in either theme'],
];

/**
 * Literal shapes that are correct in BOTH themes and so are exempt anywhere:
 *  - pure-black shadows (shadows are black in both themes)
 *  - black scrims behind modals and over photos
 *  - white content sitting over photos / camera preview
 */
const EXEMPT_VALUE = /^(#000{1,4}|#000000|rgba\(0,\s*0,\s*0,[^)]*\)|transparent)$/i;

function walk(dir: string, out: string[] = []): string[] {
  if (dir === resolve(__dirname)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  prop: string;
  value: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of walk(SRC)) {
    const rel = file.replace(SRC + '/', '');
    if (file.includes('/test/')) continue;
    if (ALLOWED_FILES.some(([f]) => rel === f)) continue;

    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(
          /(\w*[Cc]olor\w*)\s*[:=]\s*[{]?\s*['"](#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))['"]/g,
        )) {
          if (EXEMPT_VALUE.test(m[2])) continue;
          hits.push({ file: rel, line: i + 1, prop: m[1], value: m[2] });
        }

        // LinearGradient takes `colors={[...]}` — a plural array, which the
        // singular `color:` pattern above does not match. The dashboard's Mate
        // button hid a hardcoded dark slate here and rendered a dark gradient
        // in light mode until it was spotted on a device.
        const gradient = line.match(/colors=\{\[([^\]]*)\]/);
        if (gradient) {
          for (const g of gradient[1].matchAll(/['"](#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))['"]/g)) {
            if (EXEMPT_VALUE.test(g[1])) continue;
            hits.push({ file: rel, line: i + 1, prop: 'gradient colors', value: g[1] });
          }
        }
      });
  }
  return hits;
}

/**
 * Ratchet. Currently ZERO outside the allowlist — every colour in the app
 * comes from a token. Was ~363 before the theme migration. Never raise it.
 */
const BASELINE = 0;

describe('hardcoded colours', () => {
  const hits = scan();

  it(`stays at or below the ${BASELINE} known literals`, () => {
    const report = hits
      .map((h) => `  ${h.file}:${h.line}  ${h.prop}: ${h.value}`)
      .join('\n');
    expect(
      hits.length,
      `Hardcoded colours went UP to ${hits.length}. Use a theme token — a literal ` +
        `that looks right in dark will not be right in light:\n${report}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it('has no literal that is obviously an old-palette value', () => {
    // The pre-migration palette. Any of these surviving means a screen is still
    // painted from the retired eucalyptus/wattle scheme.
    const RETIRED = ['#009868', '#00C897', '#cfa153', '#0F172A', '#1E293B', '#064E3B'];
    const stale = hits.filter((h) =>
      RETIRED.some((r) => h.value.toLowerCase() === r.toLowerCase()),
    );
    expect(
      stale,
      `Retired palette values still in use:\n${stale
        .map((h) => `  ${h.file}:${h.line}  ${h.value}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // A file that no longer exists (or was renamed) would silently widen the
    // exemption, so assert each entry still resolves.
    for (const [file] of ALLOWED_FILES) {
      expect(() => statSync(join(SRC, file)), `allowlisted file missing: ${file}`).not.toThrow();
    }
  });
});
