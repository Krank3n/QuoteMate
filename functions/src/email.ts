import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { PASSTHROUGH_SURCHARGE_PCT } from './shared/pdf';
import { NEXT_PRICE_AUD } from './foundingOffer';
import { NO_GST_NOTE } from './shared/document/gstMode';
import {
  resolvePriceDetail,
  showsLineItems,
  showsPerLineMoney,
  type PriceDetail,
} from './shared/document/priceDetail';
import {
  buildPaymentReceiptContentHtml,
  PaymentReceiptContentInput,
} from './paymentReceipt.helpers';

// Brevo API configuration
const getBrevoApiKey = (): string => {
  return process.env.BREVO_API_KEY || '';
};

const SENDER = {
  email: 'noreply@hansendev.com.au',
  name: 'QuoteMate',
};

// Admin notification email
const ADMIN_EMAIL = process.env.ADMIN_EMAILS || '';

// Email preference types that users can opt out of
type EmailCategory = 'transactional' | 'marketing';

interface SendEmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
  category: EmailCategory;
  userId?: string; // For logging and preference checking
  tags?: string[];
  attachment?: Array<{ name: string; content: string }>; // base64 encoded
  unsubscribeUrl?: string; // If set, adds List-Unsubscribe headers (required by Gmail bulk-sender rules)
  // Customer-facing sends (quote/invoice to client) override the default
  // QuoteMate identity so replies go to the tradie and the from-name shows
  // their business. Sender email stays on the verified domain — only the
  // display name changes — so DKIM/SPF/DMARC remain aligned.
  replyTo?: { email: string; name?: string };
  senderName?: string;
  // Blind-copy recipients (e.g. the tradie's own "email me a copy" toggle on
  // quote/invoice sends). Invisible to the primary recipient.
  bcc?: Array<{ email: string; name?: string }>;
}

// Strip characters that could break an RFC 5322 display-name header.
// Brevo serialises sender.name into "Name <email>" so commas, quotes, and
// CR/LF could splice the header. Belt-and-braces sanitisation.
function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n,"<>]/g, '').trim().slice(0, 78);
}

// Domains that are guaranteed to bounce or are forbidden by RFC 2606.
// privaterelay.appleid.com (Apple Hide-My-Email) is deliberately NOT here:
// the sender domain carries Apple's relay SPF include and 57 of 77 attempted
// relay sends delivered (Aug 2026 emailLog audit) — the old blanket ban muted
// 50 real users. Individually revoked relays hard-bounce once and are then
// suppressed per-address (see hasHardBounce below).
const UNSENDABLE_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'sentry-next.wixpress.com',
]);

// Recipients scraped from image filenames (e.g. "flags@2x.webp",
// "group-193@2x-3.png") parse as valid-looking addresses but the "domain"
// is just a file extension. Reject anything whose domain ends in an asset
// extension to catch the whole family without enumerating filenames.
const ASSET_DOMAIN_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.bmp'];

export function classifyUnsendable(to: string): string | null {
  const clean = (to || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return 'invalid-format';
  const at = clean.lastIndexOf('@');
  const domain = clean.slice(at + 1);
  if (!domain) return 'invalid-format';
  if (UNSENDABLE_DOMAINS.has(domain)) return `unsendable-domain:${domain}`;
  if (ASSET_DOMAIN_EXTS.some(ext => domain.endsWith(ext))) return 'asset-filename';
  return null;
}

// A hard bounce (recorded on the emailLog row by the Brevo webhook) marks the
// address dead — typically a revoked Apple relay. Soft bounces don't count:
// full mailboxes recover.
export function hasHardBounce(rows: Array<{ bounceType?: unknown }>): boolean {
  return rows.some((r) => r.bounceType === 'hard');
}

// The skip is silent on purpose: the original bounced row already documents
// the dead address in the admin email log, and sweep jobs re-attempt daily
// (cooldown stamps are only written on successful sends), so logging each
// skip would recreate the daily blocked-row noise 2f6eb24 removed.
async function hasPriorHardBounce(to: string): Promise<boolean> {
  try {
    const prior = await admin.firestore().collection('emailLog')
      .where('to', '==', to)
      .select('bounceType')
      .limit(100)
      .get();
    return hasHardBounce(prior.docs.map((d) => d.data()));
  } catch (err: any) {
    // Fail-open: Brevo keeps its own hard-bounce suppression list as backstop.
    console.warn('sendEmail: hard-bounce lookup failed', err?.message);
    return false;
  }
}

// Shared email wrapper (base layout for all emails)
function wrapEmailTemplate(content: string, options?: { unsubscribeUrl?: string; preheader?: string }): string {
  const { unsubscribeUrl, preheader } = options || {};
  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>QuoteMate</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important}</style>
  <![endif]-->
  <style>
    @media only screen and (max-width: 600px) {
      .qm-outer-pad { padding: 16px 8px !important; }
      .qm-card-pad { padding: 24px 18px !important; }
      .qm-logo-pad { padding: 0 0 20px !important; }
      .qm-day-cell { padding: 0 3px !important; }
      .qm-day-link { padding: 12px 4px !important; }
      .qm-day-num { font-size: 17px !important; }
      .qm-day-wd { font-size: 11px !important; }
      .qm-h1 { font-size: 22px !important; line-height: 1.25 !important; }
      .qm-body { font-size: 14.5px !important; line-height: 1.6 !important; }
      .qm-video-card-pad { padding: 16px 18px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#0f172a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;">
    <tr>
      <td align="center" class="qm-outer-pad" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" class="qm-logo-pad" style="padding:0 0 32px;">
              <img src="https://hansendev.web.app/email-assets/logo.png" alt="QuoteMate" width="160" style="display:block;width:160px;height:auto;border-radius:20px;" />
            </td>
          </tr>
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
                <tr>
                  <td class="qm-card-pad" style="padding:40px 36px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:28px 0 0;text-align:center;">
              <p style="color:#475569;font-size:13px;margin:0 0 6px;line-height:1.5;">
                QuoteMate &mdash; Professional Quoting for Tradies
              </p>
              ${unsubscribeUrl ? `
                <p style="margin:0;">
                  <a href="${unsubscribeUrl}" style="color:#64748b;font-size:12px;text-decoration:underline;">Unsubscribe from marketing emails</a>
                </p>
              ` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Reusable component: status badge
function badge(text: string, bgColor: string, textColor: string): string {
  return `<span style="display:inline-block;background:${bgColor};color:${textColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;padding:4px 10px;border-radius:20px;">${text}</span>`;
}

// Reusable component: info card row
function infoRow(label: string, value: string, isLast = false): string {
  return `
    <tr>
      <td style="padding:10px 0;${!isLast ? 'border-bottom:1px solid #334155;' : ''}">
        <span style="color:#94a3b8;font-size:13px;">${label}</span><br/>
        <span style="color:#f1f5f9;font-size:15px;font-weight:600;">${value}</span>
      </td>
    </tr>`;
}

// App deep link - tries custom scheme first (opens app), falls back to Play Store / App Store
const APP_LINK = 'https://hansendev.web.app/open';

// Reusable component: CTA button
function ctaButton(text: string, color: string = '#009868', href: string = APP_LINK): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr>
        <td style="background:${color};border-radius:10px;text-align:center;">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${text}</a>
        </td>
      </tr>
    </table>`;
}

// Reusable component: info card (dark card within card)
function infoCard(rows: string, accentColor?: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;${accentColor ? `border-left:4px solid ${accentColor};` : ''}margin:24px 0;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows}
          </table>
        </td>
      </tr>
    </table>`;
}

// Reusable component: feature bullet
function featureBullet(icon: string, text: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td width="28" valign="top" style="font-size:16px;">${icon}</td>
        <td valign="top" style="padding-left:8px;">
          <p style="color:#cbd5e1;font-size:14px;margin:0;line-height:1.5;">${text}</p>
        </td>
      </tr>
    </table>`;
}

// Check if user has opted out of a given email category
export async function canSendEmail(userId: string, category: EmailCategory): Promise<boolean> {
  if (category === 'transactional') return true; // Always send transactional

  try {
    const prefsDoc = await admin.firestore()
      .doc(`users/${userId}/settings/emailPreferences`)
      .get();

    if (!prefsDoc.exists) return true; // No prefs = opted in by default

    const prefs = prefsDoc.data();
    return prefs?.marketing !== false;
  } catch (error) {
    return true; // Fail open
  }
}

// AU Spam Act 2003 compliance footer for cold outreach. Required:
//   - clear sender business identity
//   - functional reply contact
//   - one-click unsubscribe
// Wrapped around the body for any send tagged 'lead_outreach'.
function wrapLeadOutreachBody(innerBody: string, unsubscribeLink: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.6;">
<div style="max-width:560px;margin:0 auto;padding:24px 20px;">
<div>${innerBody}</div>
<div style="margin-top:36px;padding-top:18px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
QuoteMate is made by Hansen Dev (Sydney NSW, Australia). You're receiving this because your business is publicly listed as a tradie servicing this area &mdash; reply "stop" or click below and I'll never email you again.<br/>
<a href="${unsubscribeLink}" style="color:#64748b;text-decoration:underline;">Unsubscribe from QuoteMate outreach</a>
</div>
</div>
</body></html>`;
}

// Pre-create the emailLog doc, attach its id as a Brevo tag, then send. The
// Brevo webhook posts back events keyed to that tag, which lets us correlate
// delivery / bounce / open / click / spam back to this exact send.
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, category, userId, tags, attachment, replyTo: replyToOverride, senderName, bcc } = options;
  let { htmlContent, unsubscribeUrl } = options;

  // For cold lead outreach, wrap with the AU spam-act compliance footer
  // and ensure a List-Unsubscribe header is set even if the caller didn't.
  const isLeadOutreach = !!tags?.includes('lead_outreach');
  if (isLeadOutreach) {
    const leadTag = tags!.find(t => t.startsWith('lead:'));
    const leadId = leadTag ? leadTag.slice('lead:'.length) : '';
    if (!unsubscribeUrl) {
      // Cloud Function endpoint (one-click). Override via OUTREACH_UNSUB_URL_BASE env if you front it with a custom domain.
      const base = process.env.OUTREACH_UNSUB_URL_BASE
        || 'https://us-central1-hansendev.cloudfunctions.net/leadUnsubscribe';
      unsubscribeUrl = `${base}?to=${encodeURIComponent(to)}&lead=${encodeURIComponent(leadId)}`;
    }
    // Attribute outreach clicks in GA (lands in the "Email" channel instead of
    // hiding in Direct). Rewritten at send time so it covers every message the
    // copy generator ever produced — visible link text stays clean.
    htmlContent = htmlContent.replace(
      /href="https:\/\/quotemateapp\.au([^"]*)"/g,
      (_m, rest: string) => {
        if (rest.includes('utm_')) return _m;
        const sep = rest.includes('?') ? '&' : '?';
        return `href="https://quotemateapp.au${rest}${sep}utm_source=outreach&utm_medium=email&utm_campaign=lead_outreach"`;
      }
    );
    htmlContent = wrapLeadOutreachBody(htmlContent, unsubscribeUrl);
  }

  const apiKey = getBrevoApiKey();

  if (!apiKey) {
    console.error('sendEmail: BREVO_API_KEY not configured');
    return false;
  }

  if (!to) {
    console.warn('sendEmail: no recipient address provided');
    return false;
  }

  // Short-circuit known-unsendable addresses before we burn a Brevo call or
  // sender reputation. We still log a row so the admin email log shows what
  // was skipped and why.
  const unsendableReason = classifyUnsendable(to);
  if (unsendableReason) {
    console.info(`sendEmail: blocking unsendable recipient ${to} (${unsendableReason})`);
    try {
      await admin.firestore().collection('emailLog').add({
        userId: userId || null,
        to,
        subject,
        category,
        tags: [...(tags || []), `blocked:${unsendableReason}`],
        status: 'blocked',
        blockedReason: unsendableReason,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        openCount: 0,
        clickCount: 0,
      });
    } catch (logErr: any) {
      console.warn('sendEmail: failed to log blocked send', logErr?.message);
    }
    return false;
  }

  // Check user email preferences (skip for test sends)
  if (userId && userId !== 'test') {
    const allowed = await canSendEmail(userId, category);
    if (!allowed) {
      console.info(`sendEmail: user ${userId} opted out of ${category}`);
      return false;
    }
  }

  if (await hasPriorHardBounce(to)) {
    console.info(`sendEmail: skipping ${to} — prior hard bounce on record`);
    return false;
  }

  // Pre-create log doc — status: 'pending' until Brevo accepts, then 'sent'.
  const logRef = await admin.firestore().collection('emailLog').add({
    userId: userId || null,
    to,
    subject,
    category,
    tags: tags || [],
    status: 'pending',
    queuedAt: admin.firestore.FieldValue.serverTimestamp(),
    openCount: 0,
    clickCount: 0,
  });
  const logId = logRef.id;
  const trackingTag = `emailLogId:${logId}`;
  const brevoTags = [...(tags || []), trackingTag];

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        // Cold outreach uses an isolated sender (separate domain/subdomain ideally)
        // so spam complaints don't poison the transactional sender's reputation.
        // Configure OUTREACH_SENDER_EMAIL + OUTREACH_REPLY_TO_EMAIL in functions/.env.
        // Customer-facing sends (sendDocumentEmail) pass senderName/replyTo so
        // the inbox shows the tradie's business and replies route to them, not us.
        sender: isLeadOutreach && process.env.OUTREACH_SENDER_EMAIL
          ? { email: process.env.OUTREACH_SENDER_EMAIL, name: process.env.OUTREACH_SENDER_NAME || 'Tom' }
          : senderName
            ? { email: SENDER.email, name: sanitizeDisplayName(senderName) }
            : SENDER,
        replyTo: replyToOverride
          ? { email: replyToOverride.email, name: replyToOverride.name ? sanitizeDisplayName(replyToOverride.name) : undefined }
          : isLeadOutreach && process.env.OUTREACH_REPLY_TO_EMAIL
            ? { email: process.env.OUTREACH_REPLY_TO_EMAIL, name: process.env.OUTREACH_REPLY_TO_NAME || 'Tom' }
            : { email: 'tom@hansendev.com.au', name: 'Tom at QuoteMate' },
        to: [{ email: to }],
        ...(bcc?.length ? { bcc } : {}),
        subject,
        htmlContent,
        tags: brevoTags,
        // Brevo forwards custom JSON headers in webhook events — belt + braces
        // in case tag parsing fails for any reason.
        headers: {
          ...(unsubscribeUrl ? {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          } : {}),
          'X-Mailin-custom': JSON.stringify({ emailLogId: logId, userId: userId || null, category }),
        },
        ...(attachment?.length ? { attachment } : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`sendEmail: Brevo API error ${response.status} for "${subject}" to ${to}: ${errorBody}`);
      await logRef.set({
        status: 'send_failed',
        sendError: `brevo-${response.status}`,
        sendErrorBody: errorBody.slice(0, 500),
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return false;
    }

    const body = await response.json().catch(() => ({} as any));
    await logRef.set({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      brevoMessageId: body?.messageId || null,
    }, { merge: true });

    return true;
  } catch (error: any) {
    console.error(`sendEmail: unexpected error for "${subject}" to ${to}:`, error?.message);
    await logRef.set({
      status: 'send_failed',
      sendError: error?.message || 'unknown',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return false;
  }
}

// Helper to get user email from Firebase Auth or business settings
export async function getUserEmail(userId: string): Promise<string | null> {
  // Try Firebase Auth first
  try {
    const userRecord = await admin.auth().getUser(userId);
    if (userRecord.email) return userRecord.email;
  } catch (error) {
    // User might not exist in Auth
  }

  // Fallback to business settings
  try {
    const settingsDoc = await admin.firestore()
      .doc(`users/${userId}/settings/business`)
      .get();
    if (settingsDoc.exists) {
      return settingsDoc.data()?.email || null;
    }
  } catch (error) {
  }

  return null;
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================

// Tom's Calendly for the new-signup walkthrough. Override via env if the slug
// changes so we don't have to redeploy just to update a link.
const TOM_CALENDLY_BASE = process.env.TOM_CALENDLY_URL
  || 'https://calendly.com/thomas-andrew-hansen/30min';

// Returns the next `count` weekdays in Sydney time. Used to build deep-linked
// Calendly buttons in the welcome email — Calendly accepts `?date=YYYY-MM-DD`
// so the booker lands directly on that day's slot picker.
function getNextWeekdaysSydney(count: number): Array<{ iso: string; month: string; weekday: string; dayNum: number; monthShort: string }> {
  const todaySydney = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, m, d] = todaySydney.split('-').map(Number);
  // Anchor at UTC noon so day increments stay on the right calendar day
  // regardless of DST shifts when we read .getUTCDay().
  const cursor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const result: Array<{ iso: string; month: string; weekday: string; dayNum: number; monthShort: string }> = [];

  while (result.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const yy = cursor.getUTCFullYear();
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getUTCDate()).padStart(2, '0');
    result.push({
      iso: `${yy}-${mm}-${dd}`,
      month: `${yy}-${mm}`,
      weekday: weekdays[dow],
      dayNum: cursor.getUTCDate(),
      monthShort: months[cursor.getUTCMonth()],
    });
  }
  return result;
}

// Renders a single "pick this day" button for the welcome-email calendar row.
// Bulletproof email layout: nested table, no flex/grid.
function calendarDayButton(weekday: string, dayNum: number, monthShort: string, href: string): string {
  return `
    <td valign="top" class="qm-day-cell" style="width:33.33%;padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #009868;border-radius:10px;">
        <tr>
          <td align="center" style="padding:0;">
            <a href="${href}" target="_blank" class="qm-day-link" style="display:block;padding:14px 6px;text-decoration:none;color:#f8fafc;">
              <span class="qm-day-wd" style="display:block;color:#00c897;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 4px;">${weekday}</span>
              <span class="qm-day-num" style="display:block;color:#f8fafc;font-size:19px;font-weight:700;line-height:1.1;">${dayNum} ${monthShort}</span>
            </a>
          </td>
        </tr>
      </table>
    </td>`;
}

export function sendWelcomeEmail(to: string, businessName: string, userId: string): Promise<boolean> {
  const greeting = businessName || 'there';
  const days = getNextWeekdaysSydney(3);
  const dayButtons = days
    .map(d => calendarDayButton(
      d.weekday,
      d.dayNum,
      d.monthShort,
      `${TOM_CALENDLY_BASE}?month=${d.month}&date=${d.iso}`,
    ))
    .join('');

  const content = wrapEmailTemplate(`
    <p style="color:#00c897;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">A quick hello</p>
    <h1 class="qm-h1" style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">
      G'day${businessName ? `, ${greeting}` : ''} &mdash; I'm Tom, I built QuoteMate.
    </h1>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 16px;">
      Most tradies pick QuoteMate up in about 8 minutes once someone walks them through it. I'd love to do that with you &mdash; show you the bits that matter for your trade and answer anything you're stuck on.
    </p>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 20px;">
      Pick a day that suits and I'll send through a time:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;table-layout:fixed;">
      <tr>
        ${dayButtons}
      </tr>
    </table>

    <p style="text-align:center;margin:0 0 28px;">
      <a href="${TOM_CALENDLY_BASE}" target="_blank" style="color:#5ab9ea;font-size:14px;text-decoration:underline;">Or pick another time &rarr;</a>
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border-left:4px solid #5ab9ea;margin:0 0 22px;">
      <tr>
        <td class="qm-video-card-pad" style="padding:18px 22px;">
          <p style="color:#f8fafc;font-size:15px;font-weight:600;margin:0 0 4px;">Prefer to suss it out solo first?</p>
          <p style="color:#94a3b8;font-size:14px;line-height:1.55;margin:0 0 14px;">
            There's a 5-minute walkthrough on the homepage that covers the basics.
          </p>
          <a href="https://quotemateapp.au" target="_blank" style="display:inline-block;background:#5ab9ea;color:#0f172a;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;text-decoration:none;">
            Watch the walkthrough &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 4px;">
      Either way &mdash; if anything trips you up, just reply to this email. Goes straight to me.
    </p>
    <p style="color:#f8fafc;font-size:15px;line-height:1.65;margin:20px 0 0;">
      Cheers,<br/>
      <strong>Tom</strong>
    </p>
  `, { preheader: 'I built QuoteMate. Want an 8-minute walkthrough? Pick a day below.' });

  return sendEmail({
    to,
    subject: `${businessName ? `${greeting}, ` : ''}keen for an 8-min QuoteMate walkthrough?`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['welcome'],
  });
}

export function sendQuoteSentEmail(
  to: string,
  customerName: string,
  quoteNumber: string,
  total: number,
  userId: string
): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Quote delivered</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Your quote is on its way
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
      Quote <strong style="color:#f8fafc;">#${quoteNumber}</strong> has been sent to <strong style="color:#f8fafc;">${customerName}</strong>.
    </p>

    ${infoCard(
      infoRow('Customer', customerName) +
      infoRow('Quote Number', `#${quoteNumber}`) +
      infoRow('Total', `$${total.toFixed(2)}`, true),
      '#5ab9ea'
    )}

    <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0;">
      We'll notify you as soon as your client responds.
    </p>
  `, { preheader: `Quote #${quoteNumber} sent to ${customerName} for $${total.toFixed(2)}` });

  return sendEmail({
    to,
    subject: `Quote #${quoteNumber} sent to ${customerName}`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['quote-sent'],
  });
}

export interface QuoteAcceptedHook {
  line: string;
  cta: string;
  tag: string;
}

/**
 * The conversion hook under the accepted-quote celebration. quote-accepted is
 * the best-engaged email in the program (43% open / 26% click, Jul 2026
 * audit) and lands at the exact moment the tradie has seen the payoff — so
 * unconnected users get the connect-Square pitch here (Path B), and connected
 * users get pointed at the card-link invoice they already have. Distinct tags
 * so emailLogAudit can read the two variants separately.
 */
export function quoteAcceptedHook(hasSquareConnection: boolean): QuoteAcceptedHook {
  return hasSquareConnection
    ? {
        line: 'Convert it to an invoice &mdash; your customer can pay by card straight from the link.',
        cta: 'Send the invoice',
        tag: 'square-ready',
      }
    : {
        line:
          'Convert it to an invoice and get paid. Connect Square once and every invoice can go out with a pay-by-card link &mdash; the money lands without the chasing.',
        cta: 'Invoice &amp; get paid',
        tag: 'square-hook',
      };
}

export async function sendQuoteAcceptedEmail(
  to: string,
  customerName: string,
  quoteNumber: string,
  total: number,
  clientNotes: string | null,
  userId: string
): Promise<boolean> {
  // Read failure defaults to the connect pitch — for the mostly-unconnected
  // user base that's the right guess, and it's harmless for connected users.
  let hasSquareConnection = false;
  try {
    const snap = await admin.firestore().doc(`users/${userId}/settings/squareConnection`).get();
    hasSquareConnection = snap.exists;
  } catch {}
  const hook = quoteAcceptedHook(hasSquareConnection);

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#064e3b;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 16px;">
        &#10003;
      </div>
      ${badge('ACCEPTED', '#064e3b', '#00c897')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 12px;text-align:center;line-height:1.3;">
      You've won the job!
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;text-align:center;">
      <strong style="color:#f8fafc;">${customerName}</strong> has accepted your quote.
    </p>

    ${infoCard(
      infoRow('Customer', customerName) +
      infoRow('Quote Number', `#${quoteNumber}`) +
      infoRow('Total', `$${total.toFixed(2)}`, !clientNotes) +
      (clientNotes ? infoRow('Client Notes', clientNotes, true) : ''),  
      '#00c897'
    )}

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 0;text-align:center;">
      ${hook.line}
    </p>
    ${ctaButton(hook.cta, '#009868')}
  `, { preheader: `Great news! ${customerName} accepted quote #${quoteNumber} for $${total.toFixed(2)}` });

  return sendEmail({
    to,
    subject: `Quote #${quoteNumber} accepted by ${customerName}`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['quote-accepted', hook.tag],
  });
}

export function sendQuoteDeclinedEmail(
  to: string,
  customerName: string,
  quoteNumber: string,
  total: number,
  clientNotes: string | null,
  userId: string
): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#7f1d1d;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:24px;margin:0 0 16px;">
        &#10005;
      </div>
      ${badge('DECLINED', '#7f1d1d', '#ef4444')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 12px;text-align:center;line-height:1.3;">
      Quote declined
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;text-align:center;">
      <strong style="color:#f8fafc;">${customerName}</strong> has declined your quote.
    </p>

    ${infoCard(
      infoRow('Customer', customerName) +
      infoRow('Quote Number', `#${quoteNumber}`) +
      infoRow('Total', `$${total.toFixed(2)}`, !clientNotes) +
      (clientNotes ? infoRow('Client Notes', clientNotes, true) : ''),
      '#ef4444'
    )}

    <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0;text-align:center;">
      Consider following up to discuss their concerns &mdash; a quick call can often turn a no into a yes.
    </p>
  `, { preheader: `${customerName} declined quote #${quoteNumber}` });

  return sendEmail({
    to,
    subject: `Quote #${quoteNumber} declined by ${customerName}`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['quote-declined'],
  });
}

export function sendPaymentFailedEmail(to: string, userId: string): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#78350f;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 16px;">
        !
      </div>
      ${badge('ACTION REQUIRED', '#78350f', '#e6b872')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;text-align:center;line-height:1.3;">
      Payment couldn't be processed
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;text-align:center;">
      We were unable to charge your payment method for your QuoteMate Pro subscription.
    </p>

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#fca5a5;font-size:14px;font-weight:600;margin:0 0 6px;">What happens next?</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            If your payment method isn't updated soon, your subscription will be paused and you'll be moved to the free plan.
          </p>
        </td>
      </tr>
    `, '#ef4444')}

    <div style="text-align:center;">
      <p style="color:#cbd5e1;font-size:14px;margin:0 0 4px;">Update your payment method in:</p>
      <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0;">Settings &rarr; Subscription</p>
    </div>
    ${ctaButton('Update Payment Method', '#ef4444')}
  `, { preheader: 'Your subscription payment failed. Update your payment method to keep QuoteMate Pro.' });

  return sendEmail({
    to,
    subject: 'Action required: QuoteMate payment failed',
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['payment-failed'],
  });
}

export function sendSubscriptionCancelledEmail(to: string, businessName: string, userId: string): Promise<boolean> {
  const greeting = businessName || 'there';
  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Subscription update</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      We're sorry to see you go, ${greeting}
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      Your QuoteMate Pro subscription has been cancelled. You'll still have access to all Pro features until the end of your current billing period.
    </p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px;">
      After that, you'll move to the free plan with limited quotes per month.
    </p>

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 6px;">Changed your mind?</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            You can resubscribe anytime from Settings &rarr; Subscription in the app. Your data is safe and waiting.
          </p>
        </td>
      </tr>
    `)}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:24px 0 0;">
      We'd love to know why you cancelled &mdash; your feedback helps us build a better product. Just reply to this email.
    </p>
  `, { preheader: 'Your Pro subscription has been cancelled. You\'ll have access until the end of your billing period.' });

  return sendEmail({
    to,
    subject: 'Your QuoteMate Pro subscription has been cancelled',
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['subscription-cancelled'],
  });
}

export function sendReEngagementEmail(
  to: string,
  businessName: string,
  daysSinceLastActive: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const trimmedName = (businessName || '').trim();
  const heading = trimmedName
    ? `Hey ${trimmedName}, your next quote is waiting`
    : `Your next quote is waiting`;
  const subjectLine = trimmedName
    ? `${trimmedName}, your next quote is waiting`
    : `Your next quote is waiting`;

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      ${heading}
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;">
      It's been <strong style="color:#f8fafc;">${daysSinceLastActive} days</strong> since your last visit. Jobs don't quote themselves &mdash; let's get back to it.
    </p>

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 16px;">Here's what you can do in 60 seconds:</p>
          ${featureBullet('&#127908;', 'Describe a job with <strong style="color:#f8fafc;">voice</strong> &mdash; no typing needed')}
          ${featureBullet('&#128176;', 'Get <strong style="color:#f8fafc;">real-time prices</strong> from major hardware stores')}
          ${featureBullet('&#128232;', 'Send quotes clients can <strong style="color:#f8fafc;">accept with one click</strong>')}
        </td>
      </tr>
    `)}

    ${ctaButton('Create a Quote')}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:28px 0 8px;text-align:center;">
      Or let us know how you're going &mdash; one tap:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=great&category=re-engagement" target="_blank" style="display:inline-block;background:#064e3b;border:2px solid #00c897;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#128170;</span>
                  <span style="color:#00c897;font-size:12px;font-weight:700;">Still keen</span>
                </a>
              </td>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=okay&category=re-engagement" target="_blank" style="display:inline-block;background:#1e293b;border:2px solid #f59e0b;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#128528;</span>
                  <span style="color:#f59e0b;font-size:12px;font-weight:700;">Hit a snag</span>
                </a>
              </td>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=bad&category=re-engagement" target="_blank" style="display:inline-block;background:#1e293b;border:2px solid #ef4444;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#128075;</span>
                  <span style="color:#ef4444;font-size:12px;font-weight:700;">Not for me</span>
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, { unsubscribeUrl, preheader: `It's been ${daysSinceLastActive} days. Your next job is just a tap away.` });

  return sendEmail({
    to,
    subject: subjectLine,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['re-engagement', `inactive-${daysSinceLastActive}d`],
    unsubscribeUrl,
  });
}

/**
 * Trial lifecycle: "your trial ends in N days" — sent once, ~2 days before the
 * 14-day Pro trial lapses. Anchored to trialStartedAt (NOT signup like the
 * onboarding drip), because conversion pressure only makes sense against the
 * trial clock. Copy source: website repo marketing/trial-lifecycle-emails.md.
 */
/**
 * Real founding-member availability, read from config/foundingOffer by the
 * lifecycle cron. null (cap filled / doc unavailable) suppresses every
 * founding line — no invented scarcity, and cap-only: no deadlines anywhere.
 */
export interface FoundingSpots {
  spotsLeft: number;
  cap: number;
}

export function sendTrialEndingEmail(
  to: string,
  businessName: string,
  daysRemaining: number,
  userId: string,
  founding: FoundingSpots | null = null
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';
  const daysWord = daysRemaining <= 1 ? 'tomorrow' : `in ${daysRemaining} days`;
  const pricingUrl = 'https://quotemateapp.au/pricing?utm_source=lifecycle&utm_medium=email&utm_campaign=trial&utm_content=trial_ending';
  const foundingLine = founding
    ? `
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:16px 0 0;">
      Lock it in as a <strong style="color:#f8fafc;">founding member</strong> and $49/mo is yours for life &mdash; the price goes to $${NEXT_PRICE_AUD.monthly} for new members once the first ${founding.cap} are in. Right now there are <strong style="color:#f8fafc;">${founding.spotsLeft} of ${founding.cap} spots left</strong>.
    </p>`
    : '';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Your Pro trial ends ${daysWord}
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Hi ${greeting} &mdash; straight version, no tricks. Here's exactly what changes when the trial wraps up:
    </p>

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 16px;">You keep, free, forever:</p>
          ${featureBullet('&#9989;', 'Unlimited quotes and invoices')}
          ${featureBullet('&#9989;', 'Your branding on every PDF, GST handled')}
          ${featureBullet('&#9989;', 'Online card payments')}
        </td>
      </tr>
    `)}

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 16px;">Pro keeps doing:</p>
          ${featureBullet('&#128736;', 'Material lists built for you, with live supplier pricing')}
          ${featureBullet('&#128196;', 'Every premium template')}
          ${featureBullet('&#128179;', 'Lower Square rate + bank/PayID/BPAY/PayPal options')}
        </td>
      </tr>
    `)}

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:24px 0 0;">
      Pro is <strong style="color:#f8fafc;">$49/month</strong>, or <strong style="color:#f8fafc;">$328 for the year</strong> &mdash; 44% off, which works out around $6.30 a week. Most tradies lose more than that in forgotten line items on one quote.
    </p>
${foundingLine}
    ${ctaButton(founding ? 'Claim your founding spot' : 'Keep Pro — takes 30 seconds', '#009868', pricingUrl)}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:28px 0 0;">
      Either way, your quotes, invoices and customers stay yours.
    </p>
  `, { unsubscribeUrl, preheader: 'What you keep free forever, what Pro keeps doing.' });

  return sendEmail({
    to,
    // Flat transactional subject on purpose: the Jul 2026 emailLog audit found
    // pitch-shaped subjects on this step opened at 1/15 while plain personal
    // ones ran ~20%. The founding pitch stays in the body.
    subject: `Your Pro access ends ${daysWord}`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-ending'],
    unsubscribeUrl,
  });
}

/**
 * Trial lifecycle: the trial_ending slot for users who built quotes but never
 * sent one. A personal note from Tom in the tip-5 mould — plain layout,
 * replies land with Tom, sells nothing. The reply question is the point:
 * these users are days from churning and we don't know why they stalled.
 */
export function sendTrialEndingNudgeEmail(
  to: string,
  businessName: string,
  daysRemaining: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';
  const daysWord = daysRemaining <= 1 ? 'tomorrow' : `in ${daysRemaining} days`;

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Before your trial wraps up &mdash; quick one
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 16px;">Hi ${greeting},</p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      It's Tom &mdash; I built QuoteMate. Your trial wraps up ${daysWord}, and I noticed you've built a quote but haven't sent one to a customer yet.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Was there something that didn't feel right &mdash; pricing off, layout not you, or just flat out with work? Hit reply and tell me. It comes straight to me, not a support queue, and it genuinely shapes what I fix next.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
      And if the quote's good to go, sending takes about ten seconds &mdash; your customer gets a link they can accept right on their phone.
    </p>

    ${ctaButton('Send that quote')}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:28px 0 0;">
      No pressure either way &mdash; quotes and invoices stay free after the trial.
    </p>
    <p style="color:#f8fafc;font-size:15px;line-height:1.65;margin:28px 0 0;">
      Cheers,<br/>
      <strong>Tom</strong> &mdash; QuoteMate
    </p>
  `, { unsubscribeUrl, preheader: 'You built a quote but never sent it — what got in the way?' });

  return sendEmail({
    to,
    subject: 'Your quote never went out — what got in the way?',
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-ending-nudge'],
    unsubscribeUrl,
    replyTo: { email: 'tom@hansendev.com.au', name: 'Tom at QuoteMate' },
  });
}

/**
 * Trial lifecycle: sent once, shortly after the trial lapses without an
 * upgrade. Half reassurance (free plan keeps working), half churn research —
 * the reply-to question is the point.
 */
export function sendTrialEndedEmail(
  to: string,
  businessName: string,
  userId: string,
  founding: FoundingSpots | null = null
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';
  const pricingUrl = 'https://quotemateapp.au/pricing?utm_source=lifecycle&utm_medium=email&utm_campaign=trial&utm_content=trial_ended';
  const foundingLine = founding
    ? `
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      And if Pro's still on your mind: your <strong style="color:#f8fafc;">founding spot's open while they last</strong> &mdash; $49/mo locked for life, ${founding.spotsLeft} of ${founding.cap} left. Once they fill, it's $${NEXT_PRICE_AUD.monthly} for new members. No deadline, no pressure &mdash; just first in.
    </p>`
    : '';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      You're on the free plan now &mdash; one question
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${greeting} &mdash; your trial wrapped up. You're on the free plan now: unlimited quotes and invoices, nothing deleted, no card charged, because we never took one.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      One question, genuinely: <strong style="color:#f8fafc;">what would Pro have needed to do for you to keep it?</strong> Hit reply with one line. Brutal is fine &mdash; brutal is useful.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      If the answer is price: the annual plan is $328, about $6.30 a week. If the answer is a missing feature, there's a decent chance it gets built &mdash; feature requests from real users run this roadmap.
    </p>
${foundingLine}
    ${ctaButton('See Pro pricing', '#009868', pricingUrl)}
  `, { unsubscribeUrl, preheader: 'No card charged, nothing lost. But tell me one thing.' });

  return sendEmail({
    to,
    // Plain reply-seeking subject (see trial_ending note): the old
    // plan-status subject opened at 0/15.
    subject: `Your trial's wrapped up — quick question`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-ended'],
    unsubscribeUrl,
    replyTo: { email: 'tom@hansendev.com.au', name: 'Tom at QuoteMate' },
  });
}

/**
 * Trial lifecycle day 0–1: the trial just started (it starts on the first
 * quote). Value framing plus ONE action — send that quote today. Pro claims
 * here must stay true: free already has unlimited quotes/invoices + branding,
 * so only genuine Pro features are named.
 */
export function sendTrialStartValueEmail(
  to: string,
  businessName: string,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const name = (businessName || '').trim();

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Your 14 days of Pro start now
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Good on ya${name ? `, ${name}` : ''} &mdash; your first quote's in, and that kicks off 14 days with everything unlocked. No card, no catch.
    </p>

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 16px;">While it's all unlocked, put it to work:</p>
          ${featureBullet('&#128736;', 'Materials lists priced for you, with live supplier prices')}
          ${featureBullet('&#128196;', 'Every premium PDF template')}
          ${featureBullet('&#128179;', 'Lower card fee + bank/PayID/BPAY/PayPal options for your customers')}
        </td>
      </tr>
    `)}

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:24px 0 0;">
      One thing to do today: <strong style="color:#f8fafc;">send that quote</strong>. Email, SMS or share it, straight from the app. Quotes sent within the hour win jobs that quotes sent at 9pm lose.
    </p>

    ${ctaButton('Send your quote')}
  `, { unsubscribeUrl, preheader: 'One thing to do today: send that quote.' });

  return sendEmail({
    to,
    subject: 'Your 14 days of Pro start now',
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-start-value'],
    unsubscribeUrl,
  });
}

/**
 * Trial lifecycle day 3–4 (Path B): pitch turning on payments while the
 * tradie is engaged — skipped entirely if Square is already connected.
 * Honest framing: payments work on the free plan too.
 */
export function sendTrialSquarePitchEmail(
  to: string,
  businessName: string,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Get paid the second the job's done
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${greeting} &mdash; you're sending tidy quotes. Here's the other half: getting paid without chasing.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hook up Square &mdash; takes about a minute &mdash; and every quote and invoice carries a <strong style="color:#f8fafc;">Pay Now button</strong> your customer can tap on their phone. Deposits up front, balances on the day, no &ldquo;I'll do a transfer tonight&rdquo;.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
      It's yours to keep on the free plan too &mdash; no need to be on Pro.
    </p>

    ${ctaButton('Turn on payments')}
  `, { unsubscribeUrl, preheader: 'One minute of setup and every quote carries a Pay Now button.' });

  return sendEmail({
    to,
    subject: "Want to get paid the second the job's done?",
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-square-pitch'],
    unsubscribeUrl,
  });
}

/**
 * Trial lifecycle day 7–8: personalised recap of the user's OWN numbers.
 * recap.rich gates the figures — thin data falls back to non-numeric copy,
 * never padded numbers. Numbers come from midTrialRecap over the user's real
 * documents (lifecycleEmails.helpers.ts).
 */
export function sendTrialMidValueEmail(
  to: string,
  businessName: string,
  recap: { quotesBuilt: number; dollarsQuoted: number; sent: number; rich: boolean },
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';
  const pricingUrl = 'https://quotemateapp.au/pricing?utm_source=lifecycle&utm_medium=email&utm_campaign=trial&utm_content=trial_mid';
  const dollars = `$${recap.dollarsQuoted.toLocaleString('en-AU')}`;

  const recapBlock = recap.rich
    ? `
    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 16px;">Your first week:</p>
          ${featureBullet('&#128221;', `<strong style="color:#f8fafc;">${recap.quotesBuilt} quote${recap.quotesBuilt === 1 ? '' : 's'}</strong> built`)}
          ${featureBullet('&#128176;', `<strong style="color:#f8fafc;">${dollars}</strong> quoted`)}
          ${featureBullet('&#128232;', `<strong style="color:#f8fafc;">${recap.sent}</strong> sent to customers`)}
        </td>
      </tr>
    `)}
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:24px 0 16px;">
      That's real work off your plate.
    </p>`
    : `
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      One week into your trial &mdash; how's it treating you? If you've got a job sitting unquoted, now's the moment: describe it and QuoteMate prices the materials and labour for you.
    </p>`;

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      ${recap.rich ? 'One week in — here’s your tally' : 'One week in — 7 days of Pro to go'}
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 16px;">Hi ${greeting},</p>
${recapBlock}
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
      7 days left on Pro. After that you keep going free &mdash; unlimited quotes and invoices, nothing deleted &mdash; you'll just add a pay link to each job and the fee's a touch higher.
    </p>

    ${ctaButton('See what Pro keeps', '#009868', pricingUrl)}
  `, { unsubscribeUrl, preheader: recap.rich ? 'Your first week, tallied up — and 7 days of Pro to go.' : 'Halfway through — 7 days of Pro to go.' });

  return sendEmail({
    to,
    subject: recap.rich
      ? `You've quoted ${dollars} in your first week`
      : 'One week in — 7 days of Pro to go',
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['trial-lifecycle', 'trial-mid-value'],
    unsubscribeUrl,
  });
}

/**
 * Square nudge: connected ≥5 days, never collected. One send, ever. No
 * invented social proof — at the current baseline almost nobody has
 * collected yet, so the pitch is pure mechanics + benefit.
 */
export function sendSquareIdleNudgeEmail(
  to: string,
  businessName: string,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Your Pay Now button's ready &mdash; put it to work
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${greeting} &mdash; you've hooked up Square, nice one. But nothing's come through it yet, and a connected account earns you exactly nothing until a customer taps that button.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Next quote or invoice you send, choose <strong style="color:#f8fafc;">&ldquo;Get paid on this quote&rdquo;</strong> and it goes out with a Pay Now button &mdash; your customer pays by card on their phone, and the job's marked paid before you've packed up.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
      Deposits up front, balances on the day, no chasing transfers.
    </p>

    ${ctaButton('Send a quote with a pay link')}
  `, { unsubscribeUrl, preheader: 'One tap at send and your customer can pay by card on the spot.' });

  return sendEmail({
    to,
    subject: "Your Pay Now button's ready — put it to work",
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['square-nudge', 'connected-idle'],
    unsubscribeUrl,
  });
}

/**
 * Square nudge: trial expired, sent quotes during it, never connected
 * payments. The post-trial reactivation — connecting Square is also what
 * lets them send again on the free plan. One send, ever.
 */
export function sendSquareNoPaylinkNudgeEmail(
  to: string,
  businessName: string,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = (businessName || '').trim() || 'there';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Your quotes are ready to get paid
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${greeting} &mdash; you've built proper quotes in QuoteMate, and there's one step left to close the loop: getting paid through them.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hook up Square &mdash; takes about a minute &mdash; and every quote and invoice you send carries a <strong style="color:#f8fafc;">Pay Now button</strong>. Deposits before you order materials, balances the day the job wraps, no &ldquo;I'll do a transfer tonight&rdquo;.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
      It's part of the free plan &mdash; connecting it is also what switches sending back on now your trial's wrapped.
    </p>

    ${ctaButton('Turn on payments')}
  `, { unsubscribeUrl, preheader: 'A minute of setup and every quote carries a Pay Now button.' });

  return sendEmail({
    to,
    subject: 'Get paid the day the job’s done — your quotes are ready',
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['square-nudge', 'no-paylink'],
    unsubscribeUrl,
  });
}

export function sendOnboardingTipEmail(
  to: string,
  businessName: string,
  tipNumber: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = businessName || 'there';

  const tips: Record<number, { subject: string; emoji: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: 'Pro tip: Use your voice to create quotes',
      emoji: '&#127908;',
      heading: 'Talk to QuoteMate',
      preheader: 'Skip the typing. Describe your job with voice and get a full quote in seconds.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
          Instead of typing job descriptions on-site, just tap the <strong style="color:#f8fafc;">microphone icon</strong> and describe the job out loud.
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          QuoteMate will transcribe it and generate a full quote with materials, labour, and pricing &mdash; all in seconds.
        </p>
      `,
    },
    // Tips 2 (supplier prices) and 3 (accept online) retired 2026-07: the
    // emailLog audit had them at 9–10% opens, and tip 4's copy already covers
    // tip 3's acceptance-link and notification points. Numbering is kept so
    // in-flight lastOnboardingTip state needs no migration — the drip ladder
    // (onboardingDrip.helpers.ts) can no longer select the retired slots.
    4: {
      subject: 'Pro tip: Send your quote to a client in one tap',
      emoji: '&#128232;',
      heading: 'Send it to win it',
      preheader: 'Your quotes look professional. Send one to a client and see how easy it is.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
          A quote sitting in drafts doesn't win jobs. Sending one takes <strong style="color:#f8fafc;">10 seconds</strong>:
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#9312; Open your quote and tap <strong style="color:#f8fafc;">Send</strong>
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#9313; Enter your client's email or mobile
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#9314; They get a <strong style="color:#f8fafc;">professional acceptance link</strong>
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          &#9315; You get an <strong style="color:#f8fafc;">instant notification</strong> when they respond
        </p>
      `,
    },
    // Tip 5 is not a feature tip: the drip only lets it reach users who are
    // two weeks in with no first quote (anyone with a trial or Pro is skipped
    // in sendOnboardingDrip). It's a personal activation note from Tom and
    // deliberately sells nothing — the free plan claims here must stay true.
    5: {
      subject: "Your first quote's the hard part — let's knock it over",
      emoji: '&#128736;',
      heading: "Your first quote's the hard part",
      preheader: 'Give QuoteMate a rough job and it hands back a finished quote in about five minutes.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
          It's Tom &mdash; I built QuoteMate. You signed up a couple of weeks back but haven't built a quote yet, and that first one's honestly the only tricky bit.
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
          Give it a job, even a rough one &mdash; &ldquo;repaint a three-bedroom interior&rdquo; is plenty. QuoteMate prices the materials at live supplier rates, works out the labour, and hands you a quote your customer can accept on their phone. About five minutes, start to finish.
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          Stuck on anything? Just reply &mdash; it comes straight to me, not a support queue.
        </p>
      `,
    },
  };

  const tip = tips[tipNumber];
  if (!tip) return Promise.resolve(false);

  // The personal note renders plain (no badge/emoji chrome) and replies land
  // with Tom; the feature tips keep the numbered-tip layout.
  const isPersonalNote = tipNumber === 5;

  const content = isPersonalNote
    ? wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      ${tip.heading}
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 16px;">Hi ${greeting},</p>
    ${tip.body}

    ${ctaButton('Build your first quote')}

    <p style="color:#f8fafc;font-size:15px;line-height:1.65;margin:28px 0 0;">
      Cheers,<br/>
      <strong>Tom</strong> &mdash; QuoteMate
    </p>
  `, { unsubscribeUrl, preheader: tip.preheader })
    : wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#1e293b;border:2px solid #334155;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 12px;">
        ${tip.emoji}
      </div>
      ${badge('PRO TIP', '#1e293b', '#94a3b8')}
    </div>
    <h1 style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 20px;text-align:center;line-height:1.3;">
      ${tip.heading}
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 16px;">Hey ${greeting},</p>
    ${tip.body}

    ${ctaButton('Try It Now')}
  `, { unsubscribeUrl, preheader: tip.preheader });

  return sendEmail({
    to,
    subject: tip.subject,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['onboarding', isPersonalNote ? 'activation-note' : `tip-${tipNumber}`],
    unsubscribeUrl,
    ...(isPersonalNote
      ? { replyTo: { email: 'tom@hansendev.com.au', name: 'Tom at QuoteMate' } }
      : {}),
  });
}

export function sendUpdateAnnouncementEmail(
  to: string,
  businessName: string,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = businessName || 'there';

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      ${badge('NEW UPDATE', '#064e3b', '#00c897')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;text-align:center;line-height:1.3;">
      Big updates to QuoteMate
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 20px;">Hey ${greeting},</p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 28px;">
      We've been hard at work making QuoteMate better for tradies like you. Here's what's new:
    </p>

    <!-- Free Trial -->
    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">&#127881; 14-Day Free Trial</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            New to QuoteMate? You now get <strong style="color:#f8fafc;">full access to every feature for 14 days</strong> &mdash; no credit card required. Create unlimited quotes, send invoices, and use your business logo on everything.
          </p>
        </td>
      </tr>
    `, '#00c897')}

    <!-- Invoicing -->
    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">&#128196; Full Invoicing</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            Convert accepted quotes to invoices with one tap. Track payment status, record partial payments, send invoices via email or SMS, and export professional PDFs &mdash; all from the one app.
          </p>
        </td>
      </tr>
    `, '#5ab9ea')}

    <!-- Payment Tracking -->
    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">&#128176; Payment Tracking</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            Record partial or full payments against invoices &mdash; bank transfer, card, cash, or cheque. Set flexible payment terms like <strong style="color:#f8fafc;">Net 7, Net 14, Net 30</strong>, or custom due dates. Overdue invoices are flagged automatically.
          </p>
        </td>
      </tr>
    `, '#a78bfa')}

    <!-- Smarter Pricing -->
    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">&#128200; More Accurate Pricing</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            We've improved our material pricing engine. Prices are now pulled in real time from major hardware stores, so your quotes are tighter and more competitive.
          </p>
        </td>
      </tr>
    `, '#cfa153')}

    ${ctaButton('Open QuoteMate')}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:28px 0 0;text-align:center;">
      Questions or feedback? Just reply to this email &mdash; we read every message.
    </p>
  `, { unsubscribeUrl, preheader: 'Free trial, invoicing, payment tracking, and smarter pricing — QuoteMate just got a whole lot better.' });

  return sendEmail({
    to,
    subject: `What's new in QuoteMate — Invoicing, Payment Tracking & More`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['product-update', 'v1.0.61'],
    unsubscribeUrl,
  });
}

// ============================================================
// CLIENT-FACING QUOTE EMAIL (light, business-branded theme)
// ============================================================

interface QuoteEmailData {
  customerName: string;
  emailBody: string; // generated or default body text
  jobName: string;
  materials: { name: string; quantity: number; unit: string; totalPrice: number; section?: string }[];
  laborTotal: number;
  materialsSubtotal: number;
  subtotal: number;
  gst: number;
  total: number;
  // Travel surcharge: the percentage the tradie set, and its dollar value
  // computed off the RAW subtotal. See PricingRowsInput for why the amount is
  // passed rather than derived from `subtotal` above.
  travelAdjustment?: number;
  travelAdjustmentAmount?: number;
  // false = business not GST-registered: hide the GST row and the
  // "(inc GST)" total label, and show a "No GST has been charged" note.
  gstRegistered?: boolean;
  acceptanceUrl?: string;
  photoUrls?: string[];
  // Deposit shown to the customer above the Accept button so they know what
  // they'll be asked to pay up front.
  depositAmount?: number;
  depositPercentage?: number;
  // When set, the primary CTA becomes "Accept & Pay Deposit" linking straight
  // to Square's hosted checkout. Paying = accepting (webhook handles both).
  depositPayNowUrl?: string;
  // True when the attached PDF carries a T&Cs section — drives whether the
  // CTA renders the "By paying you accept the terms…" footnote.
  hasTerms?: boolean;
  // True when the tradie has surchargePaymentFees on — the Square checkout
  // amount has been bumped, so we surface a subtle disclosure under the CTA.
  surchargePaymentFees?: boolean;
  // How much of the money the customer sees — see
  // shared/document/priceDetail.ts. The legacy pair is still accepted so an
  // older caller keeps working.
  priceDetail?: PriceDetail;
  /** @deprecated Use priceDetail. */
  showMaterialCosts?: boolean;
  /** @deprecated Use priceDetail. */
  showLaborCosts?: boolean;
  business: {
    name: string;
    abn?: string;
    phone?: string;
    email?: string;
    address?: string;
    logoUrl?: string;
    brandColor?: string;
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const DEFAULT_BRAND_COLOR = '#059669';

/**
 * A logo is only usable on a customer-facing surface if the recipient's device
 * can actually fetch it. Some accounts hold a device-local `file://` path (the
 * phone's own copy, saved before upload) or a `data:` URI, and both render as
 * a broken-image icon in the email and on the acceptance page — worse than the
 * business-name fallback those templates already have.
 *
 * Same rule the site-photos section has always applied; the logo just never
 * got it.
 */
export function remoteLogoUrl(url?: string | null): string | undefined {
  const trimmed = (url || '').trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

/**
 * The tradie's brand colour lands in `style="background:${accent}"` and in a
 * `<style>` block on the acceptance pages, so a stray quote or `</style>` in
 * the stored value would break out of the attribute. The app only ever writes
 * a 6-digit hex from its colour picker, so anything else is bad data — fall
 * back rather than interpolate it.
 */
export function safeBrandColor(color?: string | null): string {
  const trimmed = (color || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : DEFAULT_BRAND_COLOR;
}

/**
 * Money for customer-facing emails: `$8,118.55`. Thousands separators matter
 * on quote totals — `$8118.55` is genuinely harder to read at a glance, and a
 * misread total is the one mistake a quote email can't afford.
 */
export function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

// Light-themed wrapper for client-facing quote emails (business-branded, no QM logo)
function wrapQuoteEmailTemplate(content: string, options: { brandColor?: string; businessName?: string; logoUrl?: string; preheader?: string }): string {
  const { brandColor: rawBrandColor, businessName = '', preheader } = options;
  const brandColor = safeBrandColor(rawBrandColor);
  // Guarded here rather than at each caller so every email through this shell
  // degrades to the business-name lockup instead of a broken-image icon.
  const logoUrl = remoteLogoUrl(options.logoUrl);

  const logoSection = logoUrl
    ? `<tr><td align="center" style="padding:0 0 14px;">
        <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" width="88" style="display:block;width:88px;height:auto;border-radius:12px;" />
      </td></tr>`
    : '';

  const businessNameSection = businessName
    ? `<tr><td align="center" style="padding:0 0 20px;">
        <h2 style="margin:0;font-size:19px;font-weight:700;color:#111827;letter-spacing:-0.2px;">${escapeHtml(businessName)}</h2>
      </td></tr>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!-- Opt out of client-forced dark mode. Apple Mail / Outlook invert these
       templates by default, which turns the white card grey, washes out the
       tradie's brand colour and can leave the Accept button unreadable. -->
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(businessName || 'Quote')}</title>
  <style>
    :root { color-scheme: light; supported-color-schemes: light; }
    /* On mobile, merge the page background into the card so the email reads as one
       continuous surface instead of a card-on-a-page. */
    @media screen and (max-width: 600px) {
      .qm-c-body { background-color: #ffffff !important; }
      .qm-c-bg { background-color: #ffffff !important; }
      .qm-c-outer { padding: 0 !important; }
      .qm-c-card-shell {
        border-left: 0 !important;
        border-right: 0 !important;
        border-bottom: 0 !important;
        border-radius: 0 !important;
      }
      .qm-c-card { padding: 26px 20px !important; }
      /* Buttons go full-bleed on a phone so the tap target spans the screen. */
      .qm-c-btn { width: 100% !important; max-width: 100% !important; }
    }
  </style>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important}</style>
  <![endif]-->
</head>
<body class="qm-c-body" style="margin:0;padding:0;background-color:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#f7f7f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="qm-c-bg" style="background-color:#f7f7f7;">
    <tr>
      <td align="center" class="qm-c-outer" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          ${logoSection}
          ${businessNameSection}
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="qm-c-card-shell" style="background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;border-top:4px solid ${brandColor};">
                <tr>
                  <td class="qm-c-card" style="padding:34px 32px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 0 0;text-align:center;">
              <a href="https://quotemateapp.au" target="_blank" style="display:inline-block;background:#111827;color:#ffffff;font-size:10px;font-weight:600;letter-spacing:0.6px;padding:5px 10px;border-radius:999px;text-decoration:none;">QuoteMate</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Customer-facing payment receipt, sent when a payment lands on an invoice
 * (manual Record Payment or Square). Business-branded like the quote/invoice
 * emails: the tradie's name is the sender and replies route to them.
 */
export function sendPaymentReceiptEmail(options: {
  to: string;
  userId: string;
  business: { businessName?: string; brandColor?: string; logoUrl?: string };
  replyToEmail?: string | null;
  receipt: PaymentReceiptContentInput;
}): Promise<boolean> {
  const { to, userId, business, replyToEmail, receipt } = options;
  const businessName = business.businessName || receipt.businessName;

  const htmlContent = wrapQuoteEmailTemplate(buildPaymentReceiptContentHtml(receipt), {
    brandColor: business.brandColor,
    businessName,
    logoUrl: business.logoUrl,
    preheader: receipt.isFullyPaid
      ? 'Your invoice is now paid in full.'
      : 'Receipt for your payment.',
  });

  const invoiceRef = receipt.invoiceNumber ? ` — Invoice ${receipt.invoiceNumber}` : '';
  return sendEmail({
    to,
    subject: `Receipt from ${businessName}${invoiceRef}`,
    htmlContent,
    category: 'transactional',
    userId,
    tags: ['payment-receipt'],
    senderName: businessName,
    replyTo: replyToEmail ? { email: replyToEmail, name: businessName } : undefined,
  });
}

/**
 * Strip any standalone "ABN: 12 345 678 901" line from the email body. We
 * render the tradie's ABN in the footer already, so leaving it in the body
 * (whether typed by the tradie or produced by the AI email generator) makes
 * the email look duplicated.
 */
function stripAbnFromBody(body: string): string {
  return body
    .replace(/^[ \t]*ABN[:\s][^\n]*\n?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ----- shared building blocks for client-facing document emails -----

interface DocEmailBusiness {
  name: string;
  abn?: string;
  phone?: string;
  email?: string;
  address?: string;
  logoUrl?: string;
  brandColor?: string;
}

// Renders the user-authored email body. Input is plain text with a tiny
// markdown subset: `**bold**` becomes <strong>, and lines starting with
// `- `, `* ` or `• ` group into a <ul>. Blank lines split paragraphs;
// single newlines become <br/>. HTML is escaped first so the markdown
// pass cannot inject tags.
function renderEmailBodyHtml(emailBody: string): string {
  const paraStyle = 'color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;';
  const listStyle = 'color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;padding-left:24px;';
  const itemStyle = 'margin:0 0 4px;';

  const escaped = escapeHtml(stripAbnFromBody(emailBody));
  const formatInline = (s: string): string =>
    s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  const blocks: string[] = [];
  let listItems: string[] = [];
  let paraLines: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems.map((it) => `<li style="${itemStyle}">${it}</li>`).join('');
    blocks.push(`<ul style="${listStyle}">${items}</ul>`);
    listItems = [];
  };
  const flushPara = () => {
    if (!paraLines.length) return;
    blocks.push(`<p style="${paraStyle}">${paraLines.join('<br/>')}</p>`);
    paraLines = [];
  };

  for (const line of escaped.split('\n')) {
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bulletMatch) {
      flushPara();
      listItems.push(formatInline(bulletMatch[1]));
    } else if (line.trim() === '') {
      flushList();
      flushPara();
    } else {
      flushList();
      paraLines.push(formatInline(line));
    }
  }
  flushList();
  flushPara();

  return blocks.join('');
}

function renderBusinessFooter(business: DocEmailBusiness, accent: string): string {
  const esc = escapeHtml;
  const footerParts: string[] = [];
  if (business.abn) footerParts.push(`ABN: ${esc(business.abn)}`);
  if (business.phone) footerParts.push(esc(business.phone));
  if (business.email) footerParts.push(`<a href="mailto:${esc(business.email)}" style="color:${accent};text-decoration:none;">${esc(business.email)}</a>`);
  if (business.address) footerParts.push(esc(business.address));
  if (!footerParts.length) return '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #e5e7eb;padding-top:16px;">
      <tr><td style="text-align:center;">
        <p style="color:#6b7280;font-size:13px;line-height:1.8;margin:0;">${footerParts.join(' &bull; ')}</p>
      </td></tr>
    </table>`;
}

interface InvoicePaymentMethodsInput {
  paymentMethods?: any;
  plan?: 'trial' | 'free' | 'pro';
  accent: string;
  // Drives the heading: with a Pay Now button these are alternatives, without
  // one they're the only way to pay.
  hasPayNow?: boolean;
}

// Pro/trial-only Payment Methods block. Free-tier tradies are intentionally
// excluded so paid quotes funnel through Square (where the platform fee is
// collected), matching the PDF generator's rendering rules.
function renderInvoicePaymentMethods(input: InvoicePaymentMethodsInput): string {
  const { paymentMethods: pm, plan } = input;
  if (!pm || plan === 'free') return '';
  if (!pm.showOnDocuments) return '';

  const esc = escapeHtml;
  const sections: string[] = [];

  const bankHasData = pm.bankAccount?.accountName || pm.bankAccount?.bsb || pm.bankAccount?.accountNumber;
  if (pm.bankAccount?.enabled && bankHasData) {
    const lines: string[] = [];
    if (pm.bankAccount.accountName) lines.push(`Account Name: ${esc(pm.bankAccount.accountName)}`);
    if (pm.bankAccount.bsb) lines.push(`BSB: ${esc(pm.bankAccount.bsb)}`);
    if (pm.bankAccount.accountNumber) lines.push(`Account: ${esc(pm.bankAccount.accountNumber)}`);
    sections.push(renderPaymentMethodCard('Bank Transfer', lines.join('<br/>')));
  }

  if (pm.payId?.enabled && pm.payId?.payIdValue) {
    const payIdLabel = pm.payId.payIdType === 'phone' ? 'Phone'
                     : pm.payId.payIdType === 'email' ? 'Email'
                     : 'ABN';
    sections.push(renderPaymentMethodCard('PayID', `${payIdLabel}: ${esc(pm.payId.payIdValue)}`));
  }

  const bpayHasData = pm.bpay?.billerCode || pm.bpay?.referenceNumber;
  if (pm.bpay?.enabled && bpayHasData) {
    const lines: string[] = [];
    if (pm.bpay.billerCode) lines.push(`Biller Code: ${esc(pm.bpay.billerCode)}`);
    if (pm.bpay.referenceNumber) lines.push(`Reference: ${esc(pm.bpay.referenceNumber)}`);
    sections.push(renderPaymentMethodCard('BPAY', lines.join('<br/>')));
  }

  if (pm.paypal?.enabled && pm.paypal?.email) {
    sections.push(renderPaymentMethodCard('PayPal', esc(pm.paypal.email)));
  }

  if (pm.other?.enabled && pm.other?.instructions) {
    sections.push(renderPaymentMethodCard('Other Payment Options', esc(pm.other.instructions).replace(/\n/g, '<br/>')));
  }

  if (sections.length === 0) return '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0;">
      <tr><td style="padding:0 0 10px;">
        <p style="color:#9ca3af;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin:0;">${input.hasPayNow ? 'Other ways to pay' : 'How to pay'}</p>
      </td></tr>
      ${sections.map(s => `<tr><td style="padding:6px 0;">${s}</td></tr>`).join('')}
    </table>`;
}

function renderPaymentMethodCard(title: string, bodyHtml: string): string {
  return `
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-left:3px solid #111827;border-radius:8px;padding:14px 16px;">
      <p style="color:#111827;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin:0 0 6px;">${title}</p>
      <p style="color:#374151;font-size:13px;line-height:1.65;margin:0;font-variant-numeric:tabular-nums;">${bodyHtml}</p>
    </div>`;
}

export interface PricingRowsInput {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  gst: number;
  total: number;
  // false = not GST-registered: no GST row, plain "Total" label, "No GST
  // has been charged" note under the total.
  gstRegistered?: boolean;
  accent: string;
  // When set and > 0, render a "Deposit already paid" line and rename the
  // total label to "Balance due". Invoice-only.
  depositCredit?: number;
  // How much of the money the customer sees — see
  // shared/document/priceDetail.ts. Absent falls back to the legacy pair
  // below, then to 'itemised'.
  priceDetail?: PriceDetail;
  /** @deprecated Use priceDetail. */
  showMaterialCosts?: boolean;
  /** @deprecated Use priceDetail. */
  showLaborCosts?: boolean;
  // Invoice-only. Rendered as a single meta line under the total so the due
  // date and payment reference live next to the amount they belong to,
  // instead of in a second card that repeats the same number.
  dueDate?: string; // ISO date string
  invoiceNumber?: string;
  // Travel surcharge. `travelAdjustment` is the PERCENTAGE the tradie set
  // (7 = +7%), used for the label only.
  travelAdjustment?: number;
  // The surcharge in dollars, computed by the caller rather than derived here.
  // It is a percentage of the RAW subtotal (materials + labour, pre-markup —
  // see documentCalculator), while `subtotal` above is the DISPLAY subtotal
  // with markup folded into materials when the tradie hides it. Deriving it
  // from the wrong one of those two overstates the charge.
  travelAdjustmentAmount?: number;
}

export function renderPricingRows(input: PricingRowsInput): string {
  const { materialsSubtotal, laborTotal, subtotal, gst, total, accent, depositCredit } = input;
  const gstRegistered = input.gstRegistered !== false;
  const hasDeposit = !!(depositCredit && depositCredit > 0);
  // Same three modes as the PDF, resolved by the same function, so the email
  // body and the attachment can't disagree about what the customer may see.
  const detail = resolvePriceDetail(input);
  // The Materials/Labour split is 'itemised' only: in 'summary' it would
  // re-split precisely what the tradie chose not to itemise, and in 'total'
  // there is nothing but the total. Subtotal survives in both of the first
  // two. GST is disclosed in all three — it is a legal disclosure, not a
  // preference.
  const showMaterials = showsPerLineMoney(detail);
  const showLabor = showsPerLineMoney(detail);
  const showSubtotalRow = showsLineItems(detail);
  // The travel surcharge is part of the price build-up, so it belongs wherever
  // Subtotal does: in 'total' there is nothing but the total, but in the other
  // two the customer can see Subtotal and Total and this is the difference
  // between them. Omitting it left an unexplained gap — a real quote showed
  // Subtotal $6,021.85 above Total $6,406.73 with $384.88 charged and never
  // named. Same gate and same position (after Subtotal, before GST) as the PDF
  // in shared/pdf/htmlBuilders.ts, so the body and the attachment agree.
  const travelPercent = Number(input.travelAdjustment) || 0;
  const travelAmount = Number(input.travelAdjustmentAmount) || 0;
  const showTravel = showSubtotalRow && travelPercent > 0 && travelAmount > 0;
  const row = (label: string, value: string, valueColor = '#111827') => `
            <tr>
              <td style="padding:11px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #eef0f3;">${label}</td>
              <td style="padding:11px 0;color:${valueColor};font-size:14px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #eef0f3;">${value}</td>
            </tr>`;

  // Due date / reference meta line (invoices only).
  const metaBits: string[] = [];
  if (input.dueDate) {
    const due = new Date(input.dueDate);
    if (!isNaN(due.getTime())) {
      metaBits.push(`Due ${due.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    }
  }
  if (input.invoiceNumber) metaBits.push(`Reference ${escapeHtml(input.invoiceNumber)}`);
  const metaLine = metaBits.length
    ? `
            <tr>
              <td colspan="2" style="color:#6b7280;font-size:12px;padding-top:8px;">${metaBits.join(' &nbsp;&bull;&nbsp; ')}</td>
            </tr>`
    : '';

  // priceDetail 'total' on a business that isn't GST-registered leaves nothing
  // to break down. Rendering the "Summary" header over an empty box looked
  // like a bug, so the card collapses to the total on its own. Mirrors the row
  // conditions below exactly — a row must never render outside this guard.
  const hasBreakdownRows = showMaterials || showLabor || showSubtotalRow || showTravel || gstRegistered || hasDeposit;
  const breakdownSection = hasBreakdownRows
    ? `
      <tr>
        <td style="padding:18px 22px 8px;">
          <p style="color:#9ca3af;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin:0 0 4px;">Summary</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${showMaterials ? row('Materials', formatMoney(materialsSubtotal)) : ''}
            ${showLabor ? row('Labour', formatMoney(laborTotal)) : ''}
            ${showSubtotalRow ? row('Subtotal', formatMoney(subtotal)) : ''}
            ${showTravel ? row(`Travel adjustment (${travelPercent}%)`, formatMoney(travelAmount)) : ''}
            ${gstRegistered ? row('GST', formatMoney(gst)) : ''}
            ${hasDeposit ? `
            <tr>
              <td style="padding:11px 0;color:#059669;font-size:14px;border-bottom:1px solid #eef0f3;">Deposit already paid</td>
              <td style="padding:11px 0;color:#059669;font-size:14px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid #eef0f3;">−${formatMoney(depositCredit!)}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>`
    : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;margin:26px 0;overflow:hidden;">
      ${breakdownSection}
      <tr>
        <td style="padding:16px 22px 18px;background:#f9fafb;${hasBreakdownRows ? 'border-top:2px solid #111827;' : ''}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#111827;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;vertical-align:bottom;">${hasDeposit ? 'Balance Due' : gstRegistered ? 'Total (inc GST)' : 'Total'}</td>
              <td style="color:${accent};font-size:26px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;line-height:1.1;vertical-align:bottom;">${formatMoney(total)}</td>
            </tr>
            ${gstRegistered ? '' : `
            <tr>
              <td colspan="2" style="color:#6b7280;font-size:12px;padding-top:6px;">${NO_GST_NOTE}</td>
            </tr>`}
            ${metaLine}
          </table>
        </td>
      </tr>
    </table>`;
}

function renderPhotosSection(photoUrls: string[] | undefined): string {
  const esc = escapeHtml;
  // Only embed http(s) URLs; legacy quotes may hold local file:// or blob:
  // URIs that the recipient's mail client cannot resolve.
  const remotePhotoUrls = (photoUrls || []).filter(url => /^https?:\/\//i.test(url));
  if (!remotePhotoUrls.length) return '';
  const photoImgs = remotePhotoUrls.map(url =>
    `<td style="padding:4px;"><img src="${esc(url)}" width="160" style="display:block;width:160px;height:120px;object-fit:cover;border-radius:8px;" /></td>`
  ).join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr><td style="padding:0 0 8px;"><p style="color:#6b7280;font-size:13px;font-weight:600;margin:0;">Site Photos</p></td></tr>
      <tr><td>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>${photoImgs}</tr></table>
      </td></tr>
    </table>`;
}

interface QuoteCtaInput {
  acceptanceUrl?: string;
  depositAmount?: number;
  depositPercentage?: number;
  depositPayNowUrl?: string;
  hasTerms?: boolean;
  // When true the tradie has opted into surcharging card payments — Square's
  // checkout shows the inflated total. We surface the disclosure under the
  // Pay button so the customer isn't surprised on click-through.
  surchargePaymentFees?: boolean;
  accent: string;
  // Used in the reassurance line ("… lets {business} know you're good to go").
  businessName?: string;
  // The follow-up reminder email reuses this block with its own wording.
  heading?: string;
  primaryLabel?: string;
}

/**
 * The decision block: one branded panel holding the deposit terms, the Accept
 * button and the Decline button.
 *
 * Decline is a real outlined button rather than the grey underlined link it
 * used to be. Two reasons: a #9ca3af link on white is ~2.3:1 contrast (fails
 * WCAG AA), and hiding the negative option reads as a trick — which is a bad
 * look on the one email where the customer is deciding whether to trust this
 * tradie with thousands of dollars. Accept still wins on weight and colour.
 */
export function renderQuoteCta(input: QuoteCtaInput): string {
  if (!input.acceptanceUrl) return '';
  const esc = escapeHtml;
  const { acceptanceUrl, depositAmount, depositPercentage, depositPayNowUrl, hasTerms, surchargePaymentFees, accent, businessName } = input;

  // Deposit terms sit *inside* the decision panel — the customer needs the
  // number in the same glance as the button, not in a separate warning-yellow
  // banner above it.
  const depositSection = (depositAmount && depositAmount > 0)
    ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;margin:0 0 18px;">
              <tr>
                <td style="padding:14px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="color:#6b7280;font-size:13px;vertical-align:middle;">Deposit to get started${depositPercentage ? ` (${depositPercentage}%)` : ''}</td>
                      <td style="color:#111827;font-size:19px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;vertical-align:middle;">${formatMoney(depositAmount)}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="color:#6b7280;font-size:12px;line-height:1.6;padding-top:8px;border-top:1px solid #f3f4f6;">${depositPayNowUrl
                        ? `Paying the deposit accepts this quote. The rest is invoiced when the job's done.`
                        : `You'll be asked for this after accepting. The rest is invoiced when the job's done.`}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`
    : '';

  // Primary CTA + decline.
  // - With a Square deposit link: primary is "Accept & Pay Deposit" → Square.
  //   Paying = accepting (the Square webhook flips the quote to 'accepted' and
  //   fires the same side-effects as the Accept page).
  // - Without: primary is "Accept quote" → acceptance page.
  const acceptUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=accept';
  const declineUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=decline';
  const primaryHref = depositPayNowUrl ? depositPayNowUrl : acceptUrl;
  // Amount + percentage are surfaced in the deposit block — keep the button
  // label clean so the hero number doesn't repeat.
  const primaryLabel = input.primaryLabel
    ?? (depositPayNowUrl && depositAmount ? 'Accept &amp; Pay Deposit' : 'Accept quote');
  const heading = input.heading ?? 'Happy to go ahead?';

  const whoIsNotified = businessName ? esc(businessName) : 'the business';
  const reassurance = depositPayNowUrl
    ? `Secure card payment through Square. ${whoIsNotified} is notified the moment it clears.`
    : `${whoIsNotified} gets notified straight away and will be in touch to lock in a date.`;

  const footnotes = [
    depositPayNowUrl && surchargePaymentFees
      ? `Card payments include a ${PASSTHROUGH_SURCHARGE_PCT}% processing fee.`
      : '',
    depositPayNowUrl && hasTerms
      ? 'By paying you accept the Terms &amp; Conditions in the attached quote.'
      : '',
  ].filter(Boolean);

  /**
   * The real acceptance URL, in plain text, for anyone who won't click a
   * button they can't verify.
   *
   * Brevo rewrites every `href` to https://<sub>.r.bh.d.sendibt3.com/tr/cl/…
   * and there is no per-message opt-out (tried `clicktracking="off"` — a
   * Mailchimp convention Brevo ignores; shipped and reverted 18-19 Aug 2026).
   * So the buttons above CANNOT show our domain. Measured on a real account:
   * a $31,737 quote opened eleven times with zero clicks, a $44,304 quote
   * opened once with zero clicks, while a $24,040 quote that was clicked got
   * accepted two days later. An opaque redirect on the one link asking
   * someone to approve thousands of dollars is the obvious suspect.
   *
   * What Brevo rewrites is the `href` ATTRIBUTE. A bare URL sitting in the
   * body as text is left alone — verified by sending a probe and reading the
   * delivered message. So the customer gets one legible, unrewritten
   * `quotemateapp.au` address to check the buttons against.
   *
   * Deliberately NOT wrapped in an <a>: the moment it is, Brevo rewrites it
   * and we are back where we started. There is a test pinning that.
   *
   * Worth knowing, from opening a delivered quote in Gmail: the client
   * LINKIFIES this text itself, and because the text is the real URL the
   * resulting link is the real URL. So the customer both reads our domain and
   * gets a working tap — without us ever emitting an href for Brevo to eat.
   * The copy says "check the link yourself" rather than "type it in" because
   * the token is 64 characters and nobody is typing that; the point is that
   * the address is legible, not that it's transcribable.
   */
  const plainUrl = (acceptanceUrl || '').trim();

  // Buttons are table cells (not padded <a>) so Outlook renders the full
  // background, and the <a> fills the cell so the whole block is tappable.
  //
  // These hrefs reach the customer REWRITTEN to
  // https://<sub>.r.bh.d.sendibt3.com/tr/cl/<hash> — Brevo's click tracker.
  // That matters: measured 18 Aug 2026 on a real account, a $31,737 quote was
  // delivered and opened eleven times with zero clicks, and a $44,304 quote
  // opened once with zero clicks, while a $24,040 quote that WAS clicked got
  // accepted two days later. An opaque redirect domain on the one link asking
  // someone to approve thousands of dollars is the leading explanation.
  //
  // `clicktracking="off"` does NOT fix it. That is a Mailchimp convention;
  // Brevo ignores the attribute (verified by sending and reading a delivered
  // message — the attribute survives, the href is rewritten anyway), and Brevo
  // offers no per-message tracking control for transactional email at all.
  // Shipped and reverted, 18–19 Aug 2026. Don't try it again.
  //
  // The fix is Brevo's Branded Domain: a CNAME that moves tracking onto a
  // subdomain of ours, so the link reads as ours and click tracking survives.
  // DNS + dashboard, not code.
  const button = (href: string, label: string, opts: { fill: string; text: string; border: string; weight: number; size: number }) => `
                    <tr>
                      <td class="qm-c-btn" style="background:${opts.fill};border:1px solid ${opts.border};border-radius:10px;text-align:center;">
                        <a href="${esc(href)}" target="_blank" style="display:block;padding:15px 24px;color:${opts.text};font-size:${opts.size}px;font-weight:${opts.weight};line-height:1.2;text-decoration:none;">${label}</a>
                      </td>
                    </tr>`;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
      <tr>
        <td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:3px solid ${accent};border-radius:12px;padding:24px 22px;">
          <p style="color:#111827;font-size:17px;font-weight:700;text-align:center;margin:0 0 16px;letter-spacing:-0.2px;">${heading}</p>
          ${depositSection}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <table role="presentation" width="320" cellpadding="0" cellspacing="0" class="qm-c-btn" style="width:320px;max-width:100%;margin:0 auto;">
                  ${button(primaryHref, primaryLabel, { fill: accent, text: '#ffffff', border: accent, weight: 700, size: 16 })}
                  <tr><td height="10" style="font-size:10px;line-height:10px;">&nbsp;</td></tr>
                  ${button(declineUrl, 'Decline quote', { fill: '#ffffff', text: '#4b5563', border: '#d1d5db', weight: 600, size: 15 })}
                </table>
              </td>
            </tr>
          </table>
          <p style="color:#6b7280;font-size:12px;line-height:1.6;text-align:center;margin:16px 0 0;">${reassurance}</p>
          ${plainUrl ? `<p style="color:#6b7280;font-size:12px;line-height:1.7;text-align:center;margin:14px 0 0;padding:12px 10px 0;border-top:1px solid #e5e7eb;">Or check the link yourself:<br><span style="color:#374151;font-weight:600;word-break:break-all;">${esc(plainUrl)}</span></p>` : ''}
          ${footnotes.map(note => `<p style="color:#9ca3af;font-size:11px;line-height:1.6;text-align:center;margin:6px 0 0;">${note}</p>`).join('')}
        </td>
      </tr>
    </table>`;
}

function renderInvoicePayNowCta(payNowUrl: string | undefined, hasTerms: boolean | undefined, surchargePaymentFees: boolean | undefined, accent: string): string {
  if (!payNowUrl) return '';
  const esc = escapeHtml;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;">
      <tr>
        <td align="center">
          <table role="presentation" width="320" cellpadding="0" cellspacing="0" class="qm-c-btn" style="width:320px;max-width:100%;margin:0 auto;">
            <tr>
              <td class="qm-c-btn" style="background:${accent};border:1px solid ${accent};border-radius:10px;text-align:center;">
                <a href="${esc(payNowUrl)}" target="_blank" style="display:block;padding:15px 24px;color:#ffffff;font-size:16px;font-weight:700;line-height:1.2;text-decoration:none;">Pay now</a>
              </td>
            </tr>
          </table>
          <p style="color:#6b7280;font-size:12px;margin:12px 0 0;">Secure card payment through Square</p>
          ${surchargePaymentFees ? `<p style="color:#9ca3af;font-size:11px;margin:6px 0 0;">Card payments include a ${PASSTHROUGH_SURCHARGE_PCT}% processing fee.</p>` : ''}
          ${hasTerms ? `<p style="color:#9ca3af;font-size:11px;margin:6px 0 0;">By paying you accept the Terms &amp; Conditions in the attached invoice.</p>` : ''}
        </td>
      </tr>
    </table>`;
}

// ----- unified document email builder -----

export type DocumentEmailData =
  | ({ type: 'quote' } & QuoteEmailData)
  | ({ type: 'invoice' } & InvoiceEmailData);

/**
 * Unified entry point for client-facing document emails. Branches on `type`
 * for the doc-specific bits (header copy, accept-vs-pay CTA, photos vs
 * deposit-credit, preheader) and reuses shared component helpers for the
 * 80% in common (body, pricing rows, business footer, wrapper template).
 */
export function buildDocumentEmailHtml(data: DocumentEmailData): string {
  const accent = safeBrandColor(data.business.brandColor);
  const esc = escapeHtml;
  const isInvoice = data.type === 'invoice';
  const typeLabel = isInvoice ? 'Invoice' : 'Quote';
  const headerLabel = isInvoice ? 'Invoice' : 'Quotation';

  // Type-specific blocks. The framing (header / greeting / body / pricing /
  // attachment notice / sign-off / business footer) is identical between
  // quote and invoice — only the middle inserts and the closing copy differ.
  const docNumber = isInvoice ? data.invoiceNumber : undefined;
  const headerStrip = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
      <tr>
        <td style="vertical-align:middle;">
          <span style="display:inline-block;background:${accent};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:5px 10px;border-radius:4px;">${headerLabel}</span>
        </td>
        ${docNumber ? `<td style="vertical-align:middle;text-align:right;color:#9ca3af;font-size:12px;font-weight:600;letter-spacing:0.3px;">#${esc(docNumber)}</td>` : ''}
      </tr>
    </table>`;

  const preBodyExtras = !isInvoice ? renderPhotosSection(data.photoUrls) : '';

  const pricingRows = renderPricingRows({
    materialsSubtotal: data.materialsSubtotal,
    laborTotal: data.laborTotal,
    subtotal: data.subtotal,
    gst: data.gst,
    total: data.total,
    gstRegistered: data.gstRegistered,
    accent,
    depositCredit: isInvoice ? data.depositCredit : undefined,
    priceDetail: data.priceDetail,
    showMaterialCosts: data.showMaterialCosts,
    showLaborCosts: data.showLaborCosts,
    travelAdjustment: data.travelAdjustment,
    travelAdjustmentAmount: data.travelAdjustmentAmount,
    dueDate: isInvoice ? data.dueDate : undefined,
    invoiceNumber: isInvoice ? data.invoiceNumber : undefined,
  });

  const postPricingCta = isInvoice
    ? renderInvoicePayNowCta(data.payNowUrl, data.hasTerms, data.surchargePaymentFees, accent)
    : '';

  // Payment methods (bank / PayID / BPAY / PayPal / other) are invoice-only
  // and gated to pro & trial — matches the PDF. The amount due, due date and
  // payment reference live in the summary card above, next to the total.
  const paymentMethodsBlock = isInvoice
    ? renderInvoicePaymentMethods({
        paymentMethods: data.paymentMethods,
        plan: data.plan,
        accent,
        hasPayNow: !!data.payNowUrl,
      })
    : '';

  // For quotes the accept/decline CTA sits below the "PDF attached" line; for
  // invoices the Pay Now button sits above it, so the post-attachment slot
  // takes the quote CTA only.
  const postAttachmentCta = !isInvoice
    ? renderQuoteCta({
        acceptanceUrl: data.acceptanceUrl,
        depositAmount: data.depositAmount,
        depositPercentage: data.depositPercentage,
        depositPayNowUrl: data.depositPayNowUrl,
        hasTerms: data.hasTerms,
        surchargePaymentFees: data.surchargePaymentFees,
        accent,
        businessName: data.business.name,
      })
    : '';

  // The "PDF attached" note used to be its own italic line sitting between the
  // price and the buttons — a speed bump right where the customer is deciding.
  // It now rides along with the closing paragraph, after the decision.
  const attachmentNote = `The full PDF ${typeLabel.toLowerCase()} is attached for your records.`;
  const closingNotice = isInvoice
    ? `<p style="color:#374151;font-size:15px;line-height:1.7;margin:22px 0 0;">
      ${attachmentNote} If you have any questions, just reply to this email.
    </p>`
    : `<p style="color:#374151;font-size:15px;line-height:1.7;margin:24px 0 0;">
      This quote is valid for 30 days. ${attachmentNote} If you have any questions, just reply to this email.
    </p>`;

  const content = `
    ${headerStrip}
    <h1 style="color:#111827;font-size:25px;font-weight:800;margin:0 0 20px;line-height:1.25;letter-spacing:-0.4px;">
      ${esc(data.jobName)}
    </h1>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${esc(data.customerName)},
    </p>

    ${renderEmailBodyHtml(data.emailBody)}

    ${preBodyExtras}

    ${pricingRows}

    ${postPricingCta}

    ${paymentMethodsBlock}

    ${postAttachmentCta}

    ${closingNotice}

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:20px 0 0;">
      Kind regards,<br/>
      <strong style="color:#111827;">${esc(data.business.name)}</strong>
    </p>

    ${renderBusinessFooter(data.business, accent)}
  `;

  return wrapQuoteEmailTemplate(content, {
    brandColor: accent,
    businessName: data.business.name,
    logoUrl: data.business.logoUrl,
    preheader: `${typeLabel} for ${data.jobName} — ${formatMoney(data.total)} from ${data.business.name}`,
  });
}

// ----- legacy wrappers — kept for callers that still build per-type payloads -----

export function buildQuoteEmailHtml(data: QuoteEmailData): string {
  return buildDocumentEmailHtml({ type: 'quote', ...data });
}

// ============================================================
// INVOICE EMAIL BUILDER
// ============================================================

interface InvoiceEmailData {
  customerName: string;
  emailBody: string;
  jobName: string;
  materials: { name: string; quantity: number; unit: string; totalPrice: number; section?: string }[];
  laborTotal: number;
  materialsSubtotal: number;
  subtotal: number;
  gst: number;
  total: number;
  // Travel surcharge: the percentage the tradie set, and its dollar value
  // computed off the RAW subtotal. See PricingRowsInput for why the amount is
  // passed rather than derived from `subtotal` above.
  travelAdjustment?: number;
  travelAdjustmentAmount?: number;
  // See QuoteEmailData.gstRegistered.
  gstRegistered?: boolean;
  invoiceNumber?: string;
  dueDate: string; // ISO date string
  payNowUrl?: string; // Square hosted payment link (only present when tradie has Square connected)
  // True when the attached PDF carries a T&Cs section — drives whether the
  // Pay Now button renders the "By paying you accept the terms…" footnote.
  hasTerms?: boolean;
  // True when the tradie has surchargePaymentFees on — the Square checkout
  // amount has been bumped, so we surface a subtle disclosure under the CTA.
  surchargePaymentFees?: boolean;
  // Deposit credit carried over from a quote that had a deposit paid. Rendered
  // as a "Deposit already paid" line above the total.
  depositCredit?: number;
  // How much of the money the customer sees — see
  // shared/document/priceDetail.ts. The legacy pair is still accepted so an
  // older caller keeps working.
  priceDetail?: PriceDetail;
  /** @deprecated Use priceDetail. */
  showMaterialCosts?: boolean;
  /** @deprecated Use priceDetail. */
  showLaborCosts?: boolean;
  // Payment Information block — always rendered for invoices when an
  // invoiceNumber/dueDate is known. paymentMethods/plan only render the
  // bank/PayID/BPAY/PayPal/other details for pro & trial tradies.
  paymentMethods?: any;
  plan?: 'trial' | 'free' | 'pro';
  business: DocEmailBusiness;
}

export function buildInvoiceEmailHtml(data: InvoiceEmailData): string {
  return buildDocumentEmailHtml({ type: 'invoice', ...data });
}

// ============================================================
// UNSUBSCRIBE HANDLER
// ============================================================

export async function handleUnsubscribe(userId: string, category: string): Promise<boolean> {
  try {
    await admin.firestore()
      .doc(`users/${userId}/settings/emailPreferences`)
      .set({
        [category]: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    return true;
  } catch (error) {
    return false;
  }
}

// ============================================================
// QUOTE FOLLOW-UP EMAIL (2hrs after first quote created)
// ============================================================

// Pull a sensible first name out of whatever name string we have. Returns
// null when the value doesn't look like a real person's name (e.g. it's a
// business name like "Joe's Plumbing Pty Ltd", an email, or junk) so the
// caller can fall back to a generic greeting rather than "Hey Pty Ltd".
function deriveFirstName(rawName?: string | null): string | null {
  if (!rawName) return null;
  const cleaned = rawName.trim();
  if (!cleaned) return null;

  // Looks like an email or contains digits/symbols → not a person's name.
  if (/[@0-9]/.test(cleaned)) return null;

  const first = cleaned.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
  if (first.length < 2 || first.length > 20) return null;

  // Common business-y tokens that shouldn't be greeted as a name.
  const businessWords = new Set([
    'the', 'pty', 'ltd', 'inc', 'co', 'company', 'services', 'service',
    'group', 'trades', 'trade', 'solutions', 'pro', 'plumbing', 'electrical',
    'building', 'constructions', 'construction', 'contracting', 'contractors',
    'maintenance', 'enterprises', 'holdings',
  ]);
  if (businessWords.has(first.toLowerCase())) return null;

  // Title-case it so "tom" / "TOM" both render as "Tom".
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function sendQuoteFollowUpEmail(
  to: string,
  recipientName: string,
  jobName: string,
  total: number,
  hasMaterials: boolean,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const firstName = deriveFirstName(recipientName);
  const greeting = firstName ? `Hey ${firstName},` : 'Hey mate,';

  // When the quote has no material line items, gently nudge them toward the
  // AI materials generator instead of the usual "how'd it go" ask.
  const noMaterialsLine = hasMaterials
    ? ''
    : `
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      One thing I noticed &mdash; there were no material items on the quote. Did you want to have a crack at generating them? The app can build a materials list with live pricing for you in a few seconds, so you're not leaving money on the table. Happy to walk you through it if you get stuck.
    </p>`;

  const content = wrapEmailTemplate(`
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${greeting}
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      It's Tom from QuoteMate &mdash; I'm the guy that built it. Just saw your quote for <strong style="color:#f8fafc;">${jobName}</strong>, how did it go? Is there anything I can do to help out?
    </p>
${noMaterialsLine}
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Genuinely keen to hear how you found it &mdash; what worked, what didn't, anything that nearly made you chuck your phone at the wall. If you've got 10 seconds, just hit reply and let me know, or tap one of the buttons below.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=great" target="_blank" style="display:inline-block;background:#064e3b;border:2px solid #00c897;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#129321;</span>
                  <span style="color:#00c897;font-size:12px;font-weight:700;">Loved it</span>
                </a>
              </td>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=okay" target="_blank" style="display:inline-block;background:#1e293b;border:2px solid #f59e0b;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#128528;</span>
                  <span style="color:#f59e0b;font-size:12px;font-weight:700;">It was alright</span>
                </a>
              </td>
              <td style="padding:0 6px;">
                <a href="https://us-central1-hansendev.cloudfunctions.net/quickFeedback?userId=${userId}&rating=bad" target="_blank" style="display:inline-block;background:#1e293b;border:2px solid #ef4444;border-radius:12px;padding:14px 20px;text-decoration:none;text-align:center;min-width:80px;">
                  <span style="font-size:28px;display:block;margin:0 0 4px;">&#128169;</span>
                  <span style="color:#ef4444;font-size:12px;font-weight:700;">Needs work</span>
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:28px 0 0;">
      Cheers,<br/>
      Tom &mdash; QuoteMate &#127866;
    </p>
  `, { unsubscribeUrl, preheader: `How'd your quote for ${jobName} go? Anything I can help with?` });

  return sendEmail({
    to,
    subject: firstName ? `${firstName}, how'd your first quote go?` : `How'd your first quote go?`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['quote-follow-up'],
    unsubscribeUrl,
  });
}

export interface QuoteReminderEmailData {
  customerName: string;
  jobName: string;
  total: number;
  acceptanceUrl: string;
  followUpNumber: 1 | 2;
  business: DocEmailBusiness;
}

/**
 * The reminder's HTML. Split out from the send so it can be rendered in tests
 * and the preview harness without a Brevo call — same shape as
 * buildDocumentEmailHtml.
 */
export function buildQuoteReminderEmailHtml(data: QuoteReminderEmailData): string {
  const { customerName, jobName, total, acceptanceUrl, followUpNumber, business } = data;
  const accent = safeBrandColor(business.brandColor);
  const esc = escapeHtml;

  const lead = followUpNumber === 1
    ? `Just bumping this up your inbox in case it got buried — happy to answer any questions about the quote.`
    : `One last check-in on the quote below. If the price or scope isn't quite right, reply to this email and we can adjust it.`;

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
      <tr>
        <td>
          <span style="display:inline-block;background:${accent};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:5px 10px;border-radius:4px;">Quotation</span>
        </td>
      </tr>
    </table>
    <h1 style="color:#111827;font-size:25px;font-weight:800;margin:0 0 20px;line-height:1.25;letter-spacing:-0.4px;">
      ${esc(jobName)}
    </h1>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      Hi ${esc(customerName || 'there')},
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${lead}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;margin:26px 0 0;overflow:hidden;">
      <tr>
        <td style="padding:16px 22px;background:#f9fafb;border-top:2px solid #111827;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#111827;font-size:13px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;vertical-align:bottom;">Total</td>
              <td style="color:${accent};font-size:26px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;line-height:1.1;vertical-align:bottom;">${formatMoney(total)}</td>
            </tr>
            <tr>
              <td colspan="2" style="color:#6b7280;font-size:12px;padding-top:8px;">The full PDF quote was attached to your previous email.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${renderQuoteCta({
      acceptanceUrl,
      accent,
      businessName: business.name,
      heading: 'Still keen?',
      primaryLabel: 'Review &amp; accept quote',
    })}

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:24px 0 0;">
      Cheers,<br/>
      <strong style="color:#111827;">${esc(business.name)}</strong>
    </p>

    ${renderBusinessFooter(business, accent)}
  `;

  return wrapQuoteEmailTemplate(content, {
    brandColor: accent,
    businessName: business.name,
    logoUrl: business.logoUrl,
    preheader: `Reminder: ${jobName} quote — ${formatMoney(total)} from ${business.name}`,
  });
}

/**
 * Customer-facing reminder for a sent quote that hasn't been accepted yet.
 * Triggered by the customerQuoteFollowUp scheduled function. Tone is
 * professional and shifts slightly between the first and second nudge.
 */
export function sendCustomerQuoteReminderEmail(args: QuoteReminderEmailData & {
  to: string;
  userId: string;
}): Promise<boolean> {
  const { to, jobName, followUpNumber, business, userId } = args;

  const subject = followUpNumber === 1
    ? `Reminder: your quote from ${business.name} for ${jobName}`
    : `Following up on your quote from ${business.name}`;

  return sendEmail({
    to,
    subject,
    htmlContent: buildQuoteReminderEmailHtml(args),
    category: 'transactional',
    userId,
    tags: ['quote-customer-reminder', `followup:${followUpNumber}`],
    // Match the original quote send: from-name shows the tradie's business and
    // replies route back to them, not to the QuoteMate inbox.
    senderName: business.name || undefined,
    replyTo: business.email ? { email: business.email, name: business.name } : undefined,
  });
}

// ============================================================
// ADMIN NOTIFICATION EMAILS
// ============================================================

/**
 * Notify admin when a new user registers
 */
export function sendNewUserNotificationEmail(
  userEmail: string,
  platform: string,
  authMethod: string,
  businessName: string,
  reclaimed = false,
): Promise<boolean> {
  const platformLabels: Record<string, string> = {
    ios: 'iOS (iPhone/iPad)',
    android: 'Android',
    web: 'Web',
  };
  const platformDisplay = platformLabels[platform] || platform || 'Unknown';

  const methodLabels: Record<string, string> = {
    email: 'Email & Password',
    google: 'Google Sign-In',
    apple: 'Apple Sign-In',
  };
  const methodDisplay = methodLabels[authMethod] || authMethod || 'Unknown';

  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">New User Registration</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      A new user just signed up!
    </h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:12px 16px;background:#1e293b;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Email</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${userEmail}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Platform</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${platformDisplay}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Sign-up Method</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${methodDisplay}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <span style="color:#94a3b8;font-size:13px;">Business Name</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${businessName || 'Not set yet'}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `${reclaimed ? 'Returning' : 'New'} QuoteMate user: ${userEmail} (${platformDisplay})`,
    htmlContent: content,
    category: 'transactional',
    tags: ['admin-notification', 'new-user'],
  });
}

export function sendNewProSubscriptionEmail(
  userEmail: string,
  userId: string,
  platform: string,
  productId: string,
  businessName: string,
): Promise<boolean> {
  const platformLabels: Record<string, string> = {
    ios: 'iOS (App Store)',
    android: 'Android (Google Play)',
    web: 'Web (Stripe)',
  };
  const platformDisplay = platformLabels[platform] || platform || 'Unknown';

  const isYearly = productId.includes('yearly');
  const planDisplay = isYearly ? 'Yearly ($328/yr)' : 'Monthly ($49/mo)';

  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">New Pro Subscription 💰</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      A user just upgraded to Pro!
    </h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:12px 16px;background:#1e293b;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Email</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${userEmail}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Business Name</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${businessName || 'Not set'}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Plan</span><br/>
                <span style="color:#22c55e;font-size:15px;font-weight:600;">${planDisplay}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Platform</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${platformDisplay}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <span style="color:#94a3b8;font-size:13px;">User ID</span><br/>
                <span style="color:#f8fafc;font-size:13px;font-family:monospace;">${userId}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `💰 New Pro subscriber: ${userEmail} (${planDisplay} — ${platformDisplay})`,
    htmlContent: content,
    category: 'transactional',
    tags: ['admin-notification', 'new-pro-subscription'],
  });
}

function escapeHtmlEmail(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sendFeedbackEmail(
  userEmail: string,
  userId: string,
  category: string,
  feedback: string,
): Promise<boolean> {
  const escapedFeedback = escapeHtmlEmail(feedback).replace(/\n/g, '<br/>');
  const escapedCategory = escapeHtmlEmail(category);

  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">User Feedback</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      New feedback from a user
    </h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:12px 16px;background:#1e293b;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">From</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${escapeHtmlEmail(userEmail)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Category</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${escapedCategory}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <span style="color:#94a3b8;font-size:13px;">Feedback</span><br/>
                <span style="color:#f8fafc;font-size:15px;line-height:1.6;">${escapedFeedback}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `QuoteMate Feedback: ${escapedCategory}`,
    htmlContent: content,
    category: 'transactional',
    tags: ['feedback', category.toLowerCase().replace(/\s+/g, '-')],
  });
}

/**
 * Notify the founder when a tradie registers interest in the call-answering
 * service (Katie). These leads are handled with a manual/white-glove setup
 * call for now, so this email is the trigger to reach out.
 */
export function sendLeadInterestEmail(
  userEmail: string,
  userId: string,
  details: {
    businessName: string;
    contactPhone: string;
    missedCalls?: string;
    typicalJobValue?: number | null;
    estLostPerYear?: number | null;
    notes?: string;
  },
): Promise<boolean> {
  const businessName = escapeHtmlEmail(details.businessName || 'Unknown business');
  const contactPhone = escapeHtmlEmail(details.contactPhone || 'Not provided');
  const missedCalls = escapeHtmlEmail(details.missedCalls || 'Not specified');
  const fmtMoney = (n?: number | null) =>
    typeof n === 'number' && Number.isFinite(n)
      ? '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : null;
  const typicalJobValue = fmtMoney(details.typicalJobValue);
  const estLostPerYear = fmtMoney(details.estLostPerYear);
  const notes = details.notes
    ? escapeHtmlEmail(details.notes).replace(/\n/g, '<br/>')
    : '—';

  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">New Lead — Call Answering (Katie)</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      ${businessName} wants Katie set up
    </h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:12px 16px;background:#1e293b;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Business</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${businessName}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Best number to call</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${contactPhone}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Calls missed per week</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${missedCalls}</span>
              </td>
            </tr>
            ${typicalJobValue ? `<tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Typical job value</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${typicalJobValue}</span>
              </td>
            </tr>` : ''}
            ${estLostPerYear ? `<tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Est. lost revenue / year</span><br/>
                <span style="color:#cfa153;font-size:15px;font-weight:700;">${estLostPerYear}</span>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Account email</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${escapeHtmlEmail(userEmail)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <span style="color:#94a3b8;font-size:13px;">Notes</span><br/>
                <span style="color:#f8fafc;font-size:15px;line-height:1.6;">${notes}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#64748b;font-size:12px;margin:0;">User ID: ${escapeHtmlEmail(userId)}</p>
  `);

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `New Katie lead: ${details.businessName || 'Unknown business'}`,
    htmlContent: content,
    category: 'transactional',
    tags: ['lead-interest', 'callkatie'],
  });
}

/**
 * Send a one-off affiliate invitation email
 */
export function sendAffiliateInviteEmail(
  recipientEmail: string,
): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <h1 style="color:#f1f5f9;font-size:24px;font-weight:700;margin:0 0 20px;">Hey Legend! 🤙</h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px;">
      It's Tom here — hope you're doing well mate!
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px;">
      I wanted to reach out because I've set you up as an affiliate for <strong style="color:#f1f5f9;">QuoteMate</strong> — my quoting app built for tradies.
    </p>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px;">
      As an affiliate, you'll earn <strong style="color:#10b981;">50% commission</strong> on every Pro subscription that signs up through your referral link. It's a pretty sweet deal — you just share your link and earn cash when people subscribe.
    </p>
    ${infoCard(
      infoRow('Commission Rate', '50% of net revenue', false) +
      infoRow('Subscription Price', '$49 AUD/month', false) +
      infoRow('How It Works', 'Share your referral link → they subscribe → you earn', true),
      '#10b981'
    )}
    <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px;">
      To get started, just sign up at the link below and your affiliate status will be activated automatically. You'll get a unique referral link and QR code to share around.
    </p>
    ${ctaButton('Get Started with QuoteMate', '#009868', 'https://quotemateapp.au')}
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:24px 0 0;">
      Cheers legend,<br/>
      <strong style="color:#f1f5f9;">Tom</strong>
    </p>
  `);

  return sendEmail({
    to: recipientEmail,
    subject: "You're in legend — QuoteMate Affiliate Invite 🤙",
    htmlContent: content,
    category: 'transactional',
    tags: ['affiliate-invite'],
  });
}

export function sendMaterialListErrorEmail(
  userEmail: string,
  userId: string,
  jobDescription: string,
  errorMessage: string,
): Promise<boolean> {
  const truncatedJob = jobDescription.length > 500
    ? jobDescription.substring(0, 500) + '...'
    : jobDescription;

  const timestamp = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });

  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Material List Generation Failed</p>
    <h1 style="color:#ef4444;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      A material list generation has failed
    </h1>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:12px 16px;background:#1e293b;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">User</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${userEmail || userId}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Time (AEST)</span><br/>
                <span style="color:#f8fafc;font-size:15px;font-weight:600;">${timestamp}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #334155;">
                <span style="color:#94a3b8;font-size:13px;">Error</span><br/>
                <span style="color:#ef4444;font-size:15px;font-weight:600;">${errorMessage}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <span style="color:#94a3b8;font-size:13px;">Job Description</span><br/>
                <span style="color:#f8fafc;font-size:14px;">${truncatedJob}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `Material list generation failed for ${userEmail || userId}`,
    htmlContent: content,
    category: 'transactional',
    tags: ['admin-notification', 'material-list-error'],
  });
}

export function sendDraftNudgeEmail(
  to: string,
  businessName: string,
  drafts: Array<{ customerName: string; jobName: string; total: number; daysOld: number }>,
  tier: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = businessName || 'mate';
  const draftCount = drafts.length;
  const totalValue = drafts.reduce((sum, d) => sum + d.total, 0);
  const formattedValue = `$${totalValue.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const draftRows = drafts.slice(0, 5).map(d => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #334155;">
        <span style="color:#f8fafc;font-size:14px;font-weight:600;">${d.customerName}</span><br/>
        <span style="color:#94a3b8;font-size:13px;">${d.jobName} &mdash; $${d.total.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
        <span style="color:#64748b;font-size:12px;float:right;">${d.daysOld}d ago</span>
      </td>
    </tr>
  `).join('');

  const moreText = drafts.length > 5
    ? `<p style="color:#64748b;font-size:13px;margin:8px 0 0;">+ ${drafts.length - 5} more draft${drafts.length - 5 > 1 ? 's' : ''}</p>`
    : '';

  const heading = tier === 3
    ? `${greeting}, last nudge on these drafts`
    : `${greeting}, you've got ${draftCount} unsent quote${draftCount > 1 ? 's' : ''}`;

  const subtext = tier === 3
    ? `These quotes have been sitting for over a week. Send them off or they might go cold.`
    : `That's <strong style="color:#f8fafc;">${formattedValue}</strong> worth of work waiting to land in your customer's inbox.`;

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      ${badge(`${draftCount} UNSENT`, '#78350f', '#e6b872')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;text-align:center;line-height:1.3;">
      ${heading}
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;text-align:center;">
      ${subtext}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;border:1px solid #334155;">
      <tr>
        <td style="padding:16px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${draftRows}
          </table>
          ${moreText}
        </td>
      </tr>
    </table>

    ${ctaButton('Review & Send Quotes')}

    <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;text-align:center;">
      Quotes sent sooner get accepted more often. Don't let these go cold!
    </p>
  `, { unsubscribeUrl, preheader: `You have ${draftCount} unsent quote${draftCount > 1 ? 's' : ''} worth ${formattedValue}. Send them before they go cold.` });

  return sendEmail({
    to,
    subject: `You've got ${draftCount} draft quote${draftCount > 1 ? 's' : ''} in QuoteMate`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['draft-nudge', `tier-${tier}`],
    unsubscribeUrl,
  });
}

/**
 * Single-quote "ready to send" nudge: the quote is fully built (customer +
 * materials, parked on the preview screen) but was never sent. Fires once per
 * quote. Modelled on sendDraftNudgeEmail but scoped to one finished quote.
 */
export function sendReadyToSendNudgeEmail(
  to: string,
  businessName: string,
  quote: { customerName?: string; quoteNumber?: string | null; total?: number },
  daysOld: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const customerName = quote.customerName || 'your customer';
  const total = quote.total || 0;
  const formattedTotal = `$${total.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const ageText = daysOld <= 1 ? 'a day' : `${daysOld} days`;
  // HTML-escaped variants for template interpolation; the subject stays raw
  // (it's a plain-text header, not HTML).
  const greeting = escapeHtml(businessName || "G'day");
  const customerNameHtml = escapeHtml(customerName);
  const quoteNumberHtml = escapeHtml(quote.quoteNumber || '');
  const heading = quoteNumberHtml
    ? `Quote ${quoteNumberHtml} for ${customerNameHtml} is built and ready`
    : `Your quote for ${customerNameHtml} is built and ready`;

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      ${badge('READY TO SEND', '#78350f', '#e6b872')}
    </div>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${greeting},
    </p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;text-align:center;line-height:1.3;">
      ${heading}
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 24px;text-align:center;">
      You built it ${ageText} ago and it hasn't gone out yet${total > 0 ? ` &mdash; that's <strong style="color:#f8fafc;">${formattedTotal}</strong> of work still sitting in your drafts` : ''}. Have a quick look and send it through.
    </p>

    ${ctaButton('Open in QuoteMate')}
  `, { unsubscribeUrl, preheader: `Your quote for ${customerNameHtml} is built and ready to send${total > 0 ? ` &mdash; ${formattedTotal} of work still in drafts` : ''}.` });

  return sendEmail({
    to,
    subject: `Your quote for ${customerName} is ready to send`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['ready-to-send-nudge'],
    unsubscribeUrl,
  });
}

/**
 * Password reset link.
 *
 * Sent over Brevo rather than through Firebase Auth's own mailer: Firebase
 * sends from `noreply@<project>.firebaseapp.com`, which has no SPF/DKIM
 * alignment with hansendev.com.au, and a live test on 29 Jul 2026 landed in
 * Gmail's spam folder. This path is the one every other QuoteMate email uses
 * and reaches the inbox.
 *
 * Category is transactional so it can never be suppressed by a marketing
 * opt-out — a locked-out user must always be able to get back in.
 */
export function sendPasswordResetLinkEmail(to: string, resetLink: string, userId?: string): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <p style="color:#00c897;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">Account access</p>
    <h1 class="qm-h1" style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">
      Set a new password
    </h1>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 16px;">
      Someone asked to reset the QuoteMate password for <strong style="color:#f8fafc;">${to}</strong>. Tap the button below and you can pick a new one.
    </p>
    ${ctaButton('Set a new password', '#009868', resetLink)}
    <p class="qm-body" style="color:#94a3b8;font-size:14px;line-height:1.6;margin:24px 0 0;">
      This link is good for one hour. If it's expired by the time you get to it, just ask for another from the sign-in screen.
    </p>
    <p class="qm-body" style="color:#94a3b8;font-size:14px;line-height:1.6;margin:12px 0 0;">
      If that wasn't you, you can ignore this — nothing changes and your password stays as it is.
    </p>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:24px 0 0;">
      Cheers,<br/>Tom
    </p>
  `, { preheader: 'Set a new QuoteMate password' });

  return sendEmail({
    to,
    subject: 'Set a new QuoteMate password',
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['password-reset'],
  });
}

/**
 * Sent when someone asks to reset a password on an account that has no
 * password — i.e. they originally signed up with Google or Apple.
 *
 * Firebase's hosted flow sends these users nothing at all, and that silence is
 * exactly what makes them sign up again on a second account (Coastal HVAC, Jul
 * 2026). Mailing the address itself leaks nothing to a third party: only the
 * mailbox owner sees it.
 */
export function sendSocialSignInReminderEmail(to: string, providerDescription: string, userId?: string): Promise<boolean> {
  const content = wrapEmailTemplate(`
    <p style="color:#00c897;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">Account access</p>
    <h1 class="qm-h1" style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;line-height:1.3;">
      No password needed &mdash; you're a ${providerDescription} sign-in
    </h1>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 16px;">
      Someone asked to reset the QuoteMate password for <strong style="color:#f8fafc;">${to}</strong>. There's no password on this account to reset &mdash; it was set up with <strong style="color:#f8fafc;">${providerDescription}</strong>.
    </p>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 8px;">
      Head back to the sign-in screen and tap the <strong style="color:#f8fafc;">${providerDescription}</strong> button instead &mdash; you'll go straight in, and everything will be where you left it.
    </p>
    ${ctaButton('Open QuoteMate', '#009868')}
    <p class="qm-body" style="color:#94a3b8;font-size:14px;line-height:1.6;margin:24px 0 0;">
      If that wasn't you, you can safely ignore this — nothing has changed on your account.
    </p>
    <p class="qm-body" style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:24px 0 0;">
      Cheers,<br/>Tom
    </p>
  `, { preheader: `Sign in with ${providerDescription} — no password needed` });

  return sendEmail({
    to,
    subject: `Sign in with ${providerDescription} — no password needed`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['password-reset', 'social-signin-reminder'],
  });
}
