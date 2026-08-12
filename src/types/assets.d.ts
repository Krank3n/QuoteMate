/**
 * Asset module declarations.
 *
 * Metro resolves an imported font file to an asset-registry handle; there is no
 * ambient type for it in the Expo types, so TypeScript needs telling. Typed as
 * `number` because that is what the registry actually returns and what
 * expo-font's loadAsync expects.
 */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

declare module '*.otf' {
  const asset: number;
  export default asset;
}
