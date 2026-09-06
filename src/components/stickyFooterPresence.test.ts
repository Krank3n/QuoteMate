/**
 * The materials list had three things competing for the strip above the
 * keyboard (6 Sep 2026): the focused row, the screen's sticky action bar, and
 * iOS's global keyboard toolbar. The toolbar drew on top of Save.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStickyFooters,
  isStickyFooterMounted,
  registerStickyFooter,
  subscribeStickyFooter,
} from './stickyFooterPresence';

afterEach(() => __resetStickyFooters());

describe('stickyFooterPresence', () => {
  it('is quiet when no bar is mounted, so the toolbar shows as before', () => {
    expect(isStickyFooterMounted()).toBe(false);
  });

  it('reports a mounted bar, and clears when it goes', () => {
    const release = registerStickyFooter();
    expect(isStickyFooterMounted()).toBe(true);
    release();
    expect(isStickyFooterMounted()).toBe(false);
  });

  it('survives two bars overlapping during a push transition', () => {
    const outgoing = registerStickyFooter();
    const incoming = registerStickyFooter();
    outgoing();
    // The outgoing screen unmounting must not uncover the incoming one's bar.
    expect(isStickyFooterMounted()).toBe(true);
    incoming();
    expect(isStickyFooterMounted()).toBe(false);
  });

  it('ignores a release called twice, so a double unmount cannot go negative', () => {
    const a = registerStickyFooter();
    const b = registerStickyFooter();
    a();
    a();
    expect(isStickyFooterMounted()).toBe(true);
    b();
    expect(isStickyFooterMounted()).toBe(false);
  });

  it('notifies subscribers on both edges', () => {
    const seen = vi.fn();
    subscribeStickyFooter(seen);
    const release = registerStickyFooter();
    expect(seen).toHaveBeenCalledTimes(1);
    release();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('stops notifying once unsubscribed', () => {
    const seen = vi.fn();
    const off = subscribeStickyFooter(seen);
    off();
    registerStickyFooter();
    expect(seen).not.toHaveBeenCalled();
  });
});
