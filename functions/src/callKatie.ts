/**
 * Call Katie demo bridge.
 *
 * Turns the in-app "Never miss a call" pitch into a live magic-moment demo:
 * one tap and Katie (our sister call-answering product, CallKatie) phones the
 * tradie within ~30s, answering as THEIR business. Once the call fires we hand
 * off to CallKatie signup with the tradie's details pre-filled via a signed
 * token, and a 48h recovery drip nudges anyone who heard the demo but never
 * tapped through to start a trial.
 *
 * The shared partner secret signs both the demo-call request and the signup
 * handoff token. It lives only in functions env — never shipped to the client.
 * The app talks exclusively to the callables below.
 *
 * Copy rule (mirrors CallKatieScreen): describe what Katie *does*. Never call
 * it "AI".
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import { getUserEmail, sendEmail } from './email';

// Partner API base + shared secret. Base defaults to prod; override via env so
// we can point at staging without a redeploy. The trailing slash is trimmed so
// `${BASE}/api/...` never doubles up.
const CALLKATIE_API_BASE = (process.env.CALLKATIE_API_BASE || 'https://callkatie.ai').replace(/\/+$/, '');
const CALLKATIE_PARTNER_SECRET = (): string => process.env.CALLKATIE_PARTNER_SECRET || '';
const PARTNER_ID = 'quotemate';

// A tradie can trigger at most this many live demo calls, ever. The partner
// API also rate-limits server-side (2 / user / 30 days) — this is our own
// guard so we don't even make the request once they're spent.
const MAX_DEMO_CALLS = 2;

// Signup handoff token lifetime — 7 days, per the CallKatie token contract.
const HANDOFF_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

// Recovery drip: wait at least this long after the demo call before nudging.
const DRIP_DELAY_MS = 48 * 60 * 60 * 1000;

// Where triggered demo calls are tracked, keyed by QuoteMate user id. Holds the
// call count (for our cap), timestamps for the drip, and the signup-tap marker.
const DEMO_CALLS_COLLECTION = 'katieDemoCalls';

type DemoCallResult =
  | { status: 'success'; phone: string; remaining: number; signupUrl: string }
  | { status: 'limit'; code: string; message: string }
  | { status: 'error'; code: string; message: string };

/** RFC 4648 §5 base64url (no padding) — used for the handoff token payload. */
function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Normalise an Australian phone number to E.164 (+61…). Accepts the shapes
 * tradies actually type — 04xx xxx xxx, 0468-123-456, (02) 9876 5432,
 * +61 4…, 61 4… — with any spaces/dashes/brackets. Returns null when it
 * doesn't look like a valid AU number. CallKatie only dials AU numbers.
 */
function toAuE164(raw: string): string | null {
  let d = (raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+61')) d = d.slice(3);
  else if (d.startsWith('61') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  else if (d.startsWith('+')) return null; // some other country code
  // National significant number is 9 digits: mobiles lead with 4/5, landlines
  // with an area-code digit (2/3/7/8).
  if (!/^[2-8]\d{8}$/.test(d)) return null;
  return `+61${d}`;
}

/**
 * Build the signed CallKatie signup handoff URL from the tradie's profile.
 * Token = base64url(JSON payload).hexHMAC(payload) with the shared secret, per
 * the CallKatie token contract. The login page validates + prefills from it.
 */
function buildHandoffUrl(profile: {
  email: string;
  businessName: string;
  websiteUrl?: string;
  phone?: string;
  tradeType?: string;
}): string {
  const payload = {
    email: profile.email,
    businessName: profile.businessName,
    ...(profile.websiteUrl ? { websiteUrl: profile.websiteUrl } : {}),
    ...(profile.phone ? { phone: profile.phone } : {}),
    ...(profile.tradeType ? { tradeType: profile.tradeType } : {}),
    source: 'quotemate',
    exp: Math.floor(Date.now() / 1000) + HANDOFF_TOKEN_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', CALLKATIE_PARTNER_SECRET()).update(encoded).digest('hex');
  const token = `${encoded}.${signature}`;
  return `${CALLKATIE_API_BASE}/login?prefill=${encodeURIComponent(token)}&src=quotemate`;
}

/** Load the tradie's business profile + auth email server-side. */
async function loadProfile(userId: string): Promise<{
  email: string;
  businessName: string;
  website?: string;
  tradeType?: string;
  phone?: string;
}> {
  const snap = await admin.firestore().doc(`users/${userId}/settings/business`).get();
  const s = snap.exists ? (snap.data() || {}) : {};
  const email = (await getUserEmail(userId)) || (s.email || '');
  return {
    email: (email || '').trim(),
    businessName: (s.businessName || '').trim(),
    website: (s.website || '').trim() || undefined,
    tradeType: s.tradeType || undefined,
    phone: (s.phone || '').trim() || undefined,
  };
}

/**
 * Trigger a live Katie demo call.
 *
 * Loads the tradie's business profile + auth email server-side, validates a
 * usable AU phone (the client may pass an edited number), enforces our own
 * 2-call cap, then signs and sends the partner demo-call request. Returns
 * success/limit/error states the UI renders directly.
 *
 * Request:  { phone?: string }   (optional edited number; else uses settings)
 * Response: DemoCallResult
 */
export const requestKatieDemoCall = functions.https.onCall(async (data, context): Promise<DemoCallResult> => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  const userId = context.auth.uid;

  if (!CALLKATIE_PARTNER_SECRET()) {
    console.error('requestKatieDemoCall: CALLKATIE_PARTNER_SECRET not configured');
    return { status: 'error', code: 'not-configured', message: 'Demo calls aren’t available right now. Give it a bit and try again.' };
  }

  const profile = await loadProfile(userId);

  // The number can be edited on screen; fall back to the saved one.
  const phoneRaw = typeof data?.phone === 'string' && data.phone.trim()
    ? data.phone.trim()
    : (profile.phone || '');
  const phone = toAuE164(phoneRaw);

  if (!profile.businessName) {
    return { status: 'error', code: 'no-business-name', message: 'Pop your business name in Settings first so Katie knows who to answer as.' };
  }
  if (!phone) {
    return { status: 'error', code: 'invalid-phone', message: 'That doesn’t look like an Australian number. Try a mobile like 04xx xxx xxx.' };
  }
  if (!profile.email) {
    return { status: 'error', code: 'no-email', message: 'We couldn’t find your email. Add one in Settings and give it another crack.' };
  }

  const callRef = admin.firestore().doc(`${DEMO_CALLS_COLLECTION}/${userId}`);
  const callSnap = await callRef.get();
  const existing = callSnap.exists ? (callSnap.data() || {}) : {};
  const callCount: number = existing.callCount || 0;

  if (callCount >= MAX_DEMO_CALLS) {
    return { status: 'limit', code: 'limit-reached', message: 'Katie’s already given you a couple of calls. Ready for her to answer your real ones?' };
  }

  // Sign the request: HMAC-SHA256 over "<timestamp>.<raw JSON body>". The exact
  // string we sign must be the exact bytes we send, so build it once.
  const body: Record<string, unknown> = {
    businessName: profile.businessName,
    phone,
    email: profile.email,
    quotemateUserId: userId,
  };
  if (profile.website) body.websiteUrl = profile.website;
  if (profile.tradeType) body.tradeType = profile.tradeType;

  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', CALLKATIE_PARTNER_SECRET())
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    resp = await fetch(`${CALLKATIE_API_BASE}/api/partner/demo-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Partner-Id': PARTNER_ID,
        'X-Partner-Timestamp': timestamp,
        'X-Partner-Signature': signature,
      },
      body: rawBody,
    });
  } catch (err: any) {
    console.error('requestKatieDemoCall: partner request failed', err?.message);
    return { status: 'error', code: 'network', message: 'Couldn’t reach Katie just now. Give it another crack in a sec.' };
  }

  if (resp.status === 429) {
    // Partner-side rate limit. Record it so our cap + drip stay consistent.
    await callRef.set({
      userId,
      lastRateLimitedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'limit', code: 'rate-limited', message: 'Katie’s called you recently already. Ready for her to answer your real calls?' };
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
    console.error(`requestKatieDemoCall: partner error ${resp.status} ${detail}`);
    return { status: 'error', code: 'partner-error', message: 'Something went wrong booking that call. Give it another go shortly.' };
  }

  // Success — record the trigger so we can enforce the cap and drive the drip.
  await callRef.set({
    userId,
    email: profile.email,
    businessName: profile.businessName,
    phone,
    websiteUrl: profile.website || null,
    tradeType: profile.tradeType || null,
    callCount: callCount + 1,
    lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
    firstCallAt: existing.firstCallAt || admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    status: 'success',
    phone,
    remaining: Math.max(0, MAX_DEMO_CALLS - (callCount + 1)),
    signupUrl: buildHandoffUrl({
      email: profile.email,
      businessName: profile.businessName,
      websiteUrl: profile.website,
      phone,
      tradeType: profile.tradeType,
    }),
  };
});

/**
 * Build the signed CallKatie signup handoff URL for the current user and record
 * the tap in the same demo-call doc (so the recovery drip knows to leave them
 * alone). Called when the tradie taps "Start your trial".
 *
 * Request:  {}
 * Response: { url: string }
 */
export const getKatieSignupLink = functions.https.onCall(async (_data, context): Promise<{ url: string }> => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  const userId = context.auth.uid;

  if (!CALLKATIE_PARTNER_SECRET()) {
    console.error('getKatieSignupLink: CALLKATIE_PARTNER_SECRET not configured');
    throw new functions.https.HttpsError('failed-precondition', 'Signup isn’t available right now.');
  }

  const profile = await loadProfile(userId);
  if (!profile.email || !profile.businessName) {
    throw new functions.https.HttpsError('failed-precondition', 'Add your business name and email in Settings first.');
  }

  // Record the tap in the same doc so katieRecoveryDrip skips this user.
  await admin.firestore().doc(`${DEMO_CALLS_COLLECTION}/${userId}`).set({
    userId,
    signupTappedAt: admin.firestore.FieldValue.serverTimestamp(),
    signupTapCount: admin.firestore.FieldValue.increment(1),
  }, { merge: true });

  return {
    url: buildHandoffUrl({
      email: profile.email,
      businessName: profile.businessName,
      websiteUrl: profile.website,
      phone: toAuE164(profile.phone || '') || undefined,
      tradeType: profile.tradeType,
    }),
  };
});

/**
 * Recovery drip — nudges tradies who heard the demo ≥48h ago but never tapped
 * through to start a trial. Sends one marketing email (respecting opt-outs +
 * the suppression list via sendEmail) at most once per user, tracked by
 * dripSentAt on the same demo-call doc.
 */
export const katieRecoveryDrip = functions.pubsub
  .schedule('every day 11:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - DRIP_DELAY_MS);
    const snap = await admin.firestore()
      .collection(DEMO_CALLS_COLLECTION)
      .where('lastCallAt', '<=', cutoff)
      .get();

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of snap.docs) {
      try {
        const d = doc.data() || {};
        // Already converted (tapped signup) or already nudged — leave them be.
        if (d.signupTappedAt || d.dripSentAt) { skipped++; continue; }

        const to = d.email || (await getUserEmail(doc.id));
        if (!to) { skipped++; continue; }

        const signupUrl = buildHandoffUrl({
          email: to,
          businessName: d.businessName || '',
          websiteUrl: d.websiteUrl || undefined,
          phone: d.phone || undefined,
          tradeType: d.tradeType || undefined,
        });

        const ok = await sendKatieDripEmail(to, d.businessName || '', signupUrl, doc.id);
        if (ok) {
          await doc.ref.set({ dripSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          sent++;
        } else {
          errors++;
        }
      } catch (err: any) {
        errors++;
        functions.logger.error(`katieRecoveryDrip: error for ${doc.id}`, err?.message);
      }
    }

    functions.logger.info(`katieRecoveryDrip: sent=${sent}, skipped=${skipped}, errors=${errors}`);
  });

/**
 * "Katie's still ready — start your trial" recovery email. Dark on-brand
 * QuoteMate layout, sent as marketing (so opt-outs + suppression apply through
 * sendEmail). Kept self-contained here so the drip owns its own copy.
 */
function sendKatieDripEmail(
  to: string,
  businessName: string,
  signupUrl: string,
  userId: string,
): Promise<boolean> {
  const greeting = businessName ? `, ${businessName}` : '';
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;

  const html = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Call Katie</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;font-size:1px;color:#0f172a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Katie's ready to answer your calls — start your 14-day trial.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
                <tr>
                  <td style="padding:40px 36px;">
                    <p style="color:#00c897;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">Never miss a call</p>
                    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">
                      Katie's still ready${greeting}
                    </h1>
                    <p style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 16px;">
                      You heard her answer as your business the other day. She can do that for every call you can't get to — takes down the job, the address and the customer's number, so a missed call never means a missed job.
                    </p>
                    <p style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 24px;">
                      Want her answering your real calls? Start your 14-day trial — no charge to try it.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
                      <tr>
                        <td style="background:#009868;border-radius:10px;text-align:center;">
                          <a href="${signupUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Start your 14-day trial &rarr;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 0 0;text-align:center;">
              <p style="color:#475569;font-size:13px;margin:0 0 6px;line-height:1.5;">Call Katie &mdash; from the makers of QuoteMate</p>
              <p style="margin:0;">
                <a href="${unsubscribeUrl}" style="color:#64748b;font-size:12px;text-decoration:underline;">Unsubscribe from these emails</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to,
    subject: 'Katie\'s still ready — start your trial',
    htmlContent: html,
    category: 'marketing',
    userId,
    tags: ['callkatie', 'demo-recovery'],
    unsubscribeUrl,
  });
}
