import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain JS config module, no types
import config from '../../app.config.js';

// u.expo.dev answers 400 without this header. EAS builds add it themselves;
// the local gradle Android release only gets it from here (3 Sep 2026).
describe('EAS Update channel header', () => {
  it('every update request names the production channel', () => {
    expect(config.expo.updates.requestHeaders['expo-channel-name']).toBe('production');
  });
});
