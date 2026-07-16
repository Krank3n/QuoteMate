import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import cors from 'cors';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { sendEmail } from './email';

const ALLOWED_ORIGINS = [
  'https://quotemateapp.au',
  'https://www.quotemateapp.au',
];

const corsHandler = cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function runCors(
  req: functions.https.Request,
  res: functions.Response,
  handler: () => Promise<void>,
): void {
  corsHandler(req, res, () => {
    void handler().catch(error => {
      console.error('Website form request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Something went wrong. Please try again later.' });
      }
    });
  });
}
const RATE_LIMIT_MAX = 5;

type FormKind = 'contact' | 'subscribe';

function clientIp(req: functions.https.Request): string {
  const forwarded = req.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : req.ip || 'unknown').trim();
}

async function isRateLimited(req: functions.https.Request, kind: FormKind): Promise<boolean> {
  const ipHash = createHash('sha256').update(clientIp(req)).digest('hex');
  const windowNumber = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const ref = admin.firestore().doc(`websiteFormRateLimits/${kind}-${ipHash}-${windowNumber}`);

  return admin.firestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.get('count') || 0) : 0;
    if (count >= RATE_LIMIT_MAX) return true;

    transaction.set(ref, {
      count: count + 1,
      kind,
      expiresAt: admin.firestore.Timestamp.fromMillis((windowNumber + 2) * RATE_LIMIT_WINDOW_MS),
    }, { merge: true });
    return false;
  });
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]/g, '').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function firstAdminEmail(): string {
  return (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim() || '';
}

export const websiteContact = functions.https.onRequest((req, res) => {
  runCors(req, res, async () => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed.' });
      return;
    }

    if (await isRateLimited(req, 'contact')) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    const { name, email, message, website } = req.body || {};
    if (typeof website === 'string' && website.trim()) {
      res.status(200).json({ message: 'Message sent successfully!' });
      return;
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 100 ||
        typeof email !== 'string' || email.length > 254 || !EMAIL_REGEX.test(email.trim()) ||
        typeof message !== 'string' || !message.trim() || message.length > 5000) {
      res.status(400).json({ error: 'Please provide a valid name, email, and message.' });
      return;
    }

    const safeName = cleanHeader(name).slice(0, 100);
    const safeEmail = cleanHeader(email).toLowerCase();
    const safeMessage = message.trim();
    const recipient = firstAdminEmail();
    if (!recipient) {
      console.error('websiteContact: ADMIN_EMAILS is not configured');
      res.status(500).json({ error: 'Failed to send message. Please try again later.' });
      return;
    }

    const submissionRef = admin.firestore().collection('websiteContactSubmissions').doc();
    await submissionRef.set({
      name: safeName,
      email: safeEmail,
      message: safeMessage,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const sent = await sendEmail({
      to: recipient,
      subject: `QuoteMate enquiry from ${safeName}`,
      category: 'transactional',
      tags: ['website_contact', `submission:${submissionRef.id}`],
      replyTo: { email: safeEmail, name: safeName },
      htmlContent: `
        <h2>New QuoteMate website enquiry</h2>
        <p><strong>Name:</strong> ${escapeHtml(safeName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
        <p><strong>Message:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(safeMessage)}</p>
      `,
    });

    await submissionRef.set({
      status: sent ? 'sent' : 'send_failed',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!sent) {
      res.status(502).json({ error: 'Failed to send message. Please try again later.' });
      return;
    }
    res.status(200).json({ message: 'Message sent successfully!' });
  });
});

export const websiteSubscribe = functions.https.onRequest((req, res) => {
  runCors(req, res, async () => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed.' });
      return;
    }

    if (await isRateLimited(req, 'subscribe')) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    const { email, website } = req.body || {};
    if (typeof website === 'string' && website.trim()) {
      res.status(200).json({ message: 'Subscribed successfully!' });
      return;
    }
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    const safeEmail = cleanHeader(email).toLowerCase();
    const apiKey = process.env.BREVO_API_KEY || '';
    // List 5 is the dedicated "QuoteMate Website Newsletter" list in Brevo.
    const listId = Number(process.env.WEBSITE_NEWSLETTER_LIST_ID || '5');
    if (!apiKey || !Number.isInteger(listId) || listId <= 0) {
      console.error('websiteSubscribe: Brevo API key or newsletter list ID is not configured');
      res.status(500).json({ error: 'Failed to subscribe. Please try again later.' });
      return;
    }

    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: safeEmail,
        listIds: [listId],
        updateEnabled: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`websiteSubscribe: Brevo ${response.status}: ${errorBody.slice(0, 500)}`);
      res.status(502).json({ error: 'Failed to subscribe. Please try again later.' });
      return;
    }

    await admin.firestore().collection('websiteNewsletterSubscriptions').doc(
      createHash('sha256').update(safeEmail).digest('hex'),
    ).set({
      email: safeEmail,
      source: 'quotemateapp.au',
      brevoListId: listId,
      subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ message: 'Subscribed successfully!' });
  });
});
