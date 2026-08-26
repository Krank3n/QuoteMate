/**
 * @livekit/react-native-webrtc merges a MediaProjectionService (Android screen
 * capture) and FOREGROUND_SERVICE into the app manifest. QuoteMate uses LiveKit
 * for audio only.
 *
 * The trap this pins: setting enableScreenShareService:false on the LiveKit
 * Expo plugin does NOT remove them — that flag only writes a runtime meta-data
 * key. Verified against a real merged manifest, where the service was still
 * present with the flag off. Removal has to happen at merge time.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  trimScreenShare,
  SCREEN_SHARE_SERVICE,
  SCREEN_SHARE_PERMISSION,
} = require('./withLiveKitManifestTrim');

const manifest = () => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': [
      { $: { 'android:name': 'android.permission.RECORD_AUDIO' } },
      { $: { 'android:name': 'android.permission.CAMERA' } },
    ],
    application: [
      {
        $: { 'android:name': '.MainApplication' },
        service: [{ $: { 'android:name': 'com.example.KeepMeService' } }],
      },
    ],
  },
});

const perms = (m: any) => m.manifest['uses-permission'];
const services = (m: any) => m.manifest.application[0].service;
const find = (list: any[], name: string) => list.find((e) => e.$['android:name'] === name);

describe('trimScreenShare', () => {
  it('declares the tools namespace, without which the merger ignores the marker', () => {
    const out = trimScreenShare(manifest());
    expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('marks FOREGROUND_SERVICE for removal at merge time', () => {
    const entry = find(perms(trimScreenShare(manifest())), SCREEN_SHARE_PERMISSION);
    expect(entry.$['tools:node']).toBe('remove');
  });

  it('marks the MediaProjectionService for removal at merge time', () => {
    const entry = find(services(trimScreenShare(manifest())), SCREEN_SHARE_SERVICE);
    expect(entry.$['tools:node']).toBe('remove');
  });

  it('leaves the permissions the app genuinely needs alone', () => {
    const out = perms(trimScreenShare(manifest()));
    expect(find(out, 'android.permission.RECORD_AUDIO').$['tools:node']).toBeUndefined();
    expect(find(out, 'android.permission.CAMERA').$['tools:node']).toBeUndefined();
  });

  it('leaves unrelated services alone', () => {
    const out = services(trimScreenShare(manifest()));
    expect(find(out, 'com.example.KeepMeService').$['tools:node']).toBeUndefined();
  });

  it('does not stack duplicates when a prebuild already added the entry', () => {
    const once = trimScreenShare(manifest());
    const twice = trimScreenShare(once);
    expect(perms(twice).filter((p: any) => p.$['android:name'] === SCREEN_SHARE_PERMISSION)).toHaveLength(1);
    expect(services(twice).filter((s: any) => s.$['android:name'] === SCREEN_SHARE_SERVICE)).toHaveLength(1);
  });

  it('copes with a manifest whose application declares no services', () => {
    const m = manifest();
    delete (m.manifest.application[0] as any).service;
    expect(() => trimScreenShare(m)).not.toThrow();
    expect(find(services(m), SCREEN_SHARE_SERVICE).$['tools:node']).toBe('remove');
  });
});
