import { describe, expect, it } from 'vitest';
import { MODAL_MIN_BOTTOM_PAD, resolveModalInset } from './modalInsets';

describe('resolveModalInset', () => {
  it('takes the real inset when the tree reports one', () => {
    expect(resolveModalInset({ contextValue: 34, metricsValue: 34, minimum: MODAL_MIN_BOTTOM_PAD })).toBe(34);
  });

  it('falls back to the startup metrics when the modal tree reports nothing', () => {
    // A <Modal> renders outside the SafeAreaProvider, so context reads 0 —
    // this is the Android nav-bar case that put the send footer under the
    // back/home/recents buttons.
    expect(resolveModalInset({ contextValue: 0, metricsValue: 48, minimum: MODAL_MIN_BOTTOM_PAD })).toBe(48);
  });

  it('never drops below the minimum, and ignores junk values', () => {
    expect(resolveModalInset({ contextValue: 0, metricsValue: 0, minimum: MODAL_MIN_BOTTOM_PAD })).toBe(16);
    expect(resolveModalInset({ minimum: MODAL_MIN_BOTTOM_PAD })).toBe(16);
    expect(resolveModalInset({ contextValue: Number.NaN, metricsValue: -20, minimum: MODAL_MIN_BOTTOM_PAD })).toBe(16);
  });

  it('has no minimum by default, so a top inset can legitimately be zero', () => {
    expect(resolveModalInset({ contextValue: 0, metricsValue: 0 })).toBe(0);
    expect(resolveModalInset({ contextValue: 0, metricsValue: 59 })).toBe(59);
  });
});
