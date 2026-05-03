# Lead Outreach — Sender Domain Setup (Brevo + DNS)

End-to-end guide for setting up an isolated sender for cold lead outreach so spam complaints don't poison the transactional domain (`hansendev.com.au`) used for Stripe receipts, welcome emails, password resets, etc.

**Plan**: send cold outreach `From` a subdomain like `outreach.hansendev.com.au`. Authentication (DKIM/SPF/DMARC) is set up on the subdomain only. If complaints accumulate, only the subdomain reputation suffers — the main domain stays clean.

**Prereqs**
- Access to the DNS provider for `hansendev.com.au` (Cloudflare, Namecheap, Route 53, GoDaddy, whichever).
- Brevo admin login.
- Ability to edit `functions/.env` and run `firebase deploy`.

Total time: ~30 min Brevo + DNS work, then ~5 min env vars + deploy. DNS propagation can take 1–24 hours.

---

## Step 1 — Add the subdomain in Brevo

1. Log in to [app.brevo.com](https://app.brevo.com).
2. Click your profile (top right) → **Senders, Domains & Dedicated IPs**.
3. Tab: **Domains** → click **Add a domain**.
4. Enter: `outreach.hansendev.com.au`
5. Tick **"I want to digitally sign my emails"** (DKIM) — required for deliverability.
6. Click **Save and continue**.

Brevo now displays 4 DNS records you must add: a Brevo-code TXT, a DKIM TXT, an SPF TXT, and a DMARC TXT. Keep this tab open — you'll come back to verify.

---

## Step 2 — Add the DNS records

In your DNS provider, add records for the **subdomain** `outreach`. Exact host names depend on the provider:

| Brevo says | What to enter as Host / Name |
|---|---|
| `outreach.hansendev.com.au` | Most providers: just `outreach`. Cloudflare: `outreach`. |
| `mail._domainkey.outreach.hansendev.com.au` | Most providers: `mail._domainkey.outreach`. Cloudflare: `mail._domainkey.outreach`. |
| `outreach.hansendev.com.au` (SPF, TXT) | Same as the first. |
| `_dmarc.outreach.hansendev.com.au` | Most providers: `_dmarc.outreach`. |

The four records, in order:

### A. Brevo verification (TXT)
- **Type**: TXT
- **Host**: `outreach`
- **Value**: the `brevo-code:xxxxxxxxxxxxxxxx` string Brevo generates. Copy verbatim.

### B. DKIM (TXT)
- **Type**: TXT
- **Host**: `mail._domainkey.outreach`
- **Value**: the long `k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4...` string from Brevo. Copy as one line, no extra spaces.

### C. SPF (TXT)
- **Type**: TXT
- **Host**: `outreach`
- **Value**: `v=spf1 include:spf.brevo.com mx ~all`
- ⚠️ If you already have a TXT record on `outreach` (from step A), **merge them** — only one SPF record per host is allowed.

### D. DMARC (TXT)
- **Type**: TXT
- **Host**: `_dmarc.outreach`
- **Value** (start permissive — tighten later):
  ```
  v=DMARC1; p=none; rua=mailto:tom@hansendev.com.au; pct=100
  ```
- After the first month with no issues, change `p=none` to `p=quarantine`.

Save. DNS propagation usually < 1 hour but can take up to 24h.

---

## Step 3 — Receiving replies (MX setup — pick one)

This is the part most setups miss. Steps 1–2 only handle **outbound** auth. To **receive replies** at `tom@outreach.hansendev.com.au`, the subdomain needs an MX record.

Pick **one** of:

### Option A — Cloudflare Email Routing (free, easiest if DNS is on Cloudflare)
1. Cloudflare Dashboard → your `hansendev.com.au` zone → **Email** → **Email Routing**.
2. Enable Email Routing (Cloudflare auto-adds the MX records).
3. Click **Routes** → **Custom address** → enter `tom@outreach.hansendev.com.au` and forward to your real Gmail.
4. Click **Settings** → confirm MX is on the **subdomain** (you may need to add a custom rule).

If Cloudflare won't let you add Email Routing for a subdomain only (sometimes they apply it zone-wide), use Option B instead.

### Option B — ImprovMX (free, works anywhere)
1. Go to [improvmx.com](https://improvmx.com) → sign up free.
2. Add domain: `outreach.hansendev.com.au`.
3. ImprovMX gives 2 MX records (`mx1.improvmx.com`, `mx2.improvmx.com`) and 1 SPF record adjustment. Add to DNS.
   - Important: the SPF you set in Step 2C must include both Brevo and ImprovMX:
     ```
     v=spf1 include:spf.brevo.com include:spf.improvmx.com mx ~all
     ```
4. Add an alias `tom@outreach.hansendev.com.au` → forwards to `tom@gmail.com` (or wherever).

### Option C — Google Workspace (paid, ~$8/mo)
If you want a real inbox you can send replies *from*. Add the subdomain in Workspace, follow their MX setup. Overkill for MVP.

**Recommended for now**: Option B (ImprovMX). 5 minutes, free, replies land in Gmail. Upgrade later if volume grows.

---

## Step 4 — Verify in Brevo

1. Back in Brevo (the open tab from Step 1), click **Authenticate this domain** / **Verify** next to each record.
2. Wait for DNS to propagate. You can check propagation at [dnschecker.org](https://dnschecker.org/) — paste each host name and select the right record type.
3. Once Brevo shows ✅ next to all four records, the domain is verified.

---

## Step 5 — Add the sender in Brevo

1. Same page → tab: **Senders** → **Add a new sender**.
2. **From name**: `Tom` (matches what the email signs off as)
3. **From email**: `tom@outreach.hansendev.com.au`
4. Save. Brevo will send a verification email — open it in whatever inbox you forwarded the address to (Step 3) and click confirm.

---

## Step 6 — Update `functions/.env`

Add these four lines:

```env
OUTREACH_SENDER_EMAIL=tom@outreach.hansendev.com.au
OUTREACH_SENDER_NAME=Tom
OUTREACH_REPLY_TO_EMAIL=tom@outreach.hansendev.com.au
OUTREACH_REPLY_TO_NAME=Tom
```

Optional (only if you ever front the unsubscribe handler with a custom domain like `unsubscribe.quotemateapp.au`):
```env
OUTREACH_UNSUB_URL_BASE=https://unsubscribe.quotemateapp.au
```
Default (no override) is the Cloud Function URL, which works fine.

---

## Step 7 — Deploy

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes
```

After deploy, the new `leadUnsubscribe` Cloud Function URL will be:
```
https://us-central1-hansendev.cloudfunctions.net/leadUnsubscribe
```

---

## Step 8 — Smoke test

1. **Send-self test**: in `/admin/leads/discovery`, run a dry-run discovery for fencers in your home suburb. Confirm Places API returns results.
2. **Manually create a test lead** pointing to your own domain → research → generate → review the message → send to **your own email**. Verify:
   - The `From:` is `Tom <tom@outreach.hansendev.com.au>` (Gmail "show original" → check the headers)
   - The body has the AU compliance footer at the bottom with an unsubscribe link
   - The `List-Unsubscribe` header is set (Gmail "show original" again)
   - DKIM = pass, SPF = pass in the headers
3. **Reply test**: reply to the test email. Confirm it lands in your forwarding inbox (Step 3).
4. **Unsubscribe test**: click the unsubscribe link in the footer. You should land on the "You're off the list" page. Then in Firestore confirm:
   - `leadSuppression/email:<your-email>` doc exists
   - The lead doc's `status` is now `dnc`
5. **Send-after-DNC test**: try to send to that same lead again from the admin UI. Should be skipped with reason `suppressed:unsubscribed`.

---

## Sender warm-up (do this before your first real campaign)

A brand-new sender domain has zero reputation. Sending 100 cold emails day-one will tank you. Ramp up:

| Day | Max sends |
|---|---|
| 1–3 | 5–10/day (to people you know — friends, your own addresses, fellow tradies who'd say yes anyway) |
| 4–7 | 15–25/day |
| Week 2 | 30–50/day |
| Week 3+ | 100/day cap (set via `leadOutreachConfig/current.dailyMaxSends` in Firestore) |

The `adminApproveLeads` endpoint already enforces a daily cap — read from `leadOutreachConfig/current` (defaults to 200). To set the warm-up cap, create that doc:

```js
// One-time, from Firestore console or a quick script
{
  enabled: true,
  dailyMaxSends: 10,        // ramp this up over weeks
  hourlyMaxSends: 5,
  perDomainMax: 1
}
```

---

## Troubleshooting

**Brevo says "domain not verified" after 24h**
- Run `dig TXT outreach.hansendev.com.au` and `dig TXT mail._domainkey.outreach.hansendev.com.au` from a terminal. If the records are missing, DNS propagation hasn't completed or the host name is wrong (a common mistake: setting host to `outreach.hansendev.com.au` instead of just `outreach` — the provider auto-appends the zone).

**Test email goes to spam**
- Open in Gmail, click "Show original". Check:
  - SPF: pass — if fail, Step 2C has a typo
  - DKIM: pass — if fail, Step 2B is malformed (often line breaks in the public key)
  - DMARC: pass — if fail, you set `p=reject` too early or alignment is off
- If everything is pass and Gmail still spams it: warm-up isn't done, or content is triggering filters (too many links, too "salesy" — this is exactly why we kept the body plaintext-style).

**Replies not arriving**
- Run `dig MX outreach.hansendev.com.au`. If no records, Step 3 is incomplete.
- ImprovMX dashboard has a "test forwarding" button.

**`leadUnsubscribe` 500s**
- Check Firebase Functions logs: `firebase functions:log --only leadUnsubscribe`. Most likely the lead doc doesn't exist (which is fine — the suppression entry still gets written).

---

## Quick reference — DNS records (paste-ready)

Replace `<brevo-code>` and `<dkim-key>` with the values Brevo shows you.

```
TXT  outreach                            brevo-code:<brevo-code>
TXT  mail._domainkey.outreach            k=rsa; p=<dkim-key>
TXT  outreach                            v=spf1 include:spf.brevo.com include:spf.improvmx.com mx ~all
TXT  _dmarc.outreach                     v=DMARC1; p=none; rua=mailto:tom@hansendev.com.au; pct=100
MX   outreach          10                mx1.improvmx.com
MX   outreach          20                mx2.improvmx.com
```
