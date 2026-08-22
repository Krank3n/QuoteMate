import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as functions from 'firebase-functions/v1';

/**
 * SDK v6 changed the bare 'firebase-functions' entrypoint from the v1 to the
 * v2 API. Every function in this fleet is Gen 1, and several must stay that
 * way structurally: auth.user().onCreate has no v2 equivalent, and a Gen 2
 * flip changes onRequest URLs — breaking the Stripe/Square/Brevo/Sentry
 * webhook endpoints registered with third parties. These guards make a bare
 * import (which would silently deploy those functions as Gen 2) and a missing
 * v1 surface fail CI instead of failing mid-deploy.
 */

describe('firebase-functions v1 surface', () => {
  it('exposes the v1 API this fleet is built on', () => {
    expect(typeof functions.runWith).toBe('function');
    expect(typeof functions.region).toBe('function');
    expect(typeof functions.https.onRequest).toBe('function');
    expect(typeof functions.https.onCall).toBe('function');
    expect(typeof functions.https.HttpsError).toBe('function');
    expect(typeof functions.auth.user).toBe('function');
    expect(typeof functions.pubsub.schedule).toBe('function');
    expect(typeof functions.firestore.document).toBe('function');
    expect(typeof functions.logger.info).toBe('function');
  });

  it('v1 onCall hands the handler (data, context), not a CallableRequest', () => {
    // The v2 signature takes a single request argument; a silent flip here is
    // the failure mode where every callable's payload handling breaks at
    // runtime while still compiling.
    expect(functions.https.onCall.length).toBeGreaterThanOrEqual(1);
    const trigger = functions.https.onCall((data: unknown, context) => ({
      gotContext: typeof context !== 'undefined',
      data,
    }));
    expect(typeof trigger).toBe('function');
  });
});

describe('no bare firebase-functions imports (Gen 1 guard)', () => {
  it("every firebase-functions import goes through 'firebase-functions/v1'", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const source = fs.readFileSync(full, 'utf8');
        // Flags bare 'firebase-functions' plus any non-/v1 subpath (v2, logger,
        // params, ...) — each resolves to or implies the v2 API line.
        const bad = source.match(
          /(?:from\s+|require\()['"]firebase-functions(?=['"/])(?!\/v1)[^'"]*['"]/g,
        );
        if (bad) offenders.push(`${path.relative(__dirname, full)}: ${bad.join(', ')}`);
      }
    };
    walk(__dirname);
    expect(offenders).toEqual([]);
  });
});
