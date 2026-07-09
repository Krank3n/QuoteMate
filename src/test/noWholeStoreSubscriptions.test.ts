/**
 * Guard: no whole-store Zustand subscriptions on the always-mounted render
 * path (App → Dashboard and the hooks Dashboard mounts).
 *
 * `const { … } = useStore()` / `useJobStore()` with no selector subscribes
 * the component to EVERY store write. On these files that meant the entire
 * app tree (or the dashboard) re-rendered on each Firestore listener echo —
 * which land right as the user navigates back, dropping frames mid
 * transition ("flicker / double-take on return to dashboard").
 *
 * Pushed screens may still use the bare form; this guard only pins the
 * files that are mounted for the app's whole lifetime.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

const ALWAYS_MOUNTED_FILES = [
  'App.tsx',
  'src/screens/DashboardScreen.tsx',
  'src/hooks/useJobActionsSheet.tsx',
];

// Matches `useStore()` / `useJobStore()` called with zero arguments —
// the selector-less form that subscribes to the whole store.
const BARE_HOOK_CALL = /\buse(?:Job)?Store\(\s*\)/;

describe('no whole-store subscriptions on the always-mounted render path', () => {
  for (const file of ALWAYS_MOUNTED_FILES) {
    it(`${file} only subscribes via selectors`, () => {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      const offending = source
        .split('\n')
        .map((line, i) => ({
          // Ignore comments — several of them explain this very rule.
          line: line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').trim(),
          number: i + 1,
        }))
        .filter(({ line }) => BARE_HOOK_CALL.test(line));

      expect(
        offending,
        `Bare useStore()/useJobStore() call re-renders on every store write. ` +
          `Use a selector (useStore((s) => s.field)) or useStore.getState() ` +
          `inside handlers/effects instead.\n` +
          offending.map((o) => `  line ${o.number}: ${o.line}`).join('\n'),
      ).toEqual([]);
    });
  }
});
