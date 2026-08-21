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
  // Bold is excluded on purpose: its header is dark (#1F2937), so the solid
  // white plate behind the logo is what keeps a dark logo visible — the old
  // translucent wash let dark wordmarks vanish into the header.
  it.each(['professional', 'clean', 'tradesman'] as const)(
    '%s renders the logo unframed, not as a boxed-in block',
    (templateId) => {
      const css = getTemplateCSS(templateId);
      const rule = css.match(/\.logo \{[^}]*\}/s)![0];
      expect(rule).not.toMatch(/(^|[^-])border:\s*(?!none)/);
      expect(rule).not.toMatch(/background-color:\s*(?!transparent)/);
    },
  );

  it('bold backs the logo with a solid white plate so dark artwork stays visible', () => {
    const rule = getTemplateCSS('bold').match(/\.logo \{[^}]*\}/s)![0];
    expect(rule).toContain('background-color: #FFFFFF');
    expect(rule).not.toMatch(/rgba\(/);
  });
});

describe('brand colour reaches the accent only', () => {
  // The old mechanism string-replaced the accent hex throughout the
  // stylesheet — but in Bold that hex was ALSO the body text colour, so an
  // amber brand turned every item name and price amber. The brand colour is
  // now a CSS custom property override that text colours never reference.
  it.each(['professional', 'clean', 'bold', 'tradesman', 'accredited'] as const)(
    '%s declares --accent and applies a brand colour as a var override',
    (templateId) => {
      const plain = getTemplateCSS(templateId);
      expect(plain).toContain('--accent:');
      const branded = getTemplateCSS(templateId, '#C2410C');
      expect(branded).toContain('body { --accent: #C2410C; }');
      // The override is appended, so it wins the cascade over the default.
      expect(branded.lastIndexOf('--accent: #C2410C')).toBeGreaterThan(branded.indexOf('--accent:'));
    },
  );

  it('bold keeps its body text dark under any brand colour', () => {
    const branded = getTemplateCSS('bold', '#F59E0B');
    // td text colour is a literal hex the override can never touch.
    expect(branded).toMatch(/td \{[^}]*color: #1F2937/s);
    expect(branded).not.toMatch(/td \{[^}]*color: var\(--accent\)/s);
  });

  it('clean keeps its muted contact-line grey under any brand colour', () => {
    const branded = getTemplateCSS('clean', '#F59E0B');
    expect(branded).toMatch(/\.header p \{[^}]*color: #6B7280/s);
  });

  it('ignores a brand colour that is not a hex colour', () => {
    const css = getTemplateCSS('professional', 'red; } body { display: none');
    expect(css).toBe(getTemplateCSS('professional'));
  });
});

describe('page chrome', () => {
  it('tradesman prints on white — a body tint can never reach the page margins', () => {
    expect(getTemplateCSS('tradesman')).toMatch(/body \{[^}]*background-color: #FFFFFF/s);
  });

  it('keeps a subtotal row glued to the rows it sums at a page break', () => {
    expect(printMediaCSS).toMatch(/\.total-row \{[^}]*break-before: avoid/s);
  });

  it('renders the section band as a non-repeating caption', () => {
    expect(printMediaCSS).toContain('caption.section-label');
    expect(printMediaCSS).toMatch(/caption\.section-label \{[^}]*caption-side: top/s);
  });

  it('resets the band letterform styling on section scope text', () => {
    const rule = printMediaCSS.match(/\.section-scope \{[^}]*\}/s)![0];
    expect(rule).toContain('text-transform: none');
    expect(rule).toContain('letter-spacing: normal');
  });

  it('right-aligns money via the .num class', () => {
    expect(printMediaCSS).toMatch(/\.num \{[^}]*text-align: right/s);
  });

  it('credit and disclosure rows out-rank the templates’ own .summary-row rules', () => {
    // Template stylesheets are concatenated AFTER printMediaCSS and set
    // .summary-row colour/size at the same specificity — a bare class here
    // silently loses on source order (the deposit green rendered black).
    expect(printMediaCSS).toMatch(/\.summary-row\.credit-row \{[^}]*color: #15803D/s);
    expect(printMediaCSS).toMatch(/\.summary-row\.summary-note \{/);
  });

  it.each(['professional', 'clean', 'bold', 'tradesman', 'accredited'] as const)(
    '%s styles TOTAL and BALANCE DUE with compound selectors that actually apply',
    (templateId) => {
      // Bare .grand-total/.balance-due lost to the template's own
      // .summary-row rule on source order — the TOTAL line had never
      // rendered its intended size or colour on any template.
      const css = getTemplateCSS(templateId);
      expect(css).toMatch(/\.summary-row\.grand-total \{/);
      expect(css).toMatch(/\.summary-row\.balance-due \{/);
      expect(css).not.toMatch(/ \.grand-total \{/);
      expect(css).not.toMatch(/ \.balance-due \{/);
    },
  );

  it('bold renders TOTAL in dark text — its summary card is white', () => {
    expect(getTemplateCSS('bold')).toMatch(/\.summary-row\.grand-total \{[^}]*color: #111827/s);
  });

  it('rejects hex strings of invalid length (5 or 7 digits)', () => {
    expect(getTemplateCSS('professional', '#abcde')).toBe(getTemplateCSS('professional'));
    expect(getTemplateCSS('professional', '#abcdef1')).toBe(getTemplateCSS('professional'));
    expect(getTemplateCSS('professional', '#abc')).toContain('--accent: #abc;');
  });

  it('trims a whitespace-padded brand colour instead of dropping it', () => {
    // The email path (safeBrandColor) trims; an untrimmed stored value must
    // not silently unbrand the PDF alone.
    expect(getTemplateCSS('professional', ' #C2410C ')).toContain('--accent: #C2410C;');
  });
});
