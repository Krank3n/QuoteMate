import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pins the materials generator's model and request shape.
 *
 * Two things here are easy to undo by accident and expensive to notice:
 *
 * 1. `temperature` is REJECTED with a 400 on Opus 5. It was on this request
 *    for the previous model, and re-adding it — by habit, or by copying one of
 *    the Gemini calls in the same file, which legitimately still use it —
 *    breaks every materials generation with a 400 that only shows up as the
 *    Gemini fallback quietly taking over.
 *
 * 2. Claude is PRIMARY on evidence, not preference. Measured over real
 *    customer work on the identical prompt, missing materials per job:
 *    gemini 7.54 (text) / 8.73 (photos), opus-5 2.15 / 4.27. Sonnet 5 (9.73)
 *    and Fable 5 (7.92) both land with Gemini, so this is Opus-tier reasoning
 *    rather than a vendor preference, and there is no cheaper substitute.
 *    Swapping the order back should require re-running that comparison.
 */
const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

/** Strip comments — this guard is about the request, not the prose around it. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The body of callClaudeForMaterials — the only Anthropic materials call. */
function claudeMaterialsRequest(): string {
  const start = source.indexOf('async function callClaudeForMaterials');
  expect(start).toBeGreaterThan(-1);
  // Matches the request payload however it is assigned — it moved from an
  // inline `body:` to a hoisted `requestBody` const when the retry was added.
  const bodyAt = source.indexOf('JSON.stringify({', start);
  expect(bodyAt).toBeGreaterThan(-1);
  return stripComments(source.slice(bodyAt, source.indexOf('});', bodyAt)));
}

/** callClaudeForMaterials, bounded at its closing brace — a looser slice runs
 *  on into the next function, which has its own response parsing. */
function claudeMaterialsFn(): string {
  const start = source.indexOf('async function callClaudeForMaterials');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  // Comments stripped: the fix's own comment names the bug it prevents.
  return stripComments(source.slice(start, end));
}

describe('materials generator model', () => {
  it('generates with Claude Opus 5', () => {
    expect(claudeMaterialsRequest()).toContain("model: 'claude-opus-5'");
  });

  it('sends no sampling parameters — Opus 5 returns 400 for them', () => {
    const req = claudeMaterialsRequest();
    expect(req).not.toMatch(/\btemperature\b/);
    expect(req).not.toMatch(/\btop_p\b/);
    expect(req).not.toMatch(/\btop_k\b/);
  });

  it('ships the thinking/effort configuration the comparison was measured under', () => {
    const req = claudeMaterialsRequest();
    expect(req).toContain("thinking: { type: 'adaptive' }");
    expect(req).toContain("effort: 'high'");
  });

  it('does not use a deprecated thinking budget', () => {
    expect(claudeMaterialsRequest()).not.toMatch(/budget_tokens/);
  });

  it('treats a refusal as a failure so the Gemini fallback runs', () => {
    // A refusal is HTTP 200 with no usable text. Without this the handler
    // parses an empty response instead of falling back.
    expect(claudeMaterialsFn()).toMatch(/stop_reason === 'refusal'/);
  });

  it('reads the response text block rather than content[0]', () => {
    // With thinking on, block 0 is a thinking block. Indexing it made the
    // switch a silent no-op that still paid Claude's latency.
    const fn = claudeMaterialsFn();
    expect(fn).not.toMatch(/content\[0\]\.text/);
    expect(fn).toContain('claudeText(data)');
  });

  it('retries once on a connection-level failure', () => {
    // A single ECONNRESET cost a whole generation: it fell to Gemini, which
    // truncated its JSON on the large scope, so both providers failed and the
    // tradie got nothing. Only connection failures retry — a 4xx is an answer.
    const fn = claudeMaterialsFn();
    expect(fn).toMatch(/attempt <= 2/);
    expect(fn).toMatch(/ECONNRESET/);
    expect(fn).toMatch(/if \(!connectionLevel \|\| attempt === 2\) throw err/);
  });

  it('calls Claude before Gemini in the analyze handler', () => {
    const handler = source.slice(source.indexOf('export const analyzeJobDescription'));
    const claudeAt = handler.indexOf('callClaudeForMaterials(anthropicApiKey, finalPrompt, attachments)');
    const geminiAt = handler.indexOf('callGeminiForMaterials(geminiApiKey, finalPrompt, attachments)');
    expect(claudeAt).toBeGreaterThan(-1);
    expect(geminiAt).toBeGreaterThan(-1);
    expect(claudeAt).toBeLessThan(geminiAt);
  });

  it('leaves floorplan measurement on Gemini', () => {
    // Plan drawings were 4 of 63 photo-bearing quotes — far too few to move
    // that path on. The blind takeoff is a separate pass and stays put.
    expect(source).toContain('callGeminiForBlindTakeoff(geminiApiKey, attachments)');
  });
});
