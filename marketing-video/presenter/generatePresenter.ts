/**
 * [3] Presenter clips — the "common human" talking-head segments generated with
 * Veo 3. One locked character (presenter/character.json) reused across every
 * scenario so the face/voice stay recognizable.
 *
 *   tsx presenter/generatePresenter.ts <slug>
 *
 * Calls the Gemini Veo API directly with GEMINI_API_KEY (read from
 * ../../functions/.env, same key the app uses) — the same flow as the
 * generatePresenterClip Firebase Function, inlined so the pilot runs without a
 * deployed function or an auth token (mirrors generateVoiceover.ts). Wrap it
 * back through the Function for production parity.
 *
 * Env: VEO_MODEL (default veo-3.0-fast-generate-001).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');
const API = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 8_000;
const MAX_POLLS = 50; // ~7 min ceiling per clip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function geminiKey(): string {
  const env = readFileSync(resolve(ROOT, '..', 'functions', '.env'), 'utf8');
  const key = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.replace(/['"\r]/g, '').trim();
  if (!key) throw new Error('GEMINI_API_KEY not found in functions/.env');
  return key;
}

interface Character {
  seed: number;
  description: string;
  voice: string;
  negative: string;
  /** What the person is physically doing while they speak (e.g. holding their
   *  phone up and talking to it). Drives the action clause of the prompt. */
  action?: string;
  /** Default backdrop, overridable per scenario via presenter.setting. */
  setting?: string;
}

/** Resolve a presenter line: either a key into conversation, or a literal. */
function resolveLine(value: string, conversation: Record<string, string>): string {
  return conversation[value] ?? value;
}

function clipPrompt(character: Character, line: string, setting: string): string {
  const action = character.action ?? 'looking at the camera';
  return (
    `${character.description} ${setting}. ${character.voice} ` +
    `While ${action}, they say it out loud, naturally and warmly: "${line}"`
  );
}

async function generate(prompt: string, character: Character, key: string): Promise<Buffer> {
  // Fast proved indistinguishable for talking-head and is ~½ the cost. Set
  // VEO_MODEL=veo-3.0-generate-001 for the higher-fidelity model.
  const model = process.env.VEO_MODEL || 'veo-3.0-fast-generate-001';
  const parameters: Record<string, unknown> = {
    aspectRatio: '9:16',
    // Text-to-video supports 'allow_all' | 'dont_allow' — 'allow_adult' is
    // image-to-video only and 400s here. We generate a talking person.
    personGeneration: 'allow_all',
    negativePrompt: character.negative,
    seed: character.seed,
  };

  // 1) Kick off the long-running generation.
  const startRes = await fetch(`${API}/models/${model}:predictLongRunning?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters }),
  });
  if (!startRes.ok) throw new Error(`Veo start failed: ${startRes.status} ${await startRes.text()}`);
  const op = (await startRes.json()) as { name?: string };
  if (!op.name) throw new Error('Veo did not return an operation name.');

  // 2) Poll until the operation completes (~1–3 min).
  let done: any = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${API}/${op.name}?key=${key}`);
    if (!pollRes.ok) continue;
    const status = (await pollRes.json()) as any;
    if (status.done) {
      if (status.error) throw new Error(`Veo failed: ${JSON.stringify(status.error)}`);
      done = status;
      break;
    }
  }
  if (!done) throw new Error('Veo timed out before the clip was ready.');

  // 3) Pull the generated sample's file URI and fetch the bytes.
  const sample =
    done.response?.generateVideoResponse?.generatedSamples?.[0] ?? done.response?.generatedSamples?.[0];
  const uri: string | undefined = sample?.video?.uri ?? sample?.video?.fileUri;
  if (!uri) throw new Error(`Veo response had no video URI: ${JSON.stringify(done.response)?.slice(0, 300)}`);
  const fileRes = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
  if (!fileRes.ok) throw new Error(`Clip download failed: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('usage: generatePresenter.ts <slug>');

  const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios', `${slug}.json`), 'utf8'));
  const character: Character = JSON.parse(readFileSync(join(ROOT, 'presenter', 'character.json'), 'utf8'));
  const convo: Record<string, string> = scenario.conversation;
  const p = scenario.presenter as { intro: string; answer: string; reaction: string; setting?: string };
  const setting = p.setting ?? character.setting ?? 'on a residential job site';

  // Just the opening talking-head before the app replay. The closing reaction
  // is now a voiceover over the PDF (scenarios voiceover.lines.pdf), not a
  // second clip, and the 'answer' line is voiced in the chat — so we only spend
  // one Veo generation per scenario.
  const parts: Array<{ name: string; line: string }> = [
    { name: 'intro', line: resolveLine(p.intro, convo) },
  ];

  const key = geminiKey();
  mkdirSync(OUT, { recursive: true });
  for (const part of parts) {
    console.log(`[${slug}] ${part.name}: "${part.line}"  → generating (Veo, ~1–3 min)…`);
    const buf = await generate(clipPrompt(character, part.line, setting), character, key);
    const file = join(OUT, `${slug}.${part.name}.mp4`);
    writeFileSync(file, buf);
    console.log(`  → ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
