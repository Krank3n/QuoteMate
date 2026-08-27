/**
 * Regression: the acceptance page shipped with TypeScript annotations
 * (`function(url: string)`) inside its inline browser script. Browsers fail
 * to parse the whole <script> block, so the page sat on "Loading quote..."
 * forever for every customer who opened an SMS/email link. Parse the inline
 * script here so a TS-ism can never silently ship again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every Firestore touch the handler makes is recorded here, so the GET tests
 * below can assert on the whole set rather than on one write they thought to
 * look for. Rate limiting is the one legitimate writer on this path (fail-open
 * bucket), so its entries are filtered out at the assertion, not here.
 */
const firestoreTouches: string[] = [];

function fakeDocRef(path: string): any {
  return {
    path,
    get: async () => {
      firestoreTouches.push(`get:${path}`);
      return { exists: false, data: () => undefined, ref: fakeDocRef(path) };
    },
    set: async () => { firestoreTouches.push(`set:${path}`); },
    update: async () => { firestoreTouches.push(`update:${path}`); },
    collection: (name: string) => fakeCollectionRef(`${path}/${name}`),
  };
}

function fakeCollectionRef(path: string): any {
  const self: any = {
    path,
    doc: (id?: string) => fakeDocRef(`${path}/${id ?? 'auto'}`),
    add: async () => { firestoreTouches.push(`add:${path}`); return fakeDocRef(`${path}/auto`); },
    where: () => self,
    limit: () => self,
    orderBy: () => self,
    get: async () => { firestoreTouches.push(`query:${path}`); return { empty: true, docs: [] }; },
  };
  return self;
}

// A function declaration, not a const: vi.mock factories are hoisted above
// every `const` in the file, and index.ts calls admin.firestore() at import.
function makeFakeDb(): any {
  return {
    collection: (name: string) => fakeCollectionRef(name),
    doc: (path: string) => fakeDocRef(path),
    batch: () => ({
      set: () => { firestoreTouches.push('batch.set'); },
      update: () => { firestoreTouches.push('batch.update'); },
      commit: async () => { firestoreTouches.push('batch.commit'); },
    }),
    runTransaction: async (fn: any) => {
      firestoreTouches.push('transaction:rateLimits');
      return fn({
        get: async (ref: any) => { firestoreTouches.push(`tx.get:${ref.path}`); return { data: () => undefined }; },
        set: (ref: any) => { firestoreTouches.push(`tx.set:${ref.path}`); },
      });
    },
  };
}

/** Copy a function's statics (admin.firestore.FieldValue and friends). */
function copyStatics(from: any, onto: any): any {
  for (const key of Object.getOwnPropertyNames(from)) {
    if (key === 'prototype' || key === 'length' || key === 'name') continue;
    try { onto[key] = from[key]; } catch { /* a getter that wants a live app */ }
  }
  return onto;
}

/**
 * firebase-admin exports a class INSTANCE — initializeApp, auth, messaging
 * and the rest live on its prototype, not as own properties. A spread (or any
 * own-property copy) therefore hands back an almost-empty module and index.ts
 * dies on admin.initializeApp() at import. Flatten the chain instead, binding
 * the methods back to the real namespace so they still work.
 */
function flattenNamespace(from: any): any {
  const out: any = {};
  for (let cur = from; cur && cur !== Object.prototype; cur = Object.getPrototypeOf(cur)) {
    for (const key of Object.getOwnPropertyNames(cur)) {
      if (key === 'constructor' || key in out) continue;
      try {
        const value = from[key];
        out[key] = typeof value === 'function' ? value.bind(from) : value;
      } catch { /* a getter that wants a live app */ }
    }
  }
  return out;
}

vi.mock('firebase-admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const base = actual.default ?? actual;
  const mock = flattenNamespace(base);
  mock.firestore = copyStatics(base.firestore, () => makeFakeDb());
  mock.default = mock;
  return mock;
});

vi.mock('./email', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendQuoteAcceptedEmail: vi.fn(async () => true),
    sendQuoteDeclinedEmail: vi.fn(async () => true),
  };
});

import { generateAcceptancePage, acceptancePageUrlForToken, quoteAcceptancePage } from './index';
import { sendQuoteAcceptedEmail, sendQuoteDeclinedEmail } from './email';

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no inline script found');
  return match[1];
}

/** Minimal Express double: captures the status + body the handler produces. */
function fakeRes() {
  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    finished,
    status(code: number) { res.statusCode = code; return res; },
    send(body: any) { res.body = body; settle(); return res; },
    json(body: any) { res.body = body; settle(); return res; },
    setHeader() { return res; },
  };
  return res;
}

async function getAcceptancePage(query: Record<string, string>) {
  const req: any = { method: 'GET', query, headers: {}, ip: '203.0.113.7' };
  const res = fakeRes();
  await (quoteAcceptancePage as any)(req, res);
  await res.finished;
  return res;
}

/** Everything the handler touched that isn't the fail-open rate-limit bucket. */
function nonRateLimitTouches(): string[] {
  return firestoreTouches.filter((t) => !t.includes('rateLimit'));
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

  it('discloses inclusive GST below the total, matching the PDF', () => {
    // Same rule as buildSummaryHTML: exclusive GST is an addend and sits in
    // the stack; inclusive GST is disclosure only and renders under the
    // total, where it can't be misread as one more figure to sum.
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    expect(script).toContain("gstMode === 'exclusive'");
    expect(script).toContain('Total includes GST of ');
    expect(script).not.toContain("'Includes GST'");
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

/**
 * The whole point of the fix: fetching a URL is not an answer.
 *
 * `?action=decline` used to be processed right here on the GET — status
 * flipped, respondedAt stamped (which locks the token forever), tradie
 * emailed and pushed. Outlook Safe Links, corporate mail scanners and browser
 * prefetchers all follow links in delivered email, so a live quote could be
 * declined, or accepted, by a machine that was only checking whether the link
 * was malicious. `?action=accept` was worse: it also materialises a Job and
 * can mint a Square deposit payment link.
 *
 * These assert on EVERY Firestore touch, not just the write we happened to
 * think of. Remove the fix and both fail.
 */
describe('quoteAcceptancePage — a GET never answers the quote', () => {
  const TOKEN = 'b'.repeat(64);

  beforeEach(() => {
    firestoreTouches.length = 0;
    vi.mocked(sendQuoteAcceptedEmail).mockClear();
    vi.mocked(sendQuoteDeclinedEmail).mockClear();
  });

  it('REGRESSION: ?action=decline records nothing and serves the review page', async () => {
    const res = await getAcceptancePage({ token: TOKEN, action: 'decline' });

    expect(nonRateLimitTouches()).toEqual([]);
    expect(sendQuoteDeclinedEmail).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    // The review page carrying the decline intent — not a confirmation that
    // the answer has already been taken.
    expect(res.body).toBe(generateAcceptancePage(TOKEN, 'decline'));
    expect(res.body).toContain('Loading your quote');
  });

  it('REGRESSION: ?action=accept records nothing and serves the review page', async () => {
    const res = await getAcceptancePage({ token: TOKEN, action: 'accept' });

    // No quote update, no Job document, no deposit payment link, no email.
    expect(nonRateLimitTouches()).toEqual([]);
    expect(sendQuoteAcceptedEmail).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(generateAcceptancePage(TOKEN, 'accept'));
    expect(res.body).toContain('Loading your quote');
  });

  it('serves the same review page for a bare link with no action', async () => {
    const res = await getAcceptancePage({ token: TOKEN });
    expect(nonRateLimitTouches()).toEqual([]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Loading your quote');
  });

  it('rejects a missing token before touching anything', async () => {
    const res = await getAcceptancePage({ action: 'decline' });
    expect(nonRateLimitTouches()).toEqual([]);
    expect(res.statusCode).toBe(400);
  });
});

describe('generateAcceptancePage — the email button arrives as an intent', () => {
  it('primes the Decline button and shows the confirmation step', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64), 'decline'));
    expect(script).toContain('var INTENT = "decline";');
    expect(script).toContain("btn.classList.add('btn-primed')");
    expect(script).toContain('One tap to go.');
  });

  it('primes the Accept button on an accept intent', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64), 'accept'));
    expect(script).toContain('var INTENT = "accept";');
  });

  it('carries no intent when the page is opened bare', () => {
    const script = inlineScript(generateAcceptancePage('a'.repeat(64)));
    expect(script).toContain('var INTENT = null;');
  });

  it('narrows the intent to the two known literals', () => {
    // The value lands inside a <script>, so it can never be whatever the
    // query string said. Anything unrecognised is simply no intent.
    const script = inlineScript(
      generateAcceptancePage('a'.repeat(64), '</script><script>alert(1)</script>' as any),
    );
    expect(script).toContain('var INTENT = null;');
    expect(script).not.toContain('alert(1)');
  });
});
