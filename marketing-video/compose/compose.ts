/**
 * [4] Compositor — stitches the final marketing video with ffmpeg.
 *
 * Talking-head + app cut-ins:  brand intro → [presenter intro] → app replay
 * (phone-framed) → [presenter reaction] → brand outro. Presenter clips are
 * optional — when absent (no Veo run yet) it produces a branded screen demo
 * from the app capture alone, so this stage is runnable on its own.
 *
 *   tsx compose/compose.ts <slug>
 *
 * Emits out/<slug>.mp4, out/<slug>.webm, out/<slug>-poster.jpg.
 * Env: LOGO_FILE, FONT_FILE, MUSIC_FILE (all optional).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');
const TMP = join(OUT, '_tmp');

const W = 1080;
const H = 1920;
const FPS = 30;
const BG = '0x0F172A'; // brand dark
const ACCENT = 'F97316'; // brand orange (drawtext fontcolor, no 0x)

const FONT_FILE =
  process.env.FONT_FILE ??
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'].find(existsSync) ??
  '';
const LOGO_FILE = process.env.LOGO_FILE ?? resolve(ROOT, '..', '..', 'QuoteMateAppWebsite', 'public', 'assets', 'logo.png');
const MUSIC_FILE = process.env.MUSIC_FILE ?? '';

function ff(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function hasAudio(file: string): boolean {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return r.status === 0 && r.stdout.toString().trim().length > 0;
}

const esc = (t: string) => t.replace(/:/g, '\\:').replace(/'/g, "’").replace(/,/g, '\\,');

/** Word-wrap to ~maxChars per line, honouring explicit newlines. */
function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > maxChars) {
        if (line) out.push(line.trim());
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) out.push(line.trim());
  }
  return out;
}

/** A solid brand card with optional centered title + logo, `secs` long. */
function makeCard(out: string, title: string, secs: number): void {
  const filters = [`[0:v]format=yuv420p[bg]`];
  let last = 'bg';
  if (existsSync(LOGO_FILE)) {
    filters.push(`[1:v]scale=320:-1[logo]`);
    filters.push(`[${last}][logo]overlay=(W-w)/2:H/2-280[bgl]`);
    last = 'bgl';
  }
  const lines = FONT_FILE && title ? wrapLines(title, 22) : [];
  const fontsize = 58;
  const lineHeight = 76;
  lines.forEach((ln, i) => {
    const y = `H/2+10+${i * lineHeight}`;
    filters.push(
      `[${last}]drawtext=fontfile='${FONT_FILE}':text='${esc(ln)}':fontcolor=white:fontsize=${fontsize}:` +
        `x=(w-text_w)/2:y=${y}[t${i}]`,
    );
    last = `t${i}`;
  });
  filters.push(`[${last}]null[outv]`);
  const inputs = ['-f', 'lavfi', '-t', String(secs), '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}`];
  if (existsSync(LOGO_FILE)) inputs.push('-i', LOGO_FILE);
  ff([
    ...inputs,
    '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', filters.join(';'),
    '-map', '[outv]', '-map', `${existsSync(LOGO_FILE) ? 2 : 1}:a`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-shortest', out,
  ]);
}

/** Normalize any clip to the canvas: fit on the brand bg, 30fps, with audio. */
function normalize(input: string, out: string): void {
  const audio = hasAudio(input);
  const vf = `scale=${W - 80}:${H - 160}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1,fps=${FPS},format=yuv420p`;
  if (audio) {
    ff(['-i', input, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', out]);
  } else {
    ff([
      '-i', input,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      '-map', '0:v', '-map', '1:a', out,
    ]);
  }
}

function main(): void {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('usage: compose.ts <slug>');
  const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios', `${slug}.json`), 'utf8'));

  const app = join(OUT, `${slug}.app.mp4`);
  if (!existsSync(app)) throw new Error(`missing ${app} — run capture first`);

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const segments: string[] = [];
  const push = (file: string, label: string) => {
    const norm = join(TMP, `${label}.mp4`);
    normalize(file, norm);
    segments.push(norm);
  };

  // brand intro
  const intro = join(TMP, 'intro.mp4');
  makeCard(intro, scenario.title ?? 'QuoteMate', 1.6);
  segments.push(intro);

  // talking-head + app cut-ins (presenter clips optional)
  const presenterIntro = join(OUT, `${slug}.intro.mp4`);
  if (existsSync(presenterIntro)) push(presenterIntro, 'p-intro');
  push(app, 'app');
  const presenterReaction = join(OUT, `${slug}.reaction.mp4`);
  if (existsSync(presenterReaction)) push(presenterReaction, 'p-reaction');

  // brand outro
  const outro = join(TMP, 'outro.mp4');
  makeCard(outro, 'Real quotes. Real prices.\nQuoteMate', 2.2);
  segments.push(outro);

  // concat
  const listFile = join(TMP, 'list.txt');
  writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
  const finalMp4 = join(OUT, `${slug}.mp4`);

  if (MUSIC_FILE && existsSync(MUSIC_FILE)) {
    const concatV = join(TMP, 'concat.mp4');
    ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatV]);
    ff([
      '-i', concatV, '-stream_loop', '-1', '-i', MUSIC_FILE,
      '-filter_complex', '[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first[a]',
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', finalMp4,
    ]);
  } else {
    ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', finalMp4]);
  }

  // web variants
  ff(['-i', finalMp4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-c:a', 'libopus', join(OUT, `${slug}.webm`)]);
  ff(['-ss', '1.6', '-i', finalMp4, '-frames:v', '1', '-q:v', '3', join(OUT, `${slug}-poster.jpg`)]);

  rmSync(TMP, { recursive: true, force: true });
  console.log(`\n  → out/${slug}.mp4`);
  console.log(`  → out/${slug}.webm`);
  console.log(`  → out/${slug}-poster.jpg\n`);
}

main();
