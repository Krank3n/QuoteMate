/**
 * Guards on the PDF shell CSS shared by every quote/invoice template.
 *
 * Two regressions this protects:
 *  1. A Google Fonts @import stalled Android's print WebView indefinitely —
 *     Preview PDF froze. printMediaCSS must stay free of remote resources.
 *  2. The compact-header logo cap dropped to 52px, making uploaded logos
 *     unreadably small no matter how large the source image was.
 *  3. Tradesman framed the logo in a border + white fill. On a
 *     background-removed PNG that reads as a generic "logo block" bolted into
 *     the corner rather than the business's own branding.
 */
import { describe, expect, it } from 'vitest';
import { printMediaCSS, getTemplateCSS } from './templates';

describe('printMediaCSS', () => {
  it('contains no remote resource imports (Android print bridge stalls on them)', () => {
    expect(printMediaCSS).not.toMatch(/@import/);
    expect(printMediaCSS).not.toMatch(/https?:\/\//);
  });

  it('caps the header logo at a readable size', () => {
    const match = printMediaCSS.match(/\.business-identity \.logo \{[^}]*\}/s);
    expect(match).toBeTruthy();
    const maxHeight = Number(match![0].match(/max-height:\s*(\d+)px/)?.[1]);
    const maxWidth = Number(match![0].match(/max-width:\s*(\d+)px/)?.[1]);
    expect(maxHeight).toBeGreaterThanOrEqual(72);
    expect(maxWidth).toBeGreaterThanOrEqual(220);
  });
});

describe('template logo caps', () => {
  it.each(['professional', 'clean', 'bold', 'tradesman'] as const)(
    '%s keeps logos at a readable size',
    (templateId) => {
      const css = getTemplateCSS(templateId);
      const match = css.match(/\.logo \{[^}]*\}/s);
      expect(match).toBeTruthy();
      const maxHeight = Number(match![0].match(/max-height:\s*(\d+)px/)?.[1]);
      expect(maxHeight).toBeGreaterThanOrEqual(72);
    },
  );
});

describe('logo framing on light-header templates', () => {
  // Bold is excluded on purpose: its header is dark (#1F2937), so the
  // translucent plate behind the logo is what keeps a dark logo visible.
  it.each(['professional', 'clean', 'tradesman'] as const)(
    '%s renders the logo unframed, not as a boxed-in block',
    (templateId) => {
      const css = getTemplateCSS(templateId);
      const rule = css.match(/\.logo \{[^}]*\}/s)![0];
      expect(rule).not.toMatch(/(^|[^-])border:\s*(?!none)/);
      expect(rule).not.toMatch(/background-color:\s*(?!transparent)/);
    },
  );
});
