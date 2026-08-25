// Regression tests for the Mate keyboard fix: on Android the keyboard used to
// slide straight over the composer (the RN KeyboardAvoidingView was a no-op
// with behavior=undefined, and the global KeyboardProvider disables the
// adjustResize window shrink the screen leaned on). The fix routes through
// keyboard-controller with a computed keyboardVerticalOffset; these tests pin
// the geometry so a future tweak can't quietly reopen the overlap or the
// dead-gap-above-the-keyboard it replaces.

import { describe, it, expect } from 'vitest';
import {
  TAB_BAR_CLEARANCE,
  KEYBOARD_GAP,
  composerClosedPadding,
  mateKeyboardOffset,
  keyboardToolbarVisibleForRoute,
} from '../composerKeyboard';

// Mirror of keyboard-controller KeyboardAvoidingView's padding worklet
// (relativeKeyboardHeight): the KAV measures its frame parent-relative, so a
// screen under a navigator header believes its bottom edge sits headerHeight
// higher than it really does.
function kavPadding(keyboardHeight: number, headerHeight: number, offset: number): number {
  return Math.max(keyboardHeight + offset - headerHeight, 0);
}

describe('Mate composer keyboard geometry', () => {
  it('closed composer clears the floating tab bar, and the home indicator when present', () => {
    // Gesture-nav iPhone: inset wins over the 8pt floor.
    expect(composerClosedPadding(34)).toBe(34 + TAB_BAR_CLEARANCE);
    // Button-nav Android: no inset, floor keeps the composer off the edge.
    expect(composerClosedPadding(0)).toBe(8 + TAB_BAR_CLEARANCE);
  });

  it('open keyboard leaves exactly KEYBOARD_GAP above the keys on iPhone geometry', () => {
    const headerHeight = 103; // 44pt header + Dynamic Island status bar
    const inset = 34;
    const keyboard = 336;
    const gap =
      kavPadding(keyboard, headerHeight, mateKeyboardOffset(headerHeight, inset)) +
      composerClosedPadding(inset) -
      keyboard;
    expect(gap).toBe(KEYBOARD_GAP);
  });

  it('open keyboard leaves exactly KEYBOARD_GAP on button-nav Android geometry', () => {
    const headerHeight = 80; // 56dp header + 24dp status bar
    const inset = 0;
    const keyboard = 280;
    const gap =
      kavPadding(keyboard, headerHeight, mateKeyboardOffset(headerHeight, inset)) +
      composerClosedPadding(inset) -
      keyboard;
    expect(gap).toBe(KEYBOARD_GAP);
  });

  it('a tiny floating keyboard never drives the padding negative', () => {
    // The KAV clamps at zero; the composer just keeps its tab-bar clearance.
    expect(kavPadding(60, 103, mateKeyboardOffset(103, 34))).toBe(0);
  });
});

describe('iOS keyboard toolbar visibility', () => {
  it('stays off the Mate chat, where it would cover the composer', () => {
    expect(keyboardToolbarVisibleForRoute('Mate')).toBe(false);
  });

  it('shows everywhere else, including before navigation is ready', () => {
    expect(keyboardToolbarVisibleForRoute('Dashboard')).toBe(true);
    expect(keyboardToolbarVisibleForRoute('JobDetails')).toBe(true);
    expect(keyboardToolbarVisibleForRoute(undefined)).toBe(true);
  });
});
