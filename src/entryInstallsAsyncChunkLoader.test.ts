import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the 13 Sep 2026 web voice outage: the prod web bundle
 * contained Metro's asyncRequire lookup for `global.__loadBundleAsync` but
 * nothing ever defined it, so every `await import(...)` on web threw
 * `Requiring unknown module "3098"` (the OpenAI voice session chunk).
 * `@expo/metro-runtime` is what installs the loader; a custom entry has to
 * import it, and it has to come before any module that can lazy-load.
 */
describe('app entry', () => {
  const root = join(__dirname, '..');
  const entry = readFileSync(join(root, 'index.js'), 'utf8');
  const codeLines = entry
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));

  it('installs the async chunk loader via @expo/metro-runtime', () => {
    expect(codeLines).toContain("import '@expo/metro-runtime';");
  });

  it('installs it before the app or any polyfill is imported', () => {
    const loaderAt = codeLines.findIndex((l) => l === "import '@expo/metro-runtime';");
    const firstOtherImport = codeLines.findIndex(
      (l) => l.startsWith('import') && !l.includes('@expo/metro-runtime'),
    );
    expect(loaderAt).toBeGreaterThanOrEqual(0);
    expect(loaderAt).toBeLessThan(firstOtherImport);
  });

  it('the runtime it imports actually defines the loader global', () => {
    const rt = readFileSync(
      join(root, 'node_modules', '@expo', 'metro-runtime', 'src', 'async-require', 'index.ts'),
      'utf8',
    );
    expect(rt).toMatch(/__loadBundleAsync`\]\s*=\s*buildAsyncRequire\(\)/);
  });
});
