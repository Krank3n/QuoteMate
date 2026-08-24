// Which extractor reads a set of already-picked files — pure, so the routing
// can be pinned without a React hook or a network call.
//
// Mate's chat path hands over uris it got from an attachment or a picker,
// where the mime is a hint at best: an unknown type goes to the photo
// extractor because that's what a phone actually produces.

/** Mirrors supplierListImporter's MAX_IMAGES — kept in step by its test. */
export const MAX_IMPORT_IMAGES = 10;

export type SupplierImportRoute =
  | { kind: 'pdf'; uri: string }
  | { kind: 'photos'; uris: string[] }
  | { kind: 'error'; message: string };

export function routeSupplierImport(args: {
  uris: string[];
  mimeType?: string;
}): SupplierImportRoute {
  const uris = (args.uris || []).map((u) => u?.trim()).filter((u): u is string => !!u);
  if (!uris.length) {
    return { kind: 'error', message: "Couldn't find that file — send it again and I'll read it." };
  }
  if (args.mimeType === 'application/pdf') {
    return { kind: 'pdf', uri: uris[0] };
  }
  if (uris.length > MAX_IMPORT_IMAGES) {
    return {
      kind: 'error',
      message: `That's more than ${MAX_IMPORT_IMAGES} pages — send the first ${MAX_IMPORT_IMAGES} and I'll take the rest after.`,
    };
  }
  return { kind: 'photos', uris };
}
