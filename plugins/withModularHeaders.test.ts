/**
 * Tests for the withModularHeaders Podfile transform.
 *
 * Regression context: adding @react-native-google-signin (native GoogleSignIn
 * iOS SDK) broke `pod install` — its Swift dep `AppCheckCore` needs
 * `GoogleUtilities` and `RecaptchaInterop` to generate module maps. The plugin
 * injects `:modular_headers => true` for exactly those pods at prebuild.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS config plugin, no types
import { injectModularHeaders } from './withModularHeaders';

const PODFILE = `require File.join(...)
platform :ios, podfile_properties['ios.deploymentTarget']

target 'QuoteMate' do
  use_expo_modules!(exclude: ['expo-updates'])

  config = use_native_modules!(config_command)
end
`;

describe('injectModularHeaders', () => {
  it('injects modular_headers pods right after use_expo_modules! with matching indent', () => {
    const out = injectModularHeaders(PODFILE);
    expect(out).toContain(
      "  use_expo_modules!(exclude: ['expo-updates'])\n" +
        "  pod 'GoogleUtilities', :modular_headers => true\n" +
        "  pod 'RecaptchaInterop', :modular_headers => true"
    );
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = injectModularHeaders(PODFILE);
    expect(injectModularHeaders(once)).toBe(once);
  });

  it('only adds pods that are missing', () => {
    const withOne = PODFILE.replace(
      "use_expo_modules!(exclude: ['expo-updates'])",
      "use_expo_modules!(exclude: ['expo-updates'])\n  pod 'GoogleUtilities', :modular_headers => true"
    );
    const out = injectModularHeaders(withOne);
    expect(out.match(/pod 'GoogleUtilities'/g)).toHaveLength(1);
    expect(out.match(/pod 'RecaptchaInterop'/g)).toHaveLength(1);
  });

  it('supports a custom pod list', () => {
    const out = injectModularHeaders(PODFILE, ['FooKit']);
    expect(out).toContain("  pod 'FooKit', :modular_headers => true");
    expect(out).not.toContain('GoogleUtilities');
  });

  it('throws loudly if the Expo Podfile marker is gone (template drift guard)', () => {
    expect(() => injectModularHeaders('target "X" do\nend\n')).toThrow(/use_expo_modules!/);
  });
});
