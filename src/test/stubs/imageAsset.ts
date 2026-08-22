/**
 * Stand-in for a .png require() under vitest — same story as fontAsset.ts:
 * Metro turns image requires into asset registry numbers; vite would try to
 * parse the binary as JavaScript and throw.
 */
export default 1;
