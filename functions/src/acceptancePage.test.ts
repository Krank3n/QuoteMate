/**
 * Regression: the acceptance page shipped with TypeScript annotations
 * (`function(url: string)`) inside its inline browser script. Browsers fail
 * to parse the whole <script> block, so the page sat on "Loading quote..."
 * forever for every customer who opened an SMS/email link. Parse the inline
 * script here so a TS-ism can never silently ship again.
 */
import { describe, expect, it } from 'vitest';
import { generateAcceptancePage, acceptancePageUrlForToken } from './index';

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no inline script found');
  return match[1];
}

describe('generateAcceptancePage', () => {
  it('embeds the token as a parseable, escaped JS literal', () => {
    const html = generateAcceptancePage("x'</script><script>alert(1)</script>");
    expect(html).not.toContain("x'</script><script>alert(1)");
  });

  it('ships an inline script the browser can parse', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    // new Function parses without executing — a SyntaxError here is exactly
    // what the customer's browser hit.
    expect(() => new Function(script)).not.toThrow();
  });

  it('contains no TypeScript annotations in the browser script', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    expect(script).not.toMatch(/function\s*\([^)]*:\s*[a-zA-Z]/);
  });

  it('offers a PDF download through the token-validated endpoint', () => {
    const html = generateAcceptancePage('a'.repeat(64));
    expect(html).toContain('Download PDF');
    expect(html).toContain("/downloadQuotePdf?token=' + encodeURIComponent(TOKEN)");
  });

  it('presents accept and decline actions and the quote shell', () => {
    const html = generateAcceptancePage('a'.repeat(64));
    expect(html).toContain('Accept quote');
    expect(html).toContain('Decline quote');
    expect(html).toContain('Loading your quote');
  });

  it('renders a Project Scope table when every line is a work item', () => {
    // Same derived rule as the PDF: all work items -> a numbered scope table
    // with no Qty column. The `new Function(script)` case above automatically
    // guards this new inline JS from a syntax error.
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    expect(script).toContain("m.kind === 'work'");
    expect(script).toContain('Project Scope');
    expect(script).toContain('Line Total');
  });

  it('gives the scope row number its own column, not the right-aligned Qty one', () => {
    // Reusing .qty put the digit flush against the title ("1Rinnai B26...")
    // because .line-items td carries zero horizontal padding.
    const html = generateAcceptancePage('a'.repeat(64));
    expect(html).toContain('<th class="num">#</th>');
    expect(inlineScript(html)).toContain('<td class="num">');
    expect(html).toMatch(/\.line-items th\.num, \.line-items td\.num \{[^}]*padding-right/);
  });

  it('drives the three presentation modes from priceDetail', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    expect(script).toContain("quote.priceDetail || 'itemised'");
    expect(script).toContain("priceDetail === 'itemised'");
    expect(script).toContain("priceDetail !== 'total'");
  });
});

describe('acceptancePageUrlForToken', () => {
  it('defaults to the Cloud Function URL', () => {
    delete process.env.QUOTE_LINK_BASE_URL;
    expect(acceptancePageUrlForToken('tok')).toBe(
      'https://us-central1-hansendev.cloudfunctions.net/quoteAcceptancePage?token=tok',
    );
  });

  it('uses the branded base when configured', () => {
    process.env.QUOTE_LINK_BASE_URL = 'https://quotemateapp.au/q/';
    expect(acceptancePageUrlForToken('tok')).toBe('https://quotemateapp.au/q?token=tok');
    delete process.env.QUOTE_LINK_BASE_URL;
  });
});
