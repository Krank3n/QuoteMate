import { describe, it, expect } from 'vitest';
import { buildCrewInviteEmailHtml } from './email';
import { crewInviteEmailCopy, crewLinkPageUrl, isCrewEmail } from './crewTime.helpers';

describe('the crew invite email', () => {
  const url = crewLinkPageUrl('AbCdEfGhIjKlMnOpQrStUvWx12');

  it("comes from the business, greets the worker by first name, and says the boss approves", () => {
    const copy = crewInviteEmailCopy('Jake Smith', 'Rivo Plumbing');
    expect(copy.subject).toBe('Your hours link for Rivo Plumbing');
    expect(copy.greeting).toBe("G'day Jake,");
    expect(copy.paragraphs.join(' ')).toMatch(/No app to install/);
    expect(copy.paragraphs.join(' ')).toMatch(/approves them/);
    expect(copy.button).toBe('Put your hours in');
  });

  it('links to the branded /t page with the token, and carries no app name', () => {
    const { subject, html } = buildCrewInviteEmailHtml({ crewName: 'Jake', business: { businessName: 'Rivo Plumbing' }, url });
    expect(url).toBe('https://quotemateapp.au/t?token=AbCdEfGhIjKlMnOpQrStUvWx12');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('Rivo Plumbing');
    expect(`${subject} ${html.replace(/https:\/\/quotemateapp\.au\/t\?token=[\w-]+/g, '')}`).not.toMatch(/QuoteMate/i);
  });

  it("escapes what the owner typed", () => {
    const { html } = buildCrewInviteEmailHtml({ crewName: '<b>Jake</b>', business: { businessName: 'A & B "Plumbing"' }, url });
    expect(html).toContain('&lt;b&gt;Jake&lt;/b&gt;');
    expect(html).not.toContain('<b>Jake</b>');
    expect(html).toContain('A &amp; B');
  });

  it('falls back gracefully with no names', () => {
    const copy = crewInviteEmailCopy('', '');
    expect(copy.greeting).toBe("G'day there,");
    expect(copy.subject).toBe('Your hours link for Your boss');
  });
});

describe('where an invite may go', () => {
  it('one plausible address only', () => {
    expect(isCrewEmail('jake@rivo.com.au')).toBe(true);
    for (const bad of ['', 'jake', 'jake@rivo', 'a@b.c', 'a@b.com, c@d.com', 'a b@c.com', 'x@y.com<script>', 42]) {
      expect(isCrewEmail(bad as any), String(bad)).toBe(false);
    }
  });
});
