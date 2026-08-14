/**
 * Did the user simply close the preview, rather than hit a failure?
 *
 * "Preview PDF" on iOS opens UIPrintInteractionController — the AirPrint sheet
 * with the rendered document in it. Reading the quote and tapping Cancel is
 * the ENTIRE point of a preview, but expo-print rejects `printAsync` whenever
 * that controller completes with `completed == false`, which is what a
 * dismissal is. So every successful preview ended in
 * "Preview failed — Couldn't open the PDF".
 *
 * Matched on the coded error first (`ERR_PRINT_INCOMPLETE`, which expo-modules
 * derives from the Swift class name `PrintIncompleteException`), falling back
 * to the reason string — either could shift if expo-print renames the
 * exception, and treating a real failure as a dismissal is the worse mistake,
 * so both are checked rather than assumed.
 */

const DISMISSAL_CODE = 'ERR_PRINT_INCOMPLETE';
const DISMISSAL_REASON = 'printing did not complete';

export function isPrintDismissal(error: unknown): boolean {
  if (!error) return false;
  const err = error as { code?: unknown; message?: unknown };

  if (typeof err.code === 'string' && err.code.toUpperCase() === DISMISSAL_CODE) {
    return true;
  }
  if (typeof err.message === 'string') {
    return err.message.toLowerCase().includes(DISMISSAL_REASON);
  }
  return false;
}
