import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { parsePlayInstallsCsv, parseAppleSalesReport, makeAscJwt, brisbaneDateParts } from './storeFunnel';

describe('parsePlayInstallsCsv', () => {
  const csv = [
    'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Daily User Installs',
    '2026-07-12,com.quotemate.app,4,1,3',
    '2026-07-13,com.quotemate.app,6,0,5',
    '2026-07-13,com.other.app,9,0,9',
  ].join('\n');

  it('maps dates to daily user installs for the right package', () => {
    const m = parsePlayInstallsCsv(csv, 'com.quotemate.app');
    expect(m.get('2026-07-12')).toBe(3);
    expect(m.get('2026-07-13')).toBe(5);
    expect(m.size).toBe(2);
  });

  it('falls back to device installs when user installs column is missing', () => {
    const alt = ['Date,Package Name,Daily Device Installs', '2026-07-12,com.quotemate.app,7'].join('\n');
    expect(parsePlayInstallsCsv(alt, 'com.quotemate.app').get('2026-07-12')).toBe(7);
  });

  it('is empty on garbage', () => {
    expect(parsePlayInstallsCsv('nope', 'com.quotemate.app').size).toBe(0);
  });
});

describe('parseAppleSalesReport', () => {
  const tsv = [
    'Provider\tSKU\tTitle\tProduct Type Identifier\tUnits\tApple Identifier',
    'APPLE\tqm1\tQuoteMate\t1F\t2\t6754000046',
    'APPLE\tqm1\tQuoteMate\t7F\t11\t6754000046', // update — excluded
    'APPLE\tqm1\tQuoteMate\t1F\t1\t6754000046',
    'APPLE\tother\tOther\t1F\t9\t9999999999', // other app — excluded
  ].join('\n');

  it('sums first-time download units for the app only', () => {
    expect(parseAppleSalesReport(tsv, '6754000046')).toBe(3);
  });

  it('is zero on an empty/day-off report', () => {
    expect(parseAppleSalesReport('', '6754000046')).toBe(0);
  });
});

describe('makeAscJwt', () => {
  it('produces a verifiable ES256 JWT with Apple claims', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = makeAscJwt({ keyId: 'KEY123', issuerId: 'ISS456', privateKey: pem }, 1_800_000_000);

    const [h, p, s] = jwt.split('.');
    expect(s).toBeTruthy();
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(payload.iss).toBe('ISS456');
    expect(payload.aud).toBe('appstoreconnect-v1');
    expect(payload.exp - payload.iat).toBe(900);

    const ok = crypto.verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url')
    );
    expect(ok).toBe(true);
  });
});

describe('brisbaneDateParts', () => {
  it('renders the date as seen in Brisbane (+10, no DST)', () => {
    // 2026-07-14 20:00 UTC = 2026-07-15 06:00 Brisbane
    const d = new Date('2026-07-14T20:00:00Z');
    expect(brisbaneDateParts(d)).toEqual({ compact: '20260715', dashed: '2026-07-15', month: '202607' });
  });
});
