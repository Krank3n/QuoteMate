/**
 * Phone numbers as they arrive from speech. The two padded numbers below are
 * real: "0475 287 599" was glued together from "04" + "two eight seven five"
 * + a garbage token, and "0477 535 423" from seven spoken digits (3 Sep 2026).
 */
import { describe, it, expect } from 'vitest';
import { normaliseAuPhone, phoneForRecord } from '../auPhone';

describe('normaliseAuPhone', () => {
  it('accepts a whole mobile however it was punctuated', () => {
    for (const said of ['0412345678', '0412 345 678', '04-1234-5678', '+61 412 345 678', '61412345678', '412 345 678']) {
      const p = normaliseAuPhone(said);
      expect(p.valid, said).toBe(true);
      expect(p.formatted).toBe('0412 345 678');
    }
  });

  it('accepts landlines and 1300 / 13 numbers', () => {
    expect(normaliseAuPhone('02 9876 5432')).toMatchObject({ valid: true, formatted: '02 9876 5432' });
    expect(normaliseAuPhone('1300 123 456')).toMatchObject({ valid: true, formatted: '1300 123 456' });
    expect(normaliseAuPhone('13 11 66')).toMatchObject({ valid: true });
  });

  it('turns spoken digit words into digits', () => {
    expect(normaliseAuPhone('oh four one two, three four five, six seven eight')).toMatchObject({ valid: true, formatted: '0412 345 678' });
  });

  it('rejects the chunks a number arrives in — nothing gets padded', () => {
    expect(normaliseAuPhone('04').valid).toBe(false);
    expect(normaliseAuPhone('two eight seven five').valid).toBe(false);
    expect(normaliseAuPhone('seven seven five three five four two').valid).toBe(false);
    expect(normaliseAuPhone('A47528759')).toMatchObject({ formatted: '47528759', valid: false });
  });

  it('never promotes nine chunked digits into a landline — only a mobile said without its zero gets one', () => {
    expect(normaliseAuPhone('287599123')).toMatchObject({ valid: false });
    expect(normaliseAuPhone('412 345 678')).toMatchObject({ valid: true, formatted: '0412 345 678' });
    expect(normaliseAuPhone('13 12 53')).toMatchObject({ valid: true, formatted: '13 12 53' });
  });

  it('rejects the wrong number of digits and non-AU prefixes', () => {
    expect(normaliseAuPhone('04268753564').valid).toBe(false); // 11 digits — the real over-long save
    expect(normaliseAuPhone('1412345678').valid).toBe(false);
    expect(normaliseAuPhone('').valid).toBe(false);
    expect(normaliseAuPhone(undefined).formatted).toBe('');
  });
});

describe('phoneForRecord', () => {
  it('stores a whole number formatted, and drops a partial one by name', () => {
    expect(phoneForRecord('0412345678')).toEqual({ phone: '0412 345 678' });
    expect(phoneForRecord('04 2875')).toEqual({ dropped: '04 2875' });
    expect(phoneForRecord('')).toEqual({});
    expect(phoneForRecord(undefined)).toEqual({});
  });
});
