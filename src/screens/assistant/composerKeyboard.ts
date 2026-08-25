// Keyboard geometry for the Mate composer.
//
// The Mate tab is the one screen where the composer has to serve two layouts:
//
//   Keyboard CLOSED — the floating tab bar overlays the bottom of the screen,
//   so the composer pads itself TAB_BAR_CLEARANCE (+ the home-indicator inset)
//   up to stay clear of it.
//
//   Keyboard OPEN — the tab bar is buried behind the keyboard, so that same
//   clearance would become a dead ~100px band between the composer and the
//   keys. The composer should instead sit a slim KEYBOARD_GAP above the
//   keyboard, like every other chat app.
//
// keyboard-controller's KeyboardAvoidingView pads by
//   keyboardHeight + keyboardVerticalOffset − headerHeight
// (it measures its frame parent-relative, so the navigator header above it
// shrinks what it thinks its bottom edge is — the offset must hand the header
// height back). mateKeyboardOffset() folds both corrections into one number:
// compensate the header, then under-pad by the surplus clearance so the
// composer's own closed padding lands it exactly KEYBOARD_GAP above the keys.

/** Height the floating LiquidTabBar needs under the composer while visible. */
export const TAB_BAR_CLEARANCE = 70;

/** Breathing room between the composer and the open keyboard. */
export const KEYBOARD_GAP = 8;

/** Composer bottom padding while the keyboard is closed. */
export function composerClosedPadding(bottomInset: number): number {
  return Math.max(bottomInset, 8) + TAB_BAR_CLEARANCE;
}

/**
 * keyboardVerticalOffset for the Mate screen's KeyboardAvoidingView. With the
 * composer's closed padding on top, total space above the keyboard comes out
 * at exactly KEYBOARD_GAP on any device.
 */
export function mateKeyboardOffset(headerHeight: number, bottomInset: number): number {
  return headerHeight + KEYBOARD_GAP - composerClosedPadding(bottomInset);
}

/**
 * iOS renders keyboard-controller's toolbar (prev/next/Done) globally — a win
 * on form screens, but it draws ~42pt ON TOP of a chat composer that hugs the
 * keyboard. Chat gets no toolbar; a Send button is its Done.
 */
export function keyboardToolbarVisibleForRoute(routeName: string | undefined): boolean {
  return routeName !== 'Mate';
}
