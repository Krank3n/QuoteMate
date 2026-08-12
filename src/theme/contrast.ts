/**
 * WCAG 2.1 relative-luminance and contrast maths.
 *
 * Lives in src/ rather than the test file because the palette was DERIVED from
 * these numbers — keeping them in the shipped module means a future retune can
 * be checked the same way it was designed, and theme.contrast.test.ts is then
 * the design intent expressed as an assertion rather than a separate
 * reimplementation that could drift.
 */

/** Accepts #rgb, #rrggbb, or rgba()/rgb() with an optional alpha. */
export function parseColor(input: string): { r: number; g: number; b: number; a: number } {
  const value = input.trim();

  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((p) => parseFloat(p.trim()));
    const [r, g, b, a = 1] = parts;
    return { r, g, b, a };
  }

  let hex = value.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length === 8) {
    // #rrggbbaa
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`Unparseable colour: ${input}`);
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: 1,
  };
}

/** Flatten a translucent colour onto an opaque background. */
export function flatten(fg: string, bg: string): string {
  const f = parseColor(fg);
  if (f.a >= 1) return fg;
  const b = parseColor(bg);
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`;
}

export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio, 1–21. Translucent foregrounds are composited over `bg`
 * first — comparing an rgba() value directly would silently overstate it.
 */
export function contrast(fg: string, bg: string): number {
  const solid = flatten(fg, bg);
  const l1 = luminance(solid);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG AA for normal-size text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (>=18.66px bold or >=24px regular). */
export const AA_LARGE = 3;
/** WCAG 1.4.11 for non-text UI components — a button's own shape. */
export const AA_NON_TEXT = 3;
/** Below this a card does not read as raised against its canvas. */
export const SURFACE_SEPARATION = 1.2;
