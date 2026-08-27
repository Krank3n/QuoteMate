/**
 * Guards an import-order bug that only appears on a device.
 *
 * @elevenlabs/client is a browser library — it constructs DOMException, which
 * Hermes has no global for. @livekit/react-native ships the polyfill, and
 * ensureElevenLabsRuntime() is what pulls it in.
 *
 * ES modules evaluate every static import before any of the importing module's
 * own code runs. So a static `import { Conversation } from '@elevenlabs/client'`
 * initialises the client BEFORE ensureElevenLabsRuntime() can install the
 * polyfill, and voice dies at module load with:
 *
 *     Uncaught Error: Property 'DOMException' doesn't exist
 *
 * Neither the unit tests (which mock the module) nor a server-side simulation
 * can see this — it took a real simulator run. A source-level assertion is the
 * only thing standing between a tidy-up and shipping it again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../elevenLabsVoiceSession.ts'),
  'utf8',
);

describe('elevenLabsVoiceSession import order', () => {
  it('never imports @elevenlabs/client as a static VALUE import', () => {
    const staticValueImport = /^\s*import\s+(?!type\b)[^;]*from\s+['"]@elevenlabs\/client['"]/m;
    expect(
      staticValueImport.test(SOURCE),
      'Static value import of @elevenlabs/client — this loads the module before ' +
        'ensureElevenLabsRuntime() installs the DOMException polyfill, and voice ' +
        'dies at import time on device. Use `await import(...)` inside the function.',
    ).toBe(false);
  });

  it('may import it for types only, which is erased at compile time', () => {
    expect(/import\s+type\s+\{[^}]*\}\s+from\s+['"]@elevenlabs\/client['"]/.test(SOURCE)).toBe(true);
  });

  it('loads the client dynamically', () => {
    expect(/await\s+import\(\s*['"]@elevenlabs\/client['"]\s*\)/.test(SOURCE)).toBe(true);
  });

  it('installs the runtime shim BEFORE loading the client', () => {
    const shim = SOURCE.indexOf('await ensureElevenLabsRuntime()');
    const client = SOURCE.search(/await\s+import\(\s*['"]@elevenlabs\/client['"]\s*\)/);
    expect(shim).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(-1);
    expect(shim, 'the shim must run first — it is what provides DOMException')
      .toBeLessThan(client);
  });
});
