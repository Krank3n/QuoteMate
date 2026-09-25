/**
 * The tradie's own standing section, printed on every quote after the T&Cs —
 * recommended trades, licence/insurance details, a warranty, whatever they
 * want every customer to see. Set once in Settings → Quotes & Invoices.
 *
 * Deliberately NOT snapshotted at send time the way the T&Cs are: terms are
 * what the customer accepted and must never change under them, but this is
 * contact-style information (like the business's own phone and payment
 * details, which also render live) — an updated partner phone number should
 * reach old quotes too.
 */
export interface ExtraSection {
  title: string;
  body: string;
}

export const EXTRA_SECTION_DEFAULT_TITLE = 'Additional information';
export const EXTRA_SECTION_TITLE_MAX = 60;
export const EXTRA_SECTION_BODY_MAX = 2000;

/** Resolve the section from business settings; undefined when there's no body. */
export function resolveExtraSection(
  settings: { extraSectionTitle?: unknown; extraSectionBody?: unknown } | null | undefined,
): ExtraSection | undefined {
  const body = typeof settings?.extraSectionBody === 'string'
    ? settings.extraSectionBody.trim().slice(0, EXTRA_SECTION_BODY_MAX)
    : '';
  if (!body) return undefined;
  const title = typeof settings?.extraSectionTitle === 'string'
    ? settings.extraSectionTitle.trim().slice(0, EXTRA_SECTION_TITLE_MAX)
    : '';
  return { title: title || EXTRA_SECTION_DEFAULT_TITLE, body };
}
