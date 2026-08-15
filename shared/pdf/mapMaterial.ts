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

import { PdfMaterial, LaborSection } from './types';

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

export interface SectionLike {
  name?: string;
  laborHours?: number;
  multiplier?: number;
  laborHoursTotal?: number;
  laborRate?: number;
  laborUnit?: 'hours' | 'days';
  laborTotal?: number;
  pricing?: 'hourly' | 'lumpSum';
  description?: string;
}

/**
 * The same story as toPdfMaterial: this projection was hand-written at four
 * sites (client quote PDF, client invoice PDF, server PDF, template preview),
 * and adding `pricing` and `description` meant editing three of them — which
 * is the proof that it wanted to be one function.
 */
export function toPdfSection(s: SectionLike): LaborSection {
  return {
    name: s.name as string,
    laborHours: s.laborHours as number,
    multiplier: s.multiplier,
    laborHoursTotal: s.laborHoursTotal,
    laborRate: s.laborRate as number,
    laborUnit: s.laborUnit,
    laborTotal: s.laborTotal as number,
    pricing: s.pricing,
    description: s.description,
  };
}

export function toPdfSections(sections: SectionLike[] | undefined | null): LaborSection[] {
  return (sections || []).map(toPdfSection);
}
