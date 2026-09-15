/**
 * Every stack navigator draws its own back chevron.
 *
 * @react-navigation/stack's default back control is a PNG bundled in
 * @react-navigation/elements, and on iPad that image never renders: the Job
 * screen had an invisible back button and the NewQuote stack showed the bare
 * word "Main". The fix is per-navigator (`headerBackImage` in screenOptions),
 * so a stack added later without it would quietly reintroduce the bug on
 * iPad only. This reads RootNavigator.tsx and checks every
 * `createStackNavigator` instance's `<X.Navigator screenOptions={{ ... }}>`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'RootNavigator.tsx'), 'utf8');

/** Variable names bound to createStackNavigator(): `const RootStack = createStackNavigator`. */
function stackNavigatorNames(text: string): string[] {
  return [...text.matchAll(/const\s+(\w+)\s*=\s*createStackNavigator\b/g)].map((m) => m[1]);
}

/**
 * The text of the balanced `{{ ... }}` given to `screenOptions` on each
 * `<Name.Navigator` element, with the line the element starts on.
 */
function screenOptionsBlocks(text: string, name: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  const open = new RegExp(`<${name}\\.Navigator\\b`, 'g');
  for (const m of text.matchAll(open)) {
    const start = m.index!;
    const line = text.slice(0, start).split('\n').length;
    const optIdx = text.indexOf('screenOptions={', start);
    const tagEnd = text.indexOf('>', start);
    expect(optIdx, `<${name}.Navigator> at line ${line} has no screenOptions`).toBeGreaterThan(-1);
    expect(optIdx, `<${name}.Navigator> at line ${line}: screenOptions is on a later element`).toBeLessThan(tagEnd);
    // Walk the braces from `screenOptions={` to the matching close.
    let depth = 0;
    let i = optIdx + 'screenOptions='.length;
    const bodyStart = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ line, body: text.slice(bodyStart, i + 1) });
  }
  return out;
}

describe('RootNavigator stack headers draw their own back chevron', () => {
  const names = stackNavigatorNames(source);
  const blocks = names.flatMap((name) =>
    screenOptionsBlocks(source, name).map((b) => ({ name, ...b })),
  );

  it('finds the stack navigators (RootStack, and NewQuoteStack used for both quote and invoice flows)', () => {
    expect(names).toEqual(expect.arrayContaining(['RootStack', 'NewQuoteStack']));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it('imports the shared chevron renderer once', () => {
    expect(source).toMatch(/import\s*\{\s*renderHeaderBackChevron\s*\}\s*from\s*'\.\/HeaderBackChevron'/);
  });

  for (const block of blocks) {
    const where = `<${block.name}.Navigator> at line ${block.line}`;

    it(`${where} sets headerBackImage to the app-drawn chevron`, () => {
      expect(block.body, `${where}: screenOptions lacks headerBackImage`).toMatch(
        /\bheaderBackImage:\s*renderHeaderBackChevron\b/,
      );
    });

    it(`${where} hides the back label ("Main" means nothing to a tradie)`, () => {
      expect(block.body).toMatch(/\bheaderBackButtonDisplayMode:\s*'minimal'/);
    });
  }
});
