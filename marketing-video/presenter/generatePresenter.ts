/**
 * [3] Presenter clips — the "common human" talking-head segments (intro,
 * answer, reaction) generated with Veo 3 via the generatePresenterClip Firebase
 * Function. One locked character (presenter/character.json) reused across every
 * scenario so the face/voice stay recognizable.
 *
 *   tsx presenter/generatePresenter.ts <slug>
 *
 * Needs:
 *   FIREBASE_ID_TOKEN   marketing-bot account id token (Bearer)
 *   the deployed generatePresenterClip function (GEMINI_API_KEY with Veo access)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');
const FUNCTIONS_URL =
  process.env.USE_FIREBASE_EMULATOR === 'true'
    ? 'http://127.0.0.1:5001/hansendev/us-central1'
    : 'https://us-central1-hansendev.cloudfunctions.net';

interface Character {
  seed: number;
  description: string;
  voice: string;
  negative: string;
}

/** Resolve a presenter line: either a key into conversation, or a literal. */
function resolveLine(value: string, conversation: Record<string, string>): string {
  return conversation[value] ?? value;
}

function clipPrompt(character: Character, line: string): string {
  return (
    `${character.description} ${character.voice} ` +
    `The person looks straight at the camera and says, naturally and warmly: "${line}"`
  );
}

async function generate(prompt: string, character: Character): Promise<Buffer> {
  const token = process.env.FIREBASE_ID_TOKEN;
  if (!token) throw new Error('FIREBASE_ID_TOKEN required (marketing-bot account id token)');
  const res = await fetch(`${FUNCTIONS_URL}/generatePresenterClip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      prompt,
      negativePrompt: character.negative,
      aspectRatio: '9:16',
      seed: character.seed,
    }),
  });
  if (!res.ok) throw new Error(`generatePresenterClip -> ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { dataBase64: string };
  return Buffer.from(data.dataBase64, 'base64');
}

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('usage: generatePresenter.ts <slug>');

  const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios', `${slug}.json`), 'utf8'));
  const character: Character = JSON.parse(readFileSync(join(ROOT, 'presenter', 'character.json'), 'utf8'));
  const convo: Record<string, string> = scenario.conversation;
  const p = scenario.presenter as { intro: string; answer: string; reaction: string };

  const parts: Array<{ name: string; line: string }> = [
    { name: 'intro', line: resolveLine(p.intro, convo) },
    { name: 'answer', line: resolveLine(p.answer, convo) },
    { name: 'reaction', line: resolveLine(p.reaction, convo) },
  ];

  mkdirSync(OUT, { recursive: true });
  for (const part of parts) {
    console.log(`[${slug}] ${part.name}: "${part.line}"  → generating (Veo, ~1–3 min)…`);
    const buf = await generate(clipPrompt(character, part.line), character);
    const file = join(OUT, `${slug}.${part.name}.mp4`);
    writeFileSync(file, buf);
    console.log(`  → ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
