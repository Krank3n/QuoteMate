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
 * While a business has saved nothing, the same seam carries an explicit
 * "nothing saved yet" line instead, so Mate asks once on their first job
 * (see "How they quote" in the prompt). No settings at all — store not
 * ready, source threw — means no line either way: the prompt stays static
 * rather than telling Mate to ask a tradie who may well have a rate card.
 *
 * The settings source is registered by the store rather than imported, so
 * none of the assistant services grow an import edge into the store graph.
 */
import type { BusinessSettings } from '../../types';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';
import { NO_PROFILE_NOTE, buildQuotingProfileBlock } from '../quotingProfile';

type ProfileSource = () => BusinessSettings | null | undefined;

let source: ProfileSource = () => null;

export function registerQuotingProfileSource(fn: ProfileSource): void {
  source = fn;
}

/**
 * The registered business settings, for the one place outside the store that
 * must show the same money the apply path will write: the draft card's rate
 * lines. Null when nothing is registered or the source throws.
 */
export function registeredBusinessSettings(): BusinessSettings | null {
  try {
    return source() ?? null;
  } catch {
    return null;
  }
}

/**
 * The block when they've saved something, the "nothing saved yet" line when
 * their settings are loaded but empty, null when there are no settings to
 * read. Never throws.
 */
function profileText(): string | null {
  try {
    const settings = source();
    if (!settings) return null;
    return buildQuotingProfileBlock(settings) ?? NO_PROFILE_NOTE;
  } catch {
    return null;
  }
}

/** The static prompt, plus the profile (or the nothing-saved line) when settings are loaded. */
export function systemPromptWithProfile(): string {
  const text = profileText();
  return text ? `${MATE_SYSTEM_PROMPT}\n\n${text}` : MATE_SYSTEM_PROMPT;
}

/** The same text as a silent context note, for providers that own their prompt. */
export function quotingProfileContextNote(): string | null {
  const text = profileText();
  return text ? `[context] ${text}` : null;
}
