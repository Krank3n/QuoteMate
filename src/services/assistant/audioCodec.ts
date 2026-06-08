// Base64 <-> bytes helpers for the voice PCM path.
//
// The mic encodes captured PCM chunks to base64 before sending them over the
// Live socket; the player decodes base64 PCM chunks back to bytes (and
// re-encodes a built WAV for the native Audio.Sound queue). Both prefer the
// host atob/btoa and fall back to a manual codec for hosts that lack them
// (Hermes without a polyfill — web only in practice, but cheaper to keep the
// fallback than to crash).

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const g: any = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  const lookup: Record<string, number> = {};
  for (let i = 0; i < ALPHA.length; i += 1) lookup[ALPHA[i]] = i;
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let oi = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean[i]] ?? 0;
    const c1 = lookup[clean[i + 1]] ?? 0;
    const c2 = lookup[clean[i + 2]] ?? 0;
    const c3 = lookup[clean[i + 3]] ?? 0;
    out[oi++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < clean.length) out[oi++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < clean.length) out[oi++] = ((c2 & 3) << 6) | c3;
  }
  return out.subarray(0, oi);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = '';
    for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
    s += part;
  }
  const g: any = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(s);
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : 0;
    out += ALPHA[a >> 2];
    out += ALPHA[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < s.length ? ALPHA[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < s.length ? ALPHA[c & 63] : '=';
  }
  return out;
}
