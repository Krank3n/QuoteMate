/**
 * Australian phone numbers as they arrive from speech.
 *
 * A number said to voice Mate lands in chunks — "it's 04", "two eight seven
 * five", then a garbage token — and the model glues the pieces together and
 * pads what is missing: "0475 287 599" was minted from "04" + "2875" + an
 * unreadable token, and "0477 535 423" from seven spoken digits (3 Sep 2026).
 * A padded number reaches the customer record and every send after it.
 *
 * So the rule is structural: keep only the digits, and accept the result only
 * when it is a whole Australian number. Anything else is dropped and the model
 * is told to say so, rather than a made-up number being saved as fact.
 */

import { normalizeDigits } from './textMatch';

export interface AuPhone {
  /** True when what came through is a complete Australian mobile, landline or 13/1300/1800 number. */
  valid: boolean;
  /** "0412 345 678" / "02 9876 5432" when valid; the bare digits otherwise. */
  formatted: string;
}

const NATIONAL_MOBILE = /^04\d{8}$/;
const NATIONAL_LANDLINE = /^0[2378]\d{8}$/;
const SPECIAL = /^(?:1[38]00\d{6}|13\d{4})$/;

/**
 * Words a tradie says for digits. STT rendered "two eight seven five" and
 * "seven seven five three five four two" as words in the 3 Sep 2026
 * transcripts, and the model passed them through as said.
 */
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Digits out of whatever was said or typed. "+61 412 345 678" and
 * "61412345678" both become "0412345678"; "double four" is left to the model
 * (there is no safe way to expand it after the fact).
 */
export function normaliseAuPhone(input: unknown): AuPhone {
  const raw = typeof input === 'string' ? input : input == null ? '' : String(input);
  const words = raw
    .toLowerCase()
    .split(/[\s,.-]+/)
    .map((w) => (w in DIGIT_WORDS ? DIGIT_WORDS[w] : w))
    .join(' ');
  let digits = normalizeDigits(words);
  if (digits.startsWith('61') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9 && /^[2-9]/.test(digits)) digits = `0${digits}`; // "412 345 678" said without the leading zero
  const valid = NATIONAL_MOBILE.test(digits) || NATIONAL_LANDLINE.test(digits) || SPECIAL.test(digits);
  return { valid, formatted: valid ? formatAuPhone(digits) : digits };
}

function formatAuPhone(digits: string): string {
  if (NATIONAL_MOBILE.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (NATIONAL_LANDLINE.test(digits)) return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
  if (/^1[38]00/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return digits;
}

/**
 * The phone to store from a customer draft the model built: the formatted
 * number when it is whole, nothing when it isn't. `dropped` carries what was
 * thrown away so the tool response can name it.
 */
export function phoneForRecord(input: unknown): { phone?: string; dropped?: string } {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return {};
  const parsed = normaliseAuPhone(raw);
  if (parsed.valid) return { phone: parsed.formatted };
  return { dropped: raw };
}
