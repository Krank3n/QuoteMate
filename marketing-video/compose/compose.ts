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
// Web delivery size — the site serves 540x960 (matches homepage walkthrough.mp4
// + the existing trade videos). The pipeline builds at 1080x1920 then the final
// is downscaled to this for publishing.
const WEB_W = 540;
const WEB_H = 960;
// Trim the empty "booting" lead-in (blank chat) off the front of the app
// capture so the chat content starts promptly after the presenter clip.
const APP_HEAD_TRIM = Number(process.env.APP_HEAD_TRIM ?? 1.2);
// The logo PNG is exported on its own #1E293C backing square; matching the
// canvas to it lets the badge sit flush with no visible box around it.
const BG = '0x1E293C'; // brand surface (= logo backing)
const ACCENT = '0xF97316'; // brand orange — accent rule under the logo

const FONT_FILE =
  process.env.FONT_FILE ??
  [
    '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf', // strong, industrial — pairs with the gear/wrench mark
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
  ].find(existsSync) ??
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

function probeDur(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(r.stdout.toString().trim()) || 0;
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

/**
 * A solid brand card: centered logo, a short orange accent rule, and a centered
 * title below it, `secs` long. The canvas matches the logo's backing colour so
 * the badge sits flush (no visible square).
 */
function makeCard(out: string, title: string, secs: number, spin: 'in' | 'out' = 'in'): void {
  const haveLogo = existsSync(LOGO_FILE);
  const filters = [`[0:v]format=yuv420p[bg]`];
  let last = 'bg';
  if (haveLogo) {
    // The logo spins + fades in (intro) or out (outro). Its baked #1E293C square
    // matches the card bg, so only the badge appears to turn. It's a still image,
    // so the input is looped into a timed stream (see inputs) for the time fx.
    // Ease-in-out (smoothstep) spin so the logo glides to a stop instead of
    // halting abruptly — one full turn over D, fading in (intro) / out (outro).
    const D = 0.8;
    const a = spin === 'out' ? secs - D : 0;
    const p = `clip((t-${a})/${D},0,1)`; // progress 0→1, clamped
    const eased = `(${p})*(${p})*(3-2*(${p}))`; // smoothstep S-curve
    const angle = spin === 'out' ? `(${eased})*2*PI` : `(1-(${eased}))*2*PI`;
    const fade = spin === 'out' ? `fade=t=out:st=${secs - D}:d=${D}:alpha=1` : `fade=t=in:st=0:d=${D}:alpha=1`;
    filters.push(
      `[1:v]scale=380:-1,format=rgba,rotate=a='${angle}':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=none,${fade}[logo]`,
    );
    filters.push(`[${last}][logo]overlay=(W-w)/2:(H-h)/2-110[bgl]`);
    last = 'bgl';
    // short orange rule between the mark and the words
    filters.push(`[${last}]drawbox=x=(iw-120)/2:y=ih/2+90:w=120:h=6:color=${ACCENT}:t=fill[rule]`);
    last = 'rule';
  }
  const lines = FONT_FILE && title ? wrapLines(title, 22) : [];
  const fontsize = 58;
  const lineHeight = 78;
  lines.forEach((ln, i) => {
    const y = `H/2+150+${i * lineHeight}`;
    filters.push(
      `[${last}]drawtext=fontfile='${FONT_FILE}':text='${esc(ln)}':fontcolor=white:fontsize=${fontsize}:` +
        `x=(w-text_w)/2:y=${y}[t${i}]`,
    );
    last = `t${i}`;
  });
  filters.push(`[${last}]null[outv]`);
  const inputs = ['-f', 'lavfi', '-t', String(secs), '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}`];
  // Loop the still logo into a timed stream so the rotate/fade have a timeline.
  if (haveLogo) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', LOGO_FILE);
  ff([
    ...inputs,
    '-f', 'lavfi', '-t', String(secs), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', filters.join(';'),
    '-map', '[outv]', '-map', `${haveLogo ? 2 : 1}:a`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-shortest', out,
  ]);
}

/** Normalize any clip to the canvas: fit on the brand bg, 30fps, with audio. */
function normalize(input: string, out: string, headTrimSec = 0): void {
  const audio = hasAudio(input);
  const ss = headTrimSec > 0 ? ['-ss', String(headTrimSec)] : [];
  const vf = `scale=${W - 80}:${H - 160}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1,fps=${FPS},format=yuv420p`;
  if (audio) {
    ff([...ss, '-i', input, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', out]);
  } else {
    ff([
      ...ss, '-i', input,
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

  // Read the voiceover timeline up front: trim the app's empty boot lead-in to
  // just before the first chat bubble actually appears (its time varies per run,
  // so a fixed trim leaves a gap). The harness emits a '__start__' mark for it.
  const timingPath = join(OUT, `${slug}.timing.json`);
  const timing: Array<{ vo: string; videoTime: number }> = existsSync(timingPath)
    ? JSON.parse(readFileSync(timingPath, 'utf8'))
    : [];
  const startMark = timing.find((m) => m.vo === '__start__');
  const appHeadTrim = startMark ? Math.max(0, startMark.videoTime - 0.4) : APP_HEAD_TRIM;

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  // Build the ordered segment list, tracking where the app segment starts in
  // the final timeline so the Mate voiceover can be placed against it.
  const segments: string[] = [];
  let cursor = 0; // running start time of the next segment
  let appStart = 0;
  const add = (file: string) => {
    segments.push(file);
    cursor += probeDur(file);
  };
  const push = (file: string, label: string, headTrim = 0): string => {
    const norm = join(TMP, `${label}.mp4`);
    normalize(file, norm, headTrim);
    return norm;
  };

  // brand intro
  const intro = join(TMP, 'intro.mp4');
  makeCard(intro, scenario.title ?? 'QuoteMate', 1.6);
  add(intro);

  // talking-head + app cut-ins (presenter clips optional)
  const presenterIntro = join(OUT, `${slug}.intro.mp4`);
  if (existsSync(presenterIntro)) add(push(presenterIntro, 'p-intro'));
  appStart = cursor; // the app segment begins here (after head-trim)
  add(push(app, 'app', appHeadTrim));
  const presenterReaction = join(OUT, `${slug}.reaction.mp4`);
  if (existsSync(presenterReaction)) add(push(presenterReaction, 'p-reaction'));

  // brand outro
  const outro = join(TMP, 'outro.mp4');
  // Two balanced stacked lines under the logo (the badge already carries the wordmark).
  makeCard(outro, 'Real quotes.\nReal prices.', 2.2, 'out');
  add(outro);

  // concat (re-encode for uniformity) → single track we then dub onto
  const listFile = join(TMP, 'list.txt');
  writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
  const concatV = join(TMP, 'concat.mp4');
  // Tag bt709 explicitly — without a colr atom some players (QuickTime) render
  // the H.264 as a black screen. `-c:v copy` below preserves these tags.
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-movflags', '+faststart', concatV]);

  // Gather the voiceover clips + their placement (appStart + recorded offset,
  // shifted by the head-trim). The '__start__' mark has no clip and is skipped.
  const voClips: Array<{ vo: string; file: string; atSec: number }> = [];
  const voPath = join(OUT, `${slug}.voiceover.json`);
  if (existsSync(voPath) && timing.length) {
    const voice = JSON.parse(readFileSync(voPath, 'utf8'));
    for (const mark of timing) {
      const clip = voice.clips?.[mark.vo];
      if (clip && existsSync(clip.file)) {
        voClips.push({ vo: mark.vo, file: clip.file, atSec: appStart + Math.max(0, mark.videoTime - appHeadTrim) });
      }
    }
    console.log(`  voiceover: ${voClips.map((v) => `${v.vo}@${v.atSec.toFixed(1)}s`).join('  ')}`);
  }

  const finalMp4 = join(OUT, `${slug}.mp4`);
  const haveMusic = !!(MUSIC_FILE && existsSync(MUSIC_FILE));

  // Re-encode the final with the PTS reset (setpts/asetpts) and `-bf 0`: B-frames
  // make libx264 emit an edit list with an empty edit at the start, which some
  // players (QuickTime) render as a fully black screen. Dropping B-frames +
  // zeroing the start removes it, so the deliverable plays everywhere.
  // Downscale to the site's web-delivery size + CRF (matches walkthrough.mp4 /
  // the trade videos — ~540x960, a few hundred kbps). `bf 0` keeps it free of
  // the empty-edit that blanks QuickTime.
  const VENC = [
    '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-crf', '26',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  ];
  if (voClips.length === 0 && !haveMusic) {
    // Nothing to dub — clean the concat into the final.
    ff(['-i', concatV, '-vf', `setpts=PTS-STARTPTS,scale=${WEB_W}:${WEB_H}:flags=lanczos`,
      '-af', 'aresample=async=1,asetpts=PTS-STARTPTS',
      ...VENC, '-c:a', 'aac', '-movflags', '+faststart', finalMp4]);
  } else {
    // Mix: base audio + each delayed Mate VO clip + optional looped music bed.
    const inputs = ['-i', concatV];
    voClips.forEach((v) => inputs.push('-i', v.file));
    if (haveMusic) inputs.push('-stream_loop', '-1', '-i', MUSIC_FILE);

    const parts: string[] = [];
    const mixIns: string[] = ['[0:a]'];
    voClips.forEach((v, i) => {
      const idx = i + 1; // input index of this VO
      const delayMs = Math.round(v.atSec * 1000);
      parts.push(`[${idx}:a]aresample=48000,adelay=${delayMs}:all=1[vo${i}]`);
      mixIns.push(`[vo${i}]`);
    });
    if (haveMusic) {
      const mIdx = voClips.length + 1;
      parts.push(`[${mIdx}:a]volume=0.10[mus]`);
      mixIns.push('[mus]');
    }
    parts.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:normalize=0[a]`);
    parts.push(`[0:v]setpts=PTS-STARTPTS,scale=${WEB_W}:${WEB_H}:flags=lanczos[v]`);
    ff([
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[v]', '-map', '[a]',
      ...VENC, '-c:a', 'aac', '-movflags', '+faststart', '-shortest', finalMp4,
    ]);
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
