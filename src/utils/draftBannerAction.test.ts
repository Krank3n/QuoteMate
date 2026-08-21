/**
 * The dashboard draft banner's tap target.
 *
 * A draft stamped 'JobPreview' is finished work waiting on a send, not
 * unfinished wizard work — the banner has to offer the send. It can only do
 * that when the draft knows which job it belongs to, because the send sheet
 * is reached through ViewJob.
 */
import { describe, it, expect } from 'vitest';

import { resolveDraftBannerAction } from './draftBannerAction';

describe('resolveDraftBannerAction', () => {
  it('offers the send for a finished draft attached to a job', () => {
    expect(resolveDraftBannerAction({ draftStep: 'JobPreview', jobId: 'job-1' })).toEqual({
      kind: 'send',
      icon: 'send-outline',
    });
  });

  it('falls back to resuming when a finished draft has no job to open', () => {
    expect(resolveDraftBannerAction({ draftStep: 'JobPreview' })).toEqual({
      kind: 'resume',
      icon: 'pencil-outline',
    });
  });

  it('resumes a draft left mid-wizard', () => {
    expect(resolveDraftBannerAction({ draftStep: 'MaterialsList', jobId: 'job-1' })).toEqual({
      kind: 'resume',
      icon: 'pencil-outline',
    });
  });
});
