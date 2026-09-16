/**
 * Pins where the job page puts its photos.
 *
 * Photos are job-level: a job can carry a quote and an invoice, after-photos
 * are about the work, and a job with no document yet still needs a home for
 * them. So JobPhotosCard sits directly under JobDetailHeader, inside the
 * header's WebContainer, and never inside the document (scope) card. It must
 * also keep both write paths wired, or edits to a photo on a sent quote
 * silently become view-only.
 *
 * ViewJobScreen needs the store, navigation and Firebase to render, so this
 * reads the source the way conditionalHooks.guard.test.ts does.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'ViewJobScreen.tsx'), 'utf8');

describe('ViewJobScreen photos card', () => {
  it('renders JobPhotosCard, not the bare strip', () => {
    expect(source).toMatch(/import \{ JobPhotosCard \} from '\.\.\/components\/JobPhotosCard';/);
    expect(source).not.toMatch(/JobPhotoStrip/);
    expect(source.match(/<JobPhotosCard\b/g)).toHaveLength(1);
  });

  it('puts the card directly under the job header, inside the header WebContainer', () => {
    const header = source.indexOf('<JobDetailHeader');
    const card = source.indexOf('<JobPhotosCard');
    expect(header).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(header);

    // Nothing else is rendered between the header closing and the card.
    const between = source.slice(source.indexOf('/>', header) + 2, card);
    expect(between.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim()).toBe('');

    // Same WebContainer as the header: no closing tag between them, and the
    // card closes before the container does.
    expect(between).not.toContain('</WebContainer>');
    const containerClose = source.indexOf('</WebContainer>', card);
    const cardClose = source.indexOf('/>', card);
    expect(cardClose).toBeLessThan(containerClose);

    // Never inside the document card.
    const scopeCard = source.indexOf('<JobScopeCard');
    expect(scopeCard).toBeGreaterThan(card);
  });

  it('wires both photo write paths', () => {
    const card = source.indexOf('<JobPhotosCard');
    const props = source.slice(card, source.indexOf('/>', card));
    expect(props).toContain('onJobPhotosChange={handleJobPhotosChange}');
    expect(props).toContain('onDocumentPhotosChange={handleDocumentPhotosChange}');
  });
});
