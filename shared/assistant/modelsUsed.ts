/**
 * Which model(s) answered in a logged conversation.
 *
 * Per-message stamps are the truth (see ChatMessage.model), but the admin list
 * shows one row per conversation and can't open each one to find out. This
 * rolls the stamps up into something a column can hold, and keeps the order the
 * models actually appeared so "started on Claude, fell back to Gemini" survives
 * the summary.
 *
 * Why any of this exists: the brain behind Mate is chosen SERVER-side and
 * moves. Text falls back from Claude to Gemini mid-conversation when a key is
 * unfunded; the voice provider is an A/B by uid bucket, so two tradies on the
 * same build are on different models. Asked "is Mate worse since we went back
 * to Gemini?", a transcript alone cannot answer it.
 *
 * Pure — no Firestore, no React. Takes the messages, returns the summary.
 */

export interface ConversationMessageModel {
  role?: string;
  model?: string | null;
}

export interface ModelsUsed {
  /** Distinct models, in the order they first answered. */
  all: string[];
  /** The one that answered most turns — what the conversation was mostly on. */
  primary: string | null;
  /** True when more than one answered: a fallback, or voice and text mixed. */
  mixed: boolean;
  /** Assistant turns carrying a stamp. Older conversations have none. */
  stampedTurns: number;
}

const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function summariseModels(messages: ConversationMessageModel[] | undefined | null): ModelsUsed {
  const order: string[] = [];
  const counts = new Map<string, number>();

  for (const message of messages ?? []) {
    // Only the assistant has a model. A stamp on a user turn would be a bug
    // upstream; ignoring it keeps this total rather than propagating it.
    if (message?.role !== 'assistant') continue;
    const model = clean(message.model);
    if (!model) continue;
    if (!counts.has(model)) order.push(model);
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }

  const stampedTurns = [...counts.values()].reduce((sum, n) => sum + n, 0);
  // Ties go to whichever answered first — deterministic, and the earlier model
  // is the one the conversation was opened on.
  let primary: string | null = null;
  let best = 0;
  for (const model of order) {
    const n = counts.get(model) ?? 0;
    if (n > best) {
      best = n;
      primary = model;
    }
  }

  return { all: order, primary, mixed: order.length > 1, stampedTurns };
}
