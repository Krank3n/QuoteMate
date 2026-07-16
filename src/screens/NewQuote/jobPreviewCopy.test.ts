/**
 * Copy contract for the JobPreview success banner.
 *
 * Regression guard for the Jul 2026 stall finding: 36 users finished a
 * sendable quote and never sent it, while the banner declared the job
 * "locked and loaded / a done deal / all wrapped up". This pins the two
 * properties that matter: the copy must point at sending, and must never
 * claim the job is finished before anything has been sent.
 */
import { describe, it, expect } from 'vitest';

import { SUCCESS_MESSAGES, pickSuccessMessage } from './jobPreviewCopy';

// Words that read as "you're finished" — the exact failure mode the old
// copy shipped with.
const COMPLETION_CLAIMS = /\b(done|saved|sorted|wrapped|locked|deal|in the bag|good to go|finished)\b/i;

// Every subtitle must direct the user at getting the doc to the customer.
const SEND_DIRECTIVE = /\bsend\b|\bfire it off\b|in front of your customer|see it|inbox/i;

describe('JobPreview success copy', () => {
  it('has messages to pick from', () => {
    expect(SUCCESS_MESSAGES.length).toBeGreaterThan(0);
  });

  it.each(SUCCESS_MESSAGES.map((m) => [m.title, m] as const))(
    '"%s" points at sending, not completion',
    (_title, m) => {
      expect(`${m.title} ${m.subtitle}`).not.toMatch(COMPLETION_CLAIMS);
      expect(m.subtitle).toMatch(SEND_DIRECTIVE);
    },
  );

  it('pickSuccessMessage returns one of the defined messages', () => {
    expect(SUCCESS_MESSAGES).toContainEqual(pickSuccessMessage());
  });
});
