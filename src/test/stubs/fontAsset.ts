/**
 * Stand-in for a .ttf require() under vitest.
 *
 * Metro turns `require('...ttf')` into an asset registry number; vite tries to
 * parse the binary as JavaScript and throws "Invalid or unexpected token". The
 * alias in vitest.config.ts points every .ttf here so the font map stays a
 * single source of truth in src/theme/typography.ts rather than being split
 * into a test-safe half and a runtime half.
 */
export default 1;
