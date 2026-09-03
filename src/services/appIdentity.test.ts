import { describe, expect, it } from 'vitest';
import { describeAppBuild } from './appIdentity';

describe('describeAppBuild', () => {
  it('reports the store version, native build and the OTA the app launched with', () => {
    const identity = describeAppBuild(
      {
        version: () => '1.56',
        build: () => '94',
        updates: () => ({
          updateId: '01a065b1-b8b6-763e-899d-46e1290e3265',
          runtimeVersion: '1.56',
          channel: 'production',
          createdAt: new Date('2026-09-03T05:20:00.000Z'),
          isEmbeddedLaunch: false,
        }),
      },
      'ios',
    );
    expect(identity).toEqual({
      version: '1.56',
      build: '94',
      platform: 'ios',
      updateId: '01a065b1-b8b6-763e-899d-46e1290e3265',
      runtimeVersion: '1.56',
      channel: 'production',
      updatedAt: '2026-09-03T05:20:00.000Z',
    });
  });

  it('shows no update on the embedded bundle, and nulls where a module is missing', () => {
    const embedded = describeAppBuild(
      {
        version: () => '1.56',
        build: () => '171',
        updates: () => ({ updateId: 'stale-id', runtimeVersion: '1.56', channel: 'production', isEmbeddedLaunch: true }),
      },
      'android',
    );
    expect(embedded.updateId).toBeNull();
    expect(embedded.updatedAt).toBeNull();
    expect(embedded.runtimeVersion).toBe('1.56');

    const web = describeAppBuild(
      {
        version: () => '1.56',
        build: () => {
          throw new Error('expo-application is native only');
        },
        updates: () => {
          throw new Error('no expo-updates on web');
        },
      },
      'web',
    );
    expect(web).toEqual({ version: '1.56', build: null, platform: 'web', updateId: null, runtimeVersion: null, channel: null, updatedAt: null });
  });
});
