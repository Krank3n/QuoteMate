/**
 * Read the JSON text out of the lite-tier provider responses (reconcile,
 * quantity sanity check, column mapping), failing LOUDLY on the two ways a
 * 200 can carry no usable answer.
 *
 * Both used to fail as noise that looked like a flaky model: Gemini 3.7 Flash
 * thinks inside `maxOutputTokens`, so a large reconcile batch spent the whole
 * budget thinking and returned a few hundred tokens of cut-off JSON ("Unbalanced
 * JSON in LLM response"); the Claude fallback then read `content[0].text`,
 * which is the thinking block on Sonnet 5 ("No content"). Together they
 * aborted the reconcile pass on roughly one server pricing run in eight, and
 * the rows that pass exists to catch — packs priced as single items, wrong
 * products — went to the customer.
 */
import { claudeText } from './claudeText';

export function geminiLiteText(data: any): string {
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    const u = data?.usageMetadata || {};
    throw new Error(
      `Gemini Lite hit its output cap (thinking ${u.thoughtsTokenCount ?? '?'} + answer ${u.candidatesTokenCount ?? '?'} tokens)`,
    );
  }
  // Thought-summary parts carry `thought: true`; only the answer is JSON.
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p: any) => !p?.thought && typeof p?.text === 'string')
    .map((p: any) => p.text)
    .join('');
  if (!text) throw new Error(`No content in Gemini Lite response (finishReason: ${candidate?.finishReason || 'none'})`);
  return text;
}

export function claudeLiteText(data: any): string {
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Claude Lite hit its output cap (max_tokens)');
  }
  if (data?.stop_reason === 'refusal') {
    throw new Error(`Claude Lite refused: ${data.stop_details?.category || 'unspecified'}`);
  }
  const text = claudeText(data);
  if (!text) throw new Error(`No content in Claude Lite response (stop_reason: ${data?.stop_reason || 'none'})`);
  return text;
}
