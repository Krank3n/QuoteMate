/**
 * Job Details on a quote or invoice whose sections carry the scope.
 *
 * When a tradie writes a numbered scope, each section prints its part of it
 * under the section heading. Printing the whole job description as well puts
 * the scope on the page twice. So Job Details prints a one-line note instead
 * — but ONLY when every line the tradie wrote already appears under a section
 * that prints. An exclusions list, a payment note or a reworded item is not
 * covered, and then the full description prints exactly as before: nothing
 * the tradie wrote can disappear from the customer's copy.
 */
import { isWrittenScope, parseListItem } from '../pricing/writtenScope';
import type { LaborSection, PdfMaterial } from './types';

export const SCOPE_BY_SECTION_NOTE = 'The scope of works is set out under each section below.';

/** Case, punctuation and spacing don't count when matching a line. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "SCOPE OF WORKS", "Scope of work:", "Bathroom works:" — a heading, not content. */
function isHeadingLine(line: string): boolean {
  const n = norm(line);
  if (/^(the )?scope( of works?)?$/.test(n)) return true;
  return /:\s*$/.test(line) && n.split(' ').length <= 6;
}

/**
 * Does every line of `description` appear in `printedScopes`?
 *
 * A numbered item with its own lines under it ("1. Waterproofing" then
 * "Supply and install Monsoon…") is a title: each title becomes a section
 * heading, so it needs no match of its own — its lines do.
 */
export function scopeCoveredBySections(description: string, printedScopes: string[]): boolean {
  if (!isWrittenScope(description) || printedScopes.length === 0) return false;
  const haystack = ` ${norm(printedScopes.join('\n'))} `;
  const lines = description.split(/\r?\n/).filter((l) => l.trim());
  let checked = 0;
  for (let i = 0; i < lines.length; i++) {
    const item = parseListItem(lines[i]);
    const next = i + 1 < lines.length ? lines[i + 1] : undefined;
    if (item && next !== undefined) {
      const child = parseListItem(next);
      const isTitle = !child || child.indent > item.indent || (item.numbered && !child.numbered);
      if (isTitle) continue;
    }
    if (!item && isHeadingLine(lines[i])) continue;
    const text = norm(item ? item.body : lines[i]);
    if (!text) continue;
    if (!haystack.includes(` ${text} `)) return false;
    checked++;
  }
  return checked > 0;
}

/**
 * The scope text that actually prints under a section heading: a section's
 * description is captioned on its materials table, so only sections that
 * some material belongs to count. (A labour-only section's text prints in
 * the labour block, which not every layout shows — leaving it out can only
 * keep the full description, never drop it.)
 */
export function printedSectionScopes(materials: PdfMaterial[], sections: LaborSection[] | undefined): string[] {
  const used = new Set(materials.map((m) => m.section).filter((s): s is string => !!s));
  return (sections || [])
    .filter((s) => used.has(s.name) && !!s.description?.trim())
    .map((s) => s.description!.trim());
}

/** True when Job Details should print SCOPE_BY_SECTION_NOTE instead of the description. */
export function sectionsCarryScope(
  doc: { job: { description: string }; materials: PdfMaterial[]; sections?: LaborSection[] },
  layout: { showLineItems: boolean; scopeMode: boolean },
): boolean {
  if (!layout.showLineItems || layout.scopeMode) return false;
  return scopeCoveredBySections(doc.job.description || '', printedSectionScopes(doc.materials, doc.sections));
}
