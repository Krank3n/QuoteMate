// A claim is a figure, not a scope.
//
// "Final claim for the slab", "progress claim 2", "deposit for the reno",
// "invoice them for $4,500" — the amount IS the document. Run the materials
// engine on one and it invents labour hours, patching mortar and a yard broom
// for work that was already priced (a real invoice, Sep 2026). Both the
// get_job_requirements fast path and the propose_draft_quote guard read these,
// so they live here rather than in either heavyweight module.

const CLAIM_WORDING_RE =
  /\b(?:claims?|deposit|retention|instal?ments?|(?:progress|stage|milestone)\s+(?:payment|invoice|claim)s?)\b/i;

// A money figure the tradie already said: "$4,500", "4500 dollars", "5k",
// "3,200 inc GST". A bare "20" is a measurement until proven otherwise.
const STATED_FIGURE_RE =
  /\$\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:k|grand|dollars|bucks)\b|\b\d[\d,]*(?:\.\d+)?\s*(?:ex|inc|incl?\.?|plus|including|excluding)\s*gst\b/i;

// An insurance claim is a job with a scope (storm damage, a burst pipe), not
// a payment claim — the materials engine is exactly what that one wants.
const INSURANCE_CLAIM_RE = /\binsurance\s+claims?\b/i;

/** True when the wording is a claim, deposit or stage payment rather than a scope to price. */
export function isClaimWording(text: string | undefined): boolean {
  if (!text) return false;
  return CLAIM_WORDING_RE.test(text.replace(INSURANCE_CLAIM_RE, ' '));
}

/** True when a dollar figure was already stated in the wording. */
export function hasStatedFigure(text: string | undefined): boolean {
  return !!text && STATED_FIGURE_RE.test(text);
}

/** The one extra must-ask an invoice carries when it is a claim with no figure yet. */
export const CLAIM_AMOUNT_QUESTION =
  'How much the claim is for — ex or inc GST, as they would normally say it';
