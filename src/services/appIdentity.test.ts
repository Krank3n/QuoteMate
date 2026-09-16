import { describe, expect, it } from 'vitest';
import { describeAppBuild, describeUpdateLine } from './appIdentity';

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

describe('describeUpdateLine', () => {
  const base = { version: '1.57', build: '173', platform: 'android', runtimeVersion: '1.57', channel: 'production' };

  it('names the running update and when it was published, in local time', () => {
    const local = new Date(2026, 8, 16, 11, 55); // 16 Sep 2026 11:55 in the test machine's zone
    const line = describeUpdateLine({ ...base, updateId: '01a0a7ed-6125-7d29-8d81-d16a35964543', updatedAt: local.toISOString() });
    expect(line).toBe('Update 01a0a7ed, published 16 Sep 2026, 11:55 am');
  });

  it('says so plainly when the phone is still on the code it was installed with', () => {
    expect(describeUpdateLine({ ...base, updateId: null, updatedAt: null })).toBe(
      'Running the installed code, no update applied yet',
    );
  });

  it('copes with an update whose publish time is missing or unparseable', () => {
    expect(describeUpdateLine({ ...base, updateId: 'abcdef12-rest', updatedAt: null })).toBe('Update abcdef12');
    expect(describeUpdateLine({ ...base, updateId: 'abcdef12-rest', updatedAt: 'not a date' })).toBe('Update abcdef12');
  });

  it('shows nothing on web, which has no updates', () => {
    expect(describeUpdateLine({ ...base, platform: 'web', build: null, updateId: null, updatedAt: null })).toBeNull();
  });
});
