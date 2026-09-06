/**
 * Is a keyboard-sticky action bar on screen right now?
 *
 * iOS renders keyboard-controller's toolbar (prev / next / Done) globally, and
 * it draws ~42pt directly on top of the keyboard. So does a FixedBottomButton
 * in its sticky mode. Two things claiming the same strip means the toolbar
 * lands on the Save button — verified on a simulator (6 Sep 2026), where the
 * Done bar sat squarely over "Fetch Prices" and "Save" on the materials list.
 *
 * Nine screens carry a sticky bar today, so an allowlist of route names in the
 * toolbar would be wrong the moment someone adds a tenth. Instead the bar
 * announces itself while it is mounted, and the toolbar stands down. A screen
 * gets the behaviour by rendering the bar, which it already does.
 *
 * A count, not a boolean: navigation keeps the outgoing screen mounted during
 * a push transition, so two bars overlap briefly and a boolean would be
 * cleared by the first unmount.
 */

let mounted = 0;
const listeners = new Set<() => void>();

/** Call on mount of a sticky bar; call the returned function on unmount. */
export function registerStickyFooter(): () => void {
  mounted += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted = Math.max(0, mounted - 1);
    emit();
  };
}

export function isStickyFooterMounted(): boolean {
  return mounted > 0;
}

export function subscribeStickyFooter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — module state would otherwise leak between cases. */
export function __resetStickyFooters(): void {
  mounted = 0;
  listeners.clear();
}

function emit(): void {
  listeners.forEach((l) => l());
}
