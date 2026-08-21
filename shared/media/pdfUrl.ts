/**
 * Whether a stored quote/report photo URL points at a PDF plan rather than an
 * image. Works on both storage paths and Firebase download URLs
 * (".pdf?alt=media&token=…").
 *
 * Shared because every surface that renders photo URLs must agree: the app's
 * photo tiles, the customer quote email, the acceptance page, and the report
 * PDF builders all need to divert PDFs away from <img>/<Image> rendering.
 */
export function isPdfUrl(url: string | undefined | null): boolean {
  return !!url && /\.pdf($|\?)/i.test(url);
}
