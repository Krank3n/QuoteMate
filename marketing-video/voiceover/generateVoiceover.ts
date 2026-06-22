/**
 * [2b] Voiceover — Australian-accent spoken audio for Mate's chat replies.
 *
 * Generates one clip per line in scenarios/<slug>.json `voiceover.lines`
 * (keyed by the `vo` tags the driver puts on the demo events), using Gemini
 * TTS, and writes out/<slug>.voiceover.json so the capture + compositor can
 * sync each clip to when its bubble appears.
 *
 *   tsx voiceover/generateVoiceover.ts <slug>
 *
 * Reads GEMINI_API_KEY from ../../functions/.env (same key the app uses).
 * NOTE: like the Veo presenter, this should be wrapped in a Firebase Function
 * for production parity; direct API is fine for the pilot.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const SAMPLE_RATE = 24000; // Gemini TTS returns L16 PCM @ 24kHz mono

function geminiKey(): string {
  const env = readFileSync(resolve(ROOT, '..', 'functions', '.env'), 'utf8');
  const key = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.replace(/['"\r]/g, '').trim();
  if (!key) throw new Error('GEMINI_API_KEY not found in functions/.env');
  return key;
}

/** Generate one spoken line → raw PCM (s16le 24kHz mono). */
async function tts(text: string, voice: string, key: string): Promise<Buffer> {
  const styled =
    `Say this naturally in a warm, relaxed Australian accent — conversational, ` +
    `like a couple of Aussie tradies chatting, not an announcer: ${text}`;
  const res = await fetch(`${API}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: styled }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${voice} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline) throw new Error(`TTS returned no audio for "${text.slice(0, 40)}…"`);
  return Buffer.from(inline.data, 'base64');
}

/** Wrap raw PCM in a WAV via ffmpeg so the compositor can mix it. */
function pcmToWav(pcm: Buffer, wavPath: string): void {
  const rawPath = wavPath.replace(/\.wav$/, '.pcm');
  writeFileSync(rawPath, pcm);
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', rawPath, wavPath,
  ]);
  if (r.status !== 0) throw new Error('ffmpeg pcm→wav failed');
}

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('usage: generateVoiceover.ts <slug>');

  const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios', `${slug}.json`), 'utf8'));
  const vo = scenario.voiceover;
  if (!vo?.lines) {
    console.log(`[${slug}] no voiceover.lines in scenario — skipping (silent chat).`);
    return;
  }
  // `voices` maps a role (e.g. tradie/mate) → a prebuilt Gemini voice so the
  // human side and Mate's replies are spoken by distinct voices. Each line is
  // either a plain string (legacy, uses the default voice) or { voice, text }
  // where `voice` is a role key (or a raw voice name as a fallback).
  const voices: Record<string, string> = vo.voices ?? {};
  const defaultVoice: string = vo.voice || voices.mate || 'Puck';
  const resolveVoice = (role?: string): string => (role && (voices[role] ?? role)) || defaultVoice;

  const key = geminiKey();
  mkdirSync(OUT, { recursive: true });

  const clips: Record<string, { file: string; durSec: number; voice: string }> = {};
  for (const [voKey, raw] of Object.entries(vo.lines) as Array<[string, string | { voice?: string; text: string }]>) {
    const text = typeof raw === 'string' ? raw : raw.text;
    const voice = typeof raw === 'string' ? defaultVoice : resolveVoice(raw.voice);
    console.log(`[${slug}] vo '${voKey}' (${voice}): "${text.slice(0, 60)}…"`);
    const pcm = await tts(text, voice, key);
    const durSec = pcm.length / (2 * SAMPLE_RATE); // exact for s16le mono
    const file = join(OUT, `${slug}.vo.${voKey}.wav`);
    pcmToWav(pcm, file);
    clips[voKey] = { file, durSec: Math.round(durSec * 1000) / 1000, voice };
    console.log(`  → ${file} (${durSec.toFixed(2)}s, ${voice})`);
  }

  writeFileSync(join(OUT, `${slug}.voiceover.json`), JSON.stringify({ voices, clips }, null, 2));
  console.log(`  → out/${slug}.voiceover.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
