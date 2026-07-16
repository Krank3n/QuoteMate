/**
 * sanitizeJobDescription — strip Mate-conversation fragments that leak into
 * the customer-facing job description.
 *
 * Real leak (QU-178342): "Prep and poor 230 square metres of exposed
 * aggregate what's their name and phone number so I can add them to your
 * list customer name is tarik" — the model concatenated its own follow-up
 * question and the tradie's answer onto the scope. Voice transcripts carry
 * no punctuation, so sentence-level filtering can't work; instead the text
 * is CUT at the first conversational marker, keeping the factual scope
 * before it. The cut only applies when what remains is still a usable scope
 * — otherwise the original text passes through untouched (the schema
 * validator still enforces a minimum length).
 */

// Phrases that belong to a conversation with the tradie, never to a scope.
// Each marks the earliest point at which chatter starts.
const CHATTER_MARKERS: RegExp[] = [
  /\bwhat'?s (?:their|your|his|her|the customer'?s)\b/i,
  /\bwhat is (?:their|your|his|her|the customer'?s)\b/i,
  /\bcan you (?:give|send|tell|get|grab|confirm)\b/i,
  /\bcould you (?:give|send|tell|get|grab|confirm)\b/i,
  /\bso i can (?:add|save|create|put|send)\b/i,
  /\badd (?:them|him|her|it) to (?:your|the|my) (?:list|contacts?)\b/i,
  /\b(?:customer|client) name is\b/i,
  /\btheir (?:name|number|phone|email|address) is\b/i,
  /\bdo you want me to\b/i,
  /\bwould you like me to\b/i,
  /\bshould i (?:add|create|draft|send|save)\b/i,
  /\bi'?ll (?:add|create|draft|save|send) (?:that|this|them|the)\b/i,
  /\blet me know\b/i,
];

const MIN_USABLE_SCOPE = 20;

export interface SanitizedDescription {
  text: string;
  /** The chatter that was removed, when a cut happened — for logging. */
  stripped?: string;
}

export function sanitizeJobDescription(raw: string): SanitizedDescription {
  const text = (raw || '').trim();
  if (!text) return { text };

  let earliest = -1;
  for (const marker of CHATTER_MARKERS) {
    const m = marker.exec(text);
    if (m && (earliest === -1 || m.index < earliest)) earliest = m.index;
  }
  if (earliest === -1) return { text };

  const cut = text.slice(0, earliest).replace(/[\s,;:—-]+$/, '').trim();
  if (cut.length < MIN_USABLE_SCOPE) return { text };
  return { text: cut, stripped: text.slice(earliest).trim() };
}
