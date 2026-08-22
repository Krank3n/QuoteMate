/**
 * Contract for the prompt's "Sending & email" section.
 *
 * The section documented propose_send_quote but only ever described what
 * happens once the tradie asks. Sending is the activation event and 75% of
 * tradies never do it, so Mate has to raise it: once a quote is priced and
 * there's someone to send it to, offer the send. This pins that instruction
 * — and pins that Mate still only tees a send up, never fires one itself.
 */
import { describe, it, expect } from 'vitest';

import { MATE_SYSTEM_PROMPT } from '../systemPrompt';

/** The prompt is blank-line separated sections; grab the one we own. */
const SENDING_SECTION = MATE_SYSTEM_PROMPT.split('\n\n').find((s) =>
  s.startsWith('Sending & email'),
);

describe('Mate prompt — Sending & email', () => {
  it('still has a sending section', () => {
    expect(SENDING_SECTION).toBeTruthy();
  });

  it('tells Mate to offer the send rather than wait to be asked', () => {
    expect(SENDING_SECTION).toMatch(/offer the send/i);
    expect(SENDING_SECTION).toMatch(/don't wait to be asked/i);
  });

  it('names the trigger: a priced quote with somewhere to send it', () => {
    expect(SENDING_SECTION).toMatch(/priced/i);
    expect(SENDING_SECTION).toMatch(/who it's going to/i);
  });

  it('keeps propose_send_quote as the only way it acts on that yes', () => {
    expect(SENDING_SECTION).toMatch(/propose_send_quote/);
    expect(SENDING_SECTION).toMatch(/you never send it yourself/i);
  });

  it('holds the copy rules — no "AI", Aussie and gender-neutral', () => {
    expect(SENDING_SECTION).not.toMatch(/\bAI\b/);
    expect(SENDING_SECTION).not.toMatch(/\b(guys|blokes|fellas|lads|folks|fancy)\b/i);
  });
});
