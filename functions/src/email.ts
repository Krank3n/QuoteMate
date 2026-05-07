import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

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
}

// Strip characters that could break an RFC 5322 display-name header.
// Brevo serialises sender.name into "Name <email>" so commas, quotes, and
// CR/LF could splice the header. Belt-and-braces sanitisation.
function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n,"<>]/g, '').trim().slice(0, 78);
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
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#0f172a;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding:0 0 32px;">
              <img src="https://hansendev.web.app/email-assets/logo.png" alt="QuoteMate" width="160" style="display:block;width:160px;height:auto;border-radius:20px;" />
            </td>
          </tr>
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
                <tr>
                  <td style="padding:40px 36px;">
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

// Reusable component: numbered step
function step(number: number, title: string, description: string, isLast = false): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${!isLast ? 'margin-bottom:20px;' : ''}">
      <tr>
        <td width="40" valign="top">
          <div style="background:#009868;width:32px;height:32px;border-radius:50%;text-align:center;line-height:32px;">
            <span style="color:#fff;font-size:14px;font-weight:700;">${number}</span>
          </div>
        </td>
        <td valign="top" style="padding-left:12px;">
          <p style="color:#f1f5f9;font-size:15px;font-weight:600;margin:0 0 4px;">${title}</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.5;">${description}</p>
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
async function canSendEmail(userId: string, category: EmailCategory): Promise<boolean> {
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
  const { to, subject, category, userId, tags, attachment, replyTo: replyToOverride, senderName } = options;
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

  // Check user email preferences (skip for test sends)
  if (userId && userId !== 'test') {
    const allowed = await canSendEmail(userId, category);
    if (!allowed) {
      console.info(`sendEmail: user ${userId} opted out of ${category}`);
      return false;
    }
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

export function sendWelcomeEmail(to: string, businessName: string, userId: string): Promise<boolean> {
  const greeting = businessName || 'there';
  const content = wrapEmailTemplate(`
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Welcome aboard</p>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      G'day${businessName ? `, ${greeting}` : ''}! Ready to quote like a pro?
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 28px;">
      You're all set to create professional quotes in seconds. Here's how to hit the ground running:
    </p>

    ${step(1, 'Set up your business', 'Add your logo, ABN, and contact info so every quote looks professional.')}
    ${step(2, 'Create your first quote', 'Describe the job in plain English (or use voice!) and we\'ll generate materials, labour, and pricing.')}
    ${step(3, 'Send it to your client', 'Share via email or PDF with one tap. Clients can accept online instantly.', true)}

    ${ctaButton('Open QuoteMate')}

    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:28px 0 0;">
      Questions? Just reply to this email &mdash; we're here to help.
    </p>
  `, { preheader: 'Your professional quoting toolkit is ready. Here\'s how to get started.' });

  return sendEmail({
    to,
    subject: `Welcome to QuoteMate, ${greeting}!`,
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

export function sendQuoteAcceptedEmail(
  to: string,
  customerName: string,
  quoteNumber: string,
  total: number,
  clientNotes: string | null,
  userId: string
): Promise<boolean> {
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
      Convert this quote to an invoice and get paid.
    </p>
    ${ctaButton('Open in QuoteMate', '#009868')}
  `, { preheader: `Great news! ${customerName} accepted quote #${quoteNumber} for $${total.toFixed(2)}` });

  return sendEmail({
    to,
    subject: `Quote #${quoteNumber} accepted by ${customerName}`,
    htmlContent: content,
    category: 'transactional',
    userId,
    tags: ['quote-accepted'],
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

export function sendQuotaWarningEmail(
  to: string,
  quotesUsed: number,
  quotesLimit: number,
  userId: string
): Promise<boolean> {
  const remaining = quotesLimit - quotesUsed;
  const percentage = Math.round((quotesUsed / quotesLimit) * 100);

  // Progress bar
  const progressBar = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;">
      <tr>
        <td>
          <div style="background:#1e293b;border-radius:8px;height:10px;overflow:hidden;">
            <div style="background:${percentage >= 80 ? '#cfa153' : '#009868'};width:${percentage}%;height:10px;border-radius:8px;"></div>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding-top:6px;">
          <span style="color:#94a3b8;font-size:12px;">${quotesUsed} of ${quotesLimit} quotes used</span>
          <span style="color:#94a3b8;font-size:12px;float:right;">${remaining} remaining</span>
        </td>
      </tr>
    </table>`;

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      ${badge(`${remaining} LEFT`, '#78350f', '#e6b872')}
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 16px;text-align:center;line-height:1.3;">
      You're running low on quotes
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;text-align:center;">
      You've used <strong style="color:#f8fafc;">${quotesUsed} of ${quotesLimit}</strong> free quotes this month.
    </p>

    ${progressBar}

    ${infoCard(`
      <tr>
        <td style="padding:12px 0;">
          ${featureBullet('&#9889;', '<strong style="color:#f8fafc;">Unlimited quotes</strong> every month')}
          ${featureBullet('&#127912;', '<strong style="color:#f8fafc;">Custom branding</strong> on every quote')}
          ${featureBullet('&#128200;', '<strong style="color:#f8fafc;">Priority support</strong> when you need it')}
        </td>
      </tr>
    `, '#cfa153')}

    ${ctaButton('Upgrade to Pro')}
  `, { preheader: `You have ${remaining} quote${remaining === 1 ? '' : 's'} remaining this month. Upgrade for unlimited.` });

  return sendEmail({
    to,
    subject: `${remaining} quote${remaining === 1 ? '' : 's'} remaining this month`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['quota-warning'],
  });
}

export function sendReEngagementEmail(
  to: string,
  businessName: string,
  daysSinceLastActive: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = businessName || 'mate';

  const content = wrapEmailTemplate(`
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;line-height:1.3;">
      Hey ${greeting}, your next quote is waiting
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
    subject: `${greeting}, your next quote is waiting`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['re-engagement', `inactive-${daysSinceLastActive}d`],
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
    2: {
      subject: 'Pro tip: Real material prices, automatically',
      emoji: '&#128178;',
      heading: 'No more guessing material costs',
      preheader: 'QuoteMate pulls real prices from major hardware stores automatically.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
          QuoteMate automatically looks up <strong style="color:#f8fafc;">real prices</strong> from major hardware stores. No more manual price checks.
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          Head to <strong style="color:#f8fafc;">Settings &rarr; Trade & Pricing</strong> and enable your preferred stores for the most accurate pricing in your area.
        </p>
      `,
    },
    3: {
      subject: 'Pro tip: Clients can accept quotes online',
      emoji: '&#10003;',
      heading: 'One-click quote acceptance',
      preheader: 'Send quotes your clients can accept online. Get notified instantly.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
          When you send a quote, your client gets a <strong style="color:#f8fafc;">professional link</strong> where they can review every detail and accept or decline &mdash; no phone tag needed.
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          You'll get an <strong style="color:#f8fafc;">instant notification</strong> when they respond, so you can lock in the job right away.
        </p>
      `,
    },
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
    5: {
      subject: "You've got the hang of it — here's what Pro unlocks",
      emoji: '&#11088;',
      heading: 'Ready to go Pro?',
      preheader: 'Invoicing, unlimited quotes, custom branding, and payment tracking — all yours with Pro.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
          You've been using QuoteMate like a pro already. Here's what upgrading unlocks:
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#128462; <strong style="color:#f8fafc;">Invoicing</strong> &mdash; turn accepted quotes into invoices in one tap
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#9854; <strong style="color:#f8fafc;">Unlimited quotes</strong> &mdash; no monthly cap holding you back
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 4px;">
          &#127912; <strong style="color:#f8fafc;">Custom branding</strong> &mdash; your logo on every quote and invoice
        </p>
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0;">
          &#128179; <strong style="color:#f8fafc;">Payment tracking</strong> &mdash; know who's paid and who hasn't
        </p>
      `,
    },
  };

  const tip = tips[tipNumber];
  if (!tip) return Promise.resolve(false);

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#1e293b;border:2px solid #334155;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 12px;">
        ${tip.emoji}
      </div>
      ${badge(`TIP ${tipNumber} OF 5`, '#1e293b', '#94a3b8')}
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
    tags: ['onboarding', `tip-${tipNumber}`],
    unsubscribeUrl,
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
          <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">&#127881; 7-Day Free Trial</p>
          <p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.6;">
            New to QuoteMate? You now get <strong style="color:#f8fafc;">full access to every feature for 7 days</strong> &mdash; no credit card required. Create unlimited quotes, send invoices, and use your business logo on everything.
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
            We've improved our AI-powered material pricing engine. Prices are now pulled in real-time from major hardware stores so your quotes are tighter and more competitive.
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
  emailBody: string; // AI-generated or default body text
  jobName: string;
  materials: { name: string; quantity: number; unit: string; totalPrice: number; section?: string }[];
  laborTotal: number;
  materialsSubtotal: number;
  subtotal: number;
  gst: number;
  total: number;
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

// Light-themed wrapper for client-facing quote emails (business-branded, no QM logo)
function wrapQuoteEmailTemplate(content: string, options: { brandColor?: string; businessName?: string; logoUrl?: string; preheader?: string }): string {
  const { brandColor = '#059669', businessName = '', logoUrl, preheader } = options;

  const logoSection = logoUrl
    ? `<tr><td align="center" style="padding:0 0 16px;">
        <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" width="100" style="display:block;width:100px;height:auto;border-radius:10px;" />
      </td></tr>`
    : '';

  const businessNameSection = businessName
    ? `<tr><td align="center" style="padding:0 0 24px;">
        <h2 style="margin:0;font-size:22px;font-weight:700;color:#1f2937;">${escapeHtml(businessName)}</h2>
      </td></tr>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(businessName || 'Quote')}</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;font-size:1px;color:#f7f7f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          ${logoSection}
          ${businessNameSection}
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;border-top:4px solid ${brandColor};">
                <tr>
                  <td style="padding:36px 32px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.5;">
                Powered by <a href="https://hansendev.web.app" style="color:#9ca3af;text-decoration:underline;">QuoteMate</a>
              </p>
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

function renderEmailBodyHtml(emailBody: string): string {
  return escapeHtml(stripAbnFromBody(emailBody))
    .replace(/\n\n/g, '</p><p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">')
    .replace(/\n/g, '<br/>');
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

interface PricingRowsInput {
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  gst: number;
  total: number;
  accent: string;
  // When set and > 0, render a "Deposit already paid" line and rename the
  // total label to "Balance due". Invoice-only.
  depositCredit?: number;
}

function renderPricingRows(input: PricingRowsInput): string {
  const { materialsSubtotal, laborTotal, subtotal, gst, total, accent, depositCredit } = input;
  const hasDeposit = !!(depositCredit && depositCredit > 0);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
      <tr>
        <td style="padding:16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Materials</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">$${materialsSubtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Labour</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">$${laborTotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">Subtotal</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">$${subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">GST</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">$${gst.toFixed(2)}</td>
            </tr>
            ${hasDeposit ? `
            <tr>
              <td style="padding:8px 0;color:#059669;font-size:14px;border-bottom:1px solid #e5e7eb;">Deposit already paid</td>
              <td style="padding:8px 0;color:#059669;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">−$${depositCredit!.toFixed(2)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:10px 0;color:#1f2937;font-size:16px;font-weight:700;">${hasDeposit ? 'Balance due' : 'Total (inc GST)'}</td>
              <td style="padding:10px 0;color:${accent};font-size:18px;font-weight:700;text-align:right;">$${total.toFixed(2)}</td>
            </tr>
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
  accent: string;
}

function renderQuoteCta(input: QuoteCtaInput): string {
  if (!input.acceptanceUrl) return '';
  const esc = escapeHtml;
  const { acceptanceUrl, depositAmount, depositPercentage, depositPayNowUrl, hasTerms, accent } = input;

  // Deposit notice — shown above the CTA so the customer knows what they'll
  // be asked to pay. Copy changes depending on whether we mint a Pay Now link
  // up front (one-click Accept & Pay) or fall back to the two-step flow.
  const depositNoticeSection = (depositAmount && depositAmount > 0)
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
        <tr>
          <td style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;text-align:center;">
            <div style="color:#92400e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Deposit to lock it in</div>
            <div style="color:#78350f;font-size:18px;font-weight:700;">$${depositAmount.toFixed(2)}${depositPercentage ? ` (${depositPercentage}%)` : ''}</div>
            <div style="color:#92400e;font-size:13px;margin-top:4px;">${depositPayNowUrl
              ? `Pay your deposit securely below to accept this quote. The remainder is invoiced when the job's done.`
              : `You'll be asked to pay this after accepting. The remainder is invoiced when the job's done.`}</div>
          </td>
        </tr>
      </table>`
    : '';

  // Primary CTA + decline link.
  // - With a Square deposit link: primary is "Accept & Pay Deposit" → Square.
  //   Paying = accepting (the Square webhook flips the quote to 'accepted' and
  //   fires the same side-effects as the Accept page).
  // - Without: primary is "Accept Quote" → acceptance page.
  const acceptUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=accept';
  const declineUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=decline';
  const primaryHref = depositPayNowUrl ? depositPayNowUrl : acceptUrl;
  // Amount + percentage are surfaced in the deposit notice block — keep the
  // button label clean so the hero number doesn't repeat.
  const primaryLabel = depositPayNowUrl && depositAmount
    ? 'Accept &amp; Pay Deposit'
    : 'Accept Quote';
  return depositNoticeSection + `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="background:${accent};border-radius:10px;text-align:center;">
                <a href="${esc(primaryHref)}" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${primaryLabel}</a>
              </td>
            </tr>
            ${depositPayNowUrl && hasTerms ? `<tr>
              <td style="text-align:center;padding-top:6px;">
                <span style="color:#6b7280;font-size:11px;">By paying you accept the Terms &amp; Conditions in the attached quote.</span>
              </td>
            </tr>` : ''}
            <tr>
              <td height="12" style="font-size:12px;line-height:12px;">&nbsp;</td>
            </tr>
            <tr>
              <td style="text-align:center;">
                <a href="${esc(declineUrl)}" target="_blank" style="color:#9ca3af;font-size:14px;text-decoration:underline;">Decline quote</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function renderInvoicePayNowCta(payNowUrl: string | undefined, hasTerms: boolean | undefined, accent: string): string {
  if (!payNowUrl) return '';
  const esc = escapeHtml;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
      <tr>
        <td align="center">
          <a href="${esc(payNowUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;background:${accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;">
            Pay Now
          </a>
          <p style="color:#6b7280;font-size:12px;margin:8px 0 0;">Secure card payment via Square</p>
          ${hasTerms ? `<p style="color:#6b7280;font-size:11px;margin:6px 0 0;">By paying you accept the Terms &amp; Conditions in the attached invoice.</p>` : ''}
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
  const accent = data.business.brandColor || '#059669';
  const esc = escapeHtml;
  const isInvoice = data.type === 'invoice';
  const typeLabel = isInvoice ? 'Invoice' : 'Quote';
  const headerLabel = isInvoice ? 'Invoice' : 'Quotation';

  // Type-specific blocks. The framing (header / greeting / body / pricing /
  // attachment notice / sign-off / business footer) is identical between
  // quote and invoice — only the middle inserts and the closing copy differ.
  const subHeader = isInvoice && data.invoiceNumber
    ? `<p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Invoice #${esc(data.invoiceNumber)}</p>`
    : '';

  const preBodyExtras = !isInvoice ? renderPhotosSection(data.photoUrls) : '';

  const pricingRows = renderPricingRows({
    materialsSubtotal: data.materialsSubtotal,
    laborTotal: data.laborTotal,
    subtotal: data.subtotal,
    gst: data.gst,
    total: data.total,
    accent,
    depositCredit: isInvoice ? data.depositCredit : undefined,
  });

  const postPricingCta = isInvoice
    ? renderInvoicePayNowCta(data.payNowUrl, data.hasTerms, accent)
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
        accent,
      })
    : '';

  const closingNotice = isInvoice
    ? `<p style="color:#374151;font-size:14px;font-weight:600;line-height:1.6;margin:16px 0 0;">
      Payment is due by ${new Date(data.dueDate).toLocaleDateString('en-AU', {
        day: 'numeric', month: 'long', year: 'numeric',
      })}.
    </p>

    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:16px 0 0;">
      If you have any questions, please don't hesitate to get in touch.
    </p>`
    : `<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:24px 0 0;">
      This quote is valid for 30 days. If you have any questions, please don't hesitate to get in touch.
    </p>`;

  const content = `
    <h1 style="color:#1f2937;font-size:24px;font-weight:700;margin:0 0 8px;line-height:1.3;">
      ${headerLabel} for ${esc(data.jobName)}
    </h1>
    ${subHeader}
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">
      Hi ${esc(data.customerName)},
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${renderEmailBodyHtml(data.emailBody)}
    </p>

    ${preBodyExtras}

    ${pricingRows}

    ${postPricingCta}

    <p style="color:#6b7280;font-size:13px;font-style:italic;margin:0 0 4px;">
      A detailed PDF ${typeLabel.toLowerCase()} is attached for your records.
    </p>

    ${postAttachmentCta}

    ${closingNotice}

    <p style="color:#6b7280;font-size:14px;margin:16px 0 0;">
      Kind regards,<br/>
      <strong style="color:#1f2937;">${esc(data.business.name)}</strong>
    </p>

    ${renderBusinessFooter(data.business, accent)}
  `;

  return wrapQuoteEmailTemplate(content, {
    brandColor: accent,
    businessName: data.business.name,
    logoUrl: data.business.logoUrl,
    preheader: `${typeLabel} for ${data.jobName} - $${data.total.toFixed(2)} from ${data.business.name}`,
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
  invoiceNumber?: string;
  dueDate: string; // ISO date string
  payNowUrl?: string; // Square hosted payment link (only present when tradie has Square connected)
  // True when the attached PDF carries a T&Cs section — drives whether the
  // Pay Now button renders the "By paying you accept the terms…" footnote.
  hasTerms?: boolean;
  // Deposit credit carried over from a quote that had a deposit paid. Rendered
  // as a "Deposit already paid" line above the total.
  depositCredit?: number;
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

export function sendQuoteFollowUpEmail(
  to: string,
  businessName: string,
  jobName: string,
  total: number,
  userId: string
): Promise<boolean> {
  const unsubscribeUrl = `https://us-central1-hansendev.cloudfunctions.net/unsubscribeEmail?userId=${userId}&category=marketing`;
  const greeting = businessName || 'legend';

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#1e293b;border:2px solid #334155;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 12px;">
        &#129488;
      </div>
    </div>
    <h1 style="color:#f8fafc;font-size:26px;font-weight:700;margin:0 0 20px;text-align:center;line-height:1.3;">
      G'day ${greeting}, quick check-in
    </h1>
    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      You just put together your first quote &mdash; <strong style="color:#f8fafc;">${jobName}</strong> for <strong style="color:#f8fafc;">$${total.toFixed(2)}</strong>. Ripper effort! We just wanted to check in and see how the experience was.
    </p>

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      Look, we're more invested in this than your mum asking about your love life. We genuinely want to make sure QuoteMate is helping you win more jobs and not giving you the run-around.
    </p>

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      <strong style="color:#f8fafc;">Did the prices stack up?</strong> Was anything missing or off? Was it easy enough to use, or did you nearly chuck your phone at the wall?
    </p>

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
      Even if everything went smooth as a cold beer on a Friday arvo, we'd still love to hear about it. And if something was a bit dodgy, that's even better &mdash; tell us so we can fix it up before your next one.
    </p>

    <p style="color:#f8fafc;font-size:15px;line-height:1.7;margin:0 0 4px;font-weight:600;">
      Give us the quick version &mdash; one tap:
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

    <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:20px 0 0;text-align:center;">
      Got more to say? We're all ears:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#f59e0b;border-radius:10px;text-align:center;">
                <a href="${APP_LINK}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Share Detailed Feedback</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:24px 0 0;text-align:center;">
      No worries if you're flat out &mdash; we'll be here when you're ready. Cheers! &#127866;
    </p>
  `, { unsubscribeUrl, preheader: `How was your first quote? We'd love to hear about it.` });

  return sendEmail({
    to,
    subject: `How'd your first quote go? 🤔`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['quote-follow-up'],
    unsubscribeUrl,
  });
}

/**
 * Customer-facing reminder for a sent quote that hasn't been accepted yet.
 * Triggered by the customerQuoteFollowUp scheduled function. Tone is
 * professional and shifts slightly between the first and second nudge.
 */
export function sendCustomerQuoteReminderEmail(args: {
  to: string;
  customerName: string;
  jobName: string;
  total: number;
  acceptanceUrl: string;
  followUpNumber: 1 | 2;
  business: {
    name: string;
    abn?: string;
    phone?: string;
    email?: string;
    address?: string;
    logoUrl?: string;
    brandColor?: string;
  };
  userId: string;
}): Promise<boolean> {
  const { to, customerName, jobName, total, acceptanceUrl, followUpNumber, business, userId } = args;
  const accent = business.brandColor || '#059669';
  const esc = escapeHtml;
  const acceptUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=accept';
  const declineUrl = acceptanceUrl + (acceptanceUrl.includes('?') ? '&' : '?') + 'action=decline';

  const subject = followUpNumber === 1
    ? `Reminder: your quote from ${business.name} for ${jobName}`
    : `Following up on your quote from ${business.name}`;

  const lead = followUpNumber === 1
    ? `Just bumping this up your inbox in case it got buried — happy to answer any questions about the quote.`
    : `One last check-in on the quote below. If the price or scope isn't quite right, reply to this email and we can adjust it.`;

  const content = `
    <h1 style="color:#1f2937;font-size:24px;font-weight:700;margin:0 0 8px;line-height:1.3;">
      Quote for ${esc(jobName)}
    </h1>
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">
      Hi ${esc(customerName || 'there')},
    </p>

    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${lead}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
      <tr>
        <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#6b7280;font-size:13px;padding:0 0 4px;">Total</td>
              <td style="color:${accent};font-size:20px;font-weight:700;text-align:right;padding:0 0 4px;">$${total.toFixed(2)}</td>
            </tr>
            <tr>
              <td colspan="2" style="color:#9ca3af;font-size:12px;">The original quote PDF was attached to your previous email.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="background:${accent};border-radius:10px;text-align:center;">
                <a href="${esc(acceptUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Review &amp; accept quote</a>
              </td>
            </tr>
            <tr>
              <td height="12" style="font-size:12px;line-height:12px;">&nbsp;</td>
            </tr>
            <tr>
              <td style="text-align:center;">
                <a href="${esc(declineUrl)}" target="_blank" style="color:#9ca3af;font-size:14px;text-decoration:underline;">Decline quote</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:24px 0 0;">
      Cheers,<br/>
      <strong style="color:#1f2937;">${esc(business.name)}</strong>
    </p>

    ${renderBusinessFooter(business, accent)}
  `;

  const htmlContent = wrapQuoteEmailTemplate(content, {
    brandColor: accent,
    businessName: business.name,
    logoUrl: business.logoUrl,
    preheader: `Reminder: ${jobName} quote — $${total.toFixed(2)} from ${business.name}`,
  });

  return sendEmail({
    to,
    subject,
    htmlContent,
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
    subject: `New QuoteMate user: ${userEmail} (${platformDisplay})`,
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
  const planDisplay = isYearly ? 'Yearly ($199/yr)' : 'Monthly ($29/mo)';

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
      infoRow('Subscription Price', '$29 AUD/month', false) +
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
