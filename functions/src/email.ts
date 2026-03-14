import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

// Brevo API configuration
const getBrevoApiKey = (): string => {
  return functions.config().brevo?.api_key || process.env.BREVO_API_KEY || '';
};

const SENDER = {
  email: 'noreply@hansendev.com.au',
  name: 'QuoteMate',
};

// Admin notification email
const ADMIN_EMAIL = 'thomas.andrew.hansen@gmail.com';

// Email preference types that users can opt out of
type EmailCategory = 'transactional' | 'marketing';

interface SendEmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
  category: EmailCategory;
  userId?: string; // For logging and preference checking
  tags?: string[];
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
    console.error('Error checking email preferences:', error);
    return true; // Fail open
  }
}

// Core send function via Brevo API
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const { to, subject, htmlContent, category, userId, tags } = options;
  const apiKey = getBrevoApiKey();

  if (!apiKey) {
    console.error('Brevo API key not configured');
    return false;
  }

  if (!to) {
    console.error('No recipient email provided');
    return false;
  }

  // Check user email preferences (skip for test sends)
  if (userId && userId !== 'test') {
    const allowed = await canSendEmail(userId, category);
    if (!allowed) {
      console.log(`User ${userId} has opted out of ${category} emails, skipping`);
      return false;
    }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: SENDER,
        to: [{ email: to }],
        subject,
        htmlContent,
        tags: tags || [],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Brevo API error (${response.status}):`, errorBody);
      return false;
    }

    // Log the sent email
    if (userId) {
      await logEmail(userId, to, subject, category, tags);
    }

    console.log(`Email sent: "${subject}" to ${to}`);
    return true;
  } catch (error: any) {
    console.error('Error sending email:', error.message);
    return false;
  }
}

// Log sent emails to Firestore for tracking
async function logEmail(
  userId: string,
  to: string,
  subject: string,
  category: EmailCategory,
  tags?: string[]
): Promise<void> {
  try {
    await admin.firestore()
      .collection('emailLog')
      .add({
        userId,
        to,
        subject,
        category,
        tags: tags || [],
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error('Error logging email:', error);
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
    console.error('Error fetching user email:', error);
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
          ${featureBullet('&#128176;', 'Get <strong style="color:#f8fafc;">real-time prices</strong> from Bunnings and more')}
          ${featureBullet('&#128232;', 'Send quotes clients can <strong style="color:#f8fafc;">accept with one click</strong>')}
        </td>
      </tr>
    `)}

    ${ctaButton('Create a Quote')}
  `, { unsubscribeUrl, preheader: `It's been ${daysSinceLastActive} days. Your next job is just a tap away.` });

  return sendEmail({
    to,
    subject: `${greeting}, your next quote is waiting`,
    htmlContent: content,
    category: 'marketing',
    userId,
    tags: ['re-engagement', `inactive-${daysSinceLastActive}d`],
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
      preheader: 'QuoteMate pulls real prices from Bunnings and other stores automatically.',
      body: `
        <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 8px;">
          QuoteMate automatically looks up <strong style="color:#f8fafc;">real prices</strong> from Bunnings and other major hardware stores. No more manual price checks.
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
  };

  const tip = tips[tipNumber];
  if (!tip) return Promise.resolve(false);

  const content = wrapEmailTemplate(`
    <div style="text-align:center;margin:0 0 24px;">
      <div style="background:#1e293b;border:2px solid #334155;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;margin:0 0 12px;">
        ${tip.emoji}
      </div>
      ${badge(`TIP ${tipNumber} OF 3`, '#1e293b', '#94a3b8')}
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
  });
}

// ============================================================
// CLIENT-FACING QUOTE EMAIL
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

export function buildQuoteEmailHtml(data: QuoteEmailData): string {
  const accent = data.business.brandColor || '#009868';
  const esc = escapeHtml;

  // Business logo
  const logoSection = data.business.logoUrl
    ? `<tr><td align="center" style="padding:0 0 20px;">
        <img src="${esc(data.business.logoUrl)}" alt="${esc(data.business.name)}" width="120" style="display:block;width:120px;height:auto;border-radius:12px;" />
      </td></tr>`
    : '';

  // Email body paragraphs
  const bodyHtml = esc(data.emailBody).replace(/\n\n/g, '</p><p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">').replace(/\n/g, '<br/>');

  // Photos section
  let photosSection = '';
  if (data.photoUrls?.length) {
    const photoImgs = data.photoUrls.map(url =>
      `<td style="padding:4px;"><img src="${esc(url)}" width="160" style="display:block;width:160px;height:120px;object-fit:cover;border-radius:8px;" /></td>`
    ).join('');
    photosSection = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
        <tr><td style="padding:0 0 8px;"><p style="color:#94a3b8;font-size:13px;font-weight:600;margin:0;">Site Photos</p></td></tr>
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>${photoImgs}</tr></table>
        </td></tr>
      </table>`;
  }

  // Pricing table
  const pricingRows = `
    <tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:14px;border-bottom:1px solid #334155;">Materials</td>
      <td style="padding:8px 0;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #334155;">$${data.materialsSubtotal.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:14px;border-bottom:1px solid #334155;">Labour</td>
      <td style="padding:8px 0;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #334155;">$${data.laborTotal.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:14px;border-bottom:1px solid #334155;">Subtotal</td>
      <td style="padding:8px 0;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #334155;">$${data.subtotal.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:14px;border-bottom:1px solid #334155;">GST</td>
      <td style="padding:8px 0;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #334155;">$${data.gst.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:10px 0;color:#f8fafc;font-size:16px;font-weight:700;">Total (inc GST)</td>
      <td style="padding:10px 0;color:${accent};font-size:18px;font-weight:700;text-align:right;">$${data.total.toFixed(2)}</td>
    </tr>`;

  // Accept/Decline buttons
  let ctaSection = '';
  if (data.acceptanceUrl) {
    ctaSection = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:${accent};border-radius:10px;text-align:center;margin-right:12px;">
                  <a href="${esc(data.acceptanceUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Accept Quote</a>
                </td>
                <td width="12"></td>
                <td style="background:#475569;border-radius:10px;text-align:center;">
                  <a href="${esc(data.acceptanceUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Decline</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
  }

  // Business footer
  const footerParts: string[] = [];
  if (data.business.name) footerParts.push(`<strong style="color:#f1f5f9;">${esc(data.business.name)}</strong>`);
  if (data.business.abn) footerParts.push(`ABN: ${esc(data.business.abn)}`);
  if (data.business.phone) footerParts.push(esc(data.business.phone));
  if (data.business.email) footerParts.push(`<a href="mailto:${esc(data.business.email)}" style="color:${accent};text-decoration:none;">${esc(data.business.email)}</a>`);
  if (data.business.address) footerParts.push(esc(data.business.address));

  const businessFooter = footerParts.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;border-top:1px solid #334155;padding-top:20px;">
      <tr><td style="text-align:center;">
        <p style="color:#94a3b8;font-size:13px;line-height:1.8;margin:0;">${footerParts.join(' &bull; ')}</p>
      </td></tr>
    </table>` : '';

  const content = `
    ${logoSection}
    <h1 style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 8px;line-height:1.3;">
      Quotation for ${esc(data.jobName)}
    </h1>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">
      Hi ${esc(data.customerName)},
    </p>

    <p style="color:#cbd5e1;font-size:15px;line-height:1.7;margin:0 0 16px;">
      ${bodyHtml}
    </p>

    ${photosSection}

    ${infoCard(pricingRows, accent)}

    ${ctaSection}

    <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:24px 0 0;">
      This quote is valid for 30 days. If you have any questions, please don't hesitate to get in touch.
    </p>

    <p style="color:#94a3b8;font-size:14px;margin:16px 0 0;">
      Kind regards,<br/>
      <strong style="color:#f1f5f9;">${esc(data.business.name)}</strong>
    </p>

    ${businessFooter}
  `;

  return wrapEmailTemplate(content, {
    preheader: `Quote for ${data.jobName} - $${data.total.toFixed(2)} from ${data.business.name}`,
  });
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
    console.error('Error updating email preferences:', error);
    return false;
  }
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
