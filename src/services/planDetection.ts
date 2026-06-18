/**
 * Plan detection
 *
 * Cheap, best-effort guess at whether an image is an architectural plan/drawing
 * (vs an ordinary site photo) so the upload flow can pick a resolution WITHOUT
 * asking the user. A plan is mostly uniform near-white with thin dark lines, so
 * it has very low luminance variance and a high near-white fraction; a site
 * photo has high tonal variance. Thresholds tuned on real plans vs photos
 * (plan std ≈ 0.08, photos ≈ 0.30+).
 *
 * This only affects upload resolution — the gear generator's vision model
 * classifies plan-vs-photo itself at analysis time, so a wrong guess here is a
 * soft miss (slightly higher/lower res), never a correctness issue.
 *
 * Pixel sampling needs a canvas, which only exists on web. On native we can't
 * read pixels without a heavy decoder dep, so we return false and let the
 * explicit "Plan or drawing" capture option handle the rare case.
 */
import { Platform } from 'react-native';

// Luminance variance below this ⇒ mostly-uniform (plan-like). Photos sit well above.
const MAX_PLAN_STD = 0.15;
// At least this fraction of the image must be near-white (paper/background).
const MIN_NEAR_WHITE_FRAC = 0.5;
// A pixel counts as "near white" above this normalised luminance.
const NEAR_WHITE_LUMA = 0.88;

function loadImage(uri: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const img = new (globalThis as any).Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = uri;
  });
}

export async function detectIsPlan(uri: string): Promise<boolean> {
  // Web-only: needs a canvas to read pixels. Native falls back to false.
  if (Platform.OS !== 'web' || typeof (globalThis as any).document === 'undefined') {
    return false;
  }
  try {
    const img = await loadImage(uri);
    const w = 96;
    const h = Math.max(1, Math.round((img.height / img.width) * w)) || 96;
    const canvas = (globalThis as any).document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    let n = 0;
    let sum = 0;
    let sumSq = 0;
    let nearWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += luma;
      sumSq += luma * luma;
      if (luma > NEAR_WHITE_LUMA) nearWhite++;
      n++;
    }
    if (!n) return false;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    const nearWhiteFrac = nearWhite / n;
    return std < MAX_PLAN_STD && nearWhiteFrac > MIN_NEAR_WHITE_FRAC;
  } catch {
    return false;
  }
}
