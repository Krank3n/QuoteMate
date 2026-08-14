/**
 * The single place a stored material becomes a PdfMaterial.
 *
 * Three renderers used to build this projection by hand — the client quote
 * PDF, the client invoice PDF and the server PDF — and every new field had to
 * be remembered in all three. It never was: fields added to Material silently
 * stopped at whichever mapper was forgotten, and the two mapping layers drift
 * apart exactly where nobody looks (a customer-facing document).
 *
 * Takes a loose shape on purpose: the client passes a typed Material, the
 * server passes a Firestore document read as `any`.
 */

import { PdfMaterial } from './types';

export interface MaterialLike {
  name?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  totalPrice?: number;
  section?: string;
  kind?: 'material' | 'work';
  scope?: string;
}

export function toPdfMaterial(m: MaterialLike): PdfMaterial {
  return {
    name: m.name as string,
    quantity: m.quantity as number,
    unit: m.unit as string,
    price: m.price || 0,
    totalPrice: m.totalPrice || 0,
    section: m.section,
    kind: m.kind,
    scope: m.scope,
  };
}

export function toPdfMaterials(materials: MaterialLike[] | undefined | null): PdfMaterial[] {
  return (materials || []).map(toPdfMaterial);
}
