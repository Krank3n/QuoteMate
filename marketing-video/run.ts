/**
 * Orchestrator — runs the pipeline for one or more scenarios.
 *
 *   tsx run.ts <slug> [<slug> ...]      one or more scenarios
 *   tsx run.ts --all                    every slug in manifest.json
 *
 * Flags:
 *   --mode local|backend   quote driver mode (default local)
 *   --skip-presenter       skip the Veo step (no FIREBASE_ID_TOKEN / Veo access)
 *   --publish              copy finished media into the website + print the
 *                          TRADES_WITH_VIDEOS edit needed
 *
 * Stages per slug: quote → capture → presenter (unless skipped) → compose.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const OUT = join(ROOT, 'out');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const WEBSITE_TRADES = resolve(ROOT, '..', '..', 'QuoteMateAppWebsite', 'public', 'assets', 'videos', 'trades');

function step(script: string, args: string[]): void {
  console.log(`\n▶ ${script} ${args.join(' ')}`);
  const r = spawnSync(TSX, [join(ROOT, script), ...args], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) throw new Error(`${script} failed (exit ${r.status})`);
}

function publish(slug: string): void {
  mkdirSync(WEBSITE_TRADES, { recursive: true });
  const moves: Array<[string, string]> = [
    [`${slug}.mp4`, `${slug}.mp4`],
    [`${slug}.webm`, `${slug}.webm`],
    [`${slug}-poster.jpg`, `${slug}-poster.jpg`],
  ];
  for (const [from, to] of moves) {
    const src = join(OUT, from);
    if (!existsSync(src)) throw new Error(`cannot publish — missing ${src}`);
    copyFileSync(src, join(WEBSITE_TRADES, to));
    console.log(`  ✓ ${to} → ${WEBSITE_TRADES}`);
  }
  console.log(
    `\n  Last step: add '${slug}' to TRADES_WITH_VIDEOS in\n` +
      `  QuoteMateAppWebsite/app/[tradeSlug]/page.tsx  (after you've reviewed the video).`,
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'local';
  const skipPresenter = argv.includes('--skip-presenter');
  const doPublish = argv.includes('--publish');

  let slugs = argv.filter((a) => !a.startsWith('--') && a !== mode);
  if (argv.includes('--all')) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    slugs = manifest.slugs;
  }
  if (slugs.length === 0) throw new Error('usage: run.ts <slug> [...] | --all');

  const skipVoiceover = argv.includes('--skip-voiceover');

  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);
    step('driver/generateQuote.ts', [slug, '--mode', mode]);
    if (!skipVoiceover) {
      try {
        step('voiceover/generateVoiceover.ts', [slug]); // Aussie Mate voice — before capture
      } catch (e) {
        console.warn(`  ⚠ voiceover step failed (${(e as Error).message}); chat will be silent.`);
      }
    }
    step('capture/record.ts', [slug]);
    if (!skipPresenter) {
      try {
        step('presenter/generatePresenter.ts', [slug]);
      } catch (e) {
        console.warn(`  ⚠ presenter step failed (${(e as Error).message}); composing without presenter clips.`);
      }
    }
    step('compose/compose.ts', [slug]);
    if (doPublish) publish(slug);
  }
  console.log('\n✓ done');
}

main();
