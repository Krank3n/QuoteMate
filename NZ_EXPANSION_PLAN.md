# New Zealand Expansion Plan

Status: draft, 2026-07-29. Scope: make QuoteMate usable by NZ tradies — correct GST/currency, Bunnings NZ pricing via the scraper, and Reece NZ trade pricing.

---

## 0. The core problem

There is **no country concept anywhere in the codebase**. `BusinessSettings` (`src/types/index.ts:562`) has no `country` field, and AU is baked in at ~10 distinct layers:

| Layer | Hardcoded as | Where |
|---|---|---|
| GST rate | `1.1` / `0.1` / `1/11` | 12 non-test sites (see §2) |
| Currency | `AUD`, `en-AU` | `documentCalculator.ts:36-38`, ~18 sites in `functions/src/index.ts` |
| Tax ID | `ABN` | `htmlBuilders.ts:550/747/832`, `email.ts:1791/1874/1722` |
| Scraper target | `bunnings.com.au` | scraper `scraper.ts:470/1130`, `parser.ts:28/83/150`, `server.ts` ×5 |
| Supplier catalogue | every URL `.com.au` | `src/constants/tradeStores.ts` (whole file) |
| Reece region | `REECE_REGION` env, global | `functions/src/index.ts:3025` + 11 call sites |
| Address lookup | `components: 'country:au'` | `functions/src/index.ts:4883` |
| LLM prompts | "Australian tradie", "AUD", Bunnings AU | 16 prompt sites (see §5) |
| Payments | Square `CurrencyCode.AUD`, PayID | `squarePayments.ts:132/136`, 63 PayID refs |
| Scheduling | `Australia/Sydney` | 35 sites across scheduled functions |

So this is not "add NZ URLs" — it's introducing a region axis and then threading it through pricing, tax, and supplier routing. The good news: GST already routes through one resolver (`shared/document/gstMode.ts`) and Reece already routes through one `REECE_REGION` constant. Those two patterns are the template for everything else.

**Strategic note before building:** per `project_marketing_gated_on_conversion`, marketing is on hold until trial→paid hits ~5% (currently 3 real payers / 306 signups). Adding a country widens the top of a funnel that leaks at the bottom. This plan is written assuming you want NZ anyway (a second market is also a second shot at product-market fit) — but Phase 5 (distribution/spend) should stay gated on the same conversion metric, tracked **separately** for NZ so it doesn't blend into the AU numbers.

---

## 1. Verified external facts

Checked, not assumed:

- **Bunnings NZ is scrapeable on the same platform** — since confirmed end-to-end with the real parser, see §3.0. `https://www.bunnings.co.nz/search/products?q=treated+pine` returns the same search-results structure as AU (verified live: "200 x 25mm Radiata Merch Treated Pine H4 Green Sawn $8.99/lm", "190 x 45mm SG8 H3.2 KD Treated Radiata Timber Framing - 6m $125.09"). Same URL pattern, same layout family → the existing `__NEXT_DATA__` parser is very likely to work with only a base-URL swap. Note the product vocab: **SG8**, **H3.2** — not MGP10/H3 (see §5).
- **Reece operates in NZ**: 30 branches, `reece.co.nz`, same maX platform. Mico is **not** Reece — it's Fletcher Building, a competitor. Don't build against Mico.
- **The Reece API is already region-shaped**: `.claude/skills/reece-api/SKILL.md:65-77` documents all endpoints as `/{au|nz}/...`. Our backend already has `REECE_REGION` defaulting to `au`.
- **Square is NOT available in New Zealand.** Square's own availability page lists AU, CA, FR, IE, JP, ES, UK, US only. This is a hard blocker for the NZ payments story (§7).
- **NZ GST is 15%**, registration threshold **NZ$60,000** (vs AU$75,000). Tax invoices need supplier name + **GST number**; buyer details required above NZ$1,000. NZBN is a separate business identifier.

---

## 2. Phase 1 — Region foundation (must land first)

Rationale for ordering: every downstream phase produces prices. If the scraper ships first, NZD shelf prices get multiplied by 1.1 and rendered with an "ABN" footer. Foundation first.

### 2.1 New module: `shared/document/region.ts`

Mirrors `gstMode.ts` exactly (same "undefined means legacy AU" invariant that `gstRegistered` already uses):

```ts
export type Region = 'AU' | 'NZ';
export function resolveRegion(source: { country?: string }): Region  // undefined → 'AU'
export function gstRateFor(region: Region): number        // 0.10 | 0.15
export function gstMultiplierFor(region: Region): number  // 1.1  | 1.15
export function gstLabelFor(region: Region): string       // 'GST (10%)' | 'GST (15%)'
export function taxIdLabelFor(region: Region): string     // 'ABN' | 'GST No.'
export function currencyFor(region: Region): 'AUD'|'NZD'
export function localeFor(region: Region): 'en-AU'|'en-NZ'
```

Lives in `shared/` because `src/`, `functions/`, and `shared/pdf` all need it. Keep it **two-valued** — no generic i18n framework, no locale registry (`feedback_limit_ui_options`).

### 2.2 Data model

- `BusinessSettings.country?: 'AU' | 'NZ'` (`src/types/index.ts:562`).
- **Snapshot `country` onto every Quote/Invoice/Document at creation**, exactly like `pricesIncludeGst`/`gstRegistered` (`src/types/index.ts:394-402`). Non-negotiable: without it, a user switching country silently re-taxes every historical document and every PDF regenerates wrong.
- Onboarding: add country to the **existing Company step** (`NewOnboardingScreen.tsx:90`) rather than a 6th step — prefill from device locale/timezone, one control, no new screen (`feedback_onboarding_simple`).

### 2.3 GST/currency call sites to convert

Client:
- `src/utils/documentCalculator.ts:31` (`/1.1`), `:107-116` (total + gst), `:36-38` (`en-AU`/`AUD`)
- `src/store/useStore.ts:1577-1578` (live recalc)
- `src/services/materialsPipeline.ts:1387` (`* 1.1`)
- `src/screens/ReeceOrderScreen.tsx:257` (`/1.1`)
- `src/utils/jobTimeline.ts:49-51` (`en-AU`)
- `src/screens/settings/BusinessDefaultsScreen.tsx:36` ("1/11 disclosure" copy)

Shared/server:
- **`shared/document/integrityCheck.ts:184`** (`subWithMarkup * 1.1`) — highest-risk single line in the project. Unconverted, every NZ document fails the integrity check and reads as tampered.
- `shared/pdf/htmlBuilders.ts:434-435` (subtotal/GST labels), `:550/747/832` (ABN label)
- `functions/src/accountReclaim.rebuild.ts:58/65/115`
- `functions/src/xeroSync.ts:91` (`TaxType: 'OUTPUT'`), `:102` (`/1.1`), `:60` (`Country: 'AU'`)
- `functions/src/index.ts:11540` (invoice TaxType), `:11176`/`:11522` (`Country:'AU'`), `:11228`/`:11598` (`CurrencyCode:'AUD'`), `:4047` (`gstRate: 10`), `:7083-7084` (admin currency format)
- `functions/src/email.ts:1722` (`stripAbnFromBody` regex must also strip `GST No.`)

**Xero caveat:** NZ Xero orgs use different tax type codes than AU (`OUTPUT` is the AU 10% code). Verify the NZ equivalents against the Xero API before shipping the NZ sync — getting this wrong writes bad tax codes into a customer's ledger. If unverified at ship time, disable Xero sync for NZ users rather than guess.

### 2.4 Acceptance gate for Phase 1

Every existing AU test passes **unchanged**, plus new named cases:
- `region.test.ts`: `resolveRegion({})` → `'AU'`; `gstRateFor('NZ')` → `0.15`
- `documentCalculator.test.ts`: NZ exclusive 1000 → total 1150 / gst 150; NZ inclusive 1150 → gst 150; NZ not-registered → gst 0
- `integrityCheck.test.ts`: NZ doc at 15% passes; AU doc at 10% still passes (regression)
- `htmlBuilders.gst.test.ts`: NZ renders `GST (15%)` and `GST No.`; AU unchanged

---

## 3. Phase 2 — Scraper NZ (`/Users/tom/Documents/GitHub/bunnings-scraper`)

> **Spike completed 2026-07-29.** Ran the repo's real `parseSearchResults()` (from `dist/parser.js`) against `bunnings.co.nz` with scraper.ts's exact context/goto/selector setup. Harness in `scratchpad/nz-spike.js` + `nz-diag.js` + `nz-filter-ab.js`. AU control passed first (9 products, AUD) to prove the harness faithful. Results below are measured, not predicted.

### 3.0 Spike results

**Works out of the box:**
- `bunnings.co.nz/search/products?q=` returns **HTTP 200 from an AU residential IP with no proxy at all** — no Cloudflare challenge, no geo-redirect. **The planned `PROXY_URL_NZ` is unnecessary** — dropped from this plan (saves Decodo cost and a config path).
- Identical platform internals: `#__NEXT_DATA__` present, same `props.pageProps.dehydratedState.queries[0].state.data.results` path, same `[data-locator^="search-product-tile"]` tiles. **The unmodified parser parses NZ pages** — 15 products for "gib board 10mm", 36 for "treated pine decking", 22 for "plasterboard 10mm".
- `"currency":"NZD"` confirmed in the payload.

**Four defects found:**

1. **CONFIRMED BUG — every NZ product URL 404s.** `parser.ts:28/83/150` prefix relative routing URLs with the hardcoded AU base, so NZ products emit `bunnings.com.au` links. Verified live:
   - emitted: `https://www.bunnings.com.au/proroc-2400-x-1200-x-10mm-standard-plasterboard_p0267085` → `"Page Not Found - Bunnings Australia"`, h1 `Error 404`
   - corrected: same path on `bunnings.co.nz` → the right product, `$33.38`
   
   Not cosmetic: these links go into quotes and material cards a tradie taps through.

2. **HYDRATION RACE — and this is an existing AU bug, not an NZ one.** The wait condition (`scraper.ts:~500`) waits for `#__NEXT_DATA__` *or* a tile element, but the script tag exists before results are populated. Measured on `"90x45 framing"`: parsed **0 products immediately after the selector fired, 17 products 3s later** on the same page. The parser silently fell through to CSS selectors and returned nothing. In production this is an invisible zero-result generator — the material drops to an LLM estimate with no error logged. **Fix regardless of NZ**: wait for a populated `results` array in the payload (or a rendered price), not for the script tag. Worth its own ticket ahead of the NZ work.

3. **AU vocabulary hard-zeros on NZ.** `"90x45 MGP10"` → literally `0 of 0 results` with the site's no-results copy (selector MISS). Not degraded ranking — nothing. Meanwhile `"SG8 framing"` → 8 products, `"H3.2 timber framing"` → 5. Confirms §3.4 is required work, not polish. NZ catalogue is a different brand set: **GIB / ProRoc** where AU has **Gyprock / CSR**.

4. **The AU filter params cost NZ half its candidates.** Isolated per-param on `"plasterboard 10mm"`:

   | params | NZ results | AU results |
   |---|---|---|
   | `sort` only | 22 | 22 |
   | `+ stockAvailability=In+Stock` | 11 | 11 |
   | `+ productranges=!Special Order\|!Marketplace` | **11** | **22 (no-op)** |
   | both (what we send today) | 11 | 11 |

   Dropped items are exactly the big sheets a plasterer wants — 4800, 6000, 3600 TE/SE. **Prices for shared items are identical** (0 of 15 and 0 of 9 differ filtered vs unfiltered), so this is pure coverage loss, not price distortion. Whether it's true filtering or a payload-shape artifact isn't pinned down; either way NZ needs its own validated param set rather than a copy of AU's.

**One loose end:** item `0299359` (GIB 10x3600x1200) read `$51.23` in the first run and `$56.11` in two later runs. Not filter-related (the A/B shows filters don't move prices) and not reproducible afterwards. NZ result *sets* also reshuffle between runs under `BoostOrder`. Logged as unexplained — re-check during implementation rather than assume price instability. (A `$59.75` reading in an intermediate run was my own harness bug: the name fragment `10x3600x1200` matches five GIB variants.)

### 3.1 Region param end-to-end

- `src/types.ts`: `region?: 'au' | 'nz'` on `SearchRequest`, `BatchSearchRequest`, warm-cache request. Default `'au'`.
- `src/scraper.ts`: `const BASE = { au: 'https://www.bunnings.com.au', nz: 'https://www.bunnings.co.nz' }`; thread region into `playwrightSearch()` (`:455`, URL at `:470`) and `getProductDetail()` (`:1120`, URL at `:1130`).
- `src/parser.ts`: three hardcoded `https://www.bunnings.com.au` URL joins at `:28`, `:83`, `:150` — pass the base into `page.evaluate` (it already takes an arg). **Confirmed broken by the spike** (defect 1 above), so this one has a ready-made regression test: an NZ result's `productUrl` must resolve 200 with a matching h1.
- Search params: region-specific set, not the AU copy (defect 4). Start NZ from `sort` only and re-add filters one at a time against a measured result count.
- `src/utils.ts:calculateGstPrice` — takes a rate instead of hardcoding `* 1.1`.
- Browser context (`src/scraper.ts:259-312`): `locale: 'en-NZ'`, `Accept-Language: 'en-NZ,en;q=0.9'`, `languages: ['en-NZ','en-US','en']`, geolocation → Auckland `(-36.8485, 174.7633)` instead of Sydney.
- `src/metrics.ts` / logging: tag region so `/metrics` reports per-region success rate (the health endpoint gates `priceFetchGate`).

### 3.2 Cache keying — the critical bug to avoid

`src/server.ts:182/316/368/478/507` all build `createCacheKey('search', searchTerm, limit, sortBy)`. **Region-blind.** As-is, the first tradie to search "treated pine" poisons the cache for the other country, with no visible symptom.

The spike sharpened what this actually produces. Item numbers turn out to be **region-scoped — 0 collisions across a 22 × 22 sample** — and the catalogues are genuinely disjoint:

| AU ("plasterboard 10mm") | NZ (same query) |
|---|---|
| `0731415` Gyprock CSR 2400x1200x10mm — $24.25 | `0267085` ProRoc 2400x1200x10mm — $33.38 |
| `0730037` Gyprock CSR 2700x1200x10mm — $26.45 | `0299359` GIB® 10x3600x1200mm — $56.11 |

So the failure mode isn't "same item, wrong price" — it's **an AU tradie's quote filling with GIB/ProRoc products at NZD prices** (or an NZ tradie getting Gyprock at AUD). Louder in hindsight, and it survives review because every individual row looks plausible. Region must be part of the key:

```ts
createCacheKey('search', region, searchTerm, String(limit), sortBy)
```

Test: same term + different region ⇒ different keys (regression test, `feedback_tickets_require_real_tests`).

Belt-and-braces: carry a `currency` field on every scraper result and assert it matches the quote's region at the point prices enter a document.

### 3.3 Proxy geo — resolved, no work needed

**Spike answered this: no NZ proxy required.** `bunnings.co.nz` served HTTP 200 with full pricing from a bare AU residential IP, no proxy, no Cloudflare challenge. The existing `PROXY_URL` (Decodo via `proxy-chain`, see `project_proxy_chain_chromium`) can serve both regions unchanged. Re-verify once from the droplet's datacentre IP, since that's a different reputation class than a residential one — but do not build `PROXY_URL_NZ` on spec.

### 3.4 NZ product vocabulary (the real quality work)

This is bigger than the URL swap. `semanticCompatible()` (`:668`) and `isStrictSemanticQuery()` (`:936-937`) encode AU trade vocab, and `common-materials.ts` warms an AU cache. NZ names differ enough to return **zero matches**:

| AU | NZ |
|---|---|
| Gyprock / CSR plasterboard | **GIB** / **ProRoc** (spike-confirmed brands) |
| Colorbond | **Colorsteel** |
| MGP10 / F7 framing | **SG8** (`"90x45 MGP10"` → 0 results on NZ) |
| H3 / H4 treatment | H1.2 / H3.1 / H3.2 (different classes) |
| SL72 / SL82 reo mesh | 665 / 668 mesh |
| Batts (generic) | **Pink Batts** |
| Villaboard | Gib Aqualine |

Deliverables: NZ synonym layer feeding both the semantic gate and the search-term generator, plus a region-specific `common-materials` warm list. Then run the existing quote-replay harness (`quote-replay-priced-audit-*.json`) against NZ terms and set a coverage floor before launch — otherwise NZ quotes silently fall through to LLM estimates.

### 3.5 Firebase proxies (`functions/src/index.ts`)

All three proxies destructure explicit fields, so region must be added deliberately:
- `bunningsScraperSearch:11734` — add `region`, validate against `['au','nz']`, default `'au'`
- `bunningsScraperBatchSearch:11783` — same
- `bunningsScraperProduct:11839` — same
- `fetchStoreHTML:5251` — `allowedDomains` needs the `.co.nz` domains
- `claudeProductSearch:11958` — prompt hardcodes "Australian tradesperson" + "bunnings.com.au"
- `parseProductsHTML:5480-5495` — "Prices MUST be in AUD"
- `placesAddressAutocomplete:4883` — `components: 'country:au'` → region-derived

Region is not a security boundary (it just selects a public website), so client-supplied + allowlist-validated is fine and avoids a Firestore read on all ~30 calls per price run.

---

## 4. Phase 3 — Reece NZ

Best-positioned piece: `REECE_REGION` (`functions/src/index.ts:3025`) already gates all 11 API call sites. Two changes:

1. **Global env → per-user.** Store `region` on `users/{uid}/integrations/reece` at connect time (derived from `BusinessSettings.country`). Both `getReeceCustomerToken()` and `getCachedReeceCatalogue()` already read that doc, so region rides along at zero extra read cost. Replace the const with `reeceRegionFor(uid)`.
2. **Consent + copy.** `:4258` and `:5022` hardcode `https://reece.com.au/link-application/...`. NZ likely needs `reece.co.nz` — verify. Copy refs to fix: `NewOnboardingScreen.tsx:716`, `ReeceIntegrationScreen.tsx:393`, `MaterialsListScreen.tsx:1613-1617`, `reeceApi.ts:197`, `index.ts:3373`.

**External dependency — start now, longest lead time.** Email Christie Howard (Christie.Howard@reece.com.au) / ConnectingCustomers@reece.com.au to confirm:
- Does the existing `QUOTEMATE` client ID work against `/nz/`, or is a separate NZ client registration + approval needed?
- Is the maX consent host the same for NZ accounts?
- Is `price-gateway/price-file` (MAX_JSON) available for NZ, same schema?
- Does `REECE_CALLBACK_URL` need an NZ allowlist entry?
- Does the NZ order-gateway accept a different address shape?

**Order screen is AU-only** (`ReeceOrderScreen.tsx:113-142`): parses `VIC|NSW|QLD|SA|WA|TAS|NT|ACT` and validates against AU Post records. NZ has region names, not state codes. Needs an NZ address branch once the NZ order-gateway spec is known — and `:257`'s `/1.1` becomes 1.15.

**Ship-without-Reece is acceptable.** If Reece NZ approval drags, launch NZ on Bunnings-only pricing and turn Reece on later. Don't let an external approval block the market.

---

## 5. Phase 4 — Content, prompts, compliance

### 5.1 LLM prompts (16 sites)

`llmService.ts:358/643/654/727/741/1074/1157`, `webSearchPricing.ts:53-59`, `assistant/systemPrompt.ts:8/108`, `functions/src/index.ts:1904/2291/2911-2917/5365/5480/5629/11958`.

Replace the literal "Australian" with a shared `regionPromptContext(region)` snippet carrying: currency, GST rate, the store domain, the §3.4 vocab, NZ Building Code (not NCC), LBP/PGDB registration (not state licensing). This is a **quality lever, not cosmetics** — a NZ tradie whose materials list says "Gyprock" and "Colorbond" gets zero shelf prices.

### 5.2 Supplier catalogue

`src/constants/tradeStores.ts` is entirely `.com.au`. Add an NZ table and make `getStoresForTrade(trade, region)` / `getDefaultStoresForTrade(trade, region)` region-aware:
- General: Bunnings NZ, Mitre 10 NZ, PlaceMakers, ITM, Carters
- Plumbing: Reece NZ, Plumbing World, Mico
- Electrical: Ideal Electrical, Corys, JA Russell (`voltex.co.nz` is already in `webScrapingPricing.ts:31` — orphaned)

Also `webScrapingPricing.ts:14-33` STORE_SEARCH_URLS, and the `bunnings.com.au` string comparisons scattered through `MaterialsListScreen.tsx:1301/1599/1614`, `AddMaterialScreen.tsx:808`, `MaterialItemCard.tsx:86`, `materialFavorites.ts:326`, `materialsPipeline.ts:520/960/1074/1111`, `materialSearch.ts:77/144`.

### 5.3 Compliance

- Tax ID label ABN → GST No. (§2.3), plus NZBN as an optional second field if you want it on invoices.
- GST-registration copy: threshold NZ$60,000 not AU$75,000.
- NZ taxable-supply-information rules: current PDF already carries supplier name, GST amount, and buyer details — mainly a labelling change. Buyer details are mandatory above NZ$1,000.
- Website (`QuoteMateAppWebsite`): `app/privacy/page.tsx` needs NZ Privacy Act 2020; `app/terms/page.tsx` needs a check for Australian Consumer Law references.

### 5.4 Push notification copy

`functions/src/aussieNotifications.ts` — "Ripper!", "Bewdy!", "legend" reads as foreign in NZ. Region-keyed pool with NZ flavour ("Sweet as", "Chur", "Good as gold"), staying gender-neutral (`feedback_copy_tone_aussie_inclusive`). 176 total `australia|aussie` hits across the codebase — sweep with an extension to the existing `emailCopy.guard.test.ts` that fails on AU-only tokens in region-agnostic copy.

---

## 6. Phase 5 — Distribution & measurement

- **App Store / Play**: enable NZ availability; NZ subscription price tiers. IAP localizes automatically, but `PaywallScreen.tsx:351/353/370-371` hardcodes `'$49'`/`'$328'` fallbacks — a NZ user hitting the fallback sees AU pricing. Fall back to store-localized values or hide the price.
- **Stripe web checkout**: needs NZD price objects, or accept AUD for v1 (NZ cards take an FX fee — worth noting in copy).
- **Website**: `quotemateapp.au` is an AU-signalling domain. Cheapest path is NZ city pages through the existing `[tradeSlug]/[citySlug]` generator (Auckland, Wellington, Christchurch, Hamilton, Tauranga, Dunedin). A `.co.nz` domain is the stronger SEO play but a bigger commitment.
- **Admin CRM**: region column + filter so the NZ funnel is measured on its own, not blended into AU (see the strategic note in §0).
- **Scheduling**: 35 `Australia/Sydney` sites in scheduled functions. NZ is +2/+3h, so nudges and digests land at odd NZ hours. v1: accept it. v2: a second cron at `Pacific/Auckland` filtered by region.

---

## 7. Payments — known gap, decide before launch

Square is not available in NZ. Consequences:
- Square connect + Tap to Pay must be hidden for NZ users (mirror the flag-list approach in `project_ios_payments_gated`).
- **PayID is AU-only** (63 refs) — hide for NZ. NZ bank transfer uses a plain account number (`BB-bbbb-AAAAAAA-SSS`), so `PaymentMethodsScreen` needs an NZ account-number field instead of BSB + PayID.
- Deposit payment links on quote-send are Square-backed → **NZ quotes cannot take deposits or card payments online.** NZ v1 is bank-transfer-only.

Given `project_monetization_square` (revenue thesis = Square payment cuts), NZ launched on bank transfer earns subscription revenue only. Stripe supports NZ and could carry payment links as a follow-up — worth costing before committing to NZ as a growth market.

---

## 8. Phase 0 — Do these first, in parallel

1. ~~**Scraper spike.**~~ **DONE 2026-07-29** — see §3.0. Verdict: NZ is scrapeable with the existing parser, no proxy needed; four defects identified, one of which (the hydration race) is an AU bug worth fixing first.
2. **Email Reece today.** Longest lead time on the critical path (§4). Now the *only* remaining external unknown.
3. **Decide the NZ payments stance** (§7) — it changes whether NZ is a real market or a trial-only one.
4. ~~Confirm Decodo NZ geo targeting~~ — moot, no NZ proxy needed.
5. **New, ahead of NZ: fix the hydration race** (§3.0 defect 2). It silently costs AU coverage today.

---

## 9. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **Hydration race (existing, AU too)** | Silent 0-result terms → materials fall to LLM estimates, no error logged | Wait on populated results, not the script tag (§3.0 defect 2). Fix before NZ |
| Region-blind scraper cache | AU quotes filled with NZ GIB/ProRoc at NZD prices, every row individually plausible | Region in cache key (§3.2) + currency assertion at document entry |
| NZ product links 404 | Tradie taps a material and lands on a Bunnings AU error page | Region base in `parser.ts` (§3.0 defect 1) + resolve-check regression test |
| AU filter params on NZ | ~50% of NZ candidates dropped, incl. the large sheets | Region-specific param set, measured (§3.0 defect 4) |
| `integrityCheck.ts:184` unconverted | Every NZ doc reads as tampered | Phase 1 gate, explicit regression test |
| Reece NZ needs separate client approval | NZ plumbers get no trade pricing | Ship NZ Bunnings-only; Reece as a follow-on |
| AU vocab returns no NZ matches | Coverage silently drops to LLM estimates | Synonym layer + replay-harness coverage floor before launch |
| Xero NZ tax codes guessed | Bad tax codes in a customer's ledger | Verify against Xero API, else disable Xero for NZ |
| Square gap | No online deposits/card payments in NZ | Decide in Phase 0; consider Stripe |
| Scope creep to "multi-region" | Weeks of abstraction for one country | Keep `Region` two-valued; no i18n framework |

## 10. Rough effort

| Phase | Estimate |
|---|---|
| 0 — Spikes | ~~1 day~~ scraper spike **done**; Reece email outstanding |
| 0b — Hydration-race fix (AU + NZ) | 0.5 day, do first |
| 1 — Region foundation | 2–3 days |
| 2 — Scraper NZ | 1–2 days (parser change is smaller than feared) + vocab tuning |
| 3 — Reece NZ | 2 days (gated on Reece) |
| 4 — Content & compliance | 2 days |
| 5 — Distribution | 1–2 days |

~2 weeks of build. Reece approval is the schedule risk; the vocab layer is the quality risk.
