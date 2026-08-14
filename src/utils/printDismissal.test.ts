/**
 * Tapping "Preview PDF", reading the quote, then closing the sheet showed
 * "Preview failed — Couldn't open the PDF". expo-print rejects printAsync when
 * iOS's print controller completes with `completed == false`, which is exactly
 * what dismissing it does — so the successful path reported a failure.
 *
 * The risk in fixing it is over-matching: swallowing a genuine failure leaves
 * the tradie staring at a button that does nothing. These pin both directions.
 */
import { describe, it, expect } from 'vitest';

import { isPrintDismissal } from './printDismissal';

/** What expo-print's iOS PrintIncompleteException arrives as in JS. */
const dismissal = () =>
  Object.assign(new Error('Printing did not complete'), { code: 'ERR_PRINT_INCOMPLETE' });

describe('isPrintDismissal', () => {
  it('REGRESSION: recognises the rejection raised when the sheet is closed', () => {
    expect(isPrintDismissal(dismissal())).toBe(true);
  });

  it('recognises it from the code alone, if the wording changes', () => {
    expect(isPrintDismissal({ code: 'ERR_PRINT_INCOMPLETE', message: 'Something else' })).toBe(true);
  });

  it('recognises it from the reason alone, if the code changes', () => {
    expect(isPrintDismissal(new Error('Printing did not complete'))).toBe(true);
  });

  it('is case-insensitive about both', () => {
    expect(isPrintDismissal({ code: 'err_print_incomplete' })).toBe(true);
    expect(isPrintDismissal(new Error('PRINTING DID NOT COMPLETE'))).toBe(true);
  });

  // The other direction: a real failure must still reach the tradie.
  it('does not swallow a printing job that genuinely errored', () => {
    const failed = Object.assign(
      new Error("Printing job encountered an error: 'out of paper'"),
      { code: 'ERR_PRINTING_JOB_FAILED' },
    );
    expect(isPrintDismissal(failed)).toBe(false);
  });

  it('does not swallow the Android preview timeout that triggers the share fallback', () => {
    expect(isPrintDismissal(new Error('PDF preview timed out'))).toBe(false);
  });

  it('does not swallow a failure to build the document', () => {
    expect(isPrintDismissal(new Error('No data to print. You must specify `uri` or `html` option')))
      .toBe(false);
  });

  it('handles junk without throwing', () => {
    expect(isPrintDismissal(null)).toBe(false);
    expect(isPrintDismissal(undefined)).toBe(false);
    expect(isPrintDismissal('Printing did not complete')).toBe(false);
    expect(isPrintDismissal({})).toBe(false);
    expect(isPrintDismissal({ code: 42, message: 7 })).toBe(false);
  });
});
