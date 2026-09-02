/**
 * The per-business block Mate carries into every session.
 *
 * MATE_SYSTEM_PROMPT is a static constant with no per-business content — the
 * only way business context reached the model was a tool call it might not
 * make. This appends the tradie's saved quoting profile (preferences + rate
 * card) to the prompt for the text path and the Gemini/OpenAI voice paths,
 * and hands the same text out as a "[context]" note for ElevenLabs, whose
 * prompt is provisioned server-side.
 *
 * The settings source is registered by the store rather than imported, so
 * none of the assistant services grow an import edge into the store graph.
 */
import type { BusinessSettings } from '../../types';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { buildQuotingProfileBlock } from '../quotingProfile';

type ProfileSettings = Pick<BusinessSettings, 'quotingPreferences' | 'rateCard'>;
type ProfileSource = () => ProfileSettings | null | undefined;

let source: ProfileSource = () => null;

export function registerQuotingProfileSource(fn: ProfileSource): void {
  source = fn;
}

/** The block, or null when the tradie has saved nothing. Never throws. */
export function quotingProfileBlock(): string | null {
  try {
    return buildQuotingProfileBlock(source());
  } catch {
    return null;
  }
}

/** The static prompt, plus the profile when there is one. */
export function systemPromptWithProfile(): string {
  const block = quotingProfileBlock();
  return block ? `${MATE_SYSTEM_PROMPT}\n\n${block}` : MATE_SYSTEM_PROMPT;
}

/** The same profile as a silent context note, for providers that own their prompt. */
export function quotingProfileContextNote(): string | null {
  const block = quotingProfileBlock();
  return block ? `[context] ${block}` : null;
}
