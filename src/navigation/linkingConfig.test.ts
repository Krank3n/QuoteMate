import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPathFromState, getStateFromPath } from '@react-navigation/core';
import { LINKING_CONFIG, LINKING_SCREENS } from './linkingConfig';

const config = { screens: { ...LINKING_SCREENS } };
const repoRoot = resolve(__dirname, '../..');

describe('referral deep link (/ref/:code)', () => {
  it('routes a scanned referral URL to the Referral screen with the code', () => {
    const state = getStateFromPath('ref/QM-AB2CD3', config);
    expect(state?.routes?.[0]).toMatchObject({
      name: 'Referral',
      params: { code: 'QM-AB2CD3' },
    });
  });

  it('still routes with a trailing slash (QR readers add one)', () => {
    const state = getStateFromPath('ref/QM-AB2CD3/', config);
    expect(state?.routes?.[0]).toMatchObject({ name: 'Referral', params: { code: 'QM-AB2CD3' } });
  });

  it('does NOT serialise to /ref/undefined when opened without a code', () => {
    // Regression: with a required `:code`, opening Referral from Settings
    // produced the literal path '/ref/undefined', which 404s on a web refresh.
    const path = getPathFromState({ routes: [{ name: 'Referral' }] } as never, config);
    expect(path).not.toContain('undefined');
    expect(path).toBe('/ref');
  });

  it('round-trips a code through path serialisation', () => {
    const path = getPathFromState(
      { routes: [{ name: 'Referral', params: { code: 'QM-AB2CD3' } }] } as never,
      config
    );
    expect(path).toBe('/ref/QM-AB2CD3');
    expect(getStateFromPath(path, config)?.routes?.[0]).toMatchObject({
      params: { code: 'QM-AB2CD3' },
    });
  });

  it('keeps the existing supplier /join link working', () => {
    expect(getStateFromPath('join?supplier=abc', config)?.routes?.[0]).toMatchObject({
      name: 'DiscoverSuppliers',
    });
  });
});

describe('native path allow-lists cover every linked route', () => {
  it('iOS apple-app-site-association includes /ref/*', () => {
    const aasa = JSON.parse(
      readFileSync(resolve(repoRoot, 'public/.well-known/apple-app-site-association'), 'utf8')
    );
    const paths: string[] = aasa.applinks.details[0].paths;
    // Without this entry iOS never hands the URL to the app, so a scanned
    // referral QR silently dead-ends on the marketing site.
    expect(paths).toContain('/ref/*');
    expect(paths).toContain('/join');
  });

  it('Android intent filter includes the /ref path prefix', () => {
    const source = readFileSync(resolve(repoRoot, 'app.config.js'), 'utf8');
    expect(source).toContain('pathPrefix: "/ref"');
    expect(source).toContain('pathPrefix: "/join"');
  });
});

describe('cold open on a deep link keeps the home screen beneath it', () => {
  // Without initialRouteName the state is just [Referral]; on Android the
  // first back press then has nothing to pop to and exits the app.
  const names = (path: string) =>
    getStateFromPath(path, LINKING_CONFIG as never)?.routes.map((r) => r.name);

  it('seeds Main under a referral link so back goes to the Dashboard', () => {
    expect(names('ref/QM-AB2CD3')).toEqual(['Main', 'Referral']);
  });

  it('seeds Main under the supplier /join link', () => {
    expect(names('join?supplier=abc')).toEqual(['Main', 'DiscoverSuppliers']);
  });

  it('still carries the referral code on the linked screen', () => {
    const state = getStateFromPath('ref/QM-AB2CD3', LINKING_CONFIG as never);
    expect(state?.routes[1]).toMatchObject({ name: 'Referral', params: { code: 'QM-AB2CD3' } });
  });
});
