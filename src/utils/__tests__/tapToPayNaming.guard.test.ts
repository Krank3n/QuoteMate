/**
 * Apple's product name may never be shortened.
 *
 * Developer Marketing Guidelines: "Don't shorten the name or include Apple —
 * always use the full 'Tap to Pay on iPhone' designation." Checklist
 * requirement 1.9 makes following those guidelines Required for any app on the
 * public App Store, and 5.4 governs the button copy specifically.
 *
 * This is easy to get wrong and invisible in review: "Set up Tap to Pay" reads
 * perfectly well in English and is a naming violation. An audit found twelve of
 * them across onboarding, the payment sheet and Square settings — several on
 * the exact screens Apple's flow recordings must show.
 *
 * Android is deliberately exempt. That contactless reader is Square's, not
 * Apple's; calling it "Tap to Pay on iPhone" would be the worse error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..');

/**
 * Lines where the bare phrase is correct. Each needs a reason, and the reason
 * has to be checkable in the file.
 */
const ALLOWED = [
  // The non-iOS half of a platform ternary — Square's reader, not Apple's.
  /platformOS === 'ios' \? 'Tap to Pay on iPhone' : 'Tap to Pay \/ Card Entry'/,
  // Android-only action specs, guarded by isIos / Platform.OS checks above them.
  /id: 'tapToPayDraft'/,
  /'Tap to pay or share the Square link'/,
  /: 'Tap to Pay',$/,
];

/**
 * Strips comments before scanning. A naive per-line check misses two shapes
 * that both occur here: JSX `{/* ... *\/}` blocks, and the continuation lines
 * of a multi-line comment, which carry no marker of their own.
 */
function withoutComments(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    let kept = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) { i = line.length; break; }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const block = line.indexOf('/*', i);
      const lineComment = line.indexOf('//', i);
      if (block !== -1 && (lineComment === -1 || block < lineComment)) {
        kept += line.slice(i, block);
        inBlock = true;
        i = block + 2;
        continue;
      }
      if (lineComment !== -1) {
        kept += line.slice(i, lineComment);
        i = line.length;
        continue;
      }
      kept += line.slice(i);
      i = line.length;
    }
    out.push(kept);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Apple's name is never shortened", () => {
  it("every user-facing 'Tap to Pay' is followed by 'on iPhone'", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      // Comments explain the rules; they are not shown to anyone.
      const lines = withoutComments(readFileSync(file, 'utf8'));
      lines.forEach((line, idx) => {
        const trimmed = line.trim();

        // Identifiers and import paths carry the phrase harmlessly.
        const cleaned = line
          .replace(/\b\w*[Tt]apToPay\w*\b/g, '')
          .replace(/TAP_TO_PAY\w*/g, '')
          .replace(/tap-to-pay-[a-z]+/g, '');

        const match = /[Tt]ap[- ]to[- ][Pp]ay/.exec(cleaned);
        if (!match) return;
        if (/^\s*on iPhone/.test(cleaned.slice(match.index + match[0].length))) return;
        if (ALLOWED.some((re) => re.test(trimmed))) return;

        offenders.push(
          `  ${file.replace(SRC, 'src')}:${idx + 1}  ${trimmed.slice(0, 90)}`,
        );
      });
    }

    expect(
      offenders,
      `Apple forbids shortening "Tap to Pay on iPhone" (Marketing Guidelines; ` +
        `checklist 1.9 / 5.4). Write the full name, or add an ALLOWED entry with ` +
        `a reason if the line is Android-only:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('never pairs the name with "Apple"', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      withoutComments(readFileSync(file, 'utf8'))
        .forEach((line, idx) => {
          if (/Apple\s+Tap to Pay/i.test(line)) {
            offenders.push(`  ${file.replace(SRC, 'src')}:${idx + 1}`);
          }
        });
    }
    expect(offenders, `"Apple Tap to Pay" is not the product name`).toEqual([]);
  });
});
