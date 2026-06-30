/**
 * Lead Outreach — automated lead discovery + personalised cold email pipeline.
 *
 * Pipeline stages (status field on leads/{leadId}):
 *   new → researched → queued → sent → engaged → replied → converted
 *                                                       ↘ dnc / bounced / rejected
 *
 * Goal: "human as possible without the human". Every send is reviewed by an
 * admin before it goes out. Personalisation comes from per-lead website
 * scraping + Claude extraction of owner name + 2-4 specific hooks.
 *
 * Sources (per planning doc):
 *   - Google Places API (primary lead source) — paid, structured, legal
 *   - Website scrape via fetch + cheerio (enrichment for each lead)
 *   - FB/IG (deferred — fragile)
 *
 * Channel: email only (no SMS — AU Spam Act tighter for cold SMS, and tradies
 * dismiss it). Sends route through existing sendEmail() in email.ts which
 * already handles Brevo + emailLog + open/click tracking.
 *
 * Compliance:
 *   - Every cold send is tagged 'lead_outreach' so email.ts injects the
 *     AU-compliant footer (sender identity + physical address + unsubscribe).
 *   - leadSuppression collection is checked before every send (DNC, bounced,
 *     replied-stop, existing user).
 *   - Existing brevoEmailWebhook is extended to flip lead status on
 *     opens/clicks/unsubscribes/bounces.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sendEmail } from './email';

const db = () => admin.firestore();

// ============================================================
// AUTH + AUDIT (mirrored from adminCrm.ts; keep duplication tiny vs cross-file dep)
// ============================================================

function requireAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  const isAdmin = context.auth?.token?.admin === true;
  if (!uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return uid;
}

async function logAdminAction(params: {
  adminUid: string;
  action: string;
  targetType: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().collection('adminAuditLog').add({
      ...params,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('leadOutreach audit log failed', err);
  }
}

// ============================================================
// TYPES
// ============================================================

export const TRADES = [
  'fencer',
  'landscaper',
  'deck-builder',
  'plumber',
  'electrician',
  'hvac',
  'carpenter',
  'cabinet-maker',
  'painter',
  'roofer',
  'flooring',
  'cleaner',
  'pest-control',
  'handyman',
] as const;
type Trade = typeof TRADES[number];

type LeadStatus =
  | 'new'
  | 'researching'
  | 'researched'
  | 'queued'
  | 'sent'
  | 'engaged'
  | 'replied'
  | 'converted'
  | 'rejected'
  | 'dnc'
  | 'bounced'
  | 'no_email';

interface PersonalizationHook {
  text: string;
  source?: string; // URL or label, e.g. 'website-about', 'gmaps-review'
}

const TRADE_QUERY: Record<Trade, string[]> = {
  'fencer': ['fencing contractor', 'fence installation'],
  'landscaper': ['landscaper', 'landscape design'],
  'deck-builder': ['deck builder', 'decking contractor'],
  'plumber': ['plumber', 'plumbing contractor'],
  'electrician': ['electrician', 'electrical contractor'],
  'hvac': ['air conditioning installation', 'air conditioning contractor'],
  'carpenter': ['carpenter', 'carpentry contractor'],
  'cabinet-maker': ['cabinet maker', 'kitchen joinery', 'custom cabinetry'],
  'painter': ['painter', 'painting contractor'],
  'roofer': ['roofer', 'roofing contractor'],
  'flooring': ['flooring installer', 'flooring contractor'],
  'cleaner': ['commercial cleaner', 'cleaning service'],
  'pest-control': ['pest control', 'pest control service'],
  'handyman': ['handyman', 'handyman service'],
};

// Per-trade hook lines — fed to Claude as input, NOT pasted verbatim.
// Rules embedded here: only name a specific supplier when it's the right one
// for that trade. Reece = plumbing/irrigation only. Bunnings is fine as a
// general timber/hardware reference but "your local suppliers" reads less
// salesy and stays accurate when the user has custom suppliers wired up.
const TRADE_PITCH: Record<Trade, string> = {
  'fencer':
    'Pickets, posts, palings, screws — live pricing from your local suppliers baked in, plus accurate qty (palings, posts, screws, concrete) for the run length you describe.',
  'landscaper':
    'Mulch, soil, plants, edging — live pricing from your local suppliers, plus Reece for any irrigation/sprinkler work. Describe the job, get the quote.',
  'deck-builder':
    'Merbau or treated pine, joists, bearers, screws — live pricing from your local suppliers, plus accurate joist + screw qty from the deck dimensions you describe.',
  'plumber':
    'Pipes, fittings, fixtures, valves — live pricing from Reece baked in, plus accurate fitting + run qty from the points and metres you describe. Describe the job, get the quote.',
  'electrician':
    'Cable, conduit, GPOs, switchboards — live pricing from your local suppliers, plus accurate cable run + accessory qty from the points and circuits you describe.',
  'hvac':
    'Splits, ducting, brackets, refrigerant lines — live pricing from your local suppliers, plus accurate qty for the rooms and capacity you describe. Describe the job, get the quote.',
  'carpenter':
    'Framing timber, sheet goods, fixings — live pricing from your local suppliers, plus accurate qty for the framing, lining or trim work you describe.',
  'cabinet-maker':
    'Board, edging, hinges, runners, handles — live pricing from Hettich, Polytec, Laminex and your local suppliers, plus accurate linear-metre + hardware qty from the kitchen, wardrobe or vanity you describe.',
  'painter':
    'Paint, primer, prep gear, drop sheets — live pricing from your local suppliers, plus accurate paint qty (litres + coats) from the wall and ceiling areas you describe.',
  'roofer':
    'Sheets, ridges, flashings, screws — live pricing from your local suppliers, plus accurate sheet + screw qty from the roof dimensions and pitch you describe.',
  'flooring':
    'Planks, underlay, trim, adhesives — live pricing from your local suppliers, plus accurate qty (with waste factor) from the room dimensions you describe.',
  'cleaner':
    'Time on site, consumables, bond-clean checklists — describe the property and scope and get a quote that lines up with how you actually price, not a flat hourly rate.',
  'pest-control':
    'Treatments, bait, callout time — describe the property and pest type and get a quote with accurate product qty + time, not a generic flat fee.',
  'handyman':
    'Mixed materials and labour — describe the job, live supplier pricing for the bits you need, accurate time estimate for the work. Quote in minutes, not hours.',
};

// ============================================================
// HELPERS — normalisation, dedupe, suppression
// ============================================================

function normaliseEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

function domainOf(email: string | null | undefined): string | null {
  const e = normaliseEmail(email);
  if (!e) return null;
  return e.split('@')[1] || null;
}

function normaliseBusinessKey(name: string | null | undefined, suburb: string | null | undefined): string {
  const n = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const s = (suburb || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${n}::${s}`;
}

async function findExistingUserByEmail(email: string): Promise<string | null> {
  const e = normaliseEmail(email);
  if (!e) return null;
  try {
    const rec = await admin.auth().getUserByEmail(e);
    return rec.uid;
  } catch {
    return null;
  }
}

async function isSuppressed(keys: { email?: string; domain?: string; phone?: string; placeId?: string }): Promise<{ suppressed: boolean; reason?: string }> {
  const checks: Array<{ id: string; type: string }> = [];
  if (keys.email) checks.push({ id: `email:${keys.email}`, type: 'email' });
  if (keys.domain) checks.push({ id: `domain:${keys.domain}`, type: 'domain' });
  if (keys.phone) checks.push({ id: `phone:${keys.phone}`, type: 'phone' });
  if (keys.placeId) checks.push({ id: `placeId:${keys.placeId}`, type: 'placeId' });
  for (const c of checks) {
    const snap = await db().doc(`leadSuppression/${c.id}`).get();
    if (snap.exists) return { suppressed: true, reason: (snap.data() as any)?.reason || 'suppressed' };
  }
  return { suppressed: false };
}

async function addSuppression(params: { type: 'email' | 'domain' | 'phone' | 'placeId'; value: string; reason: string }): Promise<void> {
  const id = `${params.type}:${params.value}`;
  await db().doc(`leadSuppression/${id}`).set({
    type: params.type,
    value: params.value,
    reason: params.reason,
    at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ============================================================
// CLAUDE PROXY — uses ANTHROPIC_API_KEY env (Firebase only, per memory note)
// ============================================================

interface ClaudeJSONResult<T> {
  ok: true;
  data: T;
}
interface ClaudeJSONError {
  ok: false;
  error: string;
}

async function callClaudeJSON<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<ClaudeJSONResult<T> | ClaudeJSONError> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };

  const model = opts.model || 'claude-sonnet-4-5';
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens || 1024,
        temperature: opts.temperature ?? 0.3,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });
    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      return { ok: false, error: `claude-${response.status}: ${txt.slice(0, 300)}` };
    }
    const body: any = await response.json();
    const text = body?.content?.[0]?.text || '';
    // Extract first JSON block (Claude sometimes wraps in fences)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, text];
    const raw = jsonMatch[1] || text;
    try {
      const parsed = JSON.parse(raw.trim());
      return { ok: true, data: parsed as T };
    } catch (e: any) {
      return { ok: false, error: `claude-parse: ${e?.message || 'bad JSON'} :: ${raw.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { ok: false, error: `claude-network: ${e?.message || 'unknown'}` };
  }
}

// ============================================================
// GOOGLE PLACES API — Text Search + Place Details
// ============================================================
//
// Uses the legacy Places API endpoints (cheap & well-documented). Set
// GOOGLE_PLACES_API_KEY in Firebase env. Costs: ~$32/1000 Text Search +
// ~$17/1000 Place Details. Budget ~$0.05/lead at the volumes we care about.

interface PlacesSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
}

interface PlacesDetailsResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
  reviews?: Array<{
    author_name?: string;
    rating?: number;
    relative_time_description?: string;
    text?: string;
    time?: number;
  }>;
  editorial_summary?: { overview?: string };
  types?: string[];
  business_status?: string;
}

async function placesTextSearch(query: string): Promise<PlacesSearchResult[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'GOOGLE_PLACES_API_KEY not configured');
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=au&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new functions.https.HttpsError('internal', `places textsearch ${res.status}: ${t.slice(0, 200)}`);
  }
  const body: any = await res.json();
  if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw new functions.https.HttpsError('internal', `places textsearch status: ${body.status}: ${body.error_message || ''}`);
  }
  return (body.results || []) as PlacesSearchResult[];
}

async function placesDetails(placeId: string): Promise<PlacesDetailsResult | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'GOOGLE_PLACES_API_KEY not configured');
  const fields = [
    'place_id', 'name', 'formatted_address', 'formatted_phone_number',
    'international_phone_number', 'website', 'rating', 'user_ratings_total',
    'address_components', 'reviews', 'editorial_summary', 'types', 'business_status',
  ].join(',');
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body: any = await res.json();
  if (body.status !== 'OK') return null;
  return body.result as PlacesDetailsResult;
}

function pickFromAddressComponents(comps: PlacesDetailsResult['address_components'] | undefined, type: string): string | null {
  if (!comps) return null;
  const m = comps.find(c => c.types.includes(type));
  return m?.long_name || null;
}

// ============================================================
// WEBSITE ENRICHMENT — fetch + cheerio + Claude extraction
// ============================================================

async function fetchPage(url: string, timeoutMs = 10_000): Promise<string | null> {
  // Real browser UA — many sites (Wix, Squarespace, Cloudflare) serve a stripped
  // page or 403 to anything that looks like a bot.
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal as any,
      headers,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    const text = await res.text();
    return text.length > 800_000 ? text.slice(0, 800_000) : text;
  } catch {
    return null;
  }
}

interface ScrapedSiteContent {
  title: string;
  description: string;
  textBlocks: string[]; // visible text from main pages (compacted)
  jsonLd: any[]; // raw JSON-LD blocks (often has owner/about/services for Wix etc.)
  metaTags: Record<string, string>; // og:*, twitter:*, etc.
  emails: string[];
  mobiles: string[];
  socials: { facebook?: string; instagram?: string };
  pages: Array<{ url: string; ok: boolean; bytes: number }>;
}

function extractSiteContent(rootUrl: string, htmls: Array<{ url: string; html: string | null }>): ScrapedSiteContent {
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  const textBlocks: string[] = [];
  const jsonLd: any[] = [];
  const metaTags: Record<string, string> = {};
  const pages: Array<{ url: string; ok: boolean; bytes: number }> = [];
  let title = '';
  let description = '';
  let facebook: string | undefined;
  let instagram: string | undefined;

  for (const { url, html } of htmls) {
    if (!html) {
      pages.push({ url, ok: false, bytes: 0 });
      continue;
    }
    pages.push({ url, ok: true, bytes: html.length });
    const $ = cheerio.load(html);

    // JSON-LD often has { "@type": "LocalBusiness", "name", "address", "founder", "description", "areaServed", ... }
    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of arr) jsonLd.push(item);
      } catch {
        // ignore malformed JSON-LD
      }
    });

    // Meta tags before stripping
    $('meta').each((_i, el) => {
      const name = ($(el).attr('name') || $(el).attr('property') || '').toLowerCase();
      const content = ($(el).attr('content') || '').trim();
      if (!name || !content) return;
      if (/^(og:|twitter:|description|keywords|author|geo\.)/.test(name) && !metaTags[name]) {
        metaTags[name] = content.slice(0, 500);
      }
    });

    if (!title) title = $('title').first().text().trim().slice(0, 200);
    if (!description) {
      description = (metaTags['description'] || metaTags['og:description'] || metaTags['twitter:description'] || '').slice(0, 400);
    }

    // Emails BEFORE stripping scripts — Wix often has email in JSON inside <script>
    $('a[href^="mailto:"]').each((_i, el) => {
      const e = ($(el).attr('href') || '').replace(/^mailto:/, '').split('?')[0];
      const n = normaliseEmail(e);
      if (n) emails.add(n);
    });
    const rawText = (html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) as string[];
    for (const e of rawText) {
      const n = normaliseEmail(e);
      // Skip generic Wix/Squarespace tracking emails
      if (!n || /\.wix\.com$/.test(n) || /\.squarespace\.com$/.test(n) || /^.*@example\./.test(n) || /sentry\.io$/.test(n)) continue;
      emails.add(n);
    }

    // Australian mobile
    const mobileMatches = (html.match(/(?:\+?61\s?|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}/g) || []) as string[];
    for (const m of mobileMatches) {
      mobiles.add(m.replace(/[\s-]/g, '').replace(/^\+?61/, '0'));
    }

    // Socials
    $('a[href]').each((_i, el) => {
      const href = ($(el).attr('href') || '').toLowerCase();
      if (!facebook && /facebook\.com\/[a-z0-9.\-_]+/.test(href)) facebook = href.split('?')[0];
      if (!instagram && /instagram\.com\/[a-z0-9.\-_]+/.test(href)) instagram = href.split('?')[0];
    });

    // NOW strip noise + extract visible text. Prefer headings + paragraphs (signal-rich)
    // over raw body() (which includes nav, footer, cookie banners).
    $('script, style, noscript, svg, header nav, footer').remove();
    const headings = $('h1, h2, h3').map((_i, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 30);
    const paras = $('p, li').map((_i, el) => $(el).text().trim()).get().filter(t => t.length > 20).slice(0, 60);
    const combined = [...headings, ...paras].join(' \n ').replace(/\s+/g, ' ').replace(/ \n /g, '\n').trim();
    if (combined) {
      textBlocks.push(combined.slice(0, 10_000));
    } else {
      // Fallback: raw body text if structured extraction got nothing
      const body = $('body').text().replace(/\s+/g, ' ').trim();
      if (body) textBlocks.push(body.slice(0, 10_000));
    }
  }

  return {
    title,
    description,
    textBlocks,
    jsonLd,
    metaTags,
    emails: Array.from(emails).slice(0, 5),
    mobiles: Array.from(mobiles).slice(0, 3),
    socials: { facebook, instagram },
    pages,
  };
}

async function scrapeWebsite(rootUrl: string): Promise<ScrapedSiteContent | null> {
  let base: URL;
  try {
    base = new URL(rootUrl.startsWith('http') ? rootUrl : `https://${rootUrl}`);
  } catch {
    return null;
  }
  const candidates = [
    base.toString(),
    new URL('/about', base).toString(),
    new URL('/about-us', base).toString(),
    new URL('/contact', base).toString(),
    new URL('/services', base).toString(),
  ];
  const seen = new Set<string>();
  const uniqueUrls = candidates.filter(u => {
    const norm = u.replace(/\/$/, '');
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
  // Fetch in parallel — sequential was 5×10s = 50s worst case, blowing the timeout.
  const htmls = await Promise.all(uniqueUrls.map(async u => ({ url: u, html: await fetchPage(u) })));
  if (htmls.every(h => !h.html)) return null;
  return extractSiteContent(rootUrl, htmls);
}

interface ClaudeEnrichment {
  ownerName: string | null;
  ownerNameSource: 'about-page' | 'guess' | null;
  enrichmentSummary: string; // 1 paragraph, ≤ 200 chars
  personalizationHooks: PersonalizationHook[]; // 2-4 items
  confidence: 'low' | 'medium' | 'high';
}

async function claudeEnrich(input: {
  businessName: string;
  trade: Trade;
  suburb: string | null;
  websiteUrl: string | null;
  scraped: ScrapedSiteContent | null;
  googleReviews: Array<{ author: string | null; rating: number | null; text: string; when: string | null }>;
  googleEditorialSummary: string | null;
  googleTypes: string[];
}): Promise<ClaudeEnrichment | null> {
  const system = `You are extracting concrete, useful facts about an Australian tradie business to support a tasteful, human-sounding cold outreach. The reader is the business owner. Output strict JSON only — no prose, no markdown fences. Schema:
{
  "ownerName": string|null,           // First name only of the owner/operator if confidently named (about page, email like ivan@<domain>, signoff "— Tom", review reply signed by, JSON-LD founder). null if uncertain.
  "ownerNameSource": "about-page"|"email-prefix"|"review-reply"|"json-ld"|"guess"|null,
  "enrichmentSummary": string,        // <= 200 chars, factual sentence summary including specifics: trade niche, suburb, years/scale, materials.
  "personalizationHooks": [           // 2-4 SPECIFIC factual hooks usable to open a personal email. Each must reference something concrete. Cite source.
    { "text": string, "source": string }
  ],
  "confidence": "low"|"medium"|"high"
}
What counts as a SPECIFIC hook (good):
- "Recent reviewer Sarah praised your team's installation of a Colorbond fence in Bondi"
- "Specialise in pool fencing — mentioned three times across reviews"
- "Established 2024, already 105 projects completed per the homepage"
- "Owner Ivan replies personally to Google reviews"
- "Customers note your '1-3 day turnaround' as a standout"
NOT specific (bad — never produce these):
- "Provides quality fencing services"
- "Customer-focused approach"
- "Operating in Sydney"
- "Skilled team"

Rules:
- ALWAYS prefer hooks from Google reviews (real customer language) over website marketing copy.
- If the website content is sparse but reviews exist, that's still HIGH confidence — reviews are the gold mine.
- Never invent facts, dates, or names. If unsure, leave null / lower confidence.
- ownerName: prefer email prefix (e.g. ivan@bestfence.com.au → "Ivan") if the email looks personal, not info@/contact@/admin@.`;

  const blocks = (input.scraped?.textBlocks || []).join('\n---\n').slice(0, 10_000);

  const reviewsText = input.googleReviews.length
    ? input.googleReviews.map(r => `[${r.rating}★ from ${r.author || 'anon'}, ${r.when || ''}] ${r.text}`).join('\n\n')
    : '(no reviews on Google)';

  const jsonLdText = (input.scraped?.jsonLd || []).length
    ? JSON.stringify((input.scraped?.jsonLd || []).slice(0, 3)).slice(0, 3000)
    : '(none)';

  const metaTagsText = input.scraped?.metaTags && Object.keys(input.scraped.metaTags).length
    ? Object.entries(input.scraped.metaTags).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '(none)';

  const detectedEmails = (input.scraped?.emails || []).join(', ') || '(none)';

  const user = `Business: ${input.businessName}
Trade category: ${input.trade}
Suburb: ${input.suburb || 'unknown'}
Website: ${input.websiteUrl || 'none'}
Google business types: ${(input.googleTypes || []).join(', ') || 'unknown'}
${input.googleEditorialSummary ? `Google editorial summary: ${input.googleEditorialSummary}` : ''}

=== GOOGLE REVIEWS (use these for hooks — real customer language) ===
${reviewsText}

=== Website detected emails ===
${detectedEmails}

=== Website title tag ===
${input.scraped?.title || '(none)'}

=== Website meta tags ===
${metaTagsText}

=== Website JSON-LD ===
${jsonLdText}

=== Website page text ===
${blocks || '(no scraped page content — site likely JS-rendered or blocked our crawl. Lean heavily on the Google reviews above.)'}`;

  const r = await callClaudeJSON<ClaudeEnrichment>({ system, user, maxTokens: 1500, temperature: 0.3 });
  if (!r.ok) {
    console.warn('claudeEnrich failed:', r.error);
    return null;
  }
  return r.data;
}

interface ClaudeMessage {
  subject: string;
  body: string; // plaintext-style HTML — paragraphs separated by <br><br>
}

async function claudeGenerateMessage(input: {
  businessName: string;
  ownerName: string | null;
  ownerNameSource: string | null;
  enrichmentConfidence: 'low' | 'medium' | 'high' | null;
  trade: Trade;
  suburb: string | null;
  hooks: PersonalizationHook[];
  enrichmentSummary: string;
}): Promise<ClaudeMessage | null> {
  // Guard against using a guessed/low-confidence owner name. Many small trade
  // businesses are family trusts or partnerships — the inbox isn't always the
  // person whose name is on the website. Wrong-name = instant red flag.
  const safeOwnerName = (
    input.ownerName
    && input.ownerNameSource
    && input.ownerNameSource !== 'guess'
    && input.enrichmentConfidence !== 'low'
  ) ? input.ownerName : null;

  const system = `You write short cold outreach emails on behalf of Tom, the maker of QuoteMate — a quoting + invoicing app for Australian tradies. The reader is a working tradie. Tone: a mate emailing, not a marketer. The reader will smell automation immediately and dismiss the brand if you sound generic.

Hard rules:
- Total body ≤ 80 words (excluding the single inline link mentioned below).
- Open by referencing the SPECIFIC personalization hook provided. Not "saw your website and was impressed" — name the actual thing.
- Never use the word "AI" anywhere. Use "smart", "describes", "suggests" instead if you need to.
- SUBJECT RULE: 3-6 words, lowercase except proper nouns. Must NOT mimic a customer inquiry — that gets opens but burns trust the moment they realise it's a pitch. NEVER use subjects like "fencing quotes in [city]", "fence repair", "need a quote", "[trade] services". Instead reference the personalisation hook or the speed/efficiency angle. GOOD examples: "loved your bondi install", "speeding up sydney fencing quotes", "fencing quotes by the metre", "saw your colorbond work". BAD examples: "fencing quotes in sydney" (looks like a customer lead), "quick question" (lazy), "Hi {name}" (lazy).
- Sign off "Tom" only. No company sig, no taglines.
- Plaintext-style HTML — paragraphs separated by <br><br>. No styling, no images, no buttons.
- Must include a one-line pitch using the trade-specific hook provided.
- NAME RULE: If ownerName is "(unknown)" you MUST open with "Hey team" or "Hi there" or the business name — NEVER invent or guess a name. Many tradie inboxes are managed by a partner/spouse/admin, so a wrong name reads as automation.
- SUPPLIER RULE: Use the supplier wording from the trade-specific hook AS IS. Do not add or substitute supplier names. Reece is plumbing/irrigation only — never mention Reece for fencing, decking, carpentry, painting, or any trade that doesn't touch water. "Your local suppliers" is the safe default when a specific name isn't in the hook.
- LINK RULE: Include EXACTLY ONE link in the body, woven in naturally so the lurker can self-serve without replying. Format as <a href="https://quotemateapp.au">quotemateapp.au</a>. Examples: "It's at <a href=\\"https://quotemateapp.au\\">quotemateapp.au</a> if you want a peek." or "Have a look at <a href=\\"https://quotemateapp.au\\">quotemateapp.au</a> — iOS + Android.". Don't make it the main CTA; the reply ask is.
- CTA RULE: One soft reply CTA at the end, like "Worth a look?" or "Keen for the link if useful?". Reply, not call/meeting.

Output strict JSON only — no markdown fences:
{ "subject": string, "body": string }`;

  const hooksList = (input.hooks || [])
    .map(h => `- ${h.text}${h.source ? ` (source: ${h.source})` : ''}`)
    .join('\n');

  const user = `Business: ${input.businessName}
Owner first name: ${safeOwnerName || '(unknown)'}
Trade: ${input.trade}
Suburb: ${input.suburb || 'unknown'}
Summary: ${input.enrichmentSummary}

Specific hooks (open with the strongest one, factually):
${hooksList || '(none — keep open generic-but-friendly)'}

Trade-specific pitch line to use (paraphrase, do not paste verbatim):
${TRADE_PITCH[input.trade]}

Include the website link <a href="https://quotemateapp.au">quotemateapp.au</a> woven naturally into the body (one place only — see LINK RULE). Mention iOS + Android once if it fits without being clunky. Make it sound human and dashed off, not polished marketing copy.`;

  const r = await callClaudeJSON<ClaudeMessage>({ system, user, maxTokens: 800, temperature: 0.6 });
  if (!r.ok) {
    console.warn('claudeGenerateMessage failed:', r.error);
    return null;
  }
  return r.data;
}

// ============================================================
// 1. adminLeadDiscovery — Google Places search → leads/{id} status='new'
// ============================================================

export const adminLeadDiscovery = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const trade = String(data?.trade || '') as Trade;
    const suburbs: string[] = Array.isArray(data?.suburbs) ? data.suburbs.filter((s: any) => typeof s === 'string') : [];
    const maxResults = Math.max(1, Math.min(Number(data?.maxResults) || 25, 60));
    const dryRun = data?.dryRun === true;

    if (!TRADE_QUERY[trade]) {
      throw new functions.https.HttpsError('invalid-argument', `trade must be one of: ${TRADES.join(' | ')}`);
    }
    if (!suburbs.length) {
      throw new functions.https.HttpsError('invalid-argument', 'suburbs[] required');
    }

    const campaignRef = db().collection('leadCampaigns').doc();
    const campaignId = campaignRef.id;
    if (!dryRun) {
      await campaignRef.set({
        trade,
        suburbs,
        requestedBy: adminUid,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        leadsCreated: 0,
        status: 'running',
      });
    }

    let created = 0;
    let dedupedExisting = 0;
    let dedupedSuppressed = 0;
    let dedupedExistingUser = 0;
    let placeFetchFailures = 0;
    const sample: any[] = [];
    const searchErrors: string[] = [];

    for (const suburb of suburbs) {
      for (const phrase of TRADE_QUERY[trade]) {
        const query = `${phrase} ${suburb}`;
        let results: PlacesSearchResult[] = [];
        try {
          results = await placesTextSearch(query);
        } catch (e: any) {
          const msg = e?.message || String(e);
          console.warn(`places search failed for "${query}": ${msg}`);
          // Capture the first distinct error verbatim so it surfaces in the UI.
          if (searchErrors.length < 3 && !searchErrors.includes(msg)) {
            searchErrors.push(msg);
          }
          continue;
        }

        for (const r of results.slice(0, maxResults)) {
          if (created + dedupedExisting + dedupedSuppressed + dedupedExistingUser >= maxResults * suburbs.length) break;

          // Dedupe by placeId first
          const placeIdMatch = await db().collection('leads').where('googlePlaceId', '==', r.place_id).limit(1).get();
          if (!placeIdMatch.empty) { dedupedExisting++; continue; }

          const supByPlace = await isSuppressed({ placeId: r.place_id });
          if (supByPlace.suppressed) { dedupedSuppressed++; continue; }

          // Business-name dedupe (cheap query — placeId already deduped above)
          const bizKey = normaliseBusinessKey(r.name, suburb);
          if (bizKey) {
            const bizMatch = await db().collection('leads').where('businessKey', '==', bizKey).limit(1).get();
            if (!bizMatch.empty) { dedupedExisting++; continue; }
          }

          // Place Details for phone + website + address. Website *content* is
          // scraped later by adminEnrichLeads — discovery stays fast (no fetches
          // here, no Claude here).
          const det = await placesDetails(r.place_id);
          if (!det) { placeFetchFailures++; continue; }

          const phone = det.formatted_phone_number || null;
          const intlPhone = det.international_phone_number || null;
          const website = det.website || null;
          const state = pickFromAddressComponents(det.address_components, 'administrative_area_level_1');
          const postcode = pickFromAddressComponents(det.address_components, 'postal_code');
          const reviews = (det.reviews || []).slice(0, 5).map(rev => ({
            author: rev.author_name || null,
            rating: rev.rating ?? null,
            text: (rev.text || '').slice(0, 800),
            when: rev.relative_time_description || null,
          })).filter(rev => rev.text);

          const leadDoc: any = {
            businessName: r.name,
            businessKey: bizKey,
            trade,
            ownerName: null,
            ownerNameSource: null,
            email: null,
            phone,
            mobile: null,
            internationalPhone: intlPhone,
            address: det.formatted_address || null,
            suburb,
            state: state || 'NSW',
            postcode: postcode || null,
            websiteUrl: website,
            facebookUrl: null,
            instagramUrl: null,
            googlePlaceId: r.place_id,
            googleRating: det.rating ?? null,
            googleReviewCount: det.user_ratings_total ?? null,
            googleReviews: reviews,
            googleEditorialSummary: det.editorial_summary?.overview || null,
            googleTypes: det.types || [],
            source: 'gmaps' as const,
            sourceUrl: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
            status: 'new' as LeadStatus,
            campaignId,
            scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (dryRun) {
            sample.push({ ...leadDoc, scrapedAt: undefined, createdAt: undefined });
            created++; // count it for the dry-run total even though we don't write
            continue;
          }

          await db().collection('leads').add(leadDoc);
          created++;
        }
      }
    }

    if (!dryRun) {
      await campaignRef.set({
        leadsCreated: created,
        dedupedExisting,
        dedupedSuppressed,
        dedupedExistingUser,
        placeFetchFailures,
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await logAdminAction({
      adminUid,
      action: 'lead_discovery',
      targetType: 'lead_campaign',
      targetId: campaignId,
      payload: { trade, suburbs, maxResults, created, dedupedExisting, dedupedSuppressed, dedupedExistingUser, dryRun },
    });

    return {
      ok: true,
      campaignId: dryRun ? null : campaignId,
      created,
      dedupedExisting,
      dedupedSuppressed,
      dedupedExistingUser,
      placeFetchFailures,
      searchErrors,
      sample: dryRun ? sample.slice(0, 10) : undefined,
    };
  });

// ============================================================
// 2. adminEnrichLeads — fetch sites + Claude extract owner + hooks
// ============================================================

export const adminEnrichLeads = functions
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const leadIds: string[] = Array.isArray(data?.leadIds) ? data.leadIds.filter((s: any) => typeof s === 'string') : [];
    if (!leadIds.length) {
      throw new functions.https.HttpsError('invalid-argument', 'leadIds[] required');
    }

    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    for (const leadId of leadIds) {
      const ref = db().doc(`leads/${leadId}`);
      const snap = await ref.get();
      if (!snap.exists) { skipped++; continue; }
      const lead: any = snap.data();
      if (!['new', 'researching'].includes(lead.status)) { skipped++; continue; }

      await ref.set({ status: 'researching' as LeadStatus }, { merge: true });

      // Backfill googleReviews / types / editorial summary for leads created
      // before we started saving them at discovery time.
      if (!Array.isArray(lead.googleReviews) && lead.googlePlaceId) {
        const det = await placesDetails(lead.googlePlaceId);
        if (det) {
          const reviews = (det.reviews || []).slice(0, 5).map(rev => ({
            author: rev.author_name || null,
            rating: rev.rating ?? null,
            text: (rev.text || '').slice(0, 800),
            when: rev.relative_time_description || null,
          })).filter(rev => rev.text);
          await ref.set({
            googleReviews: reviews,
            googleEditorialSummary: det.editorial_summary?.overview || null,
            googleTypes: det.types || [],
          }, { merge: true });
          lead.googleReviews = reviews;
          lead.googleEditorialSummary = det.editorial_summary?.overview || null;
          lead.googleTypes = det.types || [];
        }
      }

      let scraped: ScrapedSiteContent | null = null;
      if (lead.websiteUrl) {
        scraped = await scrapeWebsite(lead.websiteUrl);
      }

      const enrich = await claudeEnrich({
        businessName: lead.businessName,
        trade: lead.trade as Trade,
        suburb: lead.suburb,
        websiteUrl: lead.websiteUrl,
        scraped,
        googleReviews: Array.isArray(lead.googleReviews) ? lead.googleReviews : [],
        googleEditorialSummary: lead.googleEditorialSummary || null,
        googleTypes: Array.isArray(lead.googleTypes) ? lead.googleTypes : [],
      });

      if (!enrich) {
        await ref.set({
          status: 'new' as LeadStatus,
          enrichmentFailureReason: scraped ? 'claude_failed' : 'no_website_content',
          enrichmentAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        failed++;
        continue;
      }

      // Pull email/mobile from scrape if not already set
      const updates: any = {
        status: 'researched' as LeadStatus,
        ownerName: enrich.ownerName,
        ownerNameSource: enrich.ownerNameSource,
        enrichmentSummary: enrich.enrichmentSummary,
        personalizationHooks: enrich.personalizationHooks || [],
        enrichmentConfidence: enrich.confidence,
        enrichedAt: admin.firestore.FieldValue.serverTimestamp(),
        enrichmentFailureReason: admin.firestore.FieldValue.delete(),
      };
      if (!lead.email && scraped?.emails?.length) updates.email = scraped.emails[0];
      if (!lead.mobile && scraped?.mobiles?.length) updates.mobile = scraped.mobiles[0];
      if (!lead.facebookUrl && scraped?.socials?.facebook) updates.facebookUrl = scraped.socials.facebook;
      if (!lead.instagramUrl && scraped?.socials?.instagram) updates.instagramUrl = scraped.socials.instagram;

      // Cold outreach is email-only. If enrichment couldn't find a sendable
      // address (no website, contact-form-only site, obfuscated email), park
      // the lead in 'no_email' rather than letting it flow to 'researched' →
      // 'queued', where it would clog the queue and get skipped forever.
      if (!normaliseEmail(updates.email || lead.email)) {
        updates.status = 'no_email' as LeadStatus;
      }

      await ref.set(updates, { merge: true });

      // Save research raw
      await ref.collection('research').add({
        at: admin.firestore.FieldValue.serverTimestamp(),
        scrapedPages: scraped?.pages || [],
        scrapedTitle: scraped?.title || null,
        scrapedDescription: scraped?.description || null,
        scrapedEmails: scraped?.emails || [],
        scrapedMobiles: scraped?.mobiles || [],
        claudeOwnerName: enrich.ownerName,
        claudeConfidence: enrich.confidence,
        claudeHooks: enrich.personalizationHooks,
      });
      enriched++;
    }

    await logAdminAction({
      adminUid,
      action: 'lead_enrich',
      targetType: 'lead_batch',
      payload: { count: leadIds.length, enriched, failed, skipped },
    });

    return { ok: true, enriched, failed, skipped };
  });

// ============================================================
// 3. adminGenerateLeadMessages — Claude generate subject + body
// ============================================================

export const adminGenerateLeadMessages = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const leadIds: string[] = Array.isArray(data?.leadIds) ? data.leadIds.filter((s: any) => typeof s === 'string') : [];
    if (!leadIds.length) {
      throw new functions.https.HttpsError('invalid-argument', 'leadIds[] required');
    }

    let generated = 0;
    let failed = 0;
    let skipped = 0;

    for (const leadId of leadIds) {
      const ref = db().doc(`leads/${leadId}`);
      const snap = await ref.get();
      if (!snap.exists) { skipped++; continue; }
      const lead: any = snap.data();
      if (!['researched', 'queued'].includes(lead.status)) { skipped++; continue; }

      // No email = nothing to send. Don't spend a Claude call generating copy
      // for a lead we can never email; park it in 'no_email' so it leaves the
      // pipeline instead of silently sitting in the send queue.
      if (!normaliseEmail(lead.email)) {
        await ref.set({ status: 'no_email' as LeadStatus }, { merge: true });
        skipped++;
        continue;
      }

      const msg = await claudeGenerateMessage({
        businessName: lead.businessName,
        ownerName: lead.ownerName || null,
        ownerNameSource: lead.ownerNameSource || null,
        enrichmentConfidence: lead.enrichmentConfidence || null,
        trade: lead.trade as Trade,
        suburb: lead.suburb,
        hooks: lead.personalizationHooks || [],
        enrichmentSummary: lead.enrichmentSummary || '',
      });
      if (!msg || !msg.subject || !msg.body) { failed++; continue; }

      // Sanity guard: never let "AI" leak into copy
      const cleanBody = msg.body.replace(/\bAI\b/g, 'smart');
      const cleanSubject = msg.subject.replace(/\bAI\b/g, 'smart');

      await ref.set({
        generatedSubject: cleanSubject,
        generatedBody: cleanBody,
        generatedBodyVersion: admin.firestore.FieldValue.increment(1),
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'queued' as LeadStatus,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      generated++;
    }

    await logAdminAction({
      adminUid,
      action: 'lead_generate_messages',
      targetType: 'lead_batch',
      payload: { count: leadIds.length, generated, failed, skipped },
    });

    return { ok: true, generated, failed, skipped };
  });

// ============================================================
// 4. adminListLeads — paginated list
// ============================================================

export const adminListLeads = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const status: string | undefined = data?.status;
    const trade: string | undefined = data?.trade;
    const suburb: string | undefined = data?.suburb;
    const campaignId: string | undefined = data?.campaignId;
    const limit = Math.min(Math.max(Number(data?.limit) || 100, 1), 500);

    let q: FirebaseFirestore.Query = db().collection('leads');
    if (status) q = q.where('status', '==', status);
    if (trade) q = q.where('trade', '==', trade);
    if (suburb) q = q.where('suburb', '==', suburb);
    if (campaignId) q = q.where('campaignId', '==', campaignId);
    q = q.orderBy('createdAt', 'desc').limit(limit);

    const snap = await q.get();
    const leads = snap.docs.map(d => {
      const x = d.data() as any;
      return {
        id: d.id,
        businessName: x.businessName || null,
        trade: x.trade || null,
        ownerName: x.ownerName || null,
        suburb: x.suburb || null,
        state: x.state || null,
        email: x.email || null,
        phone: x.phone || null,
        mobile: x.mobile || null,
        websiteUrl: x.websiteUrl || null,
        status: x.status || 'new',
        googleRating: x.googleRating ?? null,
        googleReviewCount: x.googleReviewCount ?? null,
        generatedSubject: x.generatedSubject || null,
        enrichmentSummary: x.enrichmentSummary || null,
        enrichmentConfidence: x.enrichmentConfidence || null,
        campaignId: x.campaignId || null,
        scrapedAt: x.scrapedAt?.toMillis?.() || null,
        enrichedAt: x.enrichedAt?.toMillis?.() || null,
        queuedAt: x.queuedAt?.toMillis?.() || null,
        sentAt: x.sentAt?.toMillis?.() || null,
        engagedAt: x.engagedAt?.toMillis?.() || null,
        repliedAt: x.repliedAt?.toMillis?.() || null,
      };
    });

    // Light status count summary alongside list
    const summary: Record<string, number> = {};
    for (const l of leads) summary[l.status] = (summary[l.status] || 0) + 1;
    return { leads, summary };
  });

// ============================================================
// 5. adminGetLead — full detail
// ============================================================

export const adminGetLead = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const id = String(data?.id || '');
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

  const ref = db().doc(`leads/${id}`);
  const [snap, outreachSnap, notesSnap, researchSnap] = await Promise.all([
    ref.get(),
    ref.collection('outreach').orderBy('sentAt', 'desc').limit(20).get(),
    ref.collection('notes').orderBy('createdAt', 'desc').limit(20).get(),
    ref.collection('research').orderBy('at', 'desc').limit(5).get(),
  ]);
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'lead not found');

  const lead = { id, ...(snap.data() as any) };
  // Convert Firestore timestamps to ms for the client
  const tsKeys = ['createdAt', 'scrapedAt', 'enrichedAt', 'enrichmentAttemptedAt', 'queuedAt', 'sentAt', 'engagedAt', 'repliedAt', 'convertedAt', 'generatedAt'];
  for (const k of tsKeys) if (lead[k]?.toMillis) lead[k] = lead[k].toMillis();
  // Strip data that's noisy in JSON responses but pass-throughs reviews so UI can render them.
  // (no-op here — googleReviews and googleTypes already serialize fine.)

  const outreach = outreachSnap.docs.map(d => {
    const x = d.data() as any;
    return {
      id: d.id,
      subject: x.subject || null,
      body: x.body || null,
      emailLogId: x.emailLogId || null,
      sentAt: x.sentAt?.toMillis?.() || null,
      openCount: x.openCount || 0,
      clickCount: x.clickCount || 0,
    };
  });
  const notes = notesSnap.docs.map(d => {
    const x = d.data() as any;
    return {
      id: d.id,
      text: x.text || '',
      authorUid: x.authorUid || null,
      createdAt: x.createdAt?.toMillis?.() || null,
    };
  });
  const research = researchSnap.docs.map(d => {
    const x = d.data() as any;
    return {
      id: d.id,
      at: x.at?.toMillis?.() || null,
      scrapedPages: x.scrapedPages || [],
      scrapedTitle: x.scrapedTitle || null,
      scrapedDescription: x.scrapedDescription || null,
      claudeConfidence: x.claudeConfidence || null,
    };
  });

  return { lead, outreach, notes, research };
});

// ============================================================
// 6. adminUpdateLeadMessage — admin edits subject/body
// ============================================================

export const adminUpdateLeadMessage = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = String(data?.id || '');
  const subject = String(data?.subject || '').trim();
  const body = String(data?.body || '').trim();
  if (!id || !subject || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'id, subject, body required');
  }
  const ref = db().doc(`leads/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'lead not found');

  await ref.set({
    generatedSubject: subject,
    generatedBody: body,
    generatedBodyVersion: admin.firestore.FieldValue.increment(1),
    editedAt: admin.firestore.FieldValue.serverTimestamp(),
    editedBy: adminUid,
    status: 'queued' as LeadStatus,
  }, { merge: true });

  await logAdminAction({ adminUid, action: 'lead_edit_message', targetType: 'lead', targetId: id });
  return { ok: true };
});

// ============================================================
// 7. adminApproveLeads — batch send via existing sendEmail()
// ============================================================

export const adminApproveLeads = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const leadIds: string[] = Array.isArray(data?.leadIds) ? data.leadIds.filter((s: any) => typeof s === 'string') : [];
    if (!leadIds.length) throw new functions.https.HttpsError('invalid-argument', 'leadIds[] required');

    // Kill switch + effective caps (auto-ramp schedule wins if enabled)
    const cfgSnap = await db().doc('leadOutreachConfig/current').get();
    const cfg: LeadOutreachConfig = cfgSnap.exists
      ? { ...DEFAULT_CONFIG, ...(cfgSnap.data() as any) }
      : DEFAULT_CONFIG;
    if (cfg.enabled === false) {
      throw new functions.https.HttpsError('failed-precondition', 'lead outreach is disabled (kill switch)');
    }
    const eff = effectiveCaps(cfg);
    const dailyMax = eff.daily;

    // Count today's sends
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const sentTodaySnap = await db().collection('leads')
      .where('sentAt', '>=', since)
      .select()
      .get();
    const remaining = Math.max(0, dailyMax - sentTodaySnap.size);
    if (remaining <= 0) {
      const stageInfo = eff.source === 'auto' && eff.stage ? ` (auto-ramp: ${eff.stage.label})` : '';
      throw new functions.https.HttpsError('resource-exhausted', `daily cap reached (${dailyMax})${stageInfo}`);
    }

    const sentDomains = new Set<string>();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const issues: Array<{ leadId: string; reason: string }> = [];

    for (const leadId of leadIds.slice(0, remaining)) {
      const ref = db().doc(`leads/${leadId}`);
      const snap = await ref.get();
      if (!snap.exists) { skipped++; issues.push({ leadId, reason: 'not_found' }); continue; }
      const lead: any = snap.data();
      if (lead.status !== 'queued') { skipped++; issues.push({ leadId, reason: `not_queued:${lead.status}` }); continue; }
      if (!lead.email) { skipped++; issues.push({ leadId, reason: 'no_email' }); continue; }
      if (!lead.generatedSubject || !lead.generatedBody) { skipped++; issues.push({ leadId, reason: 'no_message' }); continue; }

      const email = normaliseEmail(lead.email);
      if (!email) { skipped++; issues.push({ leadId, reason: 'invalid_email' }); continue; }
      const dom = domainOf(email);

      // Pre-send safety
      const supp = await isSuppressed({ email, domain: dom || undefined, placeId: lead.googlePlaceId });
      if (supp.suppressed) {
        await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: `suppressed:${supp.reason}` }, { merge: true });
        skipped++; issues.push({ leadId, reason: `suppressed:${supp.reason}` }); continue;
      }
      const exUid = await findExistingUserByEmail(email);
      if (exUid) {
        await addSuppression({ type: 'email', value: email, reason: 'is-existing-user' });
        await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: 'is-existing-user', convertedUid: exUid }, { merge: true });
        skipped++; issues.push({ leadId, reason: 'existing-user' }); continue;
      }
      // Per-domain cap: 1 send per batch
      if (dom && sentDomains.has(dom)) { skipped++; issues.push({ leadId, reason: 'per_domain_cap' }); continue; }

      const tags = ['lead_outreach', `lead:${leadId}`];
      if (lead.campaignId) tags.push(`campaign:${lead.campaignId}`);

      const ok = await sendEmail({
        to: email,
        subject: lead.generatedSubject,
        htmlContent: lead.generatedBody, // email.ts will wrap with compliance footer (see edits there)
        category: 'marketing',
        tags,
        userId: undefined,
      });
      if (!ok) {
        failed++; issues.push({ leadId, reason: 'send_failed' });
        await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: 'send_failed' }, { merge: true });
        continue;
      }

      await ref.set({
        status: 'sent' as LeadStatus,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await ref.collection('outreach').add({
        subject: lead.generatedSubject,
        body: lead.generatedBody,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: adminUid,
      });
      if (dom) sentDomains.add(dom);
      sent++;
    }

    await logAdminAction({
      adminUid,
      action: 'lead_send',
      targetType: 'lead_batch',
      payload: { count: leadIds.length, sent, skipped, failed, issues: issues.slice(0, 50) },
    });

    return { ok: true, sent, skipped, failed, issues };
  });

// ============================================================
// autoSendQueuedLeads — scheduled background sender
// ============================================================
//
// Runs every 30 minutes during Australian business hours (Mon-Fri 9am-5pm
// AEST). Picks queued leads, oldest first, and sends them up to the hourly
// remaining cap. Respects the kill switch and the auto-ramp / manual caps.
// This is what makes the system run "while you sleep" — close the browser
// and queued leads will trickle out across the next few business days.

async function sendOneLead(params: {
  leadId: string;
  sentDomainsThisBatch: Set<string>;
  bySender: 'admin' | 'auto';
  senderUid?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { leadId, sentDomainsThisBatch, bySender, senderUid } = params;
  const ref = db().doc(`leads/${leadId}`);
  const snap = await ref.get();
  if (!snap.exists) return { sent: false, reason: 'not_found' };
  const lead: any = snap.data();
  if (lead.status !== 'queued') return { sent: false, reason: `not_queued:${lead.status}` };

  // No sendable address: reclassify out of the queue so we stop re-scanning it
  // every run. (Self-heals leads that were queued before the email gate landed.)
  const email = normaliseEmail(lead.email);
  if (!email) {
    await ref.set({ status: 'no_email' as LeadStatus }, { merge: true });
    return { sent: false, reason: 'no_email' };
  }
  if (!lead.generatedSubject || !lead.generatedBody) return { sent: false, reason: 'no_message' };

  const dom = domainOf(email);

  const supp = await isSuppressed({ email, domain: dom || undefined, placeId: lead.googlePlaceId });
  if (supp.suppressed) {
    await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: `suppressed:${supp.reason}` }, { merge: true });
    return { sent: false, reason: `suppressed:${supp.reason}` };
  }
  const exUid = await findExistingUserByEmail(email);
  if (exUid) {
    await addSuppression({ type: 'email', value: email, reason: 'is-existing-user' });
    await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: 'is-existing-user', convertedUid: exUid }, { merge: true });
    return { sent: false, reason: 'existing-user' };
  }
  if (dom && sentDomainsThisBatch.has(dom)) return { sent: false, reason: 'per_domain_cap' };

  const tags = ['lead_outreach', `lead:${leadId}`];
  if (lead.campaignId) tags.push(`campaign:${lead.campaignId}`);
  if (bySender === 'auto') tags.push('auto_send');

  const ok = await sendEmail({
    to: email,
    subject: lead.generatedSubject,
    htmlContent: lead.generatedBody,
    category: 'marketing',
    tags,
    userId: undefined,
  });
  if (!ok) {
    await ref.set({ status: 'rejected' as LeadStatus, rejectionReason: 'send_failed' }, { merge: true });
    return { sent: false, reason: 'send_failed' };
  }
  await ref.set({ status: 'sent' as LeadStatus, sentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await ref.collection('outreach').add({
    subject: lead.generatedSubject,
    body: lead.generatedBody,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    sentBy: bySender === 'auto' ? 'auto-scheduler' : (senderUid || 'admin'),
  });
  if (dom) sentDomainsThisBatch.add(dom);
  return { sent: true };
}

export const autoSendQueuedLeads = functions.pubsub
  .schedule('every 30 minutes')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    // Only run Mon-Fri 9am-5pm AEST. Tradies check email morning + lunch;
    // weekend cold sends look spammy and convert worse.
    const now = new Date();
    const localHour = Number(now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }));
    const localDay = now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' });
    if (localDay === 'Sat' || localDay === 'Sun') {
      console.info('autoSendQueuedLeads: weekend, skipping');
      return null;
    }
    if (localHour < 9 || localHour >= 17) {
      console.info(`autoSendQueuedLeads: outside business hours (h=${localHour}), skipping`);
      return null;
    }

    const cfgSnap = await db().doc('leadOutreachConfig/current').get();
    const cfg: LeadOutreachConfig = cfgSnap.exists
      ? { ...DEFAULT_CONFIG, ...(cfgSnap.data() as any) }
      : DEFAULT_CONFIG;
    if (!cfg.enabled) {
      console.info('autoSendQueuedLeads: disabled (kill switch)');
      return null;
    }

    const eff = effectiveCaps(cfg);
    const since24 = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const since1h = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    const [sent24Snap, sent1hSnap] = await Promise.all([
      db().collection('leads').where('sentAt', '>=', since24).select().get(),
      db().collection('leads').where('sentAt', '>=', since1h).select().get(),
    ]);
    const dailyRemaining = Math.max(0, eff.daily - sent24Snap.size);
    const hourlyRemaining = Math.max(0, eff.hourly - sent1hSnap.size);
    const budget = Math.min(dailyRemaining, hourlyRemaining);

    if (budget <= 0) {
      console.info(`autoSendQueuedLeads: no budget (daily=${dailyRemaining}, hourly=${hourlyRemaining})`);
      return null;
    }

    // Pick oldest queued leads. Pull a wider net than budget so we have
    // candidates to skip past (per-domain cap, missing email, etc.) without
    // running out.
    const queuedSnap = await db().collection('leads')
      .where('status', '==', 'queued')
      .orderBy('queuedAt', 'asc')
      .limit(budget * 4)
      .get();

    if (queuedSnap.empty) {
      console.info('autoSendQueuedLeads: no queued leads');
      return null;
    }

    const sentDomains = new Set<string>();
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const skipReasons: Record<string, number> = {};

    for (const d of queuedSnap.docs) {
      if (sent >= budget) break;
      const r = await sendOneLead({ leadId: d.id, sentDomainsThisBatch: sentDomains, bySender: 'auto' });
      if (r.sent) {
        sent++;
      } else {
        const reason = r.reason || 'unknown';
        skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        if (reason === 'send_failed') failed++;
        else skipped++;
      }
    }

    await logAdminAction({
      adminUid: 'system',
      action: 'auto_send_run',
      targetType: 'system',
      payload: { sent, skipped, failed, budget, dailyRemaining, hourlyRemaining, skipReasons, stage: eff.stage?.label || null, day: eff.day || null },
    });

    console.info(`autoSendQueuedLeads: sent=${sent}, skipped=${skipped}, failed=${failed}, budget=${budget}`);
    return null;
  });

// ============================================================
// weeklyLeadOutreachReport — Mon 9am AEST email summary
// ============================================================
//
// Queries the previous 7 days of lead activity + emailLog deliverability
// signals, composes a report, and emails it to ADMIN_EMAIL. Self-contained:
// no remote agent, no extra credentials, no UI clicks.

interface LeadStageCounts {
  new: number; researched: number; queued: number; sent: number;
  engaged: number; replied: number; converted: number; rejected: number;
  dnc: number; bounced: number;
}

async function buildWeeklyReport(): Promise<{ html: string; subject: string; numbers: any }> {
  const now = Date.now();
  const since = admin.firestore.Timestamp.fromMillis(now - 7 * 24 * 60 * 60 * 1000);
  const sinceMs = now - 7 * 24 * 60 * 60 * 1000;

  // Total stage counts (entire pipeline, not just last 7d)
  const allLeadsSnap = await db().collection('leads').select('status', 'sentAt', 'engagedAt', 'repliedAt', 'convertedAt').get();
  const stageCounts: LeadStageCounts = {
    new: 0, researched: 0, queued: 0, sent: 0, engaged: 0, replied: 0,
    converted: 0, rejected: 0, dnc: 0, bounced: 0,
  };
  let sent7d = 0;
  let engaged7dFromSent = 0;
  let replied7dFromSent = 0;
  let converted7dFromSent = 0;
  for (const d of allLeadsSnap.docs) {
    const data = d.data() as any;
    const status = data.status as keyof LeadStageCounts;
    if (status in stageCounts) stageCounts[status]++;
    const sentMs = data.sentAt?.toMillis?.();
    if (sentMs && sentMs >= sinceMs) {
      sent7d++;
      if (data.engagedAt?.toMillis?.() && data.engagedAt.toMillis() >= sinceMs) engaged7dFromSent++;
      if (data.repliedAt?.toMillis?.() && data.repliedAt.toMillis() >= sinceMs) replied7dFromSent++;
      if (data.convertedAt?.toMillis?.() && data.convertedAt.toMillis() >= sinceMs) converted7dFromSent++;
    }
  }

  // Brevo deliverability via emailLog filtered by tag
  const emailLogSnap = await db().collection('emailLog')
    .where('queuedAt', '>=', since)
    .get();
  let logSends = 0, logDelivered = 0, logBounced = 0, logSpam = 0, logUnsub = 0, logOpened = 0, logClicked = 0;
  for (const d of emailLogSnap.docs) {
    const data = d.data() as any;
    const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
    if (!tags.includes('lead_outreach')) continue;
    if (tags.includes('lead_outreach_test')) continue; // exclude test sends
    logSends++;
    if (data.status === 'delivered' || data.deliveredAt) logDelivered++;
    if (data.status === 'bounced' || data.bouncedAt) logBounced++;
    if (data.status === 'spam' || data.spamReportedAt) logSpam++;
    if (data.unsubscribedAt) logUnsub++;
    if ((data.openCount ?? 0) > 0) logOpened++;
    if ((data.clickCount ?? 0) > 0) logClicked++;
  }

  // Effective caps + day for context
  const cfgSnap = await db().doc('leadOutreachConfig/current').get();
  const cfg: LeadOutreachConfig = cfgSnap.exists
    ? { ...DEFAULT_CONFIG, ...(cfgSnap.data() as any) }
    : DEFAULT_CONFIG;
  const eff = effectiveCaps(cfg);

  // Per-day histogram (last 7 days)
  const daily = await sendsPerDay(7);

  // Rates
  const openRate = sent7d > 0 ? (logOpened / sent7d) * 100 : 0;
  const clickRate = sent7d > 0 ? (logClicked / sent7d) * 100 : 0;
  const replyRate = sent7d > 0 ? (replied7dFromSent / sent7d) * 100 : 0;
  const conversionRate = sent7d > 0 ? (converted7dFromSent / sent7d) * 100 : 0;
  const bounceRate = logSends > 0 ? (logBounced / logSends) * 100 : 0;
  const spamRate = logSends > 0 ? (logSpam / logSends) * 100 : 0;

  // Recommendation logic
  let recommendation = '';
  let recColor = '#10b981';
  if (spamRate > 0.3) {
    recommendation = `🚨 PAUSE — spam complaint rate ${spamRate.toFixed(2)}% is above Gmail's 0.3% threshold. Disable outreach until you investigate.`;
    recColor = '#ef4444';
  } else if (bounceRate > 5) {
    recommendation = `🛑 PAUSE — bounce rate ${bounceRate.toFixed(1)}% is high (>5%). Check email validation; could be hurting sender reputation.`;
    recColor = '#ef4444';
  } else if (replyRate < 1 && sent7d >= 20) {
    recommendation = `⚠️ REWORK MESSAGES — reply rate ${replyRate.toFixed(2)}% is below 1% across ${sent7d} sends. The hooks aren't landing. Review generated messages and re-tune the prompt.`;
    recColor = '#fcd34d';
  } else if (eff.source === 'auto' && eff.stage && (replyRate >= 3 || (replyRate >= 1.5 && conversionRate > 0))) {
    recommendation = `✅ KEEP RAMPING — reply rate ${replyRate.toFixed(2)}% is healthy. Auto-ramp is doing its job; let it advance to the next stage on schedule.`;
  } else if (sent7d === 0) {
    recommendation = `📭 NO SENDS THIS WEEK — kill switch off, queue empty, or outside business hours. Check that auto-send is enabled and there are queued leads.`;
    recColor = '#94a3b8';
  } else {
    recommendation = `📊 CONTINUE — metrics are within normal range. Keep current ramp.`;
  }

  const numbers = {
    sent7d, engaged7dFromSent, replied7dFromSent, converted7dFromSent,
    logSends, logDelivered, logBounced, logSpam, logUnsub, logOpened, logClicked,
    openRate, clickRate, replyRate, conversionRate, bounceRate, spamRate,
    stageCounts, daily, eff, recommendation,
  };

  // HTML email
  const stageRows = (Object.entries(stageCounts) as Array<[string, number]>)
    .filter(([_, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<tr><td style="padding:4px 8px;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;">${s}</td><td style="padding:4px 8px;font-weight:600;text-align:right;">${n}</td></tr>`)
    .join('');

  const dailyRow = daily.map(d => `<td style="padding:6px 4px;text-align:center;font-size:11px;border-right:1px solid #e2e8f0;">${d.date.slice(5)}<br/><strong style="font-size:14px;">${d.count}</strong></td>`).join('');

  const stage = eff.source === 'auto' && eff.stage
    ? `Auto-ramp · ${eff.stage.label} · day ${eff.day} · ${eff.daily}/day cap`
    : `Manual caps · ${eff.daily}/day`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:32px;">
  <h1 style="margin:0 0 4px;font-size:22px;">Lead Outreach · Weekly Report</h1>
  <div style="color:#64748b;font-size:13px;margin-bottom:24px;">${new Date(sinceMs).toLocaleDateString('en-AU')} → ${new Date(now).toLocaleDateString('en-AU')} · ${stage}</div>

  <div style="padding:16px;background:${recColor}11;border-left:4px solid ${recColor};border-radius:6px;margin-bottom:24px;">
    <div style="font-weight:700;font-size:14px;">${recommendation}</div>
  </div>

  <h2 style="font-size:16px;margin:24px 0 12px;">This week</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:6px 0;color:#64748b;">Sends</td><td style="padding:6px 0;text-align:right;font-weight:700;">${sent7d}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Delivered</td><td style="padding:6px 0;text-align:right;">${logDelivered} (${logSends > 0 ? ((logDelivered / logSends) * 100).toFixed(0) : 0}%)</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Open rate</td><td style="padding:6px 0;text-align:right;color:${openRate >= 30 ? '#10b981' : '#0f172a'};">${openRate.toFixed(1)}%</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Click rate</td><td style="padding:6px 0;text-align:right;">${clickRate.toFixed(1)}%</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Reply rate</td><td style="padding:6px 0;text-align:right;color:${replyRate >= 3 ? '#10b981' : replyRate < 1 ? '#fca5a5' : '#0f172a'};font-weight:600;">${replyRate.toFixed(2)}% (${replied7dFromSent})</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Conversion rate</td><td style="padding:6px 0;text-align:right;color:${conversionRate > 0 ? '#10b981' : '#0f172a'};">${conversionRate.toFixed(2)}% (${converted7dFromSent})</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Bounce rate</td><td style="padding:6px 0;text-align:right;color:${bounceRate > 5 ? '#ef4444' : '#0f172a'};">${bounceRate.toFixed(1)}%</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Spam rate</td><td style="padding:6px 0;text-align:right;color:${spamRate > 0.3 ? '#ef4444' : '#0f172a'};">${spamRate.toFixed(2)}%</td></tr>
    <tr><td style="padding:6px 0;color:#64748b;">Unsubscribes</td><td style="padding:6px 0;text-align:right;">${logUnsub}</td></tr>
  </table>

  <h2 style="font-size:16px;margin:32px 0 12px;">Sends per day</h2>
  <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
    <tr>${dailyRow}</tr>
  </table>

  <h2 style="font-size:16px;margin:32px 0 12px;">Pipeline</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#f8fafc;border-radius:6px;">
    ${stageRows || '<tr><td style="padding:8px;color:#94a3b8;">No leads yet.</td></tr>'}
  </table>

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
    Generated by QuoteMate Lead Outreach · weekly Monday 9am AEST
  </div>
</div></body></html>`;

  const subject = `Lead Outreach: ${sent7d} sent, ${replyRate.toFixed(1)}% reply rate · week of ${new Date(sinceMs).toLocaleDateString('en-AU')}`;
  return { html, subject, numbers };
}

export const weeklyLeadOutreachReport = functions.pubsub
  .schedule('every monday 09:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const adminEmail = process.env.ADMIN_EMAILS?.split(',')[0]?.trim();
    if (!adminEmail) {
      console.warn('weeklyLeadOutreachReport: ADMIN_EMAILS not configured');
      return null;
    }
    const report = await buildWeeklyReport();
    await sendEmail({
      to: adminEmail,
      subject: report.subject,
      htmlContent: report.html,
      category: 'transactional',
      tags: ['lead_weekly_report'],
    });
    console.info('weeklyLeadOutreachReport sent:', report.numbers);
    return null;
  });

// On-demand version so the user can hit "send now" from the admin UI without
// waiting for Monday. Returns the report inline + emails it.
export const adminSendLeadReport = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const adminEmail = process.env.ADMIN_EMAILS?.split(',')[0]?.trim();
  if (!adminEmail) {
    throw new functions.https.HttpsError('failed-precondition', 'ADMIN_EMAILS not set');
  }
  const report = await buildWeeklyReport();
  const ok = await sendEmail({
    to: adminEmail,
    subject: report.subject,
    htmlContent: report.html,
    category: 'transactional',
    tags: ['lead_weekly_report', 'on_demand'],
  });
  return { ok, sentTo: adminEmail, numbers: report.numbers };
});

// ============================================================
// adminTestSendLead — sends the lead's generated message to an arbitrary
// test address. Bypasses suppression / daily cap. Does NOT update lead status.
// Use this to preview deliverability + formatting before going live.
// ============================================================

export const adminTestSendLead = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const leadId = String(data?.leadId || '');
  const to = normaliseEmail(String(data?.to || ''));
  if (!leadId || !to) {
    throw new functions.https.HttpsError('invalid-argument', 'leadId + to (email) required');
  }
  const ref = db().doc(`leads/${leadId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'lead not found');
  const lead: any = snap.data();
  if (!lead.generatedSubject || !lead.generatedBody) {
    throw new functions.https.HttpsError('failed-precondition', 'No generated message yet — generate first');
  }

  // Keep 'lead_outreach' tag so email.ts wraps with the compliance footer +
  // outreach sender (accurate preview). DROP 'lead:<id>' tag so the
  // brevoEmailWebhook fan-out doesn't flip the lead's status to 'engaged' when
  // YOU open the test email.
  const ok = await sendEmail({
    to,
    subject: `[TEST] ${lead.generatedSubject}`,
    htmlContent: lead.generatedBody,
    category: 'transactional', // bypass marketing opt-in checks for the test recipient
    tags: ['lead_outreach', 'lead_outreach_test', `test_lead:${leadId}`],
    userId: undefined,
  });

  await logAdminAction({
    adminUid,
    action: 'lead_test_send',
    targetType: 'lead',
    targetId: leadId,
    payload: { to, subject: lead.generatedSubject, ok },
  });

  if (!ok) throw new functions.https.HttpsError('internal', 'Send failed — check Brevo config');
  return { ok: true, to };
});

// ============================================================
// 8. adminRejectLeads — mark rejected + add to suppression
// ============================================================

export const adminRejectLeads = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const leadIds: string[] = Array.isArray(data?.leadIds) ? data.leadIds.filter((s: any) => typeof s === 'string') : [];
  const reason = String(data?.reason || 'manual');
  const dnc = data?.dnc === true;
  if (!leadIds.length) throw new functions.https.HttpsError('invalid-argument', 'leadIds[] required');

  let rejected = 0;
  for (const leadId of leadIds) {
    const ref = db().doc(`leads/${leadId}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const lead: any = snap.data();
    await ref.set({
      status: (dnc ? 'dnc' : 'rejected') as LeadStatus,
      rejectionReason: reason,
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectedBy: adminUid,
    }, { merge: true });
    if (dnc || reason === 'dnc') {
      const e = normaliseEmail(lead.email);
      if (e) await addSuppression({ type: 'email', value: e, reason });
      if (lead.googlePlaceId) await addSuppression({ type: 'placeId', value: lead.googlePlaceId, reason });
    }
    rejected++;
  }

  await logAdminAction({ adminUid, action: 'lead_reject', targetType: 'lead_batch', payload: { count: leadIds.length, reason, dnc, rejected } });
  return { ok: true, rejected };
});

// ============================================================
// adminGetLeadConfig / adminUpdateLeadConfig — kill switch + send caps
// ============================================================
//
// Single doc at leadOutreachConfig/current. adminApproveLeads enforces
// dailyMaxSends as a hard cap. Start small on a fresh domain; ramp slowly.

interface LeadOutreachConfig {
  enabled: boolean;
  dailyMaxSends: number;
  hourlyMaxSends: number;
  perDomainMax: number;
  warmupAuto: boolean;
  warmupStartedAt: number | null; // ms epoch
}

const DEFAULT_CONFIG: LeadOutreachConfig = {
  enabled: false,
  dailyMaxSends: 5,
  hourlyMaxSends: 3,
  perDomainMax: 1,
  warmupAuto: false,
  warmupStartedAt: null,
};

// Progressive ramp schedule. Each stage applies from `dayFrom` (inclusive) to
// `dayTo` (inclusive). Day 1 is the first day of warmup (warmupStartedAt date).
// Caps are calibrated for a single subdomain on Brevo shared IPs — going past
// stage 6 from one domain = high deliverability risk; add domains instead.
interface WarmupStage {
  dayFrom: number;
  dayTo: number;
  label: string;
  daily: number;
  hourly: number;
}
const WARMUP_SCHEDULE: WarmupStage[] = [
  { dayFrom: 1,  dayTo: 3,   label: 'Days 1-3 · cold-start',     daily: 5,   hourly: 3  },
  { dayFrom: 4,  dayTo: 7,   label: 'Days 4-7 · gentle ramp',    daily: 10,  hourly: 4  },
  { dayFrom: 8,  dayTo: 14,  label: 'Days 8-14 · week 2',        daily: 25,  hourly: 8  },
  { dayFrom: 15, dayTo: 28,  label: 'Days 15-28 · week 3-4',     daily: 50,  hourly: 15 },
  { dayFrom: 29, dayTo: 56,  label: 'Days 29-56 · week 5-8',     daily: 100, hourly: 25 },
  { dayFrom: 57, dayTo: 999, label: 'Day 57+ · single-domain ceiling', daily: 200, hourly: 40 },
];

function dayOfWarmup(startedAt: number | null): number | null {
  if (!startedAt) return null;
  const ms = Date.now() - startedAt;
  if (ms < 0) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function stageForDay(day: number | null): WarmupStage | null {
  if (day == null || day < 1) return null;
  return WARMUP_SCHEDULE.find(s => day >= s.dayFrom && day <= s.dayTo) || WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1];
}

// Returns the EFFECTIVE caps for today, accounting for warmupAuto override.
function effectiveCaps(cfg: LeadOutreachConfig): { daily: number; hourly: number; source: 'auto' | 'manual'; stage?: WarmupStage; day?: number } {
  if (cfg.warmupAuto && cfg.warmupStartedAt) {
    const day = dayOfWarmup(cfg.warmupStartedAt);
    const stage = stageForDay(day);
    if (stage && day != null) {
      return { daily: stage.daily, hourly: stage.hourly, source: 'auto', stage, day };
    }
  }
  return { daily: cfg.dailyMaxSends, hourly: cfg.hourlyMaxSends, source: 'manual' };
}

// Per-day send histogram for the last N days (UTC days).
async function sendsPerDay(daysBack: number): Promise<Array<{ date: string; count: number }>> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const snap = await db().collection('leads').where('sentAt', '>=', since).select('sentAt').get();
  const counts = new Map<string, number>();
  for (const d of snap.docs) {
    const ts = (d.data() as any)?.sentAt;
    const ms = ts?.toMillis?.() ?? null;
    if (!ms) continue;
    const date = new Date(ms).toISOString().slice(0, 10);
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  // Build full series (zero-fill) so the UI doesn't have gaps.
  const out: Array<{ date: string; count: number }> = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, count: counts.get(date) || 0 });
  }
  return out;
}

export const adminGetLeadConfig = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db().doc('leadOutreachConfig/current').get();
  const config: LeadOutreachConfig = snap.exists
    ? { ...DEFAULT_CONFIG, ...(snap.data() as any) }
    : DEFAULT_CONFIG;

  // Compute effective caps (auto-ramp schedule wins if enabled)
  const eff = effectiveCaps(config);
  // Look ahead: tomorrow's stage if we cross a stage boundary overnight
  let nextStage: WarmupStage | null = null;
  let daysUntilNext: number | null = null;
  if (eff.source === 'auto' && eff.day != null && eff.stage) {
    const dayTomorrow = eff.day + 1;
    const stTomorrow = stageForDay(dayTomorrow);
    if (stTomorrow && stTomorrow !== eff.stage) {
      nextStage = stTomorrow;
      daysUntilNext = 1;
    } else {
      // Find the upcoming stage and how many days away it is
      const upcoming = WARMUP_SCHEDULE.find(s => s.dayFrom > eff.day!);
      if (upcoming) { nextStage = upcoming; daysUntilNext = upcoming.dayFrom - eff.day; }
    }
  }

  const now = Date.now();
  const since24 = admin.firestore.Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
  const since1h = admin.firestore.Timestamp.fromMillis(now - 60 * 60 * 1000);
  const [sent24Snap, sent1hSnap, history] = await Promise.all([
    db().collection('leads').where('sentAt', '>=', since24).select().get(),
    db().collection('leads').where('sentAt', '>=', since1h).select().get(),
    sendsPerDay(14),
  ]);

  return {
    config,
    effective: {
      dailyMaxSends: eff.daily,
      hourlyMaxSends: eff.hourly,
      source: eff.source,
      currentStage: eff.stage || null,
      currentDay: eff.day || null,
      nextStage,
      daysUntilNext,
    },
    schedule: WARMUP_SCHEDULE,
    sentLast24h: sent24Snap.size,
    sentLastHour: sent1hSnap.size,
    remainingToday: Math.max(0, eff.daily - sent24Snap.size),
    remainingThisHour: Math.max(0, eff.hourly - sent1hSnap.size),
    history,
  };
});

export const adminUpdateLeadConfig = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const updates: Partial<LeadOutreachConfig> = {};
  if (typeof data?.enabled === 'boolean') updates.enabled = data.enabled;
  if (typeof data?.dailyMaxSends === 'number') {
    updates.dailyMaxSends = Math.max(0, Math.min(10000, Math.floor(data.dailyMaxSends)));
  }
  if (typeof data?.hourlyMaxSends === 'number') {
    updates.hourlyMaxSends = Math.max(0, Math.min(1000, Math.floor(data.hourlyMaxSends)));
  }
  if (typeof data?.perDomainMax === 'number') {
    updates.perDomainMax = Math.max(1, Math.min(50, Math.floor(data.perDomainMax)));
  }
  if (typeof data?.warmupAuto === 'boolean') {
    updates.warmupAuto = data.warmupAuto;
    // Convenience: turning auto-ramp ON for the first time stamps the start date
    // unless the caller explicitly provides one. Turning OFF leaves the existing
    // start date alone so the user can re-enable without losing progress.
    if (data.warmupAuto && !data.warmupStartedAt) {
      const existing = await db().doc('leadOutreachConfig/current').get();
      if (!existing.exists || !(existing.data() as any)?.warmupStartedAt) {
        updates.warmupStartedAt = Date.now();
      }
    }
  }
  if (data?.warmupStartedAt !== undefined) {
    if (data.warmupStartedAt === null) {
      updates.warmupStartedAt = null;
    } else if (typeof data.warmupStartedAt === 'number' && data.warmupStartedAt > 0) {
      updates.warmupStartedAt = data.warmupStartedAt;
    }
  }
  if (!Object.keys(updates).length) {
    throw new functions.https.HttpsError('invalid-argument', 'no valid fields to update');
  }
  await db().doc('leadOutreachConfig/current').set(updates, { merge: true });
  await logAdminAction({
    adminUid,
    action: 'lead_config_update',
    targetType: 'system',
    payload: updates,
  });
  return { ok: true, updates };
});

// ============================================================
// weeklyLeadDiscovery — auto-fill the queue every Monday morning
// ============================================================
//
// Runs every Monday 8am AEST (1 hour before the weekly report). Reads
// `leadOutreachConfig/discovery`, pulls fresh Google Maps results for the
// configured trades + suburbs, dedupes against existing leads, and lands
// them as 'new'. If autoResearch is on, immediately enriches them. If
// autoGenerate is on, generates messages too — meaning by Monday afternoon
// the queue is full of personalised emails ready for the auto-sender to
// trickle out across the week.

interface DiscoveryConfig {
  enabled: boolean;
  trades: Trade[];
  suburbs: string[];
  targetPerWeek: number;     // hard cap on new leads created per run
  autoResearch: boolean;     // chain enrichment after discovery
  autoGenerate: boolean;     // chain message generation after research
}

const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  enabled: false,
  trades: ['fencer'],
  suburbs: ['Sydney'],
  targetPerWeek: 50,
  autoResearch: true,
  autoGenerate: true,
};

// Internal discovery — same logic as adminLeadDiscovery but no auth context.
// Returns IDs of leads created so the scheduler can chain enrichment + gen.
async function runDiscoveryBatch(params: {
  trade: Trade;
  suburbs: string[];
  maxResults: number;
  campaignId: string;
}): Promise<{ created: string[]; dedupedExisting: number; dedupedSuppressed: number; dedupedExistingUser: number }> {
  const { trade, suburbs, maxResults, campaignId } = params;
  const created: string[] = [];
  let dedupedExisting = 0;
  let dedupedSuppressed = 0;
  let dedupedExistingUser = 0;

  for (const suburb of suburbs) {
    if (created.length >= maxResults) break;
    for (const phrase of TRADE_QUERY[trade]) {
      if (created.length >= maxResults) break;
      let results: PlacesSearchResult[] = [];
      try {
        results = await placesTextSearch(`${phrase} ${suburb}`);
      } catch (e: any) {
        console.warn(`runDiscoveryBatch: places search failed for "${phrase} ${suburb}":`, e?.message);
        continue;
      }

      for (const r of results) {
        if (created.length >= maxResults) break;

        // Dedupe by placeId
        const placeIdMatch = await db().collection('leads').where('googlePlaceId', '==', r.place_id).limit(1).get();
        if (!placeIdMatch.empty) { dedupedExisting++; continue; }
        const supByPlace = await isSuppressed({ placeId: r.place_id });
        if (supByPlace.suppressed) { dedupedSuppressed++; continue; }

        // Dedupe by businessName+suburb
        const bizKey = normaliseBusinessKey(r.name, suburb);
        if (bizKey) {
          const bizMatch = await db().collection('leads').where('businessKey', '==', bizKey).limit(1).get();
          if (!bizMatch.empty) { dedupedExisting++; continue; }
        }

        const det = await placesDetails(r.place_id);
        if (!det) continue;

        const phone = det.formatted_phone_number || null;
        const intlPhone = det.international_phone_number || null;
        const website = det.website || null;
        const state = pickFromAddressComponents(det.address_components, 'administrative_area_level_1');
        const postcode = pickFromAddressComponents(det.address_components, 'postal_code');
        const reviews = (det.reviews || []).slice(0, 5).map(rev => ({
          author: rev.author_name || null,
          rating: rev.rating ?? null,
          text: (rev.text || '').slice(0, 800),
          when: rev.relative_time_description || null,
        })).filter(rev => rev.text);

        const docRef = await db().collection('leads').add({
          businessName: r.name,
          businessKey: bizKey,
          trade,
          ownerName: null,
          ownerNameSource: null,
          email: null,
          phone,
          mobile: null,
          internationalPhone: intlPhone,
          address: det.formatted_address || null,
          suburb,
          state: state || 'NSW',
          postcode: postcode || null,
          websiteUrl: website,
          facebookUrl: null,
          instagramUrl: null,
          googlePlaceId: r.place_id,
          googleRating: det.rating ?? null,
          googleReviewCount: det.user_ratings_total ?? null,
          googleReviews: reviews,
          googleEditorialSummary: det.editorial_summary?.overview || null,
          googleTypes: det.types || [],
          source: 'gmaps' as const,
          sourceUrl: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
          status: 'new' as LeadStatus,
          campaignId,
          scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        created.push(docRef.id);
      }
    }
  }
  return { created, dedupedExisting, dedupedSuppressed, dedupedExistingUser };
}

export const weeklyLeadDiscovery = functions
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .pubsub
  .schedule('every monday 08:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const cfgSnap = await db().doc('leadOutreachConfig/discovery').get();
    const cfg: DiscoveryConfig = cfgSnap.exists
      ? { ...DEFAULT_DISCOVERY_CONFIG, ...(cfgSnap.data() as any) }
      : DEFAULT_DISCOVERY_CONFIG;
    if (!cfg.enabled) {
      console.info('weeklyLeadDiscovery: disabled in config');
      return null;
    }
    if (!cfg.trades?.length || !cfg.suburbs?.length) {
      console.warn('weeklyLeadDiscovery: trades/suburbs empty');
      return null;
    }

    const campaignRef = db().collection('leadCampaigns').doc();
    await campaignRef.set({
      trade: cfg.trades.join(','),
      suburbs: cfg.suburbs,
      requestedBy: 'auto-scheduler',
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      leadsCreated: 0,
      status: 'running',
    });

    let totalCreated: string[] = [];
    let totalDeduped = 0;
    const perTradeRemaining = Math.max(1, Math.floor(cfg.targetPerWeek / cfg.trades.length));

    for (const trade of cfg.trades) {
      if (totalCreated.length >= cfg.targetPerWeek) break;
      const remaining = Math.min(perTradeRemaining, cfg.targetPerWeek - totalCreated.length);
      const r = await runDiscoveryBatch({ trade, suburbs: cfg.suburbs, maxResults: remaining, campaignId: campaignRef.id });
      totalCreated.push(...r.created);
      totalDeduped += r.dedupedExisting + r.dedupedSuppressed + r.dedupedExistingUser;
    }

    await campaignRef.set({
      leadsCreated: totalCreated.length,
      dedupedTotal: totalDeduped,
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // OPTIONAL: chain enrichment + generation
    let enriched = 0;
    let generated = 0;
    if (cfg.autoResearch && totalCreated.length > 0) {
      // Enrich in chunks to avoid hitting timeout
      for (const leadId of totalCreated) {
        const ref = db().doc(`leads/${leadId}`);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const lead: any = snap.data();
        if (!['new', 'researching'].includes(lead.status)) continue;

        await ref.set({ status: 'researching' as LeadStatus }, { merge: true });

        if (!Array.isArray(lead.googleReviews) && lead.googlePlaceId) {
          const det = await placesDetails(lead.googlePlaceId);
          if (det) {
            const reviews = (det.reviews || []).slice(0, 5).map(rev => ({
              author: rev.author_name || null,
              rating: rev.rating ?? null,
              text: (rev.text || '').slice(0, 800),
              when: rev.relative_time_description || null,
            })).filter(rev => rev.text);
            await ref.set({
              googleReviews: reviews,
              googleEditorialSummary: det.editorial_summary?.overview || null,
              googleTypes: det.types || [],
            }, { merge: true });
            lead.googleReviews = reviews;
            lead.googleEditorialSummary = det.editorial_summary?.overview || null;
            lead.googleTypes = det.types || [];
          }
        }

        let scraped: ScrapedSiteContent | null = null;
        if (lead.websiteUrl) scraped = await scrapeWebsite(lead.websiteUrl);

        const enrich = await claudeEnrich({
          businessName: lead.businessName,
          trade: lead.trade as Trade,
          suburb: lead.suburb,
          websiteUrl: lead.websiteUrl,
          scraped,
          googleReviews: Array.isArray(lead.googleReviews) ? lead.googleReviews : [],
          googleEditorialSummary: lead.googleEditorialSummary || null,
          googleTypes: Array.isArray(lead.googleTypes) ? lead.googleTypes : [],
        });

        if (!enrich) {
          await ref.set({ status: 'new' as LeadStatus, enrichmentFailureReason: 'auto_research_failed' }, { merge: true });
          continue;
        }

        const updates: any = {
          status: 'researched' as LeadStatus,
          ownerName: enrich.ownerName,
          ownerNameSource: enrich.ownerNameSource,
          enrichmentSummary: enrich.enrichmentSummary,
          personalizationHooks: enrich.personalizationHooks || [],
          enrichmentConfidence: enrich.confidence,
          enrichedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!lead.email && scraped?.emails?.length) updates.email = scraped.emails[0];
        if (!lead.mobile && scraped?.mobiles?.length) updates.mobile = scraped.mobiles[0];
        if (!lead.facebookUrl && scraped?.socials?.facebook) updates.facebookUrl = scraped.socials.facebook;
        if (!lead.instagramUrl && scraped?.socials?.instagram) updates.instagramUrl = scraped.socials.instagram;
        await ref.set(updates, { merge: true });
        enriched++;
      }
    }

    // Generate messages + queue. Runs INDEPENDENTLY of whether this run created
    // new leads — otherwise a week where discovery dedupes everything (e.g.
    // Sydney exhausted) leaves the queue empty and 0 sends. We sweep the whole
    // 'researched' backlog (oldest first), not just leads created this run, so
    // stranded leads from earlier weeks actually get queued. Capped per run to
    // bound Claude cost; the auto-sender trickles them out under its daily cap.
    if (cfg.autoGenerate) {
      const genCap = Math.max(cfg.targetPerWeek, 50);
      // Query by status only (no composite index needed) and sort oldest-first
      // in memory — the researched backlog is at most a few hundred docs.
      const backlogSnap = await db().collection('leads')
        .where('status', '==', 'researched')
        .get();
      const backlogDocs = backlogSnap.docs.sort((a, b) => {
        const am = (a.data() as any)?.enrichedAt?.toMillis?.() ?? 0;
        const bm = (b.data() as any)?.enrichedAt?.toMillis?.() ?? 0;
        return am - bm;
      });
      for (const d of backlogDocs) {
        if (generated >= genCap) break;
        const ref = d.ref;
        const lead: any = d.data();
        // Only auto-generate if we have an email AND meaningful enrichment, and
        // we haven't already written a message for this lead.
        if (!lead.email) continue;
        if (lead.enrichmentConfidence === 'low') continue;
        if (lead.generatedSubject && lead.generatedBody) continue;

        const msg = await claudeGenerateMessage({
          businessName: lead.businessName,
          ownerName: lead.ownerName || null,
          ownerNameSource: lead.ownerNameSource || null,
          enrichmentConfidence: lead.enrichmentConfidence || null,
          trade: lead.trade as Trade,
          suburb: lead.suburb,
          hooks: lead.personalizationHooks || [],
          enrichmentSummary: lead.enrichmentSummary || '',
        });
        if (!msg || !msg.subject || !msg.body) continue;
        const cleanBody = msg.body.replace(/\bAI\b/g, 'smart');
        const cleanSubject = msg.subject.replace(/\bAI\b/g, 'smart');
        await ref.set({
          generatedSubject: cleanSubject,
          generatedBody: cleanBody,
          generatedBodyVersion: admin.firestore.FieldValue.increment(1),
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'queued' as LeadStatus,
          queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        generated++;
      }
    }

    await logAdminAction({
      adminUid: 'system',
      action: 'weekly_discovery_run',
      targetType: 'system',
      payload: {
        campaignId: campaignRef.id,
        created: totalCreated.length,
        dedupedTotal: totalDeduped,
        enriched,
        generated,
        trades: cfg.trades,
        suburbs: cfg.suburbs,
      },
    });

    console.info(`weeklyLeadDiscovery: created=${totalCreated.length} deduped=${totalDeduped} enriched=${enriched} generated=${generated}`);
    return null;
  });

export const adminGetDiscoveryConfig = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  const snap = await db().doc('leadOutreachConfig/discovery').get();
  const config: DiscoveryConfig = snap.exists
    ? { ...DEFAULT_DISCOVERY_CONFIG, ...(snap.data() as any) }
    : DEFAULT_DISCOVERY_CONFIG;
  return { config };
});

export const adminUpdateDiscoveryConfig = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const updates: Partial<DiscoveryConfig> = {};
  if (typeof data?.enabled === 'boolean') updates.enabled = data.enabled;
  if (Array.isArray(data?.trades)) {
    updates.trades = data.trades.filter((t: any) => (TRADES as readonly string[]).includes(t));
  }
  if (Array.isArray(data?.suburbs)) {
    updates.suburbs = data.suburbs.filter((s: any) => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim());
  }
  if (typeof data?.targetPerWeek === 'number') {
    updates.targetPerWeek = Math.max(1, Math.min(500, Math.floor(data.targetPerWeek)));
  }
  if (typeof data?.autoResearch === 'boolean') updates.autoResearch = data.autoResearch;
  if (typeof data?.autoGenerate === 'boolean') updates.autoGenerate = data.autoGenerate;
  if (!Object.keys(updates).length) {
    throw new functions.https.HttpsError('invalid-argument', 'no valid fields to update');
  }
  await db().doc('leadOutreachConfig/discovery').set(updates, { merge: true });
  await logAdminAction({
    adminUid,
    action: 'discovery_config_update',
    targetType: 'system',
    payload: updates,
  });
  return { ok: true };
});

// ============================================================
// brevoInboundWebhook — automatic reply detection
// ============================================================
//
// Brevo posts here on every email received at outreach.hansendev.com.au
// (configure: dashboard → Transactional → Settings → Inbound Parsing).
// Detects auto-responders (ignored), unsubscribe-style replies (DNC), and
// genuine replies (status='replied' + saves snippet on the lead doc).

const AUTO_RESPONDER_SUBJECT = /\b(out\s*of\s*office|auto[\s-]?reply|automatic\s*reply|vacation|on\s*holiday|delivery\s*status|undeliverable|returned\s*mail|mail\s*delivery\s*failed|failure\s*notice)\b/i;
const AUTO_RESPONDER_HEADER_KEYS = ['auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'precedence'];
const AUTO_RESPONDER_HEADER_VALUES = /(auto[-_ ]?(replied|generated|response)|vacation|out[-_ ]?of[-_ ]?office|bulk|junk)/i;

const STOP_KEYWORDS = /\b(stop|unsubscribe|remove\s*me|opt[\s-]?out|don'?t\s*(email|contact|message)\s*me|not\s*interested|leave\s*me\s*alone|take\s*me\s*off)\b/i;

function classifyInboundEmail(payload: {
  subject: string;
  text: string;
  headers: Record<string, string>;
}): 'auto-responder' | 'stop' | 'reply' {
  // Headers first — most reliable signal for auto-responders
  const headers = payload.headers || {};
  for (const key of Object.keys(headers)) {
    const lk = key.toLowerCase();
    if (AUTO_RESPONDER_HEADER_KEYS.includes(lk)) {
      const v = String(headers[key]).toLowerCase();
      if (AUTO_RESPONDER_HEADER_VALUES.test(v)) return 'auto-responder';
    }
  }
  // Subject patterns
  if (AUTO_RESPONDER_SUBJECT.test(payload.subject || '')) return 'auto-responder';
  // Stop/unsub keywords (check first 1000 chars; tradies might paste boilerplate quotes
  // that contain unrelated words, so we want the explicit signal near the top)
  const top = (payload.text || '').slice(0, 1000);
  if (STOP_KEYWORDS.test(top)) return 'stop';
  return 'reply';
}

export const brevoInboundWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const expected = process.env.BREVO_INBOUND_WEBHOOK_SECRET;
    const provided = (req.query.key as string | undefined) || req.get('x-brevo-key');
    if (!expected || !provided || provided !== expected) {
      console.warn('brevoInboundWebhook: unauthorized attempt');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Brevo Inbound Parsing payload — items[] array per their docs.
    const items: any[] = Array.isArray(req.body?.items) ? req.body.items
      : Array.isArray(req.body) ? req.body
      : [req.body];

    let matched = 0;
    let autoresponders = 0;
    let stops = 0;
    let unmatched = 0;

    for (const item of items) {
      const fromEmailRaw = item?.From?.Address
        || item?.from?.[0]?.Address
        || item?.from?.[0]?.address
        || item?.from?.email
        || item?.email
        || item?.sender?.email
        || '';
      const fromEmail = normaliseEmail(fromEmailRaw);
      const subject = String(item?.Subject || item?.subject || '').slice(0, 500);
      const text = String(item?.RawTextBody || item?.text || item?.body || '').slice(0, 5000);
      const headersRaw = item?.Headers || item?.headers || {};
      // Brevo sends headers as either {key: value} or [{Name, Value}]
      const headers: Record<string, string> = {};
      if (Array.isArray(headersRaw)) {
        for (const h of headersRaw) {
          if (h?.Name) headers[String(h.Name)] = String(h.Value || '');
          else if (h?.name) headers[String(h.name)] = String(h.value || '');
        }
      } else if (typeof headersRaw === 'object') {
        for (const [k, v] of Object.entries(headersRaw)) headers[k] = String(v);
      }

      if (!fromEmail) {
        unmatched++;
        console.info('brevoInboundWebhook: no from email', { subject, item });
        continue;
      }

      // Match a lead by email
      const leadSnap = await db().collection('leads').where('email', '==', fromEmail).limit(1).get();
      if (leadSnap.empty) {
        unmatched++;
        console.info(`brevoInboundWebhook: no lead matches ${fromEmail}`);
        continue;
      }
      const leadRef = leadSnap.docs[0].ref;
      const lead = leadSnap.docs[0].data() as any;

      const classification = classifyInboundEmail({ subject, text, headers });
      const at = admin.firestore.FieldValue.serverTimestamp();
      const snippet = text.slice(0, 500);

      if (classification === 'auto-responder') {
        autoresponders++;
        // Don't change status; just record the auto-responder so we don't
        // accidentally count this as a reply later. Useful for debugging too.
        await leadRef.set({
          autoResponderAt: at,
          autoResponderSubject: subject,
        }, { merge: true });
        continue;
      }

      if (classification === 'stop') {
        stops++;
        if (fromEmail) await addSuppression({ type: 'email', value: fromEmail, reason: 'replied-stop' });
        if (lead.googlePlaceId) await addSuppression({ type: 'placeId', value: lead.googlePlaceId, reason: 'replied-stop' });
        await leadRef.set({
          status: 'dnc' as LeadStatus,
          repliedAt: at,
          replyIntent: 'stop',
          replyText: snippet,
          replySubject: subject,
          replyDetectedBy: 'brevo-inbound',
        }, { merge: true });
        continue;
      }

      // Genuine reply
      matched++;
      // Don't downgrade if already converted; otherwise flip to replied
      if (lead.status !== 'converted') {
        await leadRef.set({
          status: 'replied' as LeadStatus,
          repliedAt: at,
          replyIntent: 'neutral', // human can reclassify in the UI
          replyText: snippet,
          replySubject: subject,
          replyDetectedBy: 'brevo-inbound',
        }, { merge: true });
      }
    }

    console.info(`brevoInboundWebhook: matched=${matched} stops=${stops} autoresponders=${autoresponders} unmatched=${unmatched}`);
    res.json({ ok: true, matched, stops, autoresponders, unmatched });
  } catch (err: any) {
    console.error('brevoInboundWebhook: handler error', err);
    res.status(500).json({ error: err?.message || 'webhook error' });
  }
});

// ============================================================
// adminMarkLeadReplied — manual reply marking
// ============================================================
//
// Used while reply detection is manual (you read the reply in Gmail, come
// here, click "Mark replied"). Sets status='replied' so the weekly report
// counts it correctly. Optional `replyText` and `intent` ('positive' /
// 'neutral' / 'negative' / 'stop') get stored for context.

export const adminMarkLeadReplied = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = String(data?.id || '');
  const replyText = String(data?.replyText || '').trim().slice(0, 5000);
  const intent = String(data?.intent || 'neutral') as 'positive' | 'neutral' | 'negative' | 'stop';
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

  const ref = db().doc(`leads/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'lead not found');
  const lead: any = snap.data();

  // Stop intent → also DNC + suppression
  if (intent === 'stop') {
    const e = normaliseEmail(lead.email);
    if (e) await addSuppression({ type: 'email', value: e, reason: 'replied-stop' });
    if (lead.googlePlaceId) await addSuppression({ type: 'placeId', value: lead.googlePlaceId, reason: 'replied-stop' });
    await ref.set({
      status: 'dnc' as LeadStatus,
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      replyIntent: 'stop',
      replyText: replyText || null,
      replyMarkedBy: adminUid,
    }, { merge: true });
  } else {
    await ref.set({
      status: 'replied' as LeadStatus,
      repliedAt: admin.firestore.FieldValue.serverTimestamp(),
      replyIntent: intent,
      replyText: replyText || null,
      replyMarkedBy: adminUid,
    }, { merge: true });
  }

  await logAdminAction({
    adminUid,
    action: 'lead_mark_replied',
    targetType: 'lead',
    targetId: id,
    payload: { intent, hasReplyText: !!replyText },
  });

  return { ok: true };
});

// ============================================================
// 9. adminAddLeadNote — manual note (mirrors users/{uid}/adminNotes)
// ============================================================

export const adminAddLeadNote = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = String(data?.id || '');
  const text = String(data?.text || '').trim();
  if (!id || !text) throw new functions.https.HttpsError('invalid-argument', 'id, text required');
  const ref = db().doc(`leads/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'lead not found');
  await ref.collection('notes').add({
    text,
    authorUid: adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await ref.set({ lastNoteAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await logAdminAction({ adminUid, action: 'lead_add_note', targetType: 'lead', targetId: id });
  return { ok: true };
});

// ============================================================
// 10. onUserCreatedLinkLead — auto-link lead → user on signup
// ============================================================

export const onUserCreatedLinkLead = functions.firestore
  .document('users/{uid}')
  .onCreate(async (snap, context) => {
    const uid = context.params.uid;
    const data = snap.data() as any;
    const email = normaliseEmail(data?.email || data?.businessEmail);
    if (!email) return null;

    const matchSnap = await db().collection('leads').where('email', '==', email).limit(5).get();
    if (matchSnap.empty) return null;

    const batch = db().batch();
    for (const d of matchSnap.docs) {
      batch.set(d.ref, {
        status: 'converted' as LeadStatus,
        convertedUid: uid,
        convertedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // Mirror lead history into user CRM timeline
      const eventRef = db().collection(`users/${uid}/crmEvents`).doc();
      batch.set(eventRef, {
        type: 'lead_converted',
        leadId: d.id,
        leadCampaignId: (d.data() as any).campaignId || null,
        outcome: 'converted',
        notes: `Converted from lead outreach (${(d.data() as any).businessName || 'unknown business'})`,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return null;
  });

// ============================================================
// 11. leadUnsubscribe — public unsubscribe endpoint for cold leads
// ============================================================
//
// Linked from the AU spam-act footer in email.ts. No auth — must be one-click
// per RFC 8058 / Gmail bulk-sender requirements. Marks the lead as DNC and
// permanently suppresses the email + place_id.

const UNSUB_PAGE = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — QuoteMate</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%); min-height:100vh; display:flex; align-items:center; justify-content:center; color:#f8fafc; padding:24px; }
  .card { background:#1e293b; border:1px solid #334155; border-radius:16px; padding:40px; text-align:center; max-width:440px; }
  h1 { color:#f97316; margin:0 0 12px; font-size:22px; }
  p { color:#94a3b8; line-height:1.6; margin:0 0 8px; }
</style></head><body><div class="card">${body}</div></body></html>`;

export const leadUnsubscribe = functions.https.onRequest(async (req, res) => {
  // Accept GET (link click) and POST (RFC 8058 List-Unsubscribe-Post one-click)
  const to = String((req.query.to as string) || (req.body?.to as string) || '');
  const leadId = String((req.query.lead as string) || (req.body?.lead as string) || '');
  const email = normaliseEmail(to);

  if (!email) {
    res.status(400).send(UNSUB_PAGE('Invalid link', '<h1>Invalid link</h1><p>This unsubscribe link is missing required info.</p>'));
    return;
  }

  try {
    await addSuppression({ type: 'email', value: email, reason: 'unsubscribed' });
    const dom = domainOf(email);
    if (dom) await addSuppression({ type: 'domain', value: dom, reason: 'unsubscribed' });

    if (leadId) {
      const ref = db().doc(`leads/${leadId}`);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set({
          status: 'dnc' as LeadStatus,
          unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectionReason: 'unsubscribed',
        }, { merge: true });
        const lead: any = snap.data();
        if (lead?.googlePlaceId) {
          await addSuppression({ type: 'placeId', value: lead.googlePlaceId, reason: 'unsubscribed' });
        }
      }
    } else {
      // Best-effort: flip any leads matching this email to DNC.
      const matches = await db().collection('leads').where('email', '==', email).limit(20).get();
      const batch = db().batch();
      for (const d of matches.docs) {
        batch.set(d.ref, {
          status: 'dnc' as LeadStatus,
          unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectionReason: 'unsubscribed',
        }, { merge: true });
      }
      if (!matches.empty) await batch.commit();
    }
  } catch (err: any) {
    console.error('leadUnsubscribe failed', err);
    res.status(500).send(UNSUB_PAGE('Error', '<h1>Something went wrong</h1><p>Please email tom@hansendev.com.au and I\'ll remove you manually.</p>'));
    return;
  }

  res.status(200).send(UNSUB_PAGE('Unsubscribed', `<h1>You're off the list</h1><p>I won't email <strong>${email}</strong> again from QuoteMate. Sorry for the intrusion.</p><p style="margin-top:16px;font-size:13px;">— Tom</p>`));
});

// ============================================================
// 12. brevoLeadEventSync — used by extended brevoEmailWebhook in adminCrm.ts
// ============================================================
//
// Exported helper called from brevoEmailWebhook so we don't duplicate webhook
// auth/parsing. Given a Brevo event tag list, finds any 'lead:<id>' tag and
// updates the lead doc accordingly.

export async function applyBrevoEventToLead(params: {
  tags: string[];
  event: string;
  email: string | null;
  at: admin.firestore.FieldValue | admin.firestore.Timestamp;
  reason?: string | null;
}): Promise<void> {
  const leadTag = params.tags.find(t => typeof t === 'string' && t.startsWith('lead:'));
  if (!leadTag) return;
  const leadId = leadTag.slice('lead:'.length);
  if (!leadId) return;
  const ref = db().doc(`leads/${leadId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const lead: any = snap.data();
  const event = params.event.toLowerCase();

  const update: any = {
    [`brevoEvents.${event}.at`]: params.at,
    [`brevoEvents.${event}.count`]: admin.firestore.FieldValue.increment(1),
    lastBrevoEvent: event,
    lastBrevoEventAt: params.at,
  };

  switch (event) {
    case 'opened':
    case 'unique_opened':
      update.openCount = admin.firestore.FieldValue.increment(1);
      if (!lead.openedAt) update.openedAt = params.at;
      if (lead.status === 'sent') {
        update.status = 'engaged' as LeadStatus;
        update.engagedAt = params.at;
      }
      break;
    case 'click':
      update.clickCount = admin.firestore.FieldValue.increment(1);
      if (!lead.firstClickedAt) update.firstClickedAt = params.at;
      if (lead.status === 'sent' || lead.status === 'engaged') {
        update.status = 'engaged' as LeadStatus;
        if (!lead.engagedAt) update.engagedAt = params.at;
      }
      break;
    case 'unsubscribe':
      update.status = 'dnc' as LeadStatus;
      update.unsubscribedAt = params.at;
      if (params.email) await addSuppression({ type: 'email', value: params.email, reason: 'unsubscribed' });
      break;
    case 'spam':
      update.status = 'dnc' as LeadStatus;
      update.spamReportedAt = params.at;
      if (params.email) await addSuppression({ type: 'email', value: params.email, reason: 'spam' });
      break;
    case 'hard_bounce':
      update.status = 'bounced' as LeadStatus;
      update.bouncedAt = params.at;
      update.bounceReason = params.reason || 'hard_bounce';
      if (params.email) await addSuppression({ type: 'email', value: params.email, reason: 'hard_bounce' });
      break;
    case 'soft_bounce':
      update.softBouncedAt = params.at;
      update.bounceReason = params.reason || 'soft_bounce';
      break;
    case 'blocked':
    case 'invalid_email':
    case 'error':
      update.deliveryError = params.reason || event;
      break;
    default:
      break;
  }

  await ref.set(update, { merge: true });
}
