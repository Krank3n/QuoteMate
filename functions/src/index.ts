import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import cors from 'cors';
import fetch from 'node-fetch';
import {
  getUserEmail,
  sendEmail,
  sendWelcomeEmail,
  sendQuoteAcceptedEmail,
  sendQuoteDeclinedEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
  sendReEngagementEmail,
  sendOnboardingTipEmail,
  sendUpdateAnnouncementEmail,
  handleUnsubscribe,
  sendNewUserNotificationEmail,
  sendFeedbackEmail,
  sendQuoteFollowUpEmail,
  sendAffiliateInviteEmail,
  sendNewProSubscriptionEmail,
  sendMaterialListErrorEmail,
  sendDraftNudgeEmail,
} from './email';
export * from './adminCrm';
export {
  adminLeadDiscovery,
  adminEnrichLeads,
  adminGenerateLeadMessages,
  adminListLeads,
  adminGetLead,
  adminUpdateLeadMessage,
  adminApproveLeads,
  adminRejectLeads,
  adminAddLeadNote,
  adminMarkLeadReplied,
  brevoInboundWebhook,
  weeklyLeadDiscovery,
  adminGetDiscoveryConfig,
  adminUpdateDiscoveryConfig,
  adminGetLeadConfig,
  adminUpdateLeadConfig,
  adminTestSendLead,
  autoSendQueuedLeads,
  weeklyLeadOutreachReport,
  adminSendLeadReport,
  onUserCreatedLinkLead,
  leadUnsubscribe,
} from './leadOutreach';
export { onQuoteWritten, onInvoiceWritten, mirrorAllDocuments } from './documentMirror';
import {
  sendDocumentEmail,
  loadDocumentForQuoteId,
  loadDocumentForInvoiceId,
  applyPaymentToDocument,
  createOrRotatePaymentLink,
  logShimInvocation,
  type SquareLinkMinter,
} from './documentHandlers';
export { getStageViolationCounts, convertDocumentToInvoice } from './documentHandlers';
export { onDocumentWriteSyncJob, backfillJobsFromDocuments } from './jobHandlers';
export { storeGoogleCalendarToken, disconnectGoogleCalendar } from './googleCalendarAuth';
export { onJobWriteSyncCal } from './googleCalendarSync';
import { quoteRecordToDocumentRecord, invoiceRecordToDocumentRecord } from './shared/document/adapter';
import { getAussieMessage, AussieEvent } from './aussieNotifications';
import { hashTerms } from './shared/pdf/terms/defaultAuTradie';
import { dollarsToCents, centsToDollars } from './shared/pdf/money';
import {
  QM_APP_FEE_PCT_ONLINE,
  QM_APP_FEE_PCT_IN_PERSON,
  PASSTHROUGH_SURCHARGE_PCT,
} from './shared/pdf/squareFees';
// (All resolve via the functions/src/shared symlink → shared/)

// Initialize Firebase Admin
admin.initializeApp();

// When markup is hidden from the customer, the visible line items must still
// reconcile to the final total. Inflate materials and labor by their respective
// markup so Materials + Labour = Total (GST is inclusive in the line totals).
function applyHideMarkupForDisplay(q: any) {
  const matMarkup = Number(q.markup) || 0;
  const laborMarkup = Number(q.laborMarkup ?? q.markup) || 0;
  const hideMarkup = q.showMarkup !== true && (matMarkup > 0 || laborMarkup > 0);
  if (!hideMarkup) {
    return {
      materials: (q.materials || []).map((m: any) => ({ ...m })),
      materialsSubtotal: q.materialsSubtotal || 0,
      laborTotal: q.laborTotal || 0,
      subtotal: q.subtotal || 0,
      markupAmount: q.markupAmount || 0,
    };
  }
  const matMult = 1 + matMarkup / 100;
  const laborMult = 1 + laborMarkup / 100;
  const materialsSubtotal = (q.materialsSubtotal || 0) * matMult;
  const laborTotal = (q.laborTotal || 0) * laborMult;
  return {
    materials: (q.materials || []).map((m: any) => ({
      ...m,
      price: m.price ? m.price * matMult : m.price,
      totalPrice: (m.totalPrice || 0) * matMult,
    })),
    materialsSubtotal,
    laborTotal,
    subtotal: materialsSubtotal + laborTotal,
    markupAmount: 0,
  };
}

// Initialize Stripe with mode toggle (test or live)
const stripeMode = process.env.STRIPE_MODE || 'test';
const isTestMode = stripeMode === 'test';

// Select the appropriate secret key based on mode
const stripeSecretKey = isTestMode
  ? (process.env.STRIPE_TEST_SECRET_KEY || '')
  : (process.env.STRIPE_LIVE_SECRET_KEY || '');

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16',
});

// ============================================
// Affiliate Commission Configuration
// ============================================
const PLATFORM_FEES: Record<string, { percentage: number; fixedCents: number }> = {
  ios: { percentage: 0.30, fixedCents: 0 },       // Apple takes 30%
  android: { percentage: 0.15, fixedCents: 0 },    // Google takes 15% (small business program)
  web: { percentage: 0.029, fixedCents: 30 },      // Stripe takes 2.9% + $0.30
};

const DEFAULT_COMMISSION_RATE = 0.50; // 50% of net revenue

// Emails to auto-grant affiliate status on signup (loaded from env config)
const PENDING_AFFILIATE_EMAILS = (process.env.PENDING_AFFILIATE_EMAILS || '').split(',').filter(Boolean);

// Pricing in cents (AUD)
const PRODUCT_PRICES: Record<string, number> = {
  // iOS product IDs
  quotemate_pro_monthly: 2900,
  quotemate_pro_yearly: 19900,
  // Android product IDs
  quotemate_premium_monthly: 2900,
  quotemate_premium_yearly: 19900,
};

/**
 * Calculate affiliate commission for a subscription payment.
 * Returns amounts in cents.
 */
function calculateCommission(
  platform: string,
  grossAmountCents: number,
  commissionRate: number
): { platformFee: number; netRevenue: number; commissionAmount: number } {
  const fees = PLATFORM_FEES[platform] || PLATFORM_FEES.web;
  const platformFee = Math.round(grossAmountCents * fees.percentage + fees.fixedCents);
  const netRevenue = grossAmountCents - platformFee;
  const commissionAmount = Math.round(netRevenue * commissionRate);
  return { platformFee, netRevenue, commissionAmount };
}

/**
 * Get the current billing period string (e.g., "2026-03")
 */
function getBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Record an affiliate earning for a referrer when a referred user pays.
 */
async function recordAffiliateEarning(
  referredUserId: string,
  referrerUserId: string,
  platform: string,
  productId: string,
  grossAmountCents: number,
  billingPeriod: string
): Promise<void> {
  const firestore = admin.firestore();
  const referrerReferralRef = firestore.doc(`users/${referrerUserId}/profile/referral`);
  const referrerReferral = await referrerReferralRef.get();
  const referrerData = referrerReferral.exists ? referrerReferral.data()! : {};

  // Only record earnings if the referrer is an approved affiliate
  if (!referrerData.isAffiliate) {
    return;
  }

  const commissionRate = referrerData.commissionRate || DEFAULT_COMMISSION_RATE;

  // Check if earning already exists for this billing period + referred user
  const existingEarnings = await firestore
    .collection(`users/${referrerUserId}/affiliateEarnings`)
    .where('referredUserId', '==', referredUserId)
    .where('billingPeriod', '==', billingPeriod)
    .limit(1)
    .get();

  if (!existingEarnings.empty) {
    return;
  }

  const { platformFee, netRevenue, commissionAmount } = calculateCommission(platform, grossAmountCents, commissionRate);

  // Get referred user email (masked)
  let referredUserEmail = '';
  try {
    const email = await getUserEmail(referredUserId);
    if (email) {
      const [local, domain] = email.split('@');
      referredUserEmail = `${local.charAt(0)}***@${domain}`;
    }
  } catch {
    referredUserEmail = 'unknown';
  }

  const earningDoc = firestore.collection(`users/${referrerUserId}/affiliateEarnings`).doc();
  const batch = firestore.batch();

  batch.set(earningDoc, {
    referredUserId,
    referredUserEmail,
    platform,
    grossAmount: grossAmountCents,
    platformFee,
    netRevenue,
    commissionRate,
    commissionAmount,
    billingPeriod,
    productId,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    confirmedAt: null,
    paidAt: null,
  });

  // Update referrer's running totals
  batch.set(referrerReferralRef, {
    isAffiliate: true,
    totalEarnings: admin.firestore.FieldValue.increment(commissionAmount),
    pendingEarnings: admin.firestore.FieldValue.increment(commissionAmount),
  }, { merge: true });

  await batch.commit();
}

// CORS configuration - whitelist allowed origins
const allowedOrigins = [
  'https://us-central1-hansendev.cloudfunctions.net',
  'https://hansendev.web.app',
  'https://hansendev.firebaseapp.com',
  'https://quotemateapp.au',
  'https://www.quotemateapp.au',
];

const corsHandler = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, same-origin)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Allow localhost for development
    if (origin.startsWith('http://localhost:') || origin === 'http://localhost') {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
});

// Rate limiting via Firestore
const rateLimitDb = () => admin.firestore();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS = {
  standard: { maxRequests: 30, windowMs: 60_000 } as RateLimitConfig,
  heavy: { maxRequests: 10, windowMs: 60_000 } as RateLimitConfig,
  public: { maxRequests: 60, windowMs: 60_000 } as RateLimitConfig,
};

async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  res: functions.Response
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const ref = rateLimitDb().collection('rateLimits').doc(key);

  try {
    const allowed = await rateLimitDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.data();
      let timestamps: number[] = data?.timestamps ?? [];

      // Remove expired entries
      timestamps = timestamps.filter((t: number) => t > windowStart);

      if (timestamps.length >= config.maxRequests) {
        return false;
      }

      timestamps.push(now);
      tx.set(ref, { timestamps, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });

    if (!allowed) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return false;
    }
    return true;
  } catch (error) {
    // Allow request if rate limit check fails (fail open)
    return true;
  }
}

function getClientIp(req: functions.https.Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

// Input validation helpers
function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isValidUrl(val: unknown): boolean {
  if (!isNonEmptyString(val)) return false;
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeString(val: string, maxLength: number = 1000): string {
  return val.trim().slice(0, maxLength);
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Verify Firebase Auth token from Authorization header.
 * Returns the decoded token (with uid) or sends a 401 response.
 */
async function verifyAuth(
  req: functions.https.Request,
  res: functions.Response
): Promise<admin.auth.DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired auth token' });
    return null;
  }
}

/**
 * Verify auth and apply rate limiting in one step.
 * Returns decoded token or null (response already sent).
 */
async function verifyAuthWithRateLimit(
  req: functions.https.Request,
  res: functions.Response,
  limit: RateLimitConfig = RATE_LIMITS.standard
): Promise<admin.auth.DecodedIdToken | null> {
  const decodedToken = await verifyAuth(req, res);
  if (!decodedToken) return null;

  const allowed = await checkRateLimit(`user:${decodedToken.uid}`, limit, res);
  if (!allowed) return null;

  return decodedToken;
}

/**
 * Create a Stripe Checkout Session
 * Called from the web app when user wants to subscribe
 */
export const createCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
      if (!decodedToken) return;
      const userId = decodedToken.uid;

      try {
      const { priceId, successUrl, cancelUrl } = req.body;

      if (!isNonEmptyString(priceId)) {
        res.status(400).json({ error: 'Missing or invalid priceId' });
        return;
      }
      if (successUrl && !isValidUrl(successUrl)) {
        res.status(400).json({ error: 'Invalid successUrl' });
        return;
      }
      if (cancelUrl && !isValidUrl(cancelUrl)) {
        res.status(400).json({ error: 'Invalid cancelUrl' });
        return;
      }


      // Create Stripe customer directly (no database needed)
      const customer = await stripe.customers.create({
        metadata: {
          firebaseUserId: userId,
        },
      });


      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId,
        },
      });


      res.status(200).json({
        sessionId: session.id,
        url: session.url
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Create a Payment Intent for embedded checkout
 * Used for Stripe Elements embedded in the app
 * Creates a subscription with payment
 */
export const createPaymentIntent = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { priceId } = req.body;

      if (!isNonEmptyString(priceId)) {
        res.status(400).json({ error: 'Missing or invalid priceId' });
        return;
      }


      // Find or create Stripe customer
      let customerId: string;
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length > 0) {
        customerId = customerList.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          metadata: {
            firebaseUserId: userId,
          },
        });
        customerId = customer.id;
      }

      // Create the subscription with payment pending
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId,
        },
      });

      const invoice = subscription.latest_invoice as any;
      const paymentIntent = invoice.payment_intent;


      res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        customerId,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Create a Stripe Customer Portal Session
 * Allows users to manage their subscription
 */
export const createPortalSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { returnUrl } = req.body;

      if (returnUrl && !isValidUrl(returnUrl)) {
        res.status(400).json({ error: 'Invalid returnUrl' });
        return;
      }

      // Find customer by Firebase user ID in metadata
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length === 0) {
        res.status(404).json({ error: 'No Stripe customer found' });
        return;
      }

      const customerId = customerList.data[0].id;

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      res.status(200).json({ url: session.url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Cancel Subscription
 * Cancels a user's subscription and logs the cancellation reason
 */
export const cancelSubscription = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { reason, feedback } = req.body;

      if (!isNonEmptyString(reason)) {
        res.status(400).json({ error: 'Missing or invalid reason' });
        return;
      }


      // Find customer by Firebase user ID in Stripe metadata
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length === 0) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const customerId = customerList.data[0].id;

      // Get active subscriptions for this customer
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        res.status(404).json({ error: 'No active subscription found' });
        return;
      }

      const subscription = subscriptions.data[0];

      // Cancel the subscription at period end (don't cancel immediately)
      const canceledSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });


      // Save cancellation reason to Firestore
      const db = admin.firestore();
      const cancellationRef = db.collection('cancellations').doc();

      await cancellationRef.set({
        userId,
        userEmail: customerList.data[0].email || null,
        subscriptionId: subscription.id,
        customerId,
        reason,
        feedback: feedback || null,
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        periodEnd: new Date(subscription.current_period_end * 1000),
        platform: 'web',
      });


      res.status(200).json({
        success: true,
        message: 'Subscription canceled successfully',
        cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
        periodEnd: new Date(canceledSubscription.current_period_end * 1000).toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Log cancellation feedback
 * Logs feedback to Firebase Functions console for review
 */
export const logCancellationFeedback = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const { reason } = req.body;

      if (!isNonEmptyString(reason)) {
        res.status(400).json({ error: 'Missing or invalid reason' });
        return;
      }

      res.status(200).json({ success: true, message: 'Feedback logged successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Get subscription status for a user
 */
export const getSubscriptionStatus = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {

      // Find customer by Firebase user ID in Stripe metadata
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length === 0) {
        res.status(200).json({
          isPremium: false,
          subscriptionId: null,
          expiryDate: null,
        });
        return;
      }

      const customerId = customerList.data[0].id;

      // Get active subscriptions for this customer
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        res.status(200).json({
          isPremium: false,
          subscriptionId: null,
          expiryDate: null,
        });
        return;
      }

      const subscription = subscriptions.data[0];
      res.status(200).json({
        isPremium: subscription.status === 'active',
        subscriptionId: subscription.id,
        expiryDate: new Date(subscription.current_period_end * 1000).toISOString(),
        platform: 'web',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Stripe Webhook Handler
 * Handles events from Stripe (subscription created, updated, deleted, etc.)
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err: any) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }
      default:
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle successful checkout session
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;

  if (!userId) {
    return;
  }

  // No database storage needed - customer data is in Stripe with firebaseUserId in metadata
}

/**
 * Handle subscription created or updated
 * Writes subscription status to Firestore so all platforms can sync
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  try {
    // Look up Firebase user ID from Stripe customer metadata
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return;
    }

    const userId = customer.metadata?.firebaseUserId;
    if (!userId) {
      return;
    }

    const firestore = admin.firestore();
    const subscriptionRef = firestore.doc(`users/${userId}/profile/subscription`);
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    await subscriptionRef.set({
      isPro: isActive,
      platform: 'web',
      productId: subscription.items.data[0]?.price?.id || null,
      subscriptionId: subscription.id,
      customerId,
      validatedAt: admin.firestore.FieldValue.serverTimestamp(),
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      quotesThisMonth: 0,
    }, { merge: true });


    // Process referral commission if this user was referred and just became Pro
    if (isActive) {
      try {
        const priceId = subscription.items.data[0]?.price?.id || '';
        const amountCents = subscription.items.data[0]?.price?.unit_amount || 0;
        await processReferralCommission(userId, 'web', priceId, amountCents);
      } catch (refError) {
        // silently ignore
      }

      // Notify admin of new Pro subscription
      try {
        const userEmail = await getUserEmail(userId) || 'unknown';
        const userProfile = await firestore.doc(`users/${userId}/profile/business`).get();
        const businessName = userProfile.data()?.businessName || '';
        const productId = subscription.items.data[0]?.price?.id || '';
        await sendNewProSubscriptionEmail(userEmail, userId, 'web', productId, businessName);
      } catch (emailError) {
        // silently ignore
      }
    }
  } catch (error) {
  }
}

/**
 * Handle subscription deletion
 * Marks user as non-premium in Firestore
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;


  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return;
    }

    const userId = customer.metadata?.firebaseUserId;
    if (!userId) {
      return;
    }

    const firestore = admin.firestore();
    const subscriptionRef = firestore.doc(`users/${userId}/profile/subscription`);

    await subscriptionRef.set({
      isPro: false,
      platform: 'web',
      subscriptionId: subscription.id,
      customerId,
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      quotesThisMonth: 0,
    }, { merge: true });


    // Send cancellation email
    try {
      const email = await getUserEmail(userId);
      if (email) {
        const settingsDoc = await firestore.doc(`users/${userId}/settings/business`).get();
        const businessName = settingsDoc.data()?.businessName || '';
        await sendSubscriptionCancelledEmail(email, businessName, userId);
      }
    } catch (emailError) {
    }
  } catch (error) {
  }
}

/**
 * Handle successful payment
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Record recurring affiliate commission for renewal payments
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return;

    const userId = customer.metadata?.firebaseUserId;
    if (!userId) return;

    // Get the subscription line item details
    const lineItem = invoice.lines?.data?.[0];
    if (!lineItem) return;

    const amountCents = lineItem.amount || 0;
    const priceId = lineItem.price?.id || '';

    if (amountCents > 0 && priceId) {
      await processReferralCommission(userId, 'web', priceId, amountCents);
    }
  } catch (error) {
  }
}

/**
 * Handle failed payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      const userId = customer.metadata?.firebaseUserId;
      if (userId) {
        const email = await getUserEmail(userId);
        if (email) {
          await sendPaymentFailedEmail(email, userId);
        }
      }
    }
  } catch (error) {
  }
}

/**
 * Check and Increment Quote Quota (Server-Side Enforcement)
 * Atomically checks if the user can create a quote and increments the count.
 * Uses Firestore transactions to prevent race conditions.
 */
export const checkAndIncrementQuota = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const db = admin.firestore();
      const subscriptionRef = db.doc(`users/${userId}/profile/subscription`);
      const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

      const result = await db.runTransaction(async (transaction) => {
        const subscriptionDoc = await transaction.get(subscriptionRef);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        let subscriptionData = subscriptionDoc.exists ? subscriptionDoc.data()! : {
          isPro: false,
          quotesThisMonth: 0,
          currentPeriodStart: monthStart,
          currentPeriodEnd: monthEnd,
        };

        // Check if we need to reset monthly count (new month)
        const periodEnd = subscriptionData.currentPeriodEnd?.toDate?.() ||
          new Date(subscriptionData.currentPeriodEnd);
        if (now > periodEnd) {
          subscriptionData = {
            ...subscriptionData,
            quotesThisMonth: 0,
            currentPeriodStart: monthStart,
            currentPeriodEnd: monthEnd,
          };
        }

        // Increment monthly count for analytics
        const newCount = (subscriptionData.quotesThisMonth || 0) + 1;

        // Pro users can always create quotes
        if (subscriptionData.isPro) {
          transaction.set(subscriptionRef, {
            ...subscriptionData,
            quotesThisMonth: newCount,
            currentPeriodStart: subscriptionData.currentPeriodStart || monthStart,
            currentPeriodEnd: subscriptionData.currentPeriodEnd || monthEnd,
          }, { merge: true });
          return {
            allowed: true,
            quotesThisMonth: newCount,
            isPro: true,
            trialStartedAt: subscriptionData.trialStartedAt?.toDate?.() || null,
            trialExpired: false,
            trialDaysRemaining: null as number | null,
          };
        }

        // Free users: check trial status
        const isFirstQuote = !subscriptionData.trialStartedAt;
        let trialStartedAt: Date;

        if (isFirstQuote) {
          // First quote ever — start the trial now
          trialStartedAt = now;
          transaction.set(subscriptionRef, {
            ...subscriptionData,
            quotesThisMonth: newCount,
            trialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            currentPeriodStart: subscriptionData.currentPeriodStart || monthStart,
            currentPeriodEnd: subscriptionData.currentPeriodEnd || monthEnd,
          }, { merge: true });
        } else {
          trialStartedAt = subscriptionData.trialStartedAt.toDate?.()
            ? subscriptionData.trialStartedAt.toDate()
            : new Date(subscriptionData.trialStartedAt);
        }

        const elapsed = now.getTime() - trialStartedAt.getTime();
        const trialExpired = elapsed >= TRIAL_DURATION_MS;
        const trialDaysRemaining = trialExpired
          ? 0
          : Math.ceil((TRIAL_DURATION_MS - elapsed) / (24 * 60 * 60 * 1000));

        if (trialExpired) {
          // Trial expired — don't increment count, deny access
          return {
            allowed: false,
            quotesThisMonth: subscriptionData.quotesThisMonth || 0,
            isPro: false,
            trialStartedAt,
            trialExpired: true,
            trialDaysRemaining: 0,
          };
        }

        // Trial still active — allow and increment count
        if (!isFirstQuote) {
          transaction.set(subscriptionRef, {
            ...subscriptionData,
            quotesThisMonth: newCount,
            currentPeriodStart: subscriptionData.currentPeriodStart || monthStart,
            currentPeriodEnd: subscriptionData.currentPeriodEnd || monthEnd,
          }, { merge: true });
        }

        return {
          allowed: true,
          quotesThisMonth: newCount,
          isPro: false,
          trialStartedAt,
          trialExpired: false,
          trialDaysRemaining,
        };
      });

      if (!result.allowed) {
        res.status(403).json({
          error: 'TRIAL_EXPIRED',
          quotesThisMonth: result.quotesThisMonth,
          isPro: result.isPro,
          trialStartedAt: result.trialStartedAt,
          trialExpired: result.trialExpired,
          trialDaysRemaining: result.trialDaysRemaining,
        });
        return;
      }

      res.status(200).json({
        success: true,
        quotesThisMonth: result.quotesThisMonth,
        isPro: result.isPro,
        trialStartedAt: result.trialStartedAt,
        trialExpired: result.trialExpired,
        trialDaysRemaining: result.trialDaysRemaining,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Validate Apple Receipt
 * Called from the iOS app after a successful IAP purchase
 * Validates receipt with Apple's servers and writes subscription record to Firestore
 */
export const validateAppleReceipt = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { transactionId, productId, purchaseToken } = req.body;

      if (!isNonEmptyString(transactionId) || !isNonEmptyString(productId)) {
        res.status(400).json({ error: 'Missing required parameters: transactionId, productId' });
        return;
      }


      // Validate receipt with Apple's servers
      const receiptData = purchaseToken || transactionId;
      const sharedSecret = process.env.APPLE_SHARED_SECRET || '';

      let appleValidated = false;
      let appleExpiryDate: Date | null = null;

      if (sharedSecret && receiptData) {
        try {
          // Try production first, then sandbox
          for (const url of [
            'https://buy.itunes.apple.com/verifyReceipt',
            'https://sandbox.itunes.apple.com/verifyReceipt',
          ]) {
            const appleRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                'receipt-data': receiptData,
                'password': sharedSecret,
                'exclude-old-transactions': true,
              }),
            });

            const appleData = await appleRes.json() as any;

            // Status 0 = valid, 21007 = sandbox receipt sent to production (retry with sandbox)
            if (appleData.status === 0) {
              appleValidated = true;
              // Extract expiry from latest receipt info
              const latestInfo = appleData.latest_receipt_info;
              if (latestInfo && latestInfo.length > 0) {
                const latestExpiry = Math.max(...latestInfo.map((r: any) => parseInt(r.expires_date_ms || '0', 10)));
                if (latestExpiry > 0) {
                  appleExpiryDate = new Date(latestExpiry);
                }
              }
              break;
            } else if (appleData.status !== 21007) {
            }
          }
        } catch (appleError) {
        }
      } else {
      }

      const firestore = admin.firestore();
      const subscriptionRef = firestore.doc(`users/${userId}/profile/subscription`);

      // Determine subscription period
      const isYearly = productId.includes('yearly');
      const periodMs = isYearly ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const now = new Date();
      const expiryDate = appleExpiryDate || new Date(now.getTime() + periodMs);

      await subscriptionRef.set({
        isPro: true,
        platform: 'ios',
        productId,
        transactionId,
        purchaseToken: purchaseToken || null,
        appleValidated,
        validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        currentPeriodStart: now,
        currentPeriodEnd: expiryDate,
        quotesThisMonth: 0,
      }, { merge: true });


      // Process referral commission
      try {
        const grossCents = PRODUCT_PRICES[productId] || 2900;
        await processReferralCommission(userId, 'ios', productId, grossCents);
      } catch (refError) {
        // silently ignore
      }

      // Notify admin of new Pro subscription
      try {
        const userEmail = await getUserEmail(userId) || 'unknown';
        const iosFirestore = admin.firestore();
        const userProfile = await iosFirestore.doc(`users/${userId}/profile/business`).get();
        const businessName = userProfile.data()?.businessName || '';
        await sendNewProSubscriptionEmail(userEmail, userId, 'ios', productId, businessName);
      } catch (emailError) {
        // silently ignore
      }

      res.status(200).json({
        success: true,
        isPremium: true,
        validated: appleValidated,
        expiryDate: expiryDate.toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Validate Google Receipt
 * Called from the Android app after a successful Google Play purchase
 * Writes subscription record to Firestore
 */
export const validateGoogleReceipt = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { transactionId, productId, purchaseToken } = req.body;

      if (!isNonEmptyString(transactionId) || !isNonEmptyString(productId)) {
        res.status(400).json({ error: 'Missing required parameters: transactionId, productId' });
        return;
      }


      let googleValidated = false;
      let googleExpiryDate: Date | null = null;

      // Validate with Google Play Developer API if service account is configured
      const googleServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const googlePackageName = process.env.GOOGLE_PACKAGE_NAME || 'com.quotemate.app';

      if (googleServiceAccount && purchaseToken) {
        try {
          // Get access token using service account
          const serviceAccount = typeof googleServiceAccount === 'string'
            ? JSON.parse(googleServiceAccount) : googleServiceAccount;

          const { google } = require('googleapis');
          const authClient = new google.auth.JWT(
            serviceAccount.client_email,
            undefined,
            serviceAccount.private_key,
            ['https://www.googleapis.com/auth/androidpublisher']
          );

          const androidPublisher = google.androidpublisher({ version: 'v3', auth: authClient });
          const googleRes = await androidPublisher.purchases.subscriptions.get({
            packageName: googlePackageName,
            subscriptionId: productId,
            token: purchaseToken,
          });

          if (googleRes.data) {
            const expiryTimeMs = parseInt(googleRes.data.expiryTimeMillis || '0', 10);
            if (expiryTimeMs > Date.now()) {
              googleValidated = true;
              googleExpiryDate = new Date(expiryTimeMs);
            } else {
            }
          }
        } catch (googleError) {
        }
      } else {
      }

      const firestore = admin.firestore();
      const subscriptionRef = firestore.doc(`users/${userId}/profile/subscription`);

      // Determine subscription period
      const isYearly = productId.includes('yearly');
      const periodMs = isYearly ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const now = new Date();
      const expiryDate = googleExpiryDate || new Date(now.getTime() + periodMs);

      await subscriptionRef.set({
        isPro: true,
        platform: 'android',
        productId,
        transactionId,
        purchaseToken: purchaseToken || null,
        googleValidated,
        validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        currentPeriodStart: now,
        currentPeriodEnd: expiryDate,
        quotesThisMonth: 0,
      }, { merge: true });


      // Process referral commission
      try {
        const grossCents = PRODUCT_PRICES[productId] || 2900;
        await processReferralCommission(userId, 'android', productId, grossCents);
      } catch (refError) {
        // silently ignore
      }

      // Notify admin of new Pro subscription
      try {
        const userEmail = await getUserEmail(userId) || 'unknown';
        const userProfile = await firestore.doc(`users/${userId}/profile/business`).get();
        const businessName = userProfile.data()?.businessName || '';
        await sendNewProSubscriptionEmail(userEmail, userId, 'android', productId, businessName);
      } catch (emailError) {
        // silently ignore
      }

      res.status(200).json({
        success: true,
        isPremium: true,
        validated: googleValidated,
        expiryDate: expiryDate.toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Strip markdown code fences and parse JSON from an LLM response.
 */
function parseLLMJson(content: string): any {
  let jsonStr = content.trim();
  // Strip markdown code fences if present.
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
  }
  // Happy path — full string is valid JSON.
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Fall through to extraction.
  }
  // Extract the first balanced JSON object or array, ignoring leading/trailing prose.
  const startIdx = jsonStr.search(/[{[]/);
  if (startIdx === -1) {
    throw new Error('No JSON object found in LLM response');
  }
  const openChar = jsonStr[startIdx];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (escape) { escape = false; continue; }
    if (inString && c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        return JSON.parse(jsonStr.slice(startIdx, i + 1));
      }
    }
  }
  throw new Error('Unbalanced JSON in LLM response');
}

// Gemini 3 Pro Preview — primary model for material list generation.
// Better image understanding than Claude for site photos.
const GEMINI_MATERIALS_MODEL = 'gemini-3.1-pro-preview';

async function callGeminiForMaterials(
  apiKey: string,
  prompt: string,
  photoBase64?: string[],
): Promise<any> {
  const parts: any[] = [];
  if (Array.isArray(photoBase64) && photoBase64.length > 0) {
    for (const b64 of photoBase64) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: b64,
        },
      });
    }
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MATERIALS_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('No content in Gemini response');
  }
  return parseLLMJson(content);
}

async function callClaudeForMaterials(
  apiKey: string,
  prompt: string,
  photoBase64?: string[],
): Promise<any> {
  const messageContent: any[] = [];
  if (Array.isArray(photoBase64) && photoBase64.length > 0) {
    for (const b64 of photoBase64) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: b64,
        },
      });
    }
  }
  messageContent.push({ type: 'text', text: prompt });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 32000,
      temperature: 0.2,
      messages: [{ role: 'user', content: messageContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Material list exceeded response size — try breaking the job into smaller stages');
  }
  const content = data.content[0].text;
  return parseLLMJson(content);
}

/**
 * Analyze Job Description — Gemini 3 Pro Preview primary, Claude Opus 4.6 fallback.
 * This Cloud Function acts as a proxy to avoid CORS issues on web.
 */
export const analyzeJobDescription = functions.runWith({ timeoutSeconds: 300 }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { jobDescription, tradeContext, photoBase64, existingMaterials, availableTemplates, userSavedRates } = req.body;

      if (!isNonEmptyString(jobDescription)) {
        res.status(400).json({ error: 'Missing or invalid jobDescription' });
        return;
      }
      if (jobDescription.length > 50000) {
        res.status(400).json({ error: 'jobDescription exceeds maximum length' });
        return;
      }

      // Get API keys from Firebase config.
      // Gemini 3 Pro Preview is the PRIMARY model (better image understanding for site photos).
      // Claude Opus 4.6 is the FALLBACK if Gemini fails.
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!geminiApiKey && !anthropicApiKey) {
        res.status(500).json({ error: 'No LLM API keys configured (GEMINI_API_KEY / ANTHROPIC_API_KEY)' });
        return;
      }

      // Build trade context section
      let contextSection = '';
      if (tradeContext) {
        contextSection = '\n\nTrade Context:';
        if (tradeContext.categoryName) {
          contextSection += `\n- Trade Category: ${tradeContext.categoryName}`;
        }
        if (tradeContext.nicheName) {
          contextSection += `\n- Specialty/Niche: ${tradeContext.nicheName}`;
        }
        if (tradeContext.pricingMethod) {
          contextSection += `\n- Typical Pricing Method: ${tradeContext.pricingMethod}`;
        }
        if (tradeContext.suggestedMaterials && tradeContext.suggestedMaterials.length > 0) {
          contextSection += `\n- Common Materials for This Type of Job: ${tradeContext.suggestedMaterials.join(', ')}`;
          contextSection += '\n  (Consider these materials, but also include any others that would be needed)';
        }
      }

      // Determine store name
      const selectedStore = tradeContext?.selectedStore || 'bunnings';
      let storeName = 'Bunnings';
      if (selectedStore === 'mitre10') storeName = 'Mitre 10';
      if (selectedStore === 'reece') storeName = 'Reece';

      // Build existing materials section
      let existingMaterialsSection = '';
      if (existingMaterials && existingMaterials.length > 0) {
        const materialsList = existingMaterials.map((m: any) =>
          `- ${m.quantity} ${m.unit} of ${m.name}${m.section ? ` (${m.section})` : ''}`
        ).join('\n');
        existingMaterialsSection = `\n\nIMPORTANT - The following materials are ALREADY included in this quote (loaded from templates). Do NOT include these or similar items again. Only suggest ADDITIONAL materials that are missing:\n${materialsList}\n`;
      }

      // Build template reference section
      let templateReferenceSection = '';
      if (availableTemplates && availableTemplates.length > 0) {
        const templateDescriptions = availableTemplates.map((t: any, i: number) => {
          const matList = t.materials.slice(0, 8).map((m: any) => `${m.quantity}x ${m.name}`).join(', ');
          return `${i + 1}. "${t.name}" — Materials: ${matList} | Labor: ${t.laborHours}hrs`;
        }).join('\n');
        templateReferenceSection = `\n\nSAVED TEMPLATES (use as reference for section names and materials when they match the job):\n${templateDescriptions}\n\nWhen a saved template closely matches a section of this job:\n- Use the template's exact name as the section name\n- Use the template's material names where applicable (you can adjust quantities)\n- Set the sectionMultiplier to match the job scope\n`;
      }

      // Build user's saved supplier rates section
      let savedRatesSection = '';
      if (Array.isArray(userSavedRates) && userSavedRates.length > 0) {
        const lines = userSavedRates.map((r: any) => {
          const coverage = r.coveragePerUnit
            ? ` — covers ${r.coveragePerUnit} ${r.coverageUnit} per unit`
            : '';
          const keywords = r.keywords?.length ? ` [keywords: ${r.keywords.join(', ')}]` : '';
          return `- "${r.name}" — $${r.price} per ${r.unit}${coverage}${keywords}`;
        }).join('\n');
        savedRatesSection = `\n\nUSER'S SAVED SUPPLIER RATES — PREFER THESE OVER RETAIL\nThe tradie has personal supplier rates below. If a required material semantically matches one of these (by name, keywords, or job context), you MUST use that rate's unit and price instead of generating a generic retail search term.\n\n${lines}\n\nMatching rules:\n1. Match by meaning, not exact name. "concrete" matches a saved rate keyworded ["concrete","slab","footing"].\n2. If a rate has coveragePerUnit, that means one purchasable unit covers that much work-volume or work-area. Compute quantity = ceil(jobAmount / coveragePerUnit) where jobAmount is measured in coverageUnit. Examples: a sheet that covers 13 m² and a 40 m² wall → ceil(40/13) = 4 sheets; a mulch bag containing 0.5 m³ and a 2 m³ bed → ceil(2/0.5) = 4 bags. Always round UP — the tradie can't buy a fraction of a packaged unit.\n3. If the job gives an area but the rate is per m³ (e.g. ready-mix concrete sold loose by the m³ with no coveragePerUnit), pick a sensible slab thickness from job context (driveway ~125mm, residential slab ~100mm, footpath ~75mm) and explain your assumption in "reasoning". Compute m³ = area × thickness.\n4. For matched items set "savedRateName" to the exact saved rate name and "pricingSource": "saved_rate". Do NOT generate a retail searchTerm for these — leave searchTerm empty.\n5. Items with no matching saved rate flow through the normal retail pricing path — generate generic searchTerms for them as usual.\n`;
      }

      const hasExisting = existingMaterials && existingMaterials.length > 0;
      const prompt = `You are an expert Australian tradie assistant specializing in construction and trade work. ${hasExisting ? 'Some materials have already been added from templates. Analyze the job and suggest only the ADDITIONAL materials needed to complete the job.' : 'Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.'}

Job Description: "${jobDescription}"${contextSection}${existingMaterialsSection}${templateReferenceSection}${savedRatesSection}

Hardware Store for pricing: ${storeName}

Provide a JSON response with the following structure:
{
  "jobSummary": "Short job title, 3-7 words max (e.g. 'Deck Construction', 'Bathroom Renovation', 'Timber Fence Installation')",
  "estimatedHours": 8,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Generic product search term (material type, size, specs - NOT brand-specific)",
      "quantity": 2,
      "unit": "each|m|m²|m³|L|kg|box|pack",
      "section": "Descriptive section name (e.g. Colorbond Fence Bay, Merbau Deck Section, Concrete Footings)",
      "sectionMultiplier": 8,
      "sectionLaborHours": 1.5,
      "reasoning": "Why this material is needed",
      "savedRateName": "(only set when matched to a saved rate)",
      "pricingSource": "(set to 'saved_rate' when matched)"
    }
  ]
}

- "sectionLaborHours" is the estimated labor hours PER UNIT of that section (e.g. 1.5 hours per fence bay). All materials in the same section should have the same sectionLaborHours value. The sum of (sectionLaborHours × sectionMultiplier) across all sections should roughly equal estimatedHours.

CRITICAL — emit quantities in the SMALLEST INDIVIDUAL UNIT, not in guessed packs:
- Screws / nails / clips / fasteners → emit the individual count and unit "each" (e.g. 750 each, NOT "1 pack").
- Concrete / sand / cement → emit the count of bags and unit "each" (e.g. 20 each for 20 bags).
- Timber / decking / fascia → emit linear metres and unit "m" (e.g. 75 m).
- Tape / membrane / sarking → emit linear metres and unit "m" (e.g. 150 m).
- Paint / oil / sealer → emit total litres and unit "L" (e.g. 8 L).
The pricing layer reads pack/length size from the product page (e.g. "Box of 500", "5.4m length", "20m roll") and computes how many packs to buy. If you guess pack counts yourself you will get them wrong — you have no way to know how many clips are in a pack.

DO NOT use units "pack" or "box" in the materials output unless the item is genuinely sold and counted as discrete packs (e.g. one mixed wall-plug pack). Default to "each", "m", "kg", or "L".

DO NOT set sectionMultiplier equal to a material's own quantity — sectionMultiplier is the count of repeating WORK UNITS (bays, footings, square metres of deck), not the count of items.

SANITY-CHECK every quantity before returning. The most common failure is over-spec'ing repeating elements by 3-10×. For ANY job in ANY trade, derive each quantity from a structural anchor — never guess:

- REPEATING LINEAR ELEMENTS (deck joists, fence posts, wall studs, ceiling battens, roof rafters): count = ceil(span / centres) + 1. A 5m-wide deck with joists at 450mm = 12 joists, NOT 60. A 30m fence at 2.4m bays = 13 posts, NOT 30.
- PER-AREA ELEMENTS (decking clips, tiles, plasterboard sheets, paving, downlights, GPOs): count = area × density. Hidden deck clips ~17/m². 600x600 tiles ~2.78/m². Don't multiply density by 5.
- LINEAR MATERIAL FROM AREA (decking boards, weatherboard, cladding): linear metres = area / board_width. 50m² of 137mm decking = ~365 lm, NOT 1000+.
- ONE-PER-UNIT ITEMS (hinges per door, taps per basin, downpipes per roof side, post stirrups per post): count = N units × items_per_unit (usually 1-3).
- FASTENERS / CONSUMABLES: tie to a structural anchor too — nails per joist hanger × hangers, screws per metre of trim × metres, sealer at coverage rate × area. Never invent thousands.
- VOLUMETRIC (concrete bags, sand, gravel): bags = volume / bag_yield. A 0.054m³ footing = 3 × 20kg bags, NOT 12.

Round up by 10-15% for waste, not by 5-10×. After listing each material ask yourself: "Did I derive this from a structural anchor or did I guess?" If guessed, redo it.

Guidelines:
- Group materials into REPEATING WORK UNITS where possible. Identify the smallest repeating unit for each section (e.g. one fence bay, one square metre of decking, one staircase riser).
- For each section, specify materials with PER-UNIT quantities and a "sectionMultiplier" for how many units the job needs. Example: a 20m fence with 2.4m bays → each material has per-bay quantity, sectionMultiplier = 9.
- Non-repeating items (one-off materials like a single gate latch) should have sectionMultiplier: 1.
- Use descriptive section names that include context from the job (e.g. "Colorbond Fence Bay" not just "Fencing", "Merbau Deck Section" not just "Decking").
- All materials in the same section MUST have the same sectionMultiplier value.
- Use GENERIC product terms suitable for ${storeName}
- Specify material type, size, and specs but avoid brand-specific names
- GOOD examples: "brass stop valve 15mm quarter turn", "treated pine H3 90x45 2.4m", "PTFE thread tape 12mm"
- BAD examples: "Kinetic valve", "Ozito drill", "Ramset anchor" (these are brand-specific)
- Use common material specifications: timber grades (H3/H4), dimensions, thread sizes, capacities
- Include all materials needed: primary materials, fasteners, adhesives, finishes, etc.
- Be realistic with quantities - round up for waste (typically 10-15% extra)
- Include safety/prep materials if relevant (sandpaper, drop sheets, cleaning supplies, etc.)
- Estimate labor hours realistically for an experienced tradie in this specialty
- Consider the suggested materials but don't limit yourself to only those
- Think about what a professional ${tradeContext?.nicheName || 'tradie'} would need for this job

Return ONLY valid JSON, no other text.`;

      const finalPrompt = Array.isArray(photoBase64) && photoBase64.length > 0
        ? `${prompt}\n\nI've also attached ${photoBase64.length} site photo(s). Please examine them carefully to better understand the scope of work, identify specific materials visible, and refine your material estimates based on what you see.`
        : prompt;

      // Try Gemini 3 Pro Preview first (primary — better image understanding)
      let parsed: any | null = null;
      let primaryError: Error | null = null;

      if (geminiApiKey) {
        try {
          parsed = await callGeminiForMaterials(geminiApiKey, finalPrompt, photoBase64);
        } catch (err: any) {
          primaryError = err;
          console.warn('Gemini primary call failed, falling back to Claude Opus:', err.message);
        }
      }

      // Fallback to Claude Opus 4.6
      if (!parsed) {
        if (!anthropicApiKey) {
          throw primaryError || new Error('Gemini failed and no Anthropic fallback key configured');
        }
        try {
          parsed = await callClaudeForMaterials(anthropicApiKey, finalPrompt, photoBase64);
        } catch (fallbackErr: any) {
          // Log full errors server-side; return short summary to client
          console.error('Gemini primary error:', primaryError?.message);
          console.error('Claude fallback error:', fallbackErr?.message);
          const summarize = (msg: string): string => {
            if (!msg) return 'unknown';
            const m = msg.match(/returned (\d{3})/);
            const status = m ? m[1] : '';
            if (status === '429' || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) return `${status || '429'} quota exceeded`;
            if (status === '400' && /credit balance/i.test(msg)) return '400 out of credit';
            if (status === '401' || status === '403') return `${status} auth denied`;
            if (status === '500' || status === '503') return `${status} unavailable`;
            return status ? `${status} error` : msg.slice(0, 60);
          };
          const geminiShort = primaryError ? `Gemini ${summarize(primaryError.message)}` : 'Gemini not attempted';
          const claudeShort = `Claude ${summarize(fallbackErr.message)}`;
          throw new Error(`Both LLM providers failed — ${geminiShort}; ${claudeShort}`);
        }
      }

      // Quantity sanity-check pass — review the materials list against the
      // job description and reduce any quantity that's clearly excessive
      // (3-10× over for the job scope). Best-effort: if the call fails the
      // materials list passes through unchanged.
      const rawMaterials: any[] = Array.isArray(parsed.materials) ? parsed.materials : [];
      let validatedMaterials = rawMaterials;
      if (geminiApiKey && rawMaterials.length > 0) {
        try {
          validatedMaterials = await sanityCheckQuantities(
            geminiApiKey,
            jobDescription,
            tradeContext,
            rawMaterials,
          );
        } catch (err: any) {
          console.warn('Quantity sanity-check failed, returning raw list:', err?.message);
        }
      }

      res.status(200).json({
        materials: validatedMaterials,
        estimatedHours: parsed.estimatedHours || 8,
        jobSummary: parsed.jobSummary || '',
      });
    } catch (error: any) {
      const userEmail = await getUserEmail(decodedToken.uid);
      sendMaterialListErrorEmail(
        userEmail || '',
        decodedToken.uid,
        req.body.jobDescription || '',
        error.message,
      ).catch(() => {});

      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Reconcile priced materials — given each row's individual-unit requirement
 * and the matched product, decide how many actual purchases (packs / lengths
 * / rolls / tins) to charge for, and at what total price.
 *
 * The reconciliation pass exists because regex parsing of pack info from
 * product titles is brittle across trades:
 *   - "Galvanised Connector Nails 35mm 1kg Tub" — contains ~340 nails, but
 *     "1kg" → "N nails" needs general knowledge.
 *   - "Composite Fascia Screws" matched to "Composite Decking Board 5.4m" —
 *     wrong SKU entirely; needs to be rejected.
 *   - "10L Dulux Wash & Wear" for a paint-area requirement — needs to know
 *     coverage per litre (typical: ~12 m²/L).
 * A small Gemini Flash Lite call given the requirement + product can use
 * general knowledge to handle all of these uniformly across trades.
 */
const GEMINI_RECONCILE_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * Quantity sanity-check pass — review the materials list emitted by the
 * primary LLM and reduce any quantity that's clearly disproportionate to
 * the job scope. Universal across trades; works against the job description
 * + materials list using general structural-counting knowledge. Failures
 * fall through and the original list is returned unchanged.
 */
async function sanityCheckQuantities(
  apiKey: string,
  jobDescription: string,
  tradeContext: any,
  materials: any[],
): Promise<any[]> {
  const tradeLine = tradeContext?.nicheName
    ? `${tradeContext.categoryName || ''} / ${tradeContext.nicheName}`.trim()
    : tradeContext?.categoryName || 'general trade';

  // Tag each material with a stable index so the validator can refer back
  // without us trusting it to repeat the full object.
  const indexed = materials.map((m, i) => ({
    index: i,
    name: m.name,
    quantity: m.quantity,
    unit: m.unit,
    section: m.section,
    sectionMultiplier: m.sectionMultiplier,
  }));

  const prompt = `You are reviewing a materials list generated for an Australian tradie's job. The first-pass LLM sometimes over-spec's repeating elements by 3-10× (e.g. 60 deck joists when a 50m² deck only needs 12). Your job: review each material's quantity against the job scope and adjust any that are clearly excessive.

Job description: "${jobDescription}"
Trade: ${tradeLine}

Materials list (with index):
${JSON.stringify(indexed, null, 2)}

For each material, decide:
- "keep" — quantity is reasonable for the scope (within 30% over for waste is fine).
- "adjust" — quantity is clearly excessive (roughly 2× or more over what the scope requires). Reduce to a sensible count.

Use general structural-counting knowledge that applies across all trades:
- Repeating linear elements (joists, studs, posts, rafters): count = ceil(span / centres) + 1.
- Per-area elements (clips, tiles, sheets, downlights, GPOs): count = area × density.
- Linear material from area (decking, weatherboard, cladding): linear metres = area / element_width.
- One-per-unit items: count = N units × items_per_unit.
- Volumetric (concrete bags, sand): bags = volume / yield.
- If quantity has a sectionMultiplier (per-unit qty × multiplier), multiplier is the count of repeating WORK UNITS — sanity-check the multiplier itself against the scope.

CRITICAL — be conservative. A 20-30% over-spec is normal for waste; do NOT adjust those. Only adjust when the count is clearly disproportionate. When in doubt, keep.

Respond with ONLY valid JSON in this exact shape:
{
  "results": [
    { "index": <number>, "decision": "keep" | "adjust", "newQuantity": <number when adjust>, "reasoning": "<one short sentence>" }
  ]
}`;

  const parsed = await callGeminiLiteJson(apiKey, prompt);
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const adjustments = new Map<number, number>();
  for (const r of results) {
    if (
      r &&
      typeof r.index === 'number' &&
      r.decision === 'adjust' &&
      typeof r.newQuantity === 'number' &&
      r.newQuantity > 0
    ) {
      adjustments.set(r.index, Math.round(r.newQuantity));
    }
  }
  if (adjustments.size === 0) return materials;
  return materials.map((m, i) => {
    const adjusted = adjustments.get(i);
    return adjusted !== undefined ? { ...m, quantity: adjusted } : m;
  });
}

async function callGeminiLiteJson(apiKey: string, prompt: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_RECONCILE_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Lite returned ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No content in Gemini Lite response');
  return parseLLMJson(content);
}

export const reconcilePricedMaterials = functions.runWith({ timeoutSeconds: 120 }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { items, jobName, jobDescription } = req.body as {
        items: Array<{
          id: string;
          name: string;
          requirement: number;
          requirementUnit: string;
          // Top-N ranked candidates from the price search. Reconciliation
          // picks the best fit by chosenIndex (or rejects all of them).
          candidates: Array<{
            name?: string;
            price: number;
            url?: string;
            description?: string;
          }>;
        }>;
        jobName?: string;
        jobDescription?: string;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Missing or empty items array' });
        return;
      }
      if (items.length > 50) {
        res.status(400).json({ error: 'Too many items in single request (max 50)' });
        return;
      }

      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        return;
      }

      const jobContextBlock = (jobName || jobDescription)
        ? `JOB CONTEXT — use this to sanity-check that each chosen candidate makes sense for the job. A toilet suite for a kitchen-sink job, or a retaining-wall post for a deck-screw job, is a category mismatch and must be REJECTED, not applied.
Job: ${jobName || '(unnamed)'}
Description: ${jobDescription || '(none provided)'}

`
        : '';

      const prompt = `You are a pricing assistant for an Australian tradie quoting tool. For each material row, the tradie has stated their individual-unit requirement (e.g. "600 each nails", "150 m tape", "40 m² paint coverage") and the price-search has returned a RANKED LIST of candidate products (most likely first).

${jobContextBlock}Your job has two parts:
1. Pick the candidate that best matches the requirement (chosenIndex into the candidates array, 0-based). If NONE of the candidates are the right product category, REJECT the row — do not estimate, do not apply a wrong-category candidate.
2. For the chosen candidate, work out how many ACTUAL PURCHASES the tradie should buy, and the resulting total price. Use your general knowledge of Australian hardware and trade products.

DECISION HIERARCHY:
1. CATEGORY GATE first — if the candidate isn't in the same product category as the requirement, it cannot be applied. A "kitchen sink" requirement and a "toilet suite" candidate are NOT the same category, even if both are plumbing. A "deck screw" requirement and a "retaining-wall post" candidate are NOT the same category, even if both are timber/outdoor. Examples of category-compatible vs not:
   - ✅ Same category: kitchen sink ↔ kitchen sink (any brand/size); decking screws ↔ deck/timber screws; cup-head bolt M12 ↔ cup-head bolt M10; flexible water hose ↔ flexible water hose.
   - ❌ Different category: kitchen sink ↔ toilet suite; deck screws ↔ deck boards; gas hose ↔ water tap; tile adhesive ↔ tile grout.
2. Within the right category, prefer "apply" — different brand, slightly different size, alternative material is fine. An apply on an imperfect-but-same-category match is better than an estimate.
3. Use "estimate" only when every candidate is the wrong category but you have a confident general-knowledge price.
4. Use "reject" when every candidate is the wrong category AND the price is uncertain, OR when the only same-category candidate is implausibly priced (see PRICE SANITY below).

For each item, return one of three decisions:
- "apply" — the chosen candidate is in the SAME product category as the requirement (see CATEGORY GATE above) and the price is plausible. Imperfect matches within the same category are encouraged. Examples of valid applies:
  - Exact: "600 nails" + candidates [(1kg tub @ $13.90)] → 340 nails per tub, buy 2, total $27.80, confidence='high'.
  - Brand substitute: "Eco Deck composite fascia" + candidates include [(Ekodeck fascia 5.4m), (PermaTimber fascia 5.4m)] → apply the closest; confidence='medium'.
  - Spec substitute: "Cup Head Bolt M12 x 150mm" + candidates include [(Cup Head Bolt M12 x 120mm), (Cup Head Bolt M10 x 150mm)] → apply the closest size; confidence='medium'.
  - Length substitute: "Decking screws 50mm" + candidates include [(Decking screws 65mm box of 500)] → apply, confidence='medium'.
- "estimate" — every candidate is the wrong category, but you can give a confident AU-market price from general knowledge so the row isn't $0. Examples:
  - "Eco Deck Starter Clips" + candidates all decking boards → estimate ~$12 per 15-pack, confidence='low'.
  - "Composite Fascia Screws" + candidates all unrelated boards → estimate ~$25 per 100-pack, confidence='low'.
  Always flag it as an estimate in the reasoning ("All candidates were boards, not screws; estimate based on typical AU pricing — verify with supplier").
- "reject" — every candidate is the wrong category AND you have no confident price, OR every same-category candidate is implausibly priced. Set rejectReason explaining the mismatch (e.g. "Job is a kitchen sink replacement but all candidates were toilet suites").

PRICE SANITY — before applying, check the candidate's per-purchase price against typical AU retail for the requirement. If the chosen candidate is more than ~3× a sensible price for that product (e.g. a $946 "kitchen sink" candidate when typical kitchen sinks are $150–$500, or a $400 "PTFE tape" candidate when tape is $5–$10), REJECT instead of applying. The job description above is your strongest signal of what "sensible" means for this row.

CRITICAL — units must be compatible with the chosen candidate. If requirement is in "each" (count of items) but the product is sold by length/weight/volume, work out the conversion (nails per kg, screws per box, paint coverage per litre) using general knowledge. If you can't confidently convert, set confidence: "low" and explain in reasoning.

PREFER cheaper or smaller pack candidates when they cover the requirement adequately — don't pick the most expensive option just because it's first in the list.

Respond with ONLY valid JSON in this exact shape:
{
  "results": [
    {
      "id": "<material id>",
      "decision": "apply" | "estimate" | "reject",
      "chosenIndex": <number — 0-based index into the candidates array; only when decision=apply>,
      "estimatedUnitPrice": <number — only when decision=estimate; the per-purchase price you're estimating>,
      "purchaseCount": <number — how many to buy; required for apply and estimate>,
      "purchaseUnit": "<one of: pack, each, m, m², L, kg>",
      "totalPrice": <number — purchaseCount × unit price>,
      "coverageNote": "<one short sentence: what one purchase covers (e.g. '500 screws per box', '5.4m per length', '10L covers ~120 m²', 'estimated 15 clips per pack')>",
      "confidence": "high" | "medium" | "low",
      "reasoning": "<one short sentence justifying the choice and the maths>",
      "rejectReason": "<only when decision=reject: one sentence on why no estimate could be made>"
    }
  ]
}

Items to reconcile:
${JSON.stringify(items, null, 2)}

Return ONLY the JSON object, no other text.`;

      const parsed = await callGeminiLiteJson(geminiApiKey, prompt);
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      res.status(200).json({ results });
    } catch (error: any) {
      console.error('reconcilePricedMaterials error:', error?.message);
      res.status(500).json({ error: error?.message || 'Reconciliation failed' });
    }
  });
});

// ----------------------------------------------------------------------------
// Supplier Price List extraction — multimodal wrappers + endpoint
// ----------------------------------------------------------------------------

interface ImageInput {
  data: string;
  mimeType: string;
}

interface ExtractionInput {
  pdfBase64?: string;
  imageBase64?: (string | ImageInput)[];
}

/** Normalize an image entry to {data, mimeType}. Plain strings default to image/jpeg. */
function normalizeImage(img: string | ImageInput): ImageInput {
  if (typeof img === 'string') return { data: img, mimeType: 'image/jpeg' };
  return { data: img.data, mimeType: img.mimeType || 'image/jpeg' };
}

async function callGeminiForExtraction(
  apiKey: string,
  prompt: string,
  input: ExtractionInput,
): Promise<any> {
  const parts: any[] = [];
  if (input.pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: input.pdfBase64,
      },
    });
  }
  if (Array.isArray(input.imageBase64) && input.imageBase64.length > 0) {
    for (const raw of input.imageBase64) {
      const img = normalizeImage(raw);
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data,
        },
      });
    }
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MATERIALS_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('No content in Gemini response');
  }
  return parseLLMJson(content);
}

async function callClaudeForExtraction(
  apiKey: string,
  prompt: string,
  input: ExtractionInput,
): Promise<any> {
  const messageContent: any[] = [];
  if (input.pdfBase64) {
    messageContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: input.pdfBase64,
      },
    });
  }
  if (Array.isArray(input.imageBase64) && input.imageBase64.length > 0) {
    for (const raw of input.imageBase64) {
      const img = normalizeImage(raw);
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.data,
        },
      });
    }
  }
  messageContent.push({ type: 'text', text: prompt });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      temperature: 0.1,
      messages: [{ role: 'user', content: messageContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((c: any) => c.type === 'text');
  const content = textBlock?.text || data.content?.[0]?.text;
  if (!content) {
    throw new Error('No content in Claude response');
  }
  return parseLLMJson(content);
}

function buildExtractSupplierPrompt(supplierName?: string, defaultUnit?: string): string {
  return `You are reading a tradesperson's supplier price list. Extract every line item visible.

Supplier hint: ${supplierName || '(unknown)'}
Default unit hint: ${defaultUnit || '(none)'}

ALSO extract the supplier's contact details if they are clearly printed on the document (typically in the header, footer, or letterhead). Only include each field if you are confident the value is explicitly printed — never guess, never infer from the supplier name, never make up phone numbers or emails. Omit any field you are unsure about. The fields are:
- contactPerson: account manager / sales rep name, if labelled as such
- phone: primary phone number, digits and spacing as printed
- email: primary email address (one address only)
- address: street/postal address as printed (single line, comma separated)
- website: primary website URL

For each item, return:
- name: clean product name (strip SKU codes unless they're the only identifier)
- price: numeric AUD value (no currency symbol, no GST marker)
- unit: one of "each|m|m²|m³|L|kg|box|pack" — the SALEABLE unit. If the supplier sells a packaged/bundled product (a bag, tub, bundle), use "each" for the unit and capture the contained quantity in coveragePerUnit/coverageUnit (see rules below).
- coveragePerUnit: numeric, only if one purchasable unit contains a measurable amount of work (e.g. "covers 13 m² with 100 mm overlap" → 13, OR "1/2 m³ bag of mulch" → 0.5)
- coverageUnit: "m²"|"m³"|"m" — only if coveragePerUnit set
- keywords: 2-4 short lowercase words describing the product type (e.g. ["concrete","ready-mix","slab"])
- confidence: "high"|"medium"|"low" — "low" if price OR unit is ambiguous, "medium" if one field was inferred, "high" only when the line is fully unambiguous
- rawLine: the original line text as you read it, for the user to verify

How to choose unit vs coverage:
- "Ready-mix concrete — $450/m³" → unit:"m³", price:450, no coverage (sold loose by the m³).
- "Mulch — $45 / ½ m³" → unit:"each", price:45, coveragePerUnit:0.5, coverageUnit:"m³" (one bag = 0.5 m³).
- "FC sheet 6×2.4 — $X (covers 13 m²)" → unit:"each", price:X, coveragePerUnit:13, coverageUnit:"m²".
- "Treated pine 90×45 2.4m — $Y" → unit:"each", price:Y, no coverage (length is part of the name).
- "Sand — $30 per 20 kg bag" → unit:"each", price:30, coveragePerUnit:20, coverageUnit:"kg" is NOT supported — drop the coverage and put "20 kg" in the name. Only use coverage when the coverageUnit is m, m² or m³.

The rule of thumb: if a tradie can't buy a fraction of the listed item (e.g. a whole bag, a whole sheet), the unit must be "each" and the bundled measurement goes into coveragePerUnit.

Skip header rows, column headings, section titles, subtotals, totals, page numbers, ads, terms, disclaimers, and anything that is not a purchasable line item. Contact info goes in the supplierContact block, NOT in items.

If the photo contains ONLY contact details (a business card, letterhead, contact page) and no purchasable line items, return items: [] and fill in supplierContact with whatever you can read.

Return ONLY valid JSON in this exact shape:
{
  "supplierName": "...",
  "supplierContact": { "contactPerson": null, "phone": null, "email": null, "address": null, "website": null },
  "items": [ { "name": "...", "price": 0, "unit": "each", "coveragePerUnit": null, "coverageUnit": null, "keywords": [], "confidence": "high", "rawLine": "..." } ]
}
For supplierContact, use null for any field that is not clearly printed on the document. If no contact details are visible at all, set every field to null.`;
}

/**
 * Extract Supplier Price List — multimodal (PDF or photos).
 * Gemini 3 Pro Preview primary, Claude Opus 4.6 fallback. Both accept PDFs natively.
 */
export const extractSupplierPriceList = functions
  .runWith({ timeoutSeconds: 240, memory: '1GB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
      if (!decodedToken) return;

      try {
        const { pdfBase64, imageBase64, supplierName, defaultUnit } = req.body;

        if (!pdfBase64 && (!Array.isArray(imageBase64) || imageBase64.length === 0)) {
          res.status(400).json({ error: 'Provide either pdfBase64 or imageBase64[]' });
          return;
        }
        if (Array.isArray(imageBase64) && imageBase64.length > 10) {
          res.status(400).json({ error: 'Maximum 10 images per import' });
          return;
        }
        if (typeof pdfBase64 === 'string' && pdfBase64.length > 14_000_000) {
          res.status(400).json({ error: 'PDF too large (max 10 MB)' });
          return;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!geminiApiKey && !anthropicApiKey) {
          res.status(500).json({ error: 'No LLM API keys configured (GEMINI_API_KEY / ANTHROPIC_API_KEY)' });
          return;
        }

        const prompt = buildExtractSupplierPrompt(supplierName, defaultUnit);
        const input: ExtractionInput = { pdfBase64, imageBase64 };

        let parsed: any | null = null;
        let primaryError: Error | null = null;

        if (geminiApiKey) {
          try {
            parsed = await callGeminiForExtraction(geminiApiKey, prompt, input);
          } catch (err: any) {
            primaryError = err;
            console.warn('Gemini extraction failed, falling back to Claude:', err.message);
          }
        }

        if (!parsed) {
          if (!anthropicApiKey) {
            throw primaryError || new Error('Gemini failed and no Anthropic fallback key configured');
          }
          try {
            parsed = await callClaudeForExtraction(anthropicApiKey, prompt, input);
          } catch (fallbackErr: any) {
            console.error('Gemini extraction error:', primaryError?.message);
            console.error('Claude extraction error:', fallbackErr?.message);
            throw new Error(
              `Price list extraction failed — ${primaryError ? `Gemini: ${primaryError.message.slice(0, 80)}; ` : ''}Claude: ${fallbackErr.message.slice(0, 80)}`
            );
          }
        }

        res.status(200).json({
          supplierName: parsed.supplierName || supplierName || '',
          supplierContact: parsed.supplierContact && typeof parsed.supplierContact === 'object'
            ? parsed.supplierContact
            : null,
          items: Array.isArray(parsed.items) ? parsed.items : [],
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  });

/**
 * Search Material Price using Anthropic Claude API
 * This Cloud Function acts as a proxy to avoid CORS issues on web
 */
export const searchMaterialPrice = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { materialName, hardwareStoreUrls } = req.body;

      if (!isNonEmptyString(materialName)) {
        res.status(400).json({ error: 'Missing or invalid materialName' });
        return;
      }
      if (materialName.length > 500) {
        res.status(400).json({ error: 'materialName exceeds maximum length' });
        return;
      }

      // Get API key from Firebase config
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
      }

      const storeList = (hardwareStoreUrls || []).join(', ');

      const prompt = `You are a pricing expert for Australian hardware stores like Bunnings.

Material: "${materialName}"
Store context: ${storeList}

Based on your knowledge of typical Australian hardware store pricing, estimate a reasonable price for this material.
Consider typical Australian hardware store pricing from 2024.

Return ONLY a JSON object in this exact format (no other text):
{
  "price": <number>,
  "productName": "<material name>",
  "store": "Hardware Store (AI estimate)",
  "confidence": "<low|medium|high>"
}

Important:
- Return the price as a number only (e.g., 12.50, not "$12.50")
- Base your estimate on typical hardware store pricing
- If you cannot estimate, return { "price": null }
- Return ONLY valid JSON, no markdown, no other text

Example:
{"price": 15.90, "productName": "Treated Pine H3 90x45mm 2.4m", "store": "Hardware Store (AI estimate)", "confidence": "medium"}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      let textContent = '';
      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find((block: any) => block.type === 'text');
        if (textBlock) {
          textContent = textBlock.text;
        }
      }

      if (!textContent) {
        res.status(500).json({ error: 'No text content in response' });
        return;
      }

      let jsonStr = textContent.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const result = JSON.parse(jsonStr);

      res.status(200).json({
        price: result.price || null,
        productName: result.productName,
        store: result.store || 'Hardware Store (AI estimated)',
        url: undefined,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Reece API Endpoints
 * Integration with Reece Group API for plumbing supplies.
 * API docs: https://docs.api.reecegroup.com.au/latest/index.html
 *
 * Auth model: app-level OAuth (client_credentials) wraps every request, but
 * Reece prod strictly rejects the Customer-Number header — every plumber must
 * complete the per-user maX onboarding flow which yields a long-lived
 * Customer-Token. We store that token (encrypted at rest) per user in
 * Firestore and pass it on every product/price/inventory call.
 *
 * Required env: REECE_CLIENT_ID, REECE_CLIENT_SECRET, REECE_TOKEN_ENC_KEY,
 * REECE_CALLBACK_URL. REECE_USE_TEST_ENV=true switches to Reece's test
 * environment (where the Customer-Number trick still works for smoke tests).
 */

// Token cache to avoid requesting a new app-level token on every call
let reeceTokenCache: { token: string; expiresAt: number } | null = null;

// Reece API environment configuration. Default to PROD now that the per-user
// onboarding flow is shipping — the test env was only useful while we were
// validating the Customer-Number shortcut, which doesn't work in prod anyway.
const REECE_USE_TEST_ENV = (process.env.REECE_USE_TEST_ENV || 'false') === 'true';
const REECE_AUTH_BASE_URL = REECE_USE_TEST_ENV
  ? 'https://auth.api.test.reecegroup.com.au'
  : 'https://auth.api.reecegroup.com.au';
const REECE_API_BASE_URL = REECE_USE_TEST_ENV
  ? 'https://open.api.test.reecegroup.com.au'
  : 'https://open.api.reecegroup.com.au';
const REECE_REGION = process.env.REECE_REGION || 'au';
// Public page the maX consent flow redirects to once the user approves
// QuoteMate. Reece doesn't append any query params — the redirect itself is
// the only completion signal — so this just needs to be a stable URL that
// renders a "you can close this tab" message.
const REECE_CALLBACK_URL =
  process.env.REECE_CALLBACK_URL || 'https://quotemateapp.au/reece/callback';

/**
 * Get OAuth token for Reece API
 * Uses OAuth2 client_credentials flow with Basic auth (base64 clientId:clientSecret)
 * Token URL: {REECE_AUTH_BASE_URL}/oauth2/token
 */
async function getReeceAuthToken(): Promise<string | null> {
  try {
    // Check if we have a valid cached token
    if (reeceTokenCache && reeceTokenCache.expiresAt > Date.now()) {
      return reeceTokenCache.token;
    }

    const reeceClientId = process.env.REECE_CLIENT_ID;
    const reeceClientSecret = process.env.REECE_CLIENT_SECRET;

    if (!reeceClientId || !reeceClientSecret) {
      return null;
    }

    // OAuth2 client_credentials flow with Basic auth header
    const basicAuth = Buffer.from(`${reeceClientId}:${reeceClientSecret}`).toString('base64');

    const tokenResponse = await fetch(`${REECE_AUTH_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'Default/read Default/write',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      await tokenResponse.text();
      return null;
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 3600; // Default to 1 hour

    // Cache the token (with 5 minute buffer before expiry)
    reeceTokenCache = {
      token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    };

    return token;
  } catch (error: any) {
    return null;
  }
}

// ---- Customer-token at-rest encryption -----------------------------------
// Reece customer tokens are stored encrypted in Firestore so a database leak
// alone doesn't expose every plumber's trade-pricing entitlement to Reece.
// Format on disk: `enc:v1:base64(iv ‖ authTag ‖ ciphertext)` (AES-256-GCM).
// Mirrors the Square pattern below at squareTokenEnc helpers.
const REECE_TOKEN_ENC_PREFIX = 'enc:v1:';
function getReeceEncKey(): Buffer | null {
  const raw = process.env.REECE_TOKEN_ENC_KEY || '';
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

function encryptReeceToken(plaintext: string): string {
  const key = getReeceEncKey();
  if (!key) {
    console.warn('[reece] REECE_TOKEN_ENC_KEY not set — storing token in plaintext');
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return REECE_TOKEN_ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptReeceToken(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith(REECE_TOKEN_ENC_PREFIX)) {
    return value;
  }
  const key = getReeceEncKey();
  if (!key) {
    console.error('[reece] REECE_TOKEN_ENC_KEY missing — cannot decrypt token');
    return null;
  }
  try {
    const packed = Buffer.from(value.slice(REECE_TOKEN_ENC_PREFIX.length), 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err: any) {
    console.error('[reece] token decrypt failed', { message: err?.message });
    return null;
  }
}

/**
 * Read + decrypt the user's Reece customer token from Firestore. Returns
 * null when the user hasn't completed onboarding or their record is unreadable.
 */
async function getReeceCustomerToken(uid: string): Promise<{
  customerToken: string;
  customerNumber: string;
  homeBranch?: string;
  displayName?: string;
} | null> {
  try {
    const doc = await admin.firestore().doc(`users/${uid}/integrations/reece`).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    const enc = data.customerTokenEnc as string | undefined;
    const customerToken = decryptReeceToken(enc);
    if (!customerToken || !data.customerNumber) return null;
    return {
      customerToken,
      customerNumber: String(data.customerNumber),
      homeBranch: data.homeBranch,
      displayName: data.displayName,
    };
  } catch (err: any) {
    console.error('[reece] failed to load customer token', { uid, message: err?.message });
    return null;
  }
}

/**
 * Clear the user's stored Reece connection — typically called when Reece
 * returns 401, signalling the customer token has been revoked or expired.
 */
async function clearReeceConnection(uid: string, reason: string): Promise<void> {
  try {
    await admin.firestore().doc(`users/${uid}/integrations/reece`).delete();
    console.warn('[reece] cleared connection', { uid, reason });
  } catch (err: any) {
    console.error('[reece] failed to clear connection', { uid, message: err?.message });
  }
}

/**
 * Check if Reece API is available and configured
 */
export const checkReeceApi = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const token = await getReeceAuthToken();
      const available = !!token;

      res.status(200).json({ available });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Pull the best image URL out of a Reece product-gateway product object.
 * Tries the SAP Commerce images[] envelope first (Reece runs Hybris), then
 * common flat field names. Relative URLs are prefixed with the Reece host so
 * they render in <Image> on the client.
 */
function extractReeceImageUrl(product: any): string | null {
  if (!product) return null;

  const candidates: Array<string | undefined> = [];

  // Reece's product-gateway returns images on `productImages`. Older docs
  // and other Hybris endpoints sometimes use plain `images`, so we check
  // both — the inner shape is tried with several common conventions
  // (Hybris `format`, generic `imageType`, plain `.url`/`.imageUrl`/string).
  for (const arr of [product.productImages, product.images]) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const pick = (img: any): string | undefined =>
      typeof img === 'string' ? img : img?.url || img?.imageUrl || img?.href;
    const byFormat = (fmt: string) =>
      pick(arr.find((img: any) => img?.format === fmt));
    const byImageType = (t: string) =>
      pick(arr.find((img: any) => img?.imageType === t));
    candidates.push(byFormat('product'), byFormat('zoom'), byFormat('thumbnail'));
    candidates.push(byImageType('PRIMARY'), byImageType('GALLERY'));
    candidates.push(pick(arr[0]));
  }

  if (Array.isArray(product.media)) {
    candidates.push(product.media[0]?.url);
  } else if (product.media && typeof product.media === 'object') {
    candidates.push(product.media.primary?.url, product.media.url, product.media.primary);
  }

  if (Array.isArray(product.assets)) {
    candidates.push(
      product.assets.find((a: any) => a?.type === 'IMAGE')?.url,
      product.assets[0]?.url,
    );
  }

  candidates.push(
    product.imageUrl,
    product.productImage,
    product.productImageUrl,
    product.thumbnailUrl,
    product.thumbnail,
    product.image,
  );

  const found = candidates.find(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );
  if (!found) return null;

  if (/^https?:\/\//i.test(found)) return found;
  if (found.startsWith('//')) return `https:${found}`;
  return `https://www.reece.com.au${found.startsWith('/') ? '' : '/'}${found}`;
}

/**
 * Search for a product in Reece catalog using the calling user's customer
 * token. Returns trade-discounted pricing inline in the product result.
 */
export const searchReeceProduct = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const { productName } = req.body;

      if (!isNonEmptyString(productName)) {
        res.status(400).json({ error: 'Missing or invalid productName' });
        return;
      }

      const token = await getReeceAuthToken();
      if (!token) {
        res.status(200).json({ product: null });
        return;
      }

      const userToken = await getReeceCustomerToken(decodedToken.uid);
      if (!userToken) {
        res.status(200).json({ product: null, error: 'reece_not_connected' });
        return;
      }

      // Reece's search is strict token-AND, so a query whose noun-phrase is
      // surrounded by brand prefix or trailing size/color descriptors
      // ("Atomik Priming Fluid PVC Clear 500ml") returns 0 even when Reece
      // sells the thing. Generate variants by trimming tokens from the
      // front, back, and both ends, plus the existing last-N anchors. Try
      // them in order, stop at the first variant that returns hits.
      const tokens = productName.trim().split(/\s+/);
      const n = tokens.length;
      const candidates = [productName];
      if (n >= 4) {
        candidates.push(tokens.slice(0, -1).join(' ')); // drop trailing descriptor
        candidates.push(tokens.slice(1).join(' '));      // drop leading brand prefix
        candidates.push(tokens.slice(1, -1).join(' '));  // drop both ends
      }
      if (n >= 4) candidates.push(tokens.slice(-3).join(' ')); // noun-tail (3)
      if (n >= 3) candidates.push(tokens.slice(-2).join(' ')); // noun-tail (2)
      if (n >= 3) candidates.push(tokens.slice(0, 2).join(' ')); // noun-head (2)
      const variants = Array.from(new Set(candidates));

      const fetchVariant = (variant: string) =>
        fetch(
          `${REECE_API_BASE_URL}/${REECE_REGION}/product-gateway/search?searchPhrase=${encodeURIComponent(variant)}&pageNumber=1&pageSize=5`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
              'Customer-Token': userToken.customerToken,
            },
          },
        );

      let searchData: any = null;
      let usedVariant = productName;
      for (const variant of variants) {
        const response = await fetchVariant(variant);
        if (response.status === 401) {
          await clearReeceConnection(decodedToken.uid, 'search_401');
          res.status(200).json({ product: null, error: 'reece_reauth_required' });
          return;
        }
        if (!response.ok) {
          await response.text();
          continue;
        }
        const data = await response.json();
        if (data.products && data.products.length > 0) {
          searchData = data;
          usedVariant = variant;
          break;
        }
        searchData = data; // keep last (empty) so _debug has a shape if every variant misses
      }

      // Temporary diagnostic returned inline in the response — Cloud Logging
      // was swallowing console.log for this function, so we pass the shape
      // through to the client where it can hit Metro. Drop once Reece
      // coverage is dialed in.
      const _debug = {
        query: productName,
        usedVariant,
        retried: usedVariant !== productName,
        productCount: searchData?.products?.length ?? 0,
        topTitle: searchData?.products?.[0]?.productTitle ?? null,
        topProductId: searchData?.products?.[0]?.productId ?? null,
        topHasUom: !!searchData?.products?.[0]?.unitOfMeasures?.[0],
        topUnitPriceIncGst: searchData?.products?.[0]?.unitOfMeasures?.[0]?.unitPriceIncludingGST ?? null,
        topUnitPriceExGst: searchData?.products?.[0]?.unitOfMeasures?.[0]?.unitPriceExcludingGST ?? null,
        topProductKeys: searchData?.products?.[0] ? Object.keys(searchData.products[0]) : null,
        topProductImages: searchData?.products?.[0]?.productImages ?? null,
      };

      if (searchData?.products && searchData.products.length > 0) {
        // Return up to 5 candidates so the reconciliation pass has options
        // to pick the best fit / reject category mismatches. The first
        // candidate is also surfaced as `product` for backward compat with
        // callers that just want the top hit.
        const mapped = searchData.products.slice(0, 5).map((p: any) => {
          const uom = p.unitOfMeasures?.[0];
          return {
            itemNumber: String(p.productId),
            description: p.productTitle,
            brand: p.brand,
            category: p.category,
            unitOfMeasure: uom?.pack || null,
            unitPriceExcludingGst: uom?.unitPriceExcludingGST ?? null,
            unitPriceIncludingGst: uom?.unitPriceIncludingGST ?? null,
            imageUrl: extractReeceImageUrl(p),
          };
        });

        res.status(200).json({
          product: mapped[0],
          products: mapped,
          _debug: { ..._debug, imageExtracted: !!mapped[0].imageUrl, imageUrl: mapped[0].imageUrl },
        });
      } else {
        res.status(200).json({ product: null, products: [], _debug });
      }
    } catch (error: any) {
      res.status(200).json({ product: null });
    }
  });
});

/**
 * Get price for a Reece product. Pricing comes inline with the product
 * search response (the dedicated price-file endpoint is a bulk dump, not a
 * per-item lookup), so this handler is structurally identical to
 * searchReeceProduct but extracts the price field instead of the description.
 */
export const getReecePrice = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const { itemNumber } = req.body;

      if (!isNonEmptyString(itemNumber)) {
        res.status(400).json({ error: 'Missing or invalid itemNumber' });
        return;
      }

      const token = await getReeceAuthToken();
      if (!token) {
        res.status(200).json({ price: null });
        return;
      }

      const userToken = await getReeceCustomerToken(decodedToken.uid);
      if (!userToken) {
        res.status(200).json({ price: null, error: 'reece_not_connected' });
        return;
      }

      const priceResponse = await fetch(
        `${REECE_API_BASE_URL}/${REECE_REGION}/product-gateway/search?searchPhrase=${encodeURIComponent(itemNumber)}&pageNumber=1&pageSize=1`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Customer-Token': userToken.customerToken,
          },
        }
      );

      if (priceResponse.status === 401) {
        await clearReeceConnection(decodedToken.uid, 'price_401');
        res.status(200).json({ price: null, error: 'reece_reauth_required' });
        return;
      }

      if (!priceResponse.ok) {
        await priceResponse.text();
        res.status(200).json({ price: null });
        return;
      }

      const priceData = await priceResponse.json();

      if (priceData.products && priceData.products.length > 0) {
        const product = priceData.products[0];
        const uom = product.unitOfMeasures?.[0];
        const price = uom?.unitPriceIncludingGst || uom?.unitPriceExcludingGst;

        if (price != null) {
          res.status(200).json({
            price,
            currency: 'AUD',
            priceIncGst: uom?.unitPriceIncludingGst,
            gstRate: priceData.gstRate,
          });
        } else {
          res.status(200).json({ price: null });
        }
      } else {
        res.status(200).json({ price: null });
      }
    } catch (error: any) {
      res.status(200).json({ price: null });
    }
  });
});

/**
 * Get inventory for a Reece product. The Reece public API has no direct
 * stock-level endpoint, so we use product search as an existence probe and
 * report quantityAvailable: -1 (meaning "exists, level unknown"). Punchout
 * cart is the only path to real-time stock per Reece docs.
 */
export const getReeceInventory = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const { itemNumber, branchCode } = req.body;

      if (!isNonEmptyString(itemNumber)) {
        res.status(400).json({ error: 'Missing or invalid itemNumber' });
        return;
      }

      const token = await getReeceAuthToken();
      if (!token) {
        res.status(200).json({ inventory: null });
        return;
      }

      const userToken = await getReeceCustomerToken(decodedToken.uid);
      if (!userToken) {
        res.status(200).json({ inventory: null, error: 'reece_not_connected' });
        return;
      }

      const inventoryResponse = await fetch(
        `${REECE_API_BASE_URL}/${REECE_REGION}/product-gateway/search?searchPhrase=${encodeURIComponent(itemNumber)}&pageNumber=1&pageSize=1`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Customer-Token': userToken.customerToken,
          },
        }
      );

      if (inventoryResponse.status === 401) {
        await clearReeceConnection(decodedToken.uid, 'inventory_401');
        res.status(200).json({ inventory: null, error: 'reece_reauth_required' });
        return;
      }

      if (!inventoryResponse.ok) {
        await inventoryResponse.text();
        res.status(200).json({ inventory: null });
        return;
      }

      const inventoryData = await inventoryResponse.json();

      if (inventoryData.products && inventoryData.products.length > 0) {
        const product = inventoryData.products[0];
        res.status(200).json({
          inventory: {
            itemNumber: String(product.productId),
            branchCode: branchCode || userToken.homeBranch || 'unknown',
            quantityAvailable: -1,
          },
        });
      } else {
        res.status(200).json({ inventory: null });
      }
    } catch (error: any) {
      res.status(200).json({ inventory: null });
    }
  });
});

/**
 * Start Reece per-user onboarding — exchange the app-level OAuth token for a
 * shortlived requestToken, then return the maX consent URL the user opens in
 * a browser. After the user approves, Reece redirects to REECE_CALLBACK_URL
 * (no params), the client closes the tab and calls reeceExchangeCustomerToken.
 */
export const reeceRequestToken = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const token = await getReeceAuthToken();
      if (!token) {
        res.status(500).json({ error: 'Reece API not configured' });
        return;
      }

      const requestTokenResponse = await fetch(
        `${REECE_API_BASE_URL}/${REECE_REGION}/customer-application-onboarding-gateway/request-token`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      if (!requestTokenResponse.ok) {
        const body = await requestTokenResponse.text().catch(() => '');
        console.error('[reece] request-token failed', {
          uid: decodedToken.uid,
          status: requestTokenResponse.status,
          body: body.slice(0, 300),
        });
        res.status(502).json({ error: 'Could not start Reece connection. Please try again.' });
        return;
      }

      const data: any = await requestTokenResponse.json();
      const requestToken = data.requestToken || data.request_token;
      if (!requestToken) {
        res.status(502).json({ error: 'Reece returned an unexpected response.' });
        return;
      }

      // Reece's consent UI lives on reece.com.au, NOT on the API host.
      const params = new URLSearchParams({
        request_token: requestToken,
        callback_url: REECE_CALLBACK_URL,
      });
      const authUrl = `https://reece.com.au/link-application/account-select?${params.toString()}`;

      res.status(200).json({ requestToken, authUrl });
    } catch (error: any) {
      console.error('[reece] request-token error', { message: error?.message });
      res.status(500).json({ error: 'Reece connection failed. Please try again.' });
    }
  });
});

/**
 * Complete Reece onboarding — once the user has approved QuoteMate inside the
 * maX consent flow, the client posts the requestToken back here. We exchange
 * it for the long-lived customerToken and store the full record (encrypted)
 * on the user's integrations doc.
 */
export const reeceExchangeCustomerToken = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const { requestToken } = req.body;
      if (!isNonEmptyString(requestToken)) {
        res.status(400).json({ error: 'Missing requestToken' });
        return;
      }

      const token = await getReeceAuthToken();
      if (!token) {
        res.status(500).json({ error: 'Reece API not configured' });
        return;
      }

      const exchangeResponse = await fetch(
        `${REECE_API_BASE_URL}/${REECE_REGION}/customer-application-onboarding-gateway/customer-token`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestToken }),
        }
      );

      if (!exchangeResponse.ok) {
        const body = await exchangeResponse.text().catch(() => '');
        console.error('[reece] customer-token exchange failed', {
          uid: decodedToken.uid,
          status: exchangeResponse.status,
          body: body.slice(0, 300),
        });
        // Most common case: user landed on the maX consent page but didn't
        // tap Approve/Link before closing the tab — Reece responds with
        // "Invalid request token" because the token never moved to an
        // approved state. The message below tells them exactly what to do.
        res.status(400).json({
          error:
            "Reece sign-in didn't complete. Tap Connect again, sign in to maX, and tap the Approve / Link button on the consent page before closing the tab.",
        });
        return;
      }

      const data: any = await exchangeResponse.json();
      const customerToken = data.customerToken || data.customer_token;
      const customerNumber = data.customerNumber || data.customer_number;
      const displayName = data.displayName || data.display_name;

      // Reece returns `homeBranch` as an object — confirmed shape:
      // { branchNumber: "3032", name: "Plumbing Burwood", shortName, address,
      //   geographicalCoordinates, managerName, telephone, ... }. Earlier
      // versions of this code stringified the object, leaving "[object Object]"
      // in Firestore. Now we extract a stable display name and the branch
      // number separately.
      const homeBranchRaw = data.homeBranch || data.home_branch;
      const homeBranchName =
        homeBranchRaw?.name ||
        homeBranchRaw?.branchName ||
        homeBranchRaw?.shortName ||
        (typeof homeBranchRaw === 'string' ? homeBranchRaw : null);
      const homeBranchNumber =
        homeBranchRaw?.branchNumber ||
        homeBranchRaw?.branch_number ||
        homeBranchRaw?.number ||
        null;

      // One-shot diagnostic: dump raw shape (without the customerToken) so we
      // can spot future field renames without re-running the manual flow.
      console.log('[reece] customer-token exchange success', {
        uid: decodedToken.uid,
        customerNumberType: typeof customerNumber,
        homeBranchType: typeof homeBranchRaw,
        homeBranchKeys: homeBranchRaw && typeof homeBranchRaw === 'object'
          ? Object.keys(homeBranchRaw)
          : null,
        topLevelKeys: Object.keys(data),
      });

      if (!customerToken || !customerNumber) {
        res.status(502).json({ error: 'Reece returned an unexpected response.' });
        return;
      }

      await admin.firestore().doc(`users/${decodedToken.uid}/integrations/reece`).set({
        customerNumber: String(customerNumber),
        displayName: displayName ? String(displayName) : null,
        homeBranch: homeBranchName,
        homeBranchNumber: homeBranchNumber ? String(homeBranchNumber) : null,
        customerTokenEnc: encryptReeceToken(customerToken),
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({
        connected: true,
        customerNumber: String(customerNumber),
        displayName: displayName ? String(displayName) : null,
        homeBranch: homeBranchName,
        homeBranchNumber: homeBranchNumber ? String(homeBranchNumber) : null,
      });
    } catch (error: any) {
      console.error('[reece] exchange error', { message: error?.message });
      res.status(500).json({ error: 'Could not finish connecting Reece. Please try again.' });
    }
  });
});

/**
 * Report whether the calling user has a stored Reece connection. Used by the
 * settings screen and the materials list to gate UI without exposing the
 * encrypted token to the client.
 */
export const reeceConnectionStatus = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const doc = await admin.firestore().doc(`users/${decodedToken.uid}/integrations/reece`).get();
      if (!doc.exists) {
        res.status(200).json({ connected: false });
        return;
      }
      const data = doc.data()!;
      res.status(200).json({
        connected: true,
        customerNumber: data.customerNumber || null,
        displayName: data.displayName || null,
        homeBranch: data.homeBranch || null,
        homeBranchNumber: data.homeBranchNumber || null,
        connectedAt: data.connectedAt?.toDate?.()?.toISOString?.() || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Could not check Reece connection.' });
    }
  });
});

/**
 * Disconnect Reece for the calling user. Reece has no documented revoke
 * endpoint, so we just delete the local record — the user's existing maX
 * consent goes dormant on Reece's side until they reconnect.
 */
export const reeceDisconnect = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      await admin.firestore().doc(`users/${decodedToken.uid}/integrations/reece`).delete();
      res.status(200).json({ disconnected: true });
    } catch (error: any) {
      console.error('[reece] disconnect failed', { message: error?.message });
      res.status(500).json({ error: 'Could not disconnect Reece.' });
    }
  });
});

// ----- Reece order-gateway -------------------------------------------------
// Endpoints below let a connected plumber preview, validate, and place orders
// against their Reece trade account directly from a QuoteMate quote. Reece
// invoices the plumber on their normal trade terms; QuoteMate never handles
// money or fulfilment. Order shape was verified end-to-end against prod on
// 2026-04-28 — see .claude/skills/reece-api/SKILL.md for the full schema.

interface ReeceProduct {
  productId: number;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  quoteNumber?: string | null;
  quoteLineNumber?: number | null;
}

interface ReeceFulfillment {
  type: 'PICKUP' | 'DELIVERY';
  pickupBranch?: string;            // branchNumber (string) for PICKUP
  deliveryDetails?: {                // for DELIVERY
    contactName: string;
    deliveryAddress: {
      addressLine1: string;
      addressLine2?: string;
      suburb?: string;
      state?: string;
      postCode: string;
    };
  };
}

interface ReeceOrderRequest {
  orderByName: string;
  orderByPhone?: string;
  orderByEmail?: string;
  jobName?: string;
  orderNumber?: string;             // PO / reference echoed to Reece
  comment?: string;
  requiredByDateTime: string;        // yyyy-MM-dd'T'HH:mm:ss (no Z suffix)
  fulfillment: ReeceFulfillment;
  products: ReeceProduct[];
}

// Branch list cache: {uid -> {branches, expiresAt}}. The Reece /branches list
// is identical for all customers (it's a global directory) but the endpoint
// requires a Customer-Token, so we still fetch per-user the first time. ~1
// hour TTL is generous given how rarely Reece adds/closes branches.
const reeceBranchesCache: Map<string, { branches: any[]; expiresAt: number }> = new Map();

/**
 * List Reece branches. Used by the order modal's branch picker — the user
 * defaults to their home branch but can change it. Backend caches the
 * response for an hour to avoid hammering Reece on every modal open.
 */
export const reeceListBranches = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    try {
      const cached = reeceBranchesCache.get(decodedToken.uid);
      if (cached && cached.expiresAt > Date.now()) {
        res.status(200).json({ branches: cached.branches });
        return;
      }

      const token = await getReeceAuthToken();
      const userToken = await getReeceCustomerToken(decodedToken.uid);
      if (!token || !userToken) {
        res.status(200).json({ branches: [], error: 'reece_not_connected' });
        return;
      }

      const response = await fetch(`${REECE_API_BASE_URL}/${REECE_REGION}/branches`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Customer-Token': userToken.customerToken,
        },
      });

      if (response.status === 401) {
        await clearReeceConnection(decodedToken.uid, 'branches_401');
        res.status(200).json({ branches: [], error: 'reece_reauth_required' });
        return;
      }
      if (!response.ok) {
        await response.text();
        res.status(200).json({ branches: [] });
        return;
      }

      const data = await response.json();
      const branches = data.branches || [];
      reeceBranchesCache.set(decodedToken.uid, {
        branches,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      res.status(200).json({ branches });
    } catch (error: any) {
      console.error('[reece] list branches failed', { message: error?.message });
      res.status(200).json({ branches: [] });
    }
  });
});

/**
 * Internal helper: forward an order request to Reece's preview or check
 * endpoint. Both endpoints take the same body shape — they differ only in
 * what they validate and return. Returns the raw upstream response (status +
 * body) so the calling handler can decide how to surface it.
 */
async function callReeceOrderEndpoint(
  uid: string,
  endpoint: 'preview' | 'check' | 'orders',
  request: ReeceOrderRequest,
): Promise<{ status: number; body: any; error?: 'reece_not_connected' | 'reece_reauth_required' }> {
  const token = await getReeceAuthToken();
  const userToken = await getReeceCustomerToken(uid);
  if (!token || !userToken) {
    return { status: 200, body: null, error: 'reece_not_connected' };
  }

  const response = await fetch(
    `${REECE_API_BASE_URL}/${REECE_REGION}/order-gateway/${endpoint}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Customer-Token': userToken.customerToken,
      },
      body: JSON.stringify(request),
    },
  );

  if (response.status === 401) {
    await clearReeceConnection(uid, `order_${endpoint}_401`);
    return { status: 200, body: null, error: 'reece_reauth_required' };
  }

  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body };
}

function validateOrderRequest(req: any): ReeceOrderRequest | { error: string } {
  if (!req || typeof req !== 'object') return { error: 'Missing order body' };
  if (!isNonEmptyString(req.orderByName)) return { error: 'orderByName is required' };
  if (!isNonEmptyString(req.requiredByDateTime)) return { error: 'requiredByDateTime is required' };
  if (!Array.isArray(req.products) || req.products.length === 0) {
    return { error: 'At least one product is required' };
  }
  if (!req.fulfillment || (req.fulfillment.type !== 'PICKUP' && req.fulfillment.type !== 'DELIVERY')) {
    return { error: 'fulfillment.type must be PICKUP or DELIVERY' };
  }
  if (req.fulfillment.type === 'PICKUP' && !isNonEmptyString(req.fulfillment.pickupBranch)) {
    return { error: 'fulfillment.pickupBranch is required for PICKUP' };
  }
  if (req.fulfillment.type === 'DELIVERY') {
    const dd = req.fulfillment.deliveryDetails;
    if (!dd || !isNonEmptyString(dd.contactName)) {
      return { error: 'deliveryDetails.contactName is required for DELIVERY' };
    }
    if (!dd.deliveryAddress || !isNonEmptyString(dd.deliveryAddress.addressLine1)) {
      return { error: 'deliveryAddress.addressLine1 is required for DELIVERY' };
    }
    if (!isNonEmptyString(dd.deliveryAddress.postCode)) {
      return { error: 'deliveryAddress.postCode is required for DELIVERY' };
    }
  }
  for (const p of req.products) {
    if (!Number.isFinite(p.productId) || p.productId <= 0) return { error: 'product.productId is required' };
    if (!Number.isFinite(p.quantity) || p.quantity <= 0) return { error: 'product.quantity must be > 0' };
    if (!isNonEmptyString(p.unitOfMeasure)) return { error: 'product.unitOfMeasure is required' };
    if (!Number.isFinite(p.unitPriceExcludingGst) || p.unitPriceExcludingGst < 0) {
      return { error: 'product.unitPriceExcludingGst is required' };
    }
  }
  return req as ReeceOrderRequest;
}

/**
 * Preview a Reece order — returns the line items + total + cartage with no
 * side effects. The order modal calls this on open and again whenever the
 * user changes branch / delivery so the totals stay live.
 */
export const reeceOrderPreview = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const validated = validateOrderRequest(req.body);
    if ('error' in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const { status, body, error } = await callReeceOrderEndpoint(decodedToken.uid, 'preview', validated);
    if (error) {
      res.status(200).json({ preview: null, error });
      return;
    }
    if (status >= 400) {
      // Reece's 4xx envelope is { violations: [{fieldName, message}] } or
      // { errors: [{url, message}] }. Forward verbatim so the client can
      // render specific field-level feedback in the order modal.
      res.status(200).json({ preview: null, status, ...body });
      return;
    }
    res.status(200).json({ preview: body });
  });
});

/**
 * Run Reece's order /check on the same payload as preview. Used as a final
 * gate inside reeceOrderPlace before actually creating the order.
 */
export const reeceOrderCheck = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const validated = validateOrderRequest(req.body);
    if ('error' in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const { status, body, error } = await callReeceOrderEndpoint(decodedToken.uid, 'check', validated);
    if (error) {
      res.status(200).json({ check: null, error });
      return;
    }
    if (status >= 400) {
      res.status(200).json({ check: null, status, ...body });
      return;
    }
    res.status(200).json({ check: body });
  });
});

/**
 * Place a Reece order against the user's trade account.
 *
 * Sequence:
 *   1. Validate the request body shape.
 *   2. Run /check first (as a stock + entitlement gate). Bail on any
 *      violation rather than placing a half-broken order — Reece can't
 *      easily undo on their side and we don't want to email plumbers to
 *      cancel a shipment.
 *   3. POST to /orders. On success, append a ReeceOrder snapshot to the
 *      originating quote so the user can see history.
 *
 * Side effects: Firestore write to quotes/{quoteId}.reeceOrders. Reece
 * processes the order on their side.
 */
export const reeceOrderPlace = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { quoteId, ...orderBody } = req.body || {};

    const validated = validateOrderRequest(orderBody);
    if ('error' in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }

    // Step 1: /check (stock + entitlement gate)
    const checkResult = await callReeceOrderEndpoint(decodedToken.uid, 'check', validated);
    if (checkResult.error) {
      res.status(200).json({ order: null, error: checkResult.error });
      return;
    }
    if (checkResult.status >= 400) {
      res.status(200).json({ order: null, stage: 'check', status: checkResult.status, ...checkResult.body });
      return;
    }

    // Step 2: place the order
    const placeResult = await callReeceOrderEndpoint(decodedToken.uid, 'orders', validated);
    if (placeResult.error) {
      res.status(200).json({ order: null, error: placeResult.error });
      return;
    }
    if (placeResult.status >= 400) {
      res.status(200).json({ order: null, stage: 'place', status: placeResult.status, ...placeResult.body });
      return;
    }

    const placed = placeResult.body;
    const reeceOrderNumber = String(placed?.orderNumber || placed?.id || '');

    // Step 3: append the order to the originating quote (best-effort — we
    // already placed the order at Reece, so a Firestore failure here is a
    // user-visible "order placed but history didn't save" rather than a
    // hard failure. Log and continue.
    if (quoteId && isNonEmptyString(quoteId) && reeceOrderNumber) {
      try {
        const totalIncGst = Number(placed?.totalIncludingGst ?? placed?.total ?? 0);
        const totalExGst = Number(placed?.totalExcludingGst ?? 0);
        const cartageFee = Number(placed?.cartageFee ?? 0);
        const orderRecord = {
          reeceOrderNumber,
          placedAt: new Date().toISOString(),
          itemCount: validated.products.length,
          totalIncGst,
          totalExGst,
          cartageFee,
          fulfilmentMode: validated.fulfillment.type,
          branchNumber: validated.fulfillment.pickupBranch || null,
          branchName: placed?.fulfillment?.pickupBranchName || null,
          deliveryAddress: validated.fulfillment.deliveryDetails
            ? [
                validated.fulfillment.deliveryDetails.deliveryAddress.addressLine1,
                validated.fulfillment.deliveryDetails.deliveryAddress.suburb,
                validated.fulfillment.deliveryDetails.deliveryAddress.state,
                validated.fulfillment.deliveryDetails.deliveryAddress.postCode,
              ].filter(Boolean).join(', ')
            : null,
          reference: validated.orderNumber || null,
        };
        await admin.firestore()
          .doc(`users/${decodedToken.uid}/quotes/${quoteId}`)
          .update({
            reeceOrders: admin.firestore.FieldValue.arrayUnion(orderRecord),
          });
      } catch (err: any) {
        console.error('[reece] failed to record order on quote', {
          uid: decodedToken.uid,
          quoteId,
          reeceOrderNumber,
          message: err?.message,
        });
        // Fall through — the order is already placed at Reece.
      }
    }

    res.status(200).json({
      order: {
        reeceOrderNumber,
        raw: placed,
      },
    });
  });
});

/**
 * Fetch HTML from hardware store search URL
 * Used as CORS proxy for web platform with anti-scraping bypass
 */
export const fetchStoreHTML = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { url } = req.body;

      if (!isNonEmptyString(url) || !isValidUrl(url)) {
        res.status(400).json({ error: 'Missing or invalid url' });
        return;
      }

      // Only allow fetching from known hardware store domains
      const allowedDomains = ['bunnings.com.au', 'totaltools.com.au', 'sydneytools.com.au', 'tradetools.com'];
      const parsedUrl = new URL(url);
      if (!allowedDomains.some(d => parsedUrl.hostname.endsWith(d))) {
        res.status(400).json({ error: 'URL domain not allowed' });
        return;
      }


      // Option 1: Try with ScraperAPI if configured (most reliable)
      const scraperApiKey = process.env.SCRAPERAPI_KEY;

      if (scraperApiKey) {
        try {
          const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&country_code=au&render=true`;
          const scraperResponse = await fetch(scraperUrl);

          if (scraperResponse.ok) {
            const html = await scraperResponse.text();
            res.status(200).json({ html, method: 'scraperapi' });
            return;
          }
        } catch (scraperError) {
        }
      }

      // Option 2: Enhanced direct fetch with realistic browser fingerprinting

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-AU,en-US;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'DNT': '1',
        },
      });

      if (!response.ok) {
        res.status(response.status).json({
          error: `Failed to fetch: ${response.statusText}`,
          method: 'direct',
        });
        return;
      }

      const html = await response.text();
      res.status(200).json({ html, method: 'direct' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Clean up transcribed text and generate job title
 * Used for voice-to-text feature on web platform
 */
export const cleanupTranscription = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { transcribedText, pillSpec } = req.body;

      if (!isNonEmptyString(transcribedText)) {
        res.status(400).json({ error: 'Missing or invalid transcribedText' });
        return;
      }
      if (transcribedText.length > 50000) {
        res.status(400).json({ error: 'transcribedText exceeds maximum length' });
        return;
      }

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
      }

      // Validate optional pillSpec — array of {id, label} pairs.
      const validPillSpec: { id: string; label: string }[] = Array.isArray(pillSpec)
        ? pillSpec
            .filter((p: any) => p && isNonEmptyString(p.id) && isNonEmptyString(p.label))
            .slice(0, 30)
        : [];

      let pillSection = '';
      let pillJsonField = '';
      if (validPillSpec.length > 0) {
        const pillList = validPillSpec.map((p, i) => `${i + 1}. id="${p.id}" — ${p.label}`).join('\n');
        pillSection = `

The tradie's checklist for this job type:
${pillList}

For each checklist item, decide whether the transcript supports it being part of THIS job. Mark true ONLY if the transcript clearly mentions the item or scope. Mark false if the tradie excludes it ("no oven", "skip windows", "not the bathroom") or doesn't mention it. Return one entry per checklist id.`;
        pillJsonField = ',\n  "pills": { "id_1": true, "id_2": false }';
      }

      const prompt = `You are a helpful assistant for Australian tradies. Clean up the following voice-transcribed job description and generate a concise job title. The cleaned description will appear on an invoice sent to the customer, so it must read professionally. Do NOT add any details, claims, or information that are not present in the original text.

Transcribed Text: "${transcribedText}"

Tasks:
1. Fix transcription errors, slang, filler words ("yeah", "so", "like", "reckon"), and unclear phrases
2. Preserve EVERY detail from the original — measurements, materials, locations, conditions, causes, customer remarks. Do NOT shorten, summarise, omit, or merge details. If the input is long, the cleaned output should be similarly long. Your job is grammar, readability, and structure — not compression.
3. Format for readability on an invoice:
   - Use short paragraphs separated by blank lines for distinct phases or topics (e.g. existing condition, scope of work, materials, finish).
   - Where the work has a list of discrete items (multiple tasks, materials, or fixtures), use a bullet list with "- " at the start of each line.
   - Keep sentences plain and factual.
4. Do not invent details, do not add warranties, claims, or assurances that were not in the original.
5. Generate a short, professional job title (3-7 words)${pillSection}

Provide a JSON response with this structure:
{
  "cleanedDescription": "The cleaned and formatted description (use \\n for line breaks and \\n\\n between paragraphs)",
  "suggestedTitle": "Short Job Title"${pillJsonField}
}

Return ONLY valid JSON, no other text.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const content = data.content[0].text;

      // Parse the JSON response
      let jsonStr = content.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      // Coerce pills response to {[id]: bool} only if pillSpec was provided.
      let pills: Record<string, boolean> | undefined;
      if (validPillSpec.length > 0 && parsed.pills && typeof parsed.pills === 'object' && !Array.isArray(parsed.pills)) {
        pills = {};
        const allowedIds = new Set(validPillSpec.map((p) => p.id));
        for (const [k, v] of Object.entries(parsed.pills)) {
          if (allowedIds.has(k)) pills[k] = !!v;
        }
      }

      res.status(200).json({
        cleanedDescription: parsed.cleanedDescription || transcribedText,
        suggestedTitle: parsed.suggestedTitle || '',
        ...(pills ? { pills } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Parse hardware store search results using Claude AI
 * Used as proxy for web platform to avoid CORS and API key exposure
 */
export const parseProductsHTML = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { html, searchTerm, store, requestedQuantity, requestedUnit } = req.body;

      if (!isNonEmptyString(html) || !isNonEmptyString(searchTerm) || !isNonEmptyString(store)) {
        res.status(400).json({ error: 'Missing required parameters: html, searchTerm, store' });
        return;
      }
      if (html.length > 500000) {
        res.status(400).json({ error: 'html exceeds maximum size (500KB)' });
        return;
      }

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
      }

      const prompt = `You are an expert at parsing Australian hardware store websites and matching products.

**Search Details:**
- Store: ${store}
- Search term: "${searchTerm}"
- Requested quantity: ${requestedQuantity} ${requestedUnit}

**Task:**
1. Parse the HTML search results below
2. Find the 2-3 BEST matching products for the search term
3. Extract: product name, price (inc GST), dimensions, item number, stock level
4. Determine if quantity adjustment is needed (e.g., timber sold in fixed lengths)
5. Rank by relevance: prefer exact matches, then similar products, then alternatives

**Important Guidelines:**
- Prices MUST be in AUD and include GST (Australian stores display inc-GST prices)
- For length-based materials (timber, piping): check if sold in fixed lengths vs. cut-to-length
- If sold in fixed lengths and quantity doesn't match, calculate how many pieces needed
- Example: Need 3m, sold in 2.4m lengths → buy 2 pieces (2 × 2.4m = 4.8m ≥ 3m)
- Confidence scoring:
  - HIGH: Exact product match with correct dimensions
  - MEDIUM: Similar product, might need verification
  - LOW: Alternative product, different brand/spec

**HTML Content:**
${html.substring(0, 50000)} ${html.length > 50000 ? '... (truncated)' : ''}

**Return ONLY valid JSON (no markdown, no explanations):**
\`\`\`json
{
  "matches": [
    {
      "productName": "Product name as shown on store",
      "description": "Brief description from listing",
      "price": 12.50,
      "pricePerUnit": "$12.50 / metre" (if shown),
      "unit": "each|m|L|kg|pack|box",
      "dimensions": "2.4m length" or "90x45mm" (if applicable),
      "itemNumber": "123456",
      "brand": "Brand name",
      "stockLevel": "in-stock|low-stock|out-of-stock|unknown",
      "productUrl": "Full product page URL (MUST be null if not found in HTML - DO NOT use example.com or any placeholder)",
      "confidence": "high|medium|low"
    }
  ],
  "quantityAdjustment": {
    "originalQuantity": ${requestedQuantity},
    "adjustedQuantity": 2,
    "reason": "Need ${requestedQuantity}${requestedUnit} but sold in 2.4m lengths, buying 2 pieces (4.8m total)"
  } (ONLY if adjustment needed, otherwise omit)
}
\`\`\`

If no products found, return: {"matches": [], "quantityAdjustment": null}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const content = data.content[0];

      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      res.status(200).json({ parsed: content.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Select the best matching product from alternatives using Claude AI
 * Used by OpenAI Web Search pricing to intelligently pick the correct product
 */
export const selectBestProduct = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { products, requestedProductName, originalSearchTerm } = req.body;

      if (!products || !Array.isArray(products) || products.length === 0) {
        res.status(400).json({ error: 'Products array is required' });
        return;
      }

      if (products.length === 1) {
        res.status(200).json({
          selectedIndex: 1,
          reasoning: 'Only one product found'
        });
        return;
      }

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(200).json({
          selectedIndex: 1,
          reasoning: 'No AI selection available - using first product'
        });
        return;
      }


      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: `You are an expert at matching products for Australian hardware stores.

USER REQUESTED: "${requestedProductName}"
ORIGINAL SEARCH TERM: "${originalSearchTerm || requestedProductName}"

FOUND PRODUCTS:
${products.map((p: any, i: number) => `
${i + 1}. ${p.productName}
   - Brand: ${p.brand || 'Unknown'}
   - Price: $${p.price}
   - Description: ${p.description || 'N/A'}
   - Item #: ${p.itemNumber || 'N/A'}
   - Store: ${p.store}
`).join('\n')}

Select the BEST matching product based on:
1. Brand similarity (exact brand match is best)
2. Product type/category match (e.g., "flexible connector" vs "rubber collar")
3. Size/specifications match (e.g., "100mm" vs "100mm")
4. Price reasonableness (extremely cheap items may be wrong category)
5. Product description similarity

Return ONLY valid JSON (no markdown):
{
  "selectedIndex": 1,
  "reasoning": "Brief explanation of why this product is the best match"
}

The selectedIndex should be 1-based (first product is 1, second is 2, etc.).`,
            },
          ],
        }),
      });

      if (!response.ok) {
        await response.text();
        res.status(200).json({
          selectedIndex: 1,
          reasoning: 'Claude API error - using first product'
        });
        return;
      }

      const data: any = await response.json();
      const content = data.content?.[0]?.text || '';

      // Parse JSON from response
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const selection = JSON.parse(jsonStr);
      const selectedIndex = selection.selectedIndex || 1;
      const reasoning = selection.reasoning || 'Selected by AI';


      res.status(200).json({
        selectedIndex,
        reasoning
      });
    } catch (error: any) {
      res.status(200).json({
        selectedIndex: 1,
        reasoning: 'Error during selection - using first product'
      });
    }
  });
});

// ============================================================
// QUOTE ACCEPTANCE VIA EMAIL LINK
// ============================================================

import * as crypto from 'crypto';

// Token expiration: 30 days in milliseconds
const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Normalise any Firestore-shaped timestamp value into a JS Date.
 * Handles: Firestore Timestamp, {_seconds, _nanoseconds}, {seconds, nanoseconds},
 * ISO string, number, Date, null/undefined. Returns null for missing/invalid
 * input — callers MUST treat that as "no expiry anchor available" and handle
 * accordingly rather than falling into `new Date(null)` (which is 1970 and
 * would make every link appear expired).
 */
function normaliseTimestamp(value: any): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch { /* fall through */ }
  }
  if (typeof value === 'object') {
    const seconds = typeof value.seconds === 'number' ? value.seconds
                  : typeof value._seconds === 'number' ? value._seconds
                  : null;
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds
                : typeof value._nanoseconds === 'number' ? value._nanoseconds
                : 0;
    if (seconds !== null) return new Date(seconds * 1000 + nanos / 1e6);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Resolve the best available timestamp to anchor the acceptance-token expiry
 * check against. Prefers the quote's acceptanceTokenCreatedAt, falls back to
 * the token doc's createdAt (which is stamped server-side on every mint and
 * is the source of truth if the quote's field got clobbered by a stale
 * client-side ISO string), then to the quote's createdAt as a last resort.
 * Returns null only if nothing usable exists — callers should then skip the
 * expiry check rather than expire the link spuriously.
 */
function resolveTokenCreatedAt(
  foundQuote: any,
  tokenData?: any,
): Date | null {
  return (
    normaliseTimestamp(foundQuote?.acceptanceTokenCreatedAt) ||
    normaliseTimestamp(tokenData?.createdAt) ||
    normaliseTimestamp(foundQuote?.createdAt) ||
    null
  );
}

/**
 * Generate a secure acceptance token for a quote
 * Creates a 256-bit random token, stores it on the quote, returns the acceptance URL
 */
export const generateQuoteAcceptanceLink = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;
    const userId = decodedToken.uid;

    try {
      const { quoteId } = req.body;

      if (!isNonEmptyString(quoteId)) {
        res.status(400).json({ success: false, error: 'Missing or invalid quoteId' });
        return;
      }


      const db = admin.firestore();
      const quoteRef = db.collection('users').doc(userId).collection('quotes').doc(quoteId);
      const quoteDoc = await quoteRef.get();

      if (!quoteDoc.exists) {
        res.status(404).json({ success: false, error: 'Quote not found' });
        return;
      }

      // Generate a 256-bit (32 byte) secure random token
      const token = crypto.randomBytes(32).toString('hex'); // 64 characters
      const tokenHash = hashToken(token);

      // Store the hashed token and metadata on the quote
      await quoteRef.update({
        acceptanceTokenHash: tokenHash,
        acceptanceTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Store hashed token in dedicated collection for O(1) lookup
      await db.collection('quoteAcceptanceTokens').doc(tokenHash).set({
        userId,
        quoteId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Build the acceptance URL
      const acceptanceUrl = `https://us-central1-hansendev.cloudfunctions.net/quoteAcceptancePage?token=${token}`;


      res.status(200).json({
        success: true,
        acceptanceUrl,
        token,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * Fetch photos from URLs and return as base64 attachments for email
 */
async function fetchPhotoAttachments(
  photoUrls: string[]
): Promise<Array<{ name: string; content: string }>> {
  const attachments: Array<{ name: string; content: string }> = [];

  // Only fetch remote URLs — legacy quotes may carry local file:// URIs
  const remoteUrls = photoUrls.filter((url) => /^https?:\/\//i.test(url));

  const results = await Promise.allSettled(
    remoteUrls.map(async (url, index) => {
      const response = await fetch(url);
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const buffer = await response.buffer();
      return {
        name: `Job_Photo_${index + 1}.${ext}`,
        content: buffer.toString('base64'),
      };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      attachments.push(result.value);
    }
  }

  return attachments;
}

/**
 * Send a quote to a client via Brevo email.
 *
 * Phase-2 shim: loads the unified Document (falling back to the legacy quote
 * via the shared adapter) and delegates to the unified sendDocumentEmail
 * core. Keeps the same endpoint name + response shape so old clients keep
 * working unchanged.
 */
export const sendQuoteEmail = functions.runWith({ timeoutSeconds: 120, memory: '1GB' }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.standard);
    if (!decodedToken) return;

    const userId = decodedToken.uid;
    const { quoteId, quote: quoteFromClient, emailBody, recipientEmail, isTestSend, includePhotos } = req.body;

    if (!quoteId || !emailBody || !recipientEmail) {
      res.status(400).json({ error: 'Missing required fields: quoteId, emailBody, recipientEmail' });
      return;
    }

    logShimInvocation('sendQuoteEmail', userId, { quoteId });

    try {
      let doc = await loadDocumentForQuoteId(userId, quoteId);
      if (!doc && quoteFromClient && typeof quoteFromClient === 'object') {
        // Old client passed the quote inline and the mirror hasn't fired yet.
        // Build the unified shape ad-hoc so the unified core has something to work with.
        doc = quoteRecordToDocumentRecord(quoteFromClient, quoteId);
      }
      if (!doc) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      const result = await sendDocumentEmail(doc, {
        userId,
        docId: quoteId,
        emailBody,
        recipientEmail,
        isTestSend,
        includePhotos,
        overrides: quoteFromClient && typeof quoteFromClient === 'object' ? quoteFromClient : undefined,
        squareDepositLinkMint: async (uid, qid) => {
          const r = await mintAndRotate(uid, qid, 'deposit');
          return r ? { paymentLinkUrl: r.paymentLinkUrl } : null;
        },
        squareInvoiceLinkMint: async (uid, iid) => {
          const r = await mintAndRotate(uid, iid, 'invoice');
          return r ? { paymentLinkId: r.paymentLinkId, paymentLinkUrl: r.paymentLinkUrl } : null;
        },
        acceptanceUrlForToken: (token) =>
          `https://us-central1-hansendev.cloudfunctions.net/quoteAcceptancePage?token=${token}`,
        fetchPhotoAttachments,
        generateAcceptanceToken: () => {
          const token = crypto.randomBytes(32).toString('hex');
          return { token, hashedToken: hashToken(token) };
        },
      });

      if (!result.success) {
        res.status(500).json({ error: 'Failed to send email' });
        return;
      }

      res.json({ success: true, acceptanceUrl: result.acceptanceUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Send an invoice to a customer via Brevo email with PDF attachment.
 *
 * Phase-2 shim: loads the unified Document for this invoice and delegates to
 * the unified sendDocumentEmail core. Same endpoint name + response shape so
 * old clients keep working unchanged.
 */
export const sendInvoiceEmail = functions.runWith({ timeoutSeconds: 120, memory: '1GB' }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.standard);
    if (!decodedToken) return;

    const userId = decodedToken.uid;
    const { invoiceId, invoice: invoiceFromClient, emailBody, recipientEmail, isTestSend, includePhotos } = req.body;

    if (!invoiceId || !emailBody || !recipientEmail) {
      res.status(400).json({ error: 'Missing required fields: invoiceId, emailBody, recipientEmail' });
      return;
    }

    logShimInvocation('sendInvoiceEmail', userId, { invoiceId });

    try {
      let doc = await loadDocumentForInvoiceId(userId, invoiceId);
      if (!doc && invoiceFromClient && typeof invoiceFromClient === 'object') {
        doc = invoiceRecordToDocumentRecord(invoiceFromClient, invoiceId);
      }
      if (!doc) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      const result = await sendDocumentEmail(doc, {
        userId,
        docId: doc.id,
        emailBody,
        recipientEmail,
        isTestSend,
        includePhotos,
        overrides: invoiceFromClient && typeof invoiceFromClient === 'object' ? invoiceFromClient : undefined,
        squareInvoiceLinkMint: async (uid, iid) => {
          const r = await mintAndRotate(uid, iid, 'invoice');
          return r ? { paymentLinkId: r.paymentLinkId, paymentLinkUrl: r.paymentLinkUrl } : null;
        },
        fetchPhotoAttachments,
      });

      if (!result.success) {
        res.status(500).json({ error: 'Failed to send email' });
        return;
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Generate AI email body for a quote (web platform)
 */
export const generateQuoteEmail = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ error: 'Missing prompt' });
      return;
    }

    try {
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) {
        res.status(500).json({ error: 'API key not configured' });
        return;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API returned ${response.status}`);
      }

      const data = await response.json() as any;
      const emailBody = data.content?.[0]?.text || '';

      res.json({ emailBody });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Get quote data for the acceptance web page
 * Looks up quote by token, validates expiration, returns public quote data
 */
export const getQuoteForAcceptance = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    if (!(await checkRateLimit(`ip:${getClientIp(req)}`, RATE_LIMITS.public, res))) return;

    try {
      const { token } = req.body;

      if (!isNonEmptyString(token) || token.length > 200) {
        res.status(400).json({ success: false, error: 'Missing or invalid token' });
        return;
      }


      const db = admin.firestore();
      let foundQuote: any = null;
      let businessSettings: any = null;
      let quoteRef: FirebaseFirestore.DocumentReference | null = null;
      let tokenDataForExpiry: any = null;
      const tokenHash = hashToken(token);

      // O(1) lookup via dedicated tokens collection (hashed)
      let tokenDoc = await db.collection('quoteAcceptanceTokens').doc(tokenHash).get();

      // Fallback: try unhashed doc ID for tokens created before hashing migration
      if (!tokenDoc.exists) {
        tokenDoc = await db.collection('quoteAcceptanceTokens').doc(token).get();
      }

      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data()!;
        tokenDataForExpiry = tokenData;
        const quoteDoc = await db.collection('users').doc(tokenData.userId)
          .collection('quotes').doc(tokenData.quoteId).get();

        if (quoteDoc.exists) {
          foundQuote = quoteDoc.data();
          quoteRef = quoteDoc.ref;

          const settingsDoc = await db.collection('users').doc(tokenData.userId)
            .collection('settings').doc('business').get();
          if (settingsDoc.exists) {
            businessSettings = settingsDoc.data();
          }

          // Migrate unhashed token to hashed if needed
          if (tokenDoc.id === token && tokenDoc.id !== tokenHash) {
            await db.collection('quoteAcceptanceTokens').doc(tokenHash).set(tokenData);
            await db.collection('quoteAcceptanceTokens').doc(token).delete();
          }
        }
      } else {
        // Fallback: legacy scan for tokens created before the token collection
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
          // Try hashed field first, then legacy unhashed field
          let quotesSnapshot = await userDoc.ref
            .collection('quotes')
            .where('acceptanceTokenHash', '==', tokenHash)
            .limit(1)
            .get();

          if (quotesSnapshot.empty) {
            quotesSnapshot = await userDoc.ref
              .collection('quotes')
              .where('acceptanceToken', '==', token)
              .limit(1)
              .get();
          }

          if (!quotesSnapshot.empty) {
            foundQuote = quotesSnapshot.docs[0].data();
            quoteRef = quotesSnapshot.docs[0].ref;

            // Migrate to hashed token collection for future lookups
            await db.collection('quoteAcceptanceTokens').doc(tokenHash).set({
              userId: userDoc.id,
              quoteId: quotesSnapshot.docs[0].id,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const settingsDoc = await userDoc.ref.collection('settings').doc('business').get();
            if (settingsDoc.exists) {
              businessSettings = settingsDoc.data();
            }
            break;
          }
        }
      }

      if (!foundQuote) {
        res.status(404).json({ success: false, error: 'Quote not found or link is invalid' });
        return;
      }

      // Check if token has expired (30 days). Fall back to the token doc's
      // server-stamped createdAt if the quote's acceptanceTokenCreatedAt was
      // clobbered by a stale client-side ISO string. If nothing resolves, skip
      // the expiry check rather than letting `new Date(null)` = 1970 make
      // every link look expired.
      const tokenCreatedAt = resolveTokenCreatedAt(foundQuote, tokenDataForExpiry);
      if (tokenCreatedAt && Date.now() - tokenCreatedAt.getTime() > TOKEN_EXPIRATION_MS) {
        res.status(410).json({ success: false, error: 'This link has expired. Please request a new quote.' });
        return;
      }

      // Check if already responded
      if (foundQuote.respondedAt) {
        res.status(200).json({
          success: true,
          alreadyResponded: true,
          status: foundQuote.status,
          respondedAt: foundQuote.respondedAt,
        });
        return;
      }

      // Record that the customer viewed the quote (triggers onQuoteViewed notification).
      // Also increment viewCount + stamp firstViewedAt the first time for admin visibility.
      if (quoteRef) {
        const viewUpdate: any = {
          lastViewedAt: admin.firestore.FieldValue.serverTimestamp(),
          viewCount: admin.firestore.FieldValue.increment(1),
        };
        if (!foundQuote.firstViewedAt) {
          viewUpdate.firstViewedAt = admin.firestore.FieldValue.serverTimestamp();
        }
        await quoteRef.update(viewUpdate);
      }

      // Return quote data for the acceptance page (excluding sensitive fields)
      const photoUrls = (foundQuote.photos || [])
        .map((p: any) => p.storageUrl)
        .filter(Boolean);

      // When markup is hidden, roll it into materials AND labor for the
      // customer view so the visible lines reconcile to the final total.
      const display = applyHideMarkupForDisplay(foundQuote);

      res.status(200).json({
        success: true,
        quote: {
          id: foundQuote.id,
          quoteNumber: foundQuote.quoteNumber,
          customerName: foundQuote.customerName,
          jobName: foundQuote.job?.name,
          jobDescription: foundQuote.job?.description,
          materials: display.materials.map((m: any) => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            totalPrice: m.totalPrice || 0,
          })),
          laborTotal: display.laborTotal,
          materialsSubtotal: display.materialsSubtotal,
          subtotal: display.subtotal,
          markupAmount: display.markupAmount,
          travelAdjustmentAmount: foundQuote.travelAdjustmentAmount || 0,
          gst: foundQuote.gst,
          total: foundQuote.total,
          notes: foundQuote.notes,
          createdAt: foundQuote.createdAt,
          aiEmailBody: foundQuote.aiEmailBody || null,
          photoUrls: photoUrls,
        },
        business: {
          name: businessSettings?.businessName || 'Your Trade Business',
          email: businessSettings?.email,
          phone: businessSettings?.phone,
          logoUrl: businessSettings?.logoStorageUrl || businessSettings?.logoUri || null,
          brandColor: businessSettings?.brandColor || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * Handle quote acceptance or rejection
 * Updates quote status, records response, sends notifications
 */
export const respondToQuote = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    if (!(await checkRateLimit(`ip:${getClientIp(req)}`, RATE_LIMITS.public, res))) return;

    try {
      const { token, response, clientName, clientNotes } = req.body;

      if (!isNonEmptyString(token) || token.length > 200) {
        res.status(400).json({ success: false, error: 'Missing or invalid token' });
        return;
      }

      if (response !== 'accepted' && response !== 'rejected') {
        res.status(400).json({ success: false, error: 'Response must be "accepted" or "rejected"' });
        return;
      }

      const safeClientName = typeof clientName === 'string' ? sanitizeString(clientName, 200) : undefined;
      const safeClientNotes = typeof clientNotes === 'string' ? sanitizeString(clientNotes, 2000) : undefined;


      const db = admin.firestore();
      let foundQuoteRef: admin.firestore.DocumentReference | null = null;
      let foundQuote: any = null;
      let foundUserId: string = '';
      let businessSettings: any = null;
      let tokenDataForExpiry: any = null;
      const tokenHash = hashToken(token);

      // O(1) lookup via dedicated tokens collection (hashed)
      let tokenDoc = await db.collection('quoteAcceptanceTokens').doc(tokenHash).get();

      // Fallback: try unhashed doc ID for tokens created before hashing migration
      if (!tokenDoc.exists) {
        tokenDoc = await db.collection('quoteAcceptanceTokens').doc(token).get();
      }

      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data()!;
        tokenDataForExpiry = tokenData;
        foundUserId = tokenData.userId;
        const quoteDoc = await db.collection('users').doc(tokenData.userId)
          .collection('quotes').doc(tokenData.quoteId).get();

        if (quoteDoc.exists) {
          foundQuoteRef = quoteDoc.ref;
          foundQuote = quoteDoc.data();

          const settingsDoc = await db.collection('users').doc(tokenData.userId)
            .collection('settings').doc('business').get();
          if (settingsDoc.exists) {
            businessSettings = settingsDoc.data();
          }

          // Migrate unhashed token to hashed if needed
          if (tokenDoc.id === token && tokenDoc.id !== tokenHash) {
            await db.collection('quoteAcceptanceTokens').doc(tokenHash).set(tokenData);
            await db.collection('quoteAcceptanceTokens').doc(token).delete();
          }
        }
      } else {
        // Fallback: legacy scan for tokens created before the token collection
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
          let quotesSnapshot = await userDoc.ref
            .collection('quotes')
            .where('acceptanceTokenHash', '==', tokenHash)
            .limit(1)
            .get();

          if (quotesSnapshot.empty) {
            quotesSnapshot = await userDoc.ref
              .collection('quotes')
              .where('acceptanceToken', '==', token)
              .limit(1)
              .get();
          }

          if (!quotesSnapshot.empty) {
            foundQuoteRef = quotesSnapshot.docs[0].ref;
            foundQuote = quotesSnapshot.docs[0].data();
            foundUserId = userDoc.id;

            // Migrate to hashed token collection
            await db.collection('quoteAcceptanceTokens').doc(tokenHash).set({
              userId: userDoc.id,
              quoteId: quotesSnapshot.docs[0].id,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const settingsDoc = await userDoc.ref.collection('settings').doc('business').get();
            if (settingsDoc.exists) {
              businessSettings = settingsDoc.data();
            }
            break;
          }
        }
      }

      if (!foundQuoteRef || !foundQuote) {
        res.status(404).json({ success: false, error: 'Quote not found' });
        return;
      }

      // Check if already responded
      if (foundQuote.respondedAt) {
        res.status(400).json({ success: false, error: 'This quote has already been responded to' });
        return;
      }

      // Check token expiration. Fall back to token doc's createdAt if the
      // quote's acceptanceTokenCreatedAt was clobbered by a stale client
      // ISO string; skip the check entirely if nothing usable resolves so
      // `new Date(null)` = 1970 can't spuriously expire every link.
      const tokenCreatedAt = resolveTokenCreatedAt(foundQuote, tokenDataForExpiry);
      if (tokenCreatedAt && Date.now() - tokenCreatedAt.getTime() > TOKEN_EXPIRATION_MS) {
        res.status(410).json({ success: false, error: 'This link has expired' });
        return;
      }

      // Update the quote
      await foundQuoteRef.update({
        status: response,
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        respondedBy: safeClientName || foundQuote.customerName || 'Client',
        clientNotes: safeClientNotes || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });


      // Send email notification to business owner
      if (businessSettings?.email) {
        try {
          const quoteNumber = foundQuote.quoteNumber || foundQuote.id;
          const total = foundQuote.total || 0;

          if (response === 'accepted') {
            await sendQuoteAcceptedEmail(
              businessSettings.email,
              foundQuote.customerName,
              quoteNumber,
              total,
              safeClientNotes || null,
              foundUserId
            );
          } else {
            await sendQuoteDeclinedEmail(
              businessSettings.email,
              foundQuote.customerName,
              quoteNumber,
              total,
              safeClientNotes || null,
              foundUserId
            );
          }
        } catch (emailError: any) {
          // Don't fail the request if email fails
        }
      }

      // Send push notification via FCM
      try {
        const fcmTokensSnapshot = await db
          .collection('users')
          .doc(foundUserId)
          .collection('fcmTokens')
          .get();

        if (!fcmTokensSnapshot.empty) {
          const tokens = fcmTokensSnapshot.docs.map(doc => doc.data().token);
          const aussieEvent: AussieEvent = response === 'accepted' ? 'quote_accepted' : 'quote_rejected';
          const aussieMsg = getAussieMessage(aussieEvent, {
            customer: foundQuote.customerName,
            job: foundQuote.job?.name || 'the job',
          });

          const message = {
            notification: {
              title: aussieMsg.title,
              body: aussieMsg.body,
            },
            data: {
              quoteId: foundQuote.id,
              type: 'quote_response',
              response: response,
            },
            tokens: tokens,
          };

          await admin.messaging().sendEachForMulticast(message);
        }
      } catch (fcmError: any) {
        // Don't fail the request if push fails
      }

      res.status(200).json({
        success: true,
        message: response === 'accepted'
          ? 'Thank you! The quote has been accepted. The business will be in touch soon.'
          : 'The quote has been declined. The business has been notified.',
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * Serve the quote acceptance/response page
 * When action=accept or action=decline is provided, processes the response server-side
 * and shows a simple confirmation page. Otherwise shows the full review page.
 */
export const quoteAcceptancePage = functions.https.onRequest(async (req, res) => {
  if (!(await checkRateLimit(`ip:${getClientIp(req)}`, RATE_LIMITS.public, res))) return;

  const token = req.query.token as string;
  const action = req.query.action as string;

  if (!token || typeof token !== 'string' || token.length > 200) {
    res.status(400).send(generateErrorPage('Invalid Token', 'The quote token provided is missing or invalid.'));
    return;
  }

  // If no action specified, show the full review page (fallback)
  if (!action || (action !== 'accept' && action !== 'decline')) {
    res.status(200).send(generateAcceptancePage(token));
    return;
  }

  // Process the response server-side and show confirmation
  try {
    const db = admin.firestore();
    const responseType = action === 'accept' ? 'accepted' : 'rejected';
    const tokenHash = hashToken(token);

    // Look up the token
    let tokenDoc = await db.collection('quoteAcceptanceTokens').doc(tokenHash).get();
    if (!tokenDoc.exists) {
      tokenDoc = await db.collection('quoteAcceptanceTokens').doc(token).get();
    }

    if (!tokenDoc.exists) {
      res.status(200).send(generateConfirmationPage('error', 'Quote not found. The link may have expired.'));
      return;
    }

    const tokenData = tokenDoc.data()!;
    const quoteDoc = await db.collection('users').doc(tokenData.userId)
      .collection('quotes').doc(tokenData.quoteId).get();

    if (!quoteDoc.exists) {
      res.status(200).send(generateConfirmationPage('error', 'Quote not found.'));
      return;
    }

    const foundQuote = quoteDoc.data()!;
    const foundUserId = tokenData.userId;

    // Get business settings for branding
    const settingsDoc = await db.collection('users').doc(foundUserId)
      .collection('settings').doc('business').get();
    const businessSettings = settingsDoc.exists ? settingsDoc.data() : null;
    const businessName = businessSettings?.businessName || 'Your Trade Business';
    const brandColor = businessSettings?.brandColor || null;
    const logoUrl = businessSettings?.logoStorageUrl || businessSettings?.logoUri || null;

    // Check if already responded
    if (foundQuote.respondedAt) {
      res.status(200).send(generateConfirmationPage(
        'already',
        `This quote has already been ${foundQuote.status}.`,
        businessName, brandColor, logoUrl
      ));
      return;
    }

    // Check token expiration. Prefer the token doc's createdAt (always
    // server-stamped at mint time) over the quote's acceptanceTokenCreatedAt
    // field — the latter can get clobbered by a stale client ISO string and
    // reduce to `new Date(null)` = 1970, which would make every link look
    // expired. Skip the check if nothing resolves rather than false-expiring.
    const tokenCreatedAt = resolveTokenCreatedAt(foundQuote, tokenData);
    if (tokenCreatedAt && Date.now() - tokenCreatedAt.getTime() > TOKEN_EXPIRATION_MS) {
      res.status(200).send(generateConfirmationPage(
        'error',
        'This link has expired. Please contact the business directly.',
        businessName, brandColor, logoUrl
      ));
      return;
    }

    // Process the response
    await quoteDoc.ref.update({
      status: responseType,
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      respondedBy: foundQuote.customerName || 'Client',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send email notification to business owner
    if (businessSettings?.email) {
      try {
        const quoteNumber = foundQuote.quoteNumber || foundQuote.id;
        const total = foundQuote.total || 0;
        if (responseType === 'accepted') {
          await sendQuoteAcceptedEmail(businessSettings.email, foundQuote.customerName, quoteNumber, total, null, foundUserId);
        } else {
          await sendQuoteDeclinedEmail(businessSettings.email, foundQuote.customerName, quoteNumber, total, null, foundUserId);
        }
      } catch (emailError) {
      }
    }

    // Send push notification
    try {
      const fcmTokensSnapshot = await db.collection('users').doc(foundUserId).collection('fcmTokens').get();
      if (!fcmTokensSnapshot.empty) {
        const tokens = fcmTokensSnapshot.docs.map(doc => doc.data().token);
        const aussieEvent: AussieEvent = responseType === 'accepted' ? 'quote_accepted' : 'quote_rejected';
        const aussieMsg = getAussieMessage(aussieEvent, {
          customer: foundQuote.customerName,
          job: foundQuote.job?.name || 'the job',
        });
        await admin.messaging().sendEachForMulticast({
          notification: { title: aussieMsg.title, body: aussieMsg.body },
          data: { quoteId: foundQuote.id, type: 'quote_response', response: responseType },
          tokens,
        });
      }
    } catch (fcmError) {
    }

    // Show confirmation page
    if (responseType === 'accepted') {
      // If the quote has a deposit configured and the tradie has Square
      // connected, mint a hosted payment link and show a Pay Deposit button on
      // the confirmation page. Best-effort: if anything fails we still show the
      // standard "thank you" so the customer isn't blocked.
      let depositPayment: { url: string; amount: number } | null = null;
      const depositRequired = foundQuote.requireDeposit === true;
      const depositPct = depositRequired ? (Number(foundQuote.depositPercentage) || 0) : 0;
      if (depositRequired && depositPct > 0) {
        try {
          // Prefer the doc's active link; mint via the rotation path so the
          // unified ledger picks up any new link rather than going around it.
          const unifiedDoc = await loadDocumentForQuoteId(foundUserId, foundQuote.id);
          const active = unifiedDoc?.activePaymentLink as
            { id: string; url: string; kind: string; amount: number; consumedAt?: number } | undefined;
          if (active && active.kind === 'deposit' && !active.consumedAt) {
            depositPayment = { url: active.url, amount: active.amount };
          } else {
            const linkResult = await mintAndRotate(foundUserId, foundQuote.id, 'deposit');
            if (linkResult) {
              const depositAmount = Number(foundQuote.depositAmount)
                || ((Number(foundQuote.total) || 0) * (depositPct / 100));
              depositPayment = { url: linkResult.paymentLinkUrl, amount: depositAmount };
            } else {
              console.warn('[square] deposit link mint returned null on acceptance', {
                userId: foundUserId, quoteId: foundQuote.id,
              });
            }
          }
        } catch (err: any) {
          console.error('[square] deposit link mint threw on acceptance', {
            userId: foundUserId, quoteId: foundQuote.id, message: err?.message,
          });
          // Show standard thank-you instead.
        }
      }

      const acceptedMessage = depositPayment
        ? `Thank you! To lock in your spot, please pay your deposit below. ${businessName} will start work once it clears.`
        : `Thank you! ${businessName} has been notified and will be in touch soon.`;

      res.status(200).send(generateConfirmationPage(
        'accepted',
        acceptedMessage,
        businessName, brandColor, logoUrl,
        depositPayment,
      ));
    } else {
      res.status(200).send(generateConfirmationPage(
        'declined',
        `Your response has been recorded. ${businessName} has been notified.`,
        businessName, brandColor, logoUrl
      ));
    }
  } catch (error: any) {
    res.status(200).send(generateConfirmationPage('error', 'Something went wrong. Please try again later.'));
  }
});

/**
 * Generate a simple confirmation page after accepting/declining
 */
function generateConfirmationPage(
  type: 'accepted' | 'declined' | 'already' | 'error',
  message: string,
  businessName?: string,
  brandColor?: string | null,
  logoUrl?: string | null,
  depositPayment?: { url: string; amount: number } | null
): string {
  const accent = brandColor || '#f97316';
  const icon = type === 'accepted' ? '&#10003;' : type === 'declined' ? '&#10005;' : type === 'already' ? '&#8505;' : '&#9888;';
  const iconBg = type === 'accepted' ? '#22c55e' : type === 'declined' ? '#64748b' : type === 'error' ? '#ef4444' : '#f97316';
  const heading = type === 'accepted' ? 'Quote Accepted'
    : type === 'declined' ? 'Quote Declined'
    : type === 'already' ? 'Already Responded'
    : 'Something Went Wrong';

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="" style="width:64px;height:64px;border-radius:14px;object-fit:cover;margin-bottom:16px;" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border-radius: 20px;
      padding: 48px 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      border: 1px solid #334155;
    }
    .icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${iconBg};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 32px;
      color: white;
    }
    h1 {
      color: #f8fafc;
      font-size: 24px;
      margin-bottom: 12px;
    }
    .message {
      color: #94a3b8;
      font-size: 16px;
      line-height: 1.6;
    }
    .business {
      color: ${accent};
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    ${logoHtml}
    ${businessName ? `<div class="business">${businessName}</div>` : ''}
    <div class="icon">${icon}</div>
    <h1>${heading}</h1>
    <p class="message">${message}</p>
    ${
      depositPayment && type === 'accepted'
        ? `
      <div style="margin-top:28px;padding:20px;background:#0f172a;border:1px solid #334155;border-radius:14px;">
        <div style="color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Deposit due to start work</div>
        <div style="color:#f8fafc;font-size:32px;font-weight:700;margin-bottom:16px;">$${depositPayment.amount.toFixed(2)}</div>
        <a href="${depositPayment.url}" style="display:inline-block;background:${accent};color:#0f172a;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px;">Pay Deposit Securely</a>
        <div style="color:#64748b;font-size:12px;margin-top:14px;">Secured by Square. ${businessName || 'The business'} will be notified once your deposit is received.</div>
      </div>`
        : ''
    }
  </div>
</body>
</html>`;
}

/**
 * Generate the quote acceptance HTML page (fallback review page)
 */
function generateAcceptancePage(token: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Response - QuoteMate</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      min-height: 100vh;
      padding: 20px;
      color: #f8fafc;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    .card {
      background: #1e293b;
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      border: 1px solid #334155;
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo img {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      object-fit: cover;
      margin-bottom: 12px;
    }
    .logo h1 {
      font-size: 28px;
      color: var(--accent, #f97316);
      margin-bottom: 8px;
    }
    .logo p { color: #94a3b8; font-size: 14px; }
    .ai-summary {
      background: #0f172a;
      padding: 16px;
      border-radius: 8px;
      color: #cbd5e1;
      line-height: 1.7;
      font-size: 15px;
      border-left: 3px solid var(--accent, #f97316);
    }
    .photos-grid {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
    }
    .photos-grid img {
      width: 140px;
      height: 105px;
      object-fit: cover;
      border-radius: 8px;
      flex-shrink: 0;
    }
    .quote-number {
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .section {
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid #334155;
    }
    .section:last-child { border-bottom: none; }
    .section-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #94a3b8;
      margin-bottom: 12px;
    }
    .job-name { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .job-desc { color: #94a3b8; line-height: 1.6; }
    .material-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #334155;
    }
    .material-row:last-child { border-bottom: none; }
    .material-name { flex: 1; }
    .material-qty { color: #94a3b8; margin-right: 16px; }
    .material-price { font-weight: 500; color: var(--accent, #f97316); }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
    }
    .totals-row.total {
      font-size: 20px;
      font-weight: 700;
      padding-top: 16px;
      border-top: 2px solid #334155;
      margin-top: 8px;
    }
    .totals-row.total .amount { color: var(--accent, #f97316); }
    .notes {
      background: #0f172a;
      padding: 16px;
      border-radius: 8px;
      color: #94a3b8;
      line-height: 1.6;
    }
    .client-notes {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      color: #f8fafc;
      font-size: 16px;
      resize: vertical;
      min-height: 80px;
      margin-bottom: 16px;
    }
    .client-notes::placeholder { color: #64748b; }
    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .btn {
      flex: 1;
      padding: 16px 24px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-accept {
      background: #22c55e;
      color: white;
    }
    .btn-accept:hover { background: #16a34a; }
    .btn-decline {
      background: #334155;
      color: #f8fafc;
    }
    .btn-decline:hover { background: #475569; }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .loading {
      text-align: center;
      padding: 60px 20px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #334155;
      border-top-color: var(--accent, #f97316);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error {
      text-align: center;
      padding: 40px 20px;
    }
    .error-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .success {
      text-align: center;
      padding: 40px 20px;
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    .success h2 { color: #22c55e; margin-bottom: 12px; }
    .already-responded h2 { color: var(--accent, #f97316); }
    .contact-info {
      background: #0f172a;
      padding: 16px;
      border-radius: 8px;
      margin-top: 16px;
    }
    .contact-info p { margin-bottom: 8px; }
    .contact-info a { color: var(--accent, #f97316); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo"></div>

      <div id="content">
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading quote...</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    const TOKEN = '${token}';
    const API_BASE = 'https://us-central1-hansendev.cloudfunctions.net';

    function formatCurrency(amount) {
      return new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD'
      }).format(amount || 0);
    }

    async function loadQuote() {
      try {
        const response = await fetch(API_BASE + '/getQuoteForAcceptance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN })
        });

        const data = await response.json();

        if (!data.success) {
          showError(data.error || 'Failed to load quote');
          return;
        }

        if (data.alreadyResponded) {
          showAlreadyResponded(data.status);
          return;
        }

        renderQuote(data.quote, data.business);
      } catch (error) {
        showError('Failed to load quote. Please try again later.');
      }
    }

    function renderQuote(quote, business) {
      const content = document.getElementById('content');

      // Set brand color as CSS variable
      if (business.brandColor) {
        document.documentElement.style.setProperty('--accent', business.brandColor);
      }

      // Business logo
      var logoHtml = '';
      if (business.logoUrl) {
        logoHtml = '<img src="' + escapeHtml(business.logoUrl) + '" alt="' + escapeHtml(business.name) + '" />';
      }

      // Update logo section
      var logoSection = document.querySelector('.logo');
      if (logoSection) {
        logoSection.innerHTML = logoHtml +
          '<h1>' + escapeHtml(business.name) + '</h1>';
      }

      // AI summary section
      var aiSummaryHtml = '';
      if (quote.aiEmailBody) {
        aiSummaryHtml =
          '<div class="section">' +
            '<div class="section-title">Scope of Work</div>' +
            '<div class="ai-summary">' + escapeHtml(quote.aiEmailBody).replace(/\\n/g, '<br/>') + '</div>' +
          '</div>';
      }

      // Photos section — skip non-http(s) URLs (legacy local file:// URIs)
      var photosHtml = '';
      var remotePhotoUrls = (quote.photoUrls || []).filter(function(url: string) {
        return /^https?:\/\//i.test(url);
      });
      if (remotePhotoUrls.length > 0) {
        var imgs = remotePhotoUrls.map(function(url: string) {
          return '<img src="' + escapeHtml(url) + '" alt="Job photo" />';
        }).join('');
        photosHtml =
          '<div class="section">' +
            '<div class="section-title">Site Photos</div>' +
            '<div class="photos-grid">' + imgs + '</div>' +
          '</div>';
      }

      let materialsHtml = '';
      if (quote.materials && quote.materials.length > 0) {
        materialsHtml = quote.materials.map(m =>
          '<div class="material-row">' +
            '<span class="material-name">' + escapeHtml(m.name) + '</span>' +
            '<span class="material-qty">' + m.quantity + ' ' + m.unit + '</span>' +
            '<span class="material-price">' + formatCurrency(m.totalPrice) + '</span>' +
          '</div>'
        ).join('');
      }

      content.innerHTML =
        '<div class="quote-number">Quote #' + escapeHtml(quote.quoteNumber || quote.id) + '</div>' +

        aiSummaryHtml +

        '<div class="section">' +
          '<div class="section-title">Job Details</div>' +
          '<div class="job-name">' + escapeHtml(quote.jobName || 'Quote') + '</div>' +
          (quote.jobDescription ? '<div class="job-desc">' + escapeHtml(quote.jobDescription) + '</div>' : '') +
        '</div>' +

        photosHtml +

        (materialsHtml ?
          '<div class="section">' +
            '<div class="section-title">Materials</div>' +
            materialsHtml +
          '</div>' : '') +

        '<div class="section">' +
          '<div class="section-title">Summary</div>' +
          '<div class="totals-row"><span>Materials</span><span>' + formatCurrency(quote.materialsSubtotal) + '</span></div>' +
          '<div class="totals-row"><span>Labour</span><span>' + formatCurrency(quote.laborTotal) + '</span></div>' +
          ((quote.markupAmount || quote.travelAdjustmentAmount) ?
            '<div class="totals-row"><span>' + (quote.pricesIncludeGst === true ? 'Subtotal' : 'Subtotal (ex GST)') + '</span><span>' + formatCurrency(quote.subtotal + (quote.markupAmount || 0) + (quote.travelAdjustmentAmount || 0)) + '</span></div>' :
            '<div class="totals-row"><span>' + (quote.pricesIncludeGst === true ? 'Subtotal' : 'Subtotal (ex GST)') + '</span><span>' + formatCurrency(quote.subtotal) + '</span></div>') +
          '<div class="totals-row"><span>' + (quote.pricesIncludeGst === true ? 'Includes GST' : 'GST (10%)') + '</span><span>' + formatCurrency(quote.gst) + '</span></div>' +
          '<div class="totals-row total"><span>Total</span><span class="amount">' + formatCurrency(quote.total) + '</span></div>' +
        '</div>' +

        (quote.notes ?
          '<div class="section">' +
            '<div class="section-title">Notes</div>' +
            '<div class="notes">' + escapeHtml(quote.notes) + '</div>' +
          '</div>' : '') +

        '<div class="section">' +
          '<div class="section-title">Your Response</div>' +
          '<textarea id="clientNotes" class="client-notes" placeholder="Optional: Add any comments or questions..."></textarea>' +
          '<div class="buttons">' +
            '<button class="btn btn-decline" onclick="respondToQuote(\\'rejected\\')">Decline</button>' +
            '<button class="btn btn-accept" onclick="respondToQuote(\\'accepted\\')">Accept Quote</button>' +
          '</div>' +
        '</div>' +

        (business.email || business.phone ?
          '<div class="contact-info">' +
            '<div class="section-title">Questions?</div>' +
            (business.email ? '<p>Email: <a href="mailto:' + business.email + '">' + business.email + '</a></p>' : '') +
            (business.phone ? '<p>Phone: <a href="tel:' + business.phone + '">' + business.phone + '</a></p>' : '') +
          '</div>' : '');
    }

    async function respondToQuote(response) {
      const buttons = document.querySelectorAll('.btn');
      buttons.forEach(btn => btn.disabled = true);

      const clientNotes = document.getElementById('clientNotes')?.value || '';

      try {
        const resp = await fetch(API_BASE + '/respondToQuote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            response: response,
            clientNotes: clientNotes
          })
        });

        const data = await resp.json();

        if (data.success) {
          showSuccess(response);
        } else {
          showError(data.error || 'Failed to submit response');
          buttons.forEach(btn => btn.disabled = false);
        }
      } catch (error) {
        showError('Failed to submit response. Please try again.');
        buttons.forEach(btn => btn.disabled = false);
      }
    }

    function showSuccess(response) {
      const content = document.getElementById('content');
      const isAccepted = response === 'accepted';
      content.innerHTML =
        '<div class="success">' +
          '<div class="success-icon">' + (isAccepted ? '✅' : '📝') + '</div>' +
          '<h2>' + (isAccepted ? 'Quote Accepted!' : 'Response Submitted') + '</h2>' +
          '<p>' + (isAccepted
            ? 'Thank you for accepting this quote. The business has been notified and will be in touch soon.'
            : 'Your response has been recorded. The business has been notified.') + '</p>' +
        '</div>';
    }

    function showAlreadyResponded(status) {
      const content = document.getElementById('content');
      content.innerHTML =
        '<div class="success already-responded">' +
          '<div class="success-icon">📋</div>' +
          '<h2>Already Responded</h2>' +
          '<p>This quote has already been ' + status + '.</p>' +
        '</div>';
    }

    function showError(message) {
      const content = document.getElementById('content');
      content.innerHTML =
        '<div class="error">' +
          '<div class="error-icon">⚠️</div>' +
          '<h2>Something went wrong</h2>' +
          '<p>' + escapeHtml(message) + '</p>' +
        '</div>';
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    loadQuote();
  </script>
</body>
</html>
`;
}

/**
 * Generate an error page HTML
 */
// ============================================================
// EMAIL FUNCTIONS
// ============================================================

/**
 * Welcome email - triggered when a new user document is created
 */
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  const email = user.email;
  if (!email) return;

  // Small delay to allow business settings to be saved after signup
  await new Promise(resolve => setTimeout(resolve, 5000));

  let businessName = '';
  try {
    const settingsDoc = await admin.firestore()
      .doc(`users/${user.uid}/settings/business`)
      .get();
    businessName = settingsDoc.data()?.businessName || '';
  } catch (error) {
    // Settings may not exist yet
  }

  // Initialize email preferences (opted in by default)
  await admin.firestore()
    .doc(`users/${user.uid}/settings/emailPreferences`)
    .set({
      marketing: true,
      transactional: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  // Record signup timestamp for drip campaign scheduling
  await admin.firestore()
    .doc(`users/${user.uid}/settings/emailState`)
    .set({
      signupAt: admin.firestore.FieldValue.serverTimestamp(),
      lastOnboardingTip: 0,
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  // Read registration platform info (saved by client on signup)
  let platform = '';
  let authMethod = '';
  try {
    const regDoc = await admin.firestore()
      .doc(`users/${user.uid}/settings/registrationInfo`)
      .get();
    if (regDoc.exists) {
      platform = regDoc.data()?.platform || '';
      authMethod = regDoc.data()?.method || '';
    }
  } catch (error) {
    // Registration info may not exist yet
  }

  // If no method from client, infer from provider data
  if (!authMethod && user.providerData?.length) {
    const providerId = user.providerData[0].providerId;
    if (providerId === 'google.com') authMethod = 'google';
    else if (providerId === 'apple.com') authMethod = 'apple';
    else authMethod = 'email';
  }

  // Auto-grant affiliate status for pre-approved emails
  if (PENDING_AFFILIATE_EMAILS.includes(email.toLowerCase())) {
    try {
      const referralRef = admin.firestore().doc(`users/${user.uid}/profile/referral`);
      const referralDoc = await referralRef.get();
      const existingData = referralDoc.exists ? referralDoc.data() : {};

      // Generate a referral code if they don't already have one
      let referralCode = existingData?.referralCode;
      if (!referralCode) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = 'QM-';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        referralCode = code;
        await admin.firestore().doc(`referrals/${referralCode}`).set({
          referrerUserId: user.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await referralRef.set({
        referralCode,
        isAffiliate: true,
        commissionRate: DEFAULT_COMMISSION_RATE,
        totalReferrals: existingData?.totalReferrals || 0,
        convertedReferrals: existingData?.convertedReferrals || 0,
        totalEarnings: existingData?.totalEarnings || 0,
        pendingEarnings: existingData?.pendingEarnings || 0,
        paidEarnings: existingData?.paidEarnings || 0,
      }, { merge: true });

    } catch (error) {
    }
  }

  await Promise.all([
    sendWelcomeEmail(email, businessName, user.uid),
    sendNewUserNotificationEmail(email, platform, authMethod, businessName),
  ]);
});

/**
 * Unsubscribe endpoint - handles email unsubscribe links
 */
export const unsubscribeEmail = functions.https.onRequest(async (req, res) => {
  const userId = req.query.userId as string;
  const category = req.query.category as string;

  if (!userId || !category) {
    res.status(400).send(generateErrorPage('Invalid Link', 'This unsubscribe link is invalid.'));
    return;
  }

  if (category !== 'marketing' && category !== 'transactional') {
    res.status(400).send(generateErrorPage('Invalid Link', 'This unsubscribe link is invalid.'));
    return;
  }

  const success = await handleUnsubscribe(userId, category);

  if (success) {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed - QuoteMate</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #f8fafc;
          }
          .card {
            background: #1e293b;
            border-radius: 16px;
            padding: 40px;
            text-align: center;
            max-width: 400px;
            border: 1px solid #334155;
          }
          .icon { font-size: 48px; margin-bottom: 16px; }
          h1 { color: #f97316; margin-bottom: 12px; }
          p { color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>Unsubscribed</h1>
          <p>You've been unsubscribed from ${category} emails. You can re-enable them anytime in QuoteMate settings.</p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(500).send(generateErrorPage('Error', 'Something went wrong. Please try again later.'));
  }
});

/**
 * Scheduled: Onboarding drip emails
 * Runs daily, sends tips on day 1, 2, 5, 10, and 14 after signup
 */
export const sendOnboardingDrip = functions.pubsub
  .schedule('every day 09:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const authResult = await admin.auth().listUsers(1000);
    let totalProcessed = 0;
    let totalEligible = 0;
    let totalSent = 0;
    let totalErrors = 0;

    for (const userRecord of authResult.users) {
      try {
        const userId = userRecord.uid;
        const emailStateDoc = await db.doc(`users/${userId}/settings/emailState`).get();
        const data = emailStateDoc.data();
        if (!data?.signupAt) continue;

        totalProcessed++;

        const signupAt = data.signupAt?.toDate?.() || new Date(data.signupAt);
        const lastTip = data.lastOnboardingTip || 0;

        if (lastTip >= 5) continue; // All tips sent

        const daysSinceSignup = Math.floor((now.getTime() - signupAt.getTime()) / (1000 * 60 * 60 * 24));

        let tipToSend = 0;
        if (daysSinceSignup >= 14 && lastTip < 5) tipToSend = 5;
        else if (daysSinceSignup >= 10 && lastTip < 4) tipToSend = 4;
        else if (daysSinceSignup >= 5 && lastTip < 3) tipToSend = 3;
        else if (daysSinceSignup >= 2 && lastTip < 2) tipToSend = 2;
        else if (daysSinceSignup >= 1 && lastTip < 1) tipToSend = 1;

        if (tipToSend === 0) continue;

        totalEligible++;

        const email = userRecord.email;
        if (!email) continue;

        let businessName = '';
        try {
          const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
          businessName = settingsDoc.data()?.businessName || '';
        } catch {}

        const sent = await sendOnboardingTipEmail(email, businessName, tipToSend, userId);
        if (sent) {
          await emailStateDoc.ref.set({ lastOnboardingTip: tipToSend }, { merge: true });
          totalSent++;
        }
      } catch (error: any) {
        totalErrors++;
        functions.logger.error(`sendOnboardingDrip: error processing user ${userRecord.uid}`, error?.message);
      }
    }

    functions.logger.info(`sendOnboardingDrip: processed=${totalProcessed}, eligible=${totalEligible}, sent=${totalSent}, errors=${totalErrors}`);
  });

/**
 * Scheduled: Re-engagement emails
 * Runs daily, targets users inactive for 7+ days
 */
export const sendReEngagement = functions.pubsub
  .schedule('every day 10:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
    const authResult = await admin.auth().listUsers(1000);
    let totalProcessed = 0;
    let totalEligible = 0;
    let totalSent = 0;
    let totalErrors = 0;

    for (const userRecord of authResult.users) {
      try {
        const userId = userRecord.uid;
        const emailStateDoc = await db.doc(`users/${userId}/settings/emailState`).get();
        const data = emailStateDoc.data();
        if (!data?.lastActivityAt) continue;

        totalProcessed++;

        const lastActivityAt = data.lastActivityAt?.toDate?.() || new Date(data.lastActivityAt);
        const lastReEngagementAt = data.lastReEngagementAt?.toDate?.();

        // Skip if active within the last 7 days
        if (lastActivityAt >= sevenDaysAgo) continue;

        // Don't send if we already sent a re-engagement email in the last 21 days
        if (lastReEngagementAt && lastReEngagementAt > twentyOneDaysAgo) continue;

        totalEligible++;

        const daysSinceActive = Math.floor((now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24));

        const email = userRecord.email;
        if (!email) continue;

        let businessName = '';
        try {
          const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
          businessName = settingsDoc.data()?.businessName || '';
        } catch {}

        const sent = await sendReEngagementEmail(email, businessName, daysSinceActive, userId);
        if (sent) {
          await emailStateDoc.ref.set({
            lastReEngagementAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          totalSent++;
        }
      } catch (error: any) {
        totalErrors++;
        functions.logger.error(`sendReEngagement: error processing user ${userRecord.uid}`, error?.message);
      }
    }

    functions.logger.info(`sendReEngagement: processed=${totalProcessed}, eligible=${totalEligible}, sent=${totalSent}, errors=${totalErrors}`);
  });

/**
 * Update user activity timestamp (called from the app)
 * Used to track last activity for re-engagement emails
 */
export const updateActivityTimestamp = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuth(req, res);
    if (!decodedToken) return;

    try {
      // Capture client version info if provided — useful for support/debugging
      // in admin. Sanity-checked because the payload comes from a client.
      const rawVersion = typeof req.body?.appVersion === 'string' ? req.body.appVersion.trim() : '';
      const rawPlatform = typeof req.body?.appPlatform === 'string' ? req.body.appPlatform.trim() : '';
      const appVersion = /^[\d]+\.[\d]+\.[\d]+([.\-+][\w.-]*)?$/.test(rawVersion) ? rawVersion : null;
      const appPlatform = ['ios', 'android', 'web', 'macos', 'windows'].includes(rawPlatform) ? rawPlatform : null;

      await admin.firestore()
        .doc(`users/${decodedToken.uid}/settings/emailState`)
        .set({
          lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(appVersion ? { appVersion, appVersionSeenAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
          ...(appPlatform ? { appPlatform } : {}),
        }, { merge: true });

      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Quick feedback from follow-up email — one-tap rating
 */
export const quickFeedback = functions.https.onRequest(async (req, res) => {
  // POST = detailed feedback submission after initial rating
  if (req.method === 'POST') {
    const { userId, rating, feedbackId, details } = req.body;
    if (!userId || !feedbackId) {
      res.status(400).send('Invalid request');
      return;
    }

    try {
      // Update the existing feedback doc with detailed comments
      await admin.firestore().collection('feedback').doc(feedbackId).update({
        details: (details || '').slice(0, 5000),
        detailsAddedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify admin about the detailed feedback
      const userEmail = await getUserEmail(userId) || 'Unknown';
      await sendEmail({
        to: 'thomas.andrew.hansen@gmail.com',
        subject: `Detailed feedback from ${userEmail} (rated: ${rating})`,
        htmlContent: `<p>User <strong>${userEmail}</strong> (${userId}) left detailed feedback after rating "<strong>${rating}</strong>":</p><blockquote style="border-left:3px solid #f59e0b;padding:8px 16px;margin:16px 0;color:#333;">${(details || '').replace(/</g, '&lt;')}</blockquote>`,
        category: 'transactional',
        tags: ['quick-feedback-detail-admin'],
      });

      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Feedback received!</title>
          <style>
            body { margin:0; padding:0; background:#0f172a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
            .card { background:#1e293b; border-radius:16px; padding:48px 32px; max-width:400px; text-align:center; }
            .emoji { font-size:64px; margin:0 0 16px; }
            h1 { color:#f8fafc; font-size:24px; margin:0 0 12px; }
            p { color:#94a3b8; font-size:15px; line-height:1.6; margin:0; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="emoji">&#128079;</div>
            <h1>You're a champion!</h1>
            <p>That extra detail is gold — it'll help us make QuoteMate even better for you and every other tradie out there.</p>
          </div>
        </body>
        </html>
      `);
    } catch (error: any) {
      res.status(500).send('Something went wrong');
    }
    return;
  }

  // GET = initial one-tap rating click
  const { userId, rating, category: feedbackCategory } = req.query as { userId?: string; rating?: string; category?: string };

  const validRatings = ['great', 'okay', 'bad'];
  if (!userId || !rating || !validRatings.includes(rating)) {
    res.status(400).send('Invalid request');
    return;
  }

  const categoryLabel = feedbackCategory === 're-engagement' ? 'Re-engagement' : 'First Quote Follow-Up';

  try {
    // Store the feedback and get the doc ID for the follow-up form
    const feedbackRef = await admin.firestore().collection('feedback').add({
      userId,
      category: categoryLabel,
      feedback: `Quick rating: ${rating}`,
      rating,
      source: 'email-quick-feedback',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notify admin
    const userEmail = await getUserEmail(userId) || 'Unknown';
    await sendEmail({
      to: 'thomas.andrew.hansen@gmail.com',
      subject: `Quick feedback: "${rating}" from ${userEmail}`,
      htmlContent: `<p>User <strong>${userEmail}</strong> (${userId}) rated their first quote experience: <strong>${rating}</strong></p>`,
      category: 'transactional',
      tags: ['quick-feedback-admin'],
    });

    const emoji = rating === 'great' ? '&#129321;' : rating === 'okay' ? '&#128528;' : '&#128169;';
    const message = rating === 'great'
      ? "Stoked to hear it! That's made our day."
      : rating === 'okay'
        ? "Fair enough! We'll keep working to make it a ripper experience."
        : "Cheers for being honest — we'll get onto fixing that.";

    const placeholder = rating === 'great'
      ? "What did you love most? Any features you'd like to see?"
      : rating === 'okay'
        ? "What could we do better? What felt clunky?"
        : "What went wrong? We want to fix it for you.";

    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Thanks for the feedback!</title>
        <style>
          body { margin:0; padding:0; background:#0f172a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; box-sizing:border-box; }
          .card { background:#1e293b; border-radius:16px; padding:48px 32px; max-width:440px; width:100%; text-align:center; }
          .emoji { font-size:64px; margin:0 0 16px; }
          h1 { color:#f8fafc; font-size:24px; margin:0 0 12px; }
          p { color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 24px; }
          .divider { border:0; border-top:1px solid #334155; margin:28px 0; }
          h2 { color:#cbd5e1; font-size:16px; font-weight:600; margin:0 0 12px; }
          textarea { width:100%; min-height:100px; background:#0f172a; border:2px solid #334155; border-radius:10px; color:#f8fafc; font-size:14px; padding:12px; box-sizing:border-box; resize:vertical; font-family:inherit; }
          textarea:focus { outline:none; border-color:#f59e0b; }
          button { background:#f59e0b; color:#fff; border:none; border-radius:10px; padding:14px 32px; font-size:15px; font-weight:700; cursor:pointer; margin-top:16px; width:100%; }
          button:hover { background:#d97706; }
          button:disabled { opacity:0.6; cursor:not-allowed; }
          .done { color:#00c897; font-size:15px; font-weight:600; display:none; margin-top:16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="emoji">${emoji}</div>
          <h1>Thanks, legend!</h1>
          <p>${message}</p>

          <hr class="divider">

          <h2>Want to tell us more? (optional)</h2>
          <form id="detailsForm">
            <textarea id="details" placeholder="${placeholder}"></textarea>
            <button type="submit" id="submitBtn">Send Feedback</button>
          </form>
          <p class="done" id="doneMsg">&#128079; You're a champion — thanks for the extra detail!</p>
        </div>

        <script>
          document.getElementById('detailsForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            var details = document.getElementById('details').value.trim();
            if (!details) return;
            var btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = 'Sending...';
            try {
              await fetch('https://us-central1-hansendev.cloudfunctions.net/quickFeedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: '${userId}',
                  rating: '${rating}',
                  feedbackId: '${feedbackRef.id}',
                  details: details
                })
              });
            } catch(err) {}
            document.getElementById('detailsForm').style.display = 'none';
            document.getElementById('doneMsg').style.display = 'block';
          });
        </script>
      </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send('Something went wrong');
  }
});

/**
 * Test endpoint: send the quote follow-up email to admin
 */
export const testQuoteFollowUpEmail = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const sent = await sendQuoteFollowUpEmail(
      'thomas.andrew.hansen@gmail.com',
      'Test Business',
      'Bathroom Renovation',
      2450.00,
      'test'
    );
    res.json({ success: sent });
  });
});

/**
 * Test endpoint: send all new email types to admin for review
 */
export const testAllEmails = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const to = 'thomas.andrew.hansen@gmail.com';
    const results: Record<string, boolean> = {};

    results.tip1 = await sendOnboardingTipEmail(to, 'HansenDev', 1, 'test');
    results.tip2 = await sendOnboardingTipEmail(to, 'HansenDev', 2, 'test');
    results.tip3 = await sendOnboardingTipEmail(to, 'HansenDev', 3, 'test');
    results.tip4 = await sendOnboardingTipEmail(to, 'HansenDev', 4, 'test');
    results.tip5 = await sendOnboardingTipEmail(to, 'HansenDev', 5, 'test');
    results.reEngagement = await sendReEngagementEmail(to, 'HansenDev', 12, 'test');
    results.draftNudge = await sendDraftNudgeEmail(to, 'HansenDev', [
      { customerName: 'Matt Jellicoe', jobName: 'Fence Installation', total: 1632, daysOld: 4 },
      { customerName: 'Dawn', jobName: 'Driveway Concreting', total: 7506, daysOld: 2 },
    ], 2, 'test');

    res.json({ results });
  });
});

/**
 * One-off: backfill emailState for existing users missing it
 */
export const backfillEmailState = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const firestore = admin.firestore();
    const authResult = await admin.auth().listUsers(1000);
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const userRecord of authResult.users) {
      try {
        const emailStateRef = firestore.doc(`users/${userRecord.uid}/settings/emailState`);
        const emailStateDoc = await emailStateRef.get();
        if (emailStateDoc.exists && emailStateDoc.data()?.signupAt) {
          skipped++;
          continue;
        }

        const signupAt = new Date(userRecord.metadata.creationTime);

        await emailStateRef.set({
          signupAt: admin.firestore.Timestamp.fromDate(signupAt),
          lastOnboardingTip: 0,
          lastActivityAt: admin.firestore.Timestamp.fromDate(signupAt),
        }, { merge: true });
        created++;
      } catch (err: any) {
        errors++;
        functions.logger.error(`backfillEmailState error for ${userRecord.uid}`, err?.message);
      }
    }

    res.json({ created, skipped, errors, total: authResult.users.length });
  });
});

/**
 * Update email preferences (called from the app settings)
 */
export const updateEmailPreferences = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { marketing } = req.body;
    if (typeof marketing !== 'boolean') {
      res.status(400).json({ error: 'marketing must be a boolean' });
      return;
    }

    try {
      await admin.firestore()
        .doc(`users/${decodedToken.uid}/settings/emailPreferences`)
        .set({
          marketing,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      res.status(200).json({ success: true, marketing });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

function generateErrorPage(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - QuoteMate</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f8fafc;
    }
    .error-card {
      background: #1e293b;
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      max-width: 400px;
      border: 1px solid #334155;
    }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #f97316; margin-bottom: 12px; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-icon">⚠️</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>
`;
}

// ============================================================
// ADMIN ANALYTICS DASHBOARD
// ============================================================

function verifyAdminKey(req: functions.https.Request, res: functions.Response): boolean {
  const key = req.query.key as string;
  const expectedKey = process.env.ADMIN_DASHBOARD_KEY;

  if (!expectedKey) {
    res.status(500).send(generateErrorPage('Not Configured', 'Admin dashboard key not set. Run: firebase functions:config:set admin.dashboard_key="YOUR_SECRET"'));
    return false;
  }

  if (!key || key !== expectedKey) {
    res.status(403).send(generateErrorPage('Access Denied', 'Invalid or missing access key.'));
    return false;
  }
  return true;
}

interface AnalyticsData {
  generatedAt: string;
  funnel: {
    totalSignups: number;
    onboarded: number;
    createdQuote: number;
    created5PlusQuotes: number;
    createdInvoice: number;
    proSubscribers: number;
  };
  quotes: {
    total: number;
    statuses: Record<string, number>;
    aiGenerated: number;
    aiSkipped: number;
    totalMaterials: number;
    avgMaterialsPerQuote: number;
    totalValue: number;
    avgValue: number;
    medianValue: number;
    minValue: number;
    maxValue: number;
    avgMarkup: number;
    laborRateMedian: number;
    favoritesSaved: number;
  };
  invoices: {
    total: number;
    statuses: Record<string, number>;
    quoteToInvoiceRate: number;
  };
  tradeTypes: Record<string, number>;
  jobTypes: Array<{ name: string; count: number }>;
  quotesByMonth: Array<{ month: string; count: number }>;
  signupsByMonth: Array<{ month: string; count: number }>;
  mrr: number;
  cohortedFunnel: Array<{
    month: string;
    signups: number;
    onboarded: number;
    createdQuote: number;
    created5Plus: number;
    invoiced: number;
    pro: number;
  }>;
  acquisition: {
    platforms: Record<string, number>;
    authMethods: Record<string, number>;
  };
  emailPipeline: {
    welcome: number;
    onboardingTip1: number;
    onboardingTip2: number;
    onboardingTip3: number;
    reEngagement: number;
    quoteFollowUp: number;
  };
  dropoffSegments: Array<{
    name: string;
    description: string;
    count: number;
    emails: string[];
  }>;
  tradeRetention: Array<{
    trade: string;
    total: number;
    active: number;
    churned: number;
    retentionPct: number;
  }>;
  users: Array<{
    email: string;
    businessName: string;
    tradeType: string;
    quotes: number;
    invoices: number;
    isPro: boolean;
    quotesThisMonth: number;
    platform: string;
    authMethod: string;
    stage: string;
    favorites: number;
    signupDate: string;
    lastLogin: string;
    daysSinceLogin: number;
    firstQuoteDate: string;
    lastQuoteDate: string;
    sentQuotes: number;
    acceptedQuotes: number;
    quoteJobs: string[];
    avgQuoteValue: number;
  }>;
  recentQuotes: Array<{
    date: string;
    email: string;
    total: number;
    status: string;
    job: string;
    customer: string;
    materialsCount: number;
  }>;
  cancellations: Array<{ reason: string; feedback: string; date: string; email: string }>;
  acceptanceLinksGenerated: number;
  emailsSent: number;
  emailCategories: Record<string, number>;
  retention: {
    activeLastWeek: number;
    activeLastMonth: number;
    neverReturned: number;
  };
  referrals: {
    totalCodes: number;
    totalReferrals: number;
    convertedReferrals: number;
    pendingReferrals: number;
    affiliates: Array<{
      email: string;
      referralCode: string;
      totalReferrals: number;
      convertedReferrals: number;
      commissionRate: number;
      totalEarnings: number;
      pendingEarnings: number;
      paidEarnings: number;
    }>;
    topReferrers: Array<{
      email: string;
      referralCode: string;
      totalReferrals: number;
      convertedReferrals: number;
    }>;
  };
}

async function getAdminAnalyticsData(): Promise<AnalyticsData> {
  const db = admin.firestore();

  // Exclude internal/test accounts from all metrics
  const EXCLUDED_EMAILS = new Set([
    'thomas.andrew.hansen@gmail.com',
    'deckreck@gmail.com',
  ]);

  // Get auth users for signup/login data
  const authResult = await admin.auth().listUsers(1000);
  const authUsers = authResult.users.filter(au => !EXCLUDED_EMAILS.has(au.email || ''));

  let totalQuotes = 0;
  let totalInvoices = 0;
  const quoteStatuses: Record<string, number> = {};
  const invoiceStatuses: Record<string, number> = {};
  const tradeTypes: Record<string, number> = {};
  const jobTypesMap: Record<string, number> = {};
  const quotesByMonthMap: Record<string, number> = {};
  const signupsByMonthMap: Record<string, number> = {};
  let totalMaterials = 0;
  let quotesWithAI = 0;
  let quotesSkippedAI = 0;
  const allQuoteTotals: number[] = [];
  let onboardedCount = 0;
  let proCount = 0;
  let favoritesCount = 0;
  const markupValues: number[] = [];
  const laborRates: number[] = [];
  const recentQuotes: AnalyticsData['recentQuotes'] = [];
  const usersList: AnalyticsData['users'] = [];
  const cohortMap = new Map<string, { signups: number; onboarded: number; createdQuote: number; created5Plus: number; invoiced: number; pro: number }>();
  const platformCounts: Record<string, number> = {};
  const authMethodCounts: Record<string, number> = {};

  // Build auth user lookup
  const authMap = new Map<string, { email: string; createdAt: string; lastLogin: string }>();
  let activeLastWeek = 0;
  let activeLastMonth = 0;
  let neverReturned = 0;
  const now = Date.now();

  for (const au of authUsers) {
    const createdMs = new Date(au.metadata.creationTime).getTime();
    const lastMs = au.metadata.lastSignInTime ? new Date(au.metadata.lastSignInTime).getTime() : createdMs;

    authMap.set(au.uid, {
      email: au.email || au.displayName || 'anonymous',
      createdAt: au.metadata.creationTime,
      lastLogin: au.metadata.lastSignInTime || au.metadata.creationTime,
    });

    // Signup month
    const signupMonth = new Date(au.metadata.creationTime).toISOString().substring(0, 7);
    signupsByMonthMap[signupMonth] = (signupsByMonthMap[signupMonth] || 0) + 1;

    // Activity
    if (now - lastMs < 7 * 24 * 60 * 60 * 1000) activeLastWeek++;
    if (now - lastMs < 30 * 24 * 60 * 60 * 1000) activeLastMonth++;
    if (!au.metadata.lastSignInTime || au.metadata.lastSignInTime === au.metadata.creationTime) neverReturned++;
  }

  // Query each user's subcollections in parallel batches
  const batchSize = 10;
  for (let i = 0; i < authUsers.length; i += batchSize) {
    const batch = authUsers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (au) => {
      const userId = au.uid;
      const authInfo = authMap.get(userId)!;

      try {
        const [quotesSnap, invoicesSnap, settingsSnap, onbSnap, subSnap, favsSnap, regInfoSnap] = await Promise.all([
          db.collection(`users/${userId}/quotes`).get(),
          db.collection(`users/${userId}/invoices`).get(),
          db.doc(`users/${userId}/settings/business`).get(),
          db.doc(`users/${userId}/profile/onboarding`).get(),
          db.doc(`users/${userId}/profile/subscription`).get(),
          db.collection(`users/${userId}/materialFavorites`).get(),
          db.doc(`users/${userId}/settings/registrationInfo`).get(),
        ]);

        const userQuotes = quotesSnap.size;
        const userInvoices = invoicesSnap.size;
        totalQuotes += userQuotes;
        totalInvoices += userInvoices;
        favoritesCount += favsSnap.size;

        // Process quotes — also track per-user details
        const userQuoteJobs: string[] = [];
        const userQuoteTotals: number[] = [];
        let userSentQuotes = 0;
        let userAcceptedQuotes = 0;
        let userFirstQuoteDate = '';
        let userLastQuoteDate = '';

        for (const qDoc of quotesSnap.docs) {
          const q = qDoc.data();
          quoteStatuses[q.status || 'unknown'] = (quoteStatuses[q.status || 'unknown'] || 0) + 1;
          if (q.total) { allQuoteTotals.push(q.total); userQuoteTotals.push(q.total); }
          if (q.materials) totalMaterials += q.materials.length;
          if (q.aiSkipped) quotesSkippedAI++; else quotesWithAI++;
          if (q.markup) markupValues.push(q.markup);
          if (q.laborRate) laborRates.push(q.laborRate);
          if (q.job?.name) {
            jobTypesMap[q.job.name] = (jobTypesMap[q.job.name] || 0) + 1;
            if (!userQuoteJobs.includes(q.job.name)) userQuoteJobs.push(q.job.name);
          }
          if (q.status === 'sent' || q.status === 'accepted' || q.status === 'completed') userSentQuotes++;
          if (q.status === 'accepted' || q.status === 'completed') userAcceptedQuotes++;
          if (q.createdAt) {
            let date: Date;
            try { date = q.createdAt.toDate(); } catch { date = new Date(q.createdAt); }
            if (date && !isNaN(date.getTime())) {
              const iso = date.toISOString();
              if (!userFirstQuoteDate || iso < userFirstQuoteDate) userFirstQuoteDate = iso;
              if (!userLastQuoteDate || iso > userLastQuoteDate) userLastQuoteDate = iso;
              const m = iso.substring(0, 7);
              quotesByMonthMap[m] = (quotesByMonthMap[m] || 0) + 1;
              recentQuotes.push({
                date: iso,
                email: authInfo.email.substring(0, 25),
                total: q.total || 0,
                status: q.status || 'unknown',
                job: q.job?.name || '',
                customer: q.customerName || '',
                materialsCount: q.materials?.length || 0,
              });
            }
          }
        }

        // Process invoices
        for (const iDoc of invoicesSnap.docs) {
          const inv = iDoc.data();
          invoiceStatuses[inv.status || 'unknown'] = (invoiceStatuses[inv.status || 'unknown'] || 0) + 1;
        }

        // Settings
        let bizName = '(not set)';
        let trade = '(not set)';
        if (settingsSnap.exists) {
          const s = settingsSnap.data()!;
          bizName = s.businessName || '(not set)';
          trade = s.tradeType || '(not set)';
          if (s.tradeType) tradeTypes[s.tradeType] = (tradeTypes[s.tradeType] || 0) + 1;
        }

        // Onboarding
        if (onbSnap.exists && onbSnap.data()?.isOnboarded) onboardedCount++;

        // Subscription
        let isPro = false;
        let quotesThisMonth = 0;
        let subPlatform = '';
        if (subSnap.exists) {
          const sub = subSnap.data()!;
          isPro = sub.isPro || false;
          quotesThisMonth = sub.quotesThisMonth || 0;
          subPlatform = sub.platform || '';
          if (isPro) proCount++;
        }

        // Registration info (platform + auth method)
        let regPlatform = '';
        let authMethod = '';
        if (regInfoSnap.exists) {
          const reg = regInfoSnap.data()!;
          regPlatform = reg.platform || '';
          authMethod = reg.method || '';
          if (regPlatform) platformCounts[regPlatform] = (platformCounts[regPlatform] || 0) + 1;
          if (authMethod) authMethodCounts[authMethod] = (authMethodCounts[authMethod] || 0) + 1;
        }

        // Cohort data
        const userIsOnboarded = onbSnap.exists && onbSnap.data()?.isOnboarded;
        const signupMonthKey = new Date(authInfo.createdAt).toISOString().substring(0, 7);
        if (!cohortMap.has(signupMonthKey)) {
          cohortMap.set(signupMonthKey, { signups: 0, onboarded: 0, createdQuote: 0, created5Plus: 0, invoiced: 0, pro: 0 });
        }
        const cohort = cohortMap.get(signupMonthKey)!;
        cohort.signups++;
        if (userIsOnboarded) cohort.onboarded++;
        if (userQuotes > 0) cohort.createdQuote++;
        if (userQuotes >= 5) cohort.created5Plus++;
        if (userInvoices > 0) cohort.invoiced++;
        if (isPro) cohort.pro++;

        // Lifecycle stage
        const daysSinceSignup = (now - new Date(authInfo.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const daysSinceLogin = (now - new Date(authInfo.lastLogin).getTime()) / (1000 * 60 * 60 * 24);
        let stage = 'new';
        if (isPro) stage = 'pro';
        else if (userQuotes > 0 && daysSinceLogin < 14) stage = 'active';
        else if (userQuotes > 0 && daysSinceLogin >= 14) stage = 'at-risk';
        else if (userIsOnboarded && userQuotes === 0 && daysSinceSignup > 7) stage = 'churned';
        else if (userIsOnboarded && userQuotes === 0) stage = 'onboarding';

        usersList.push({
          email: authInfo.email,
          businessName: bizName,
          tradeType: trade,
          quotes: userQuotes,
          invoices: userInvoices,
          isPro,
          quotesThisMonth,
          platform: regPlatform || subPlatform,
          authMethod,
          stage,
          favorites: favsSnap.size,
          signupDate: new Date(authInfo.createdAt).toISOString().split('T')[0],
          lastLogin: new Date(authInfo.lastLogin).toISOString().split('T')[0],
          daysSinceLogin: Math.round(daysSinceLogin),
          firstQuoteDate: userFirstQuoteDate ? userFirstQuoteDate.split('T')[0] : '',
          lastQuoteDate: userLastQuoteDate ? userLastQuoteDate.split('T')[0] : '',
          sentQuotes: userSentQuotes,
          acceptedQuotes: userAcceptedQuotes,
          quoteJobs: userQuoteJobs.slice(0, 5),
          avgQuoteValue: userQuoteTotals.length > 0 ? Math.round(userQuoteTotals.reduce((a, b) => a + b, 0) / userQuoteTotals.length) : 0,
        });
      } catch (e) {
        // Skip users with issues
      }
    }));
  }

  // Referral data
  let totalReferralCodes = 0;
  let totalReferralsCount = 0;
  let totalConvertedReferrals = 0;
  let totalPendingReferrals = 0;
  const affiliatesList: AnalyticsData['referrals']['affiliates'] = [];
  const topReferrersList: AnalyticsData['referrals']['topReferrers'] = [];

  for (const au of authUsers) {
    try {
      const referralDoc = await db.doc(`users/${au.uid}/profile/referral`).get();
      if (!referralDoc.exists) continue;
      const r = referralDoc.data()!;
      if (!r.referralCode) continue;

      totalReferralCodes++;
      totalReferralsCount += r.totalReferrals || 0;
      totalConvertedReferrals += r.convertedReferrals || 0;
      if (r.referralPendingSince && !r.referralConverted) totalPendingReferrals++;

      const email = authMap.get(au.uid)?.email || 'unknown';

      if (r.isAffiliate) {
        affiliatesList.push({
          email,
          referralCode: r.referralCode,
          totalReferrals: r.totalReferrals || 0,
          convertedReferrals: r.convertedReferrals || 0,
          commissionRate: r.commissionRate || 0,
          totalEarnings: r.totalEarnings || 0,
          pendingEarnings: r.pendingEarnings || 0,
          paidEarnings: r.paidEarnings || 0,
        });
      }

      if ((r.totalReferrals || 0) > 0) {
        topReferrersList.push({
          email,
          referralCode: r.referralCode,
          totalReferrals: r.totalReferrals || 0,
          convertedReferrals: r.convertedReferrals || 0,
        });
      }
    } catch { /* skip */ }
  }
  topReferrersList.sort((a, b) => b.totalReferrals - a.totalReferrals);

  // Top-level collections
  const [cancellationsSnap, tokensSnap] = await Promise.all([
    db.collection('cancellations').get(),
    db.collection('quoteAcceptanceTokens').get(),
  ]);

  let emailsSent = 0;
  const emailCategories: Record<string, number> = {};
  const emailPipeline = { welcome: 0, onboardingTip1: 0, onboardingTip2: 0, onboardingTip3: 0, reEngagement: 0, quoteFollowUp: 0 };
  try {
    const emailSnap = await db.collection('emailLog').get();
    emailsSent = emailSnap.size;
    emailSnap.forEach(d => {
      const data = d.data();
      const cat = data.category || 'unknown';
      emailCategories[cat] = (emailCategories[cat] || 0) + 1;
      const tags: string[] = data.tags || [];
      if (tags.includes('welcome')) emailPipeline.welcome++;
      if (tags.includes('onboarding') && tags.includes('tip-1')) emailPipeline.onboardingTip1++;
      if (tags.includes('onboarding') && tags.includes('tip-2')) emailPipeline.onboardingTip2++;
      if (tags.includes('onboarding') && tags.includes('tip-3')) emailPipeline.onboardingTip3++;
      if (tags.includes('re-engagement')) emailPipeline.reEngagement++;
      if (tags.includes('quote-follow-up')) emailPipeline.quoteFollowUp++;
    });
  } catch { /* no email log */ }

  const cancellations: AnalyticsData['cancellations'] = [];
  cancellationsSnap.forEach(d => {
    const c = d.data();
    let dateStr = '';
    try { dateStr = c.canceledAt?.toDate?.().toISOString().split('T')[0] || ''; } catch { /* */ }
    cancellations.push({ reason: c.reason || '(none)', feedback: c.feedback || '', date: dateStr, email: c.userEmail || '' });
  });

  // Compute quote stats
  allQuoteTotals.sort((a, b) => a - b);
  const totalValue = allQuoteTotals.reduce((a, b) => a + b, 0);
  laborRates.sort((a, b) => a - b);

  // Sort users and quotes
  usersList.sort((a, b) => b.quotes - a.quotes);
  recentQuotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Build drop-off segments
  const seg_neverOnboarded = usersList.filter(u => u.stage === 'new' && u.quotes === 0);
  const seg_onboardedNoQuote = usersList.filter(u => (u.stage === 'onboarding' || u.stage === 'churned') && u.quotes === 0);
  const seg_draftOnly = usersList.filter(u => u.quotes > 0 && u.sentQuotes === 0 && !u.isPro);
  const seg_sentNoAccepted = usersList.filter(u => u.sentQuotes > 0 && u.acceptedQuotes === 0 && u.invoices === 0 && !u.isPro);
  const seg_activeNotPaying = usersList.filter(u => u.quotes >= 3 && !u.isPro && u.daysSinceLogin < 30);
  const seg_atRisk = usersList.filter(u => u.stage === 'at-risk');

  const dropoffSegments: AnalyticsData['dropoffSegments'] = [
    { name: 'Never Onboarded', description: 'Signed up but never completed setup', count: seg_neverOnboarded.length, emails: seg_neverOnboarded.map(u => u.email) },
    { name: 'Onboarded, No Quote', description: 'Completed setup but never created a quote', count: seg_onboardedNoQuote.length, emails: seg_onboardedNoQuote.map(u => u.email) },
    { name: 'Draft Only', description: 'Created quotes but never sent one to a customer', count: seg_draftOnly.length, emails: seg_draftOnly.map(u => u.email) },
    { name: 'Sent, No Win', description: 'Sent quotes but none accepted yet', count: seg_sentNoAccepted.length, emails: seg_sentNoAccepted.map(u => u.email) },
    { name: 'Active, Not Paying', description: '3+ quotes, active in last 30d, still on Free', count: seg_activeNotPaying.length, emails: seg_activeNotPaying.map(u => u.email) },
    { name: 'At Risk', description: 'Previously active but inactive 14+ days', count: seg_atRisk.length, emails: seg_atRisk.map(u => u.email) },
  ];

  // Trade retention analysis
  const tradeStats = new Map<string, { total: number; active: number; churned: number }>();
  for (const u of usersList) {
    const t = u.tradeType === '(not set)' ? 'Unknown' : u.tradeType;
    if (!tradeStats.has(t)) tradeStats.set(t, { total: 0, active: 0, churned: 0 });
    const ts = tradeStats.get(t)!;
    ts.total++;
    if (u.stage === 'active' || u.stage === 'pro') ts.active++;
    if (u.stage === 'churned' || u.stage === 'at-risk') ts.churned++;
  }
  const tradeRetention: AnalyticsData['tradeRetention'] = Array.from(tradeStats.entries())
    .filter(([, v]) => v.total >= 2)
    .map(([trade, v]) => ({ trade, total: v.total, active: v.active, churned: v.churned, retentionPct: v.total > 0 ? Math.round(v.active / v.total * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  return {
    generatedAt: new Date().toISOString(),
    funnel: {
      totalSignups: authUsers.length,
      onboarded: onboardedCount,
      createdQuote: usersList.filter(u => u.quotes > 0).length,
      created5PlusQuotes: usersList.filter(u => u.quotes >= 5).length,
      createdInvoice: usersList.filter(u => u.invoices > 0).length,
      proSubscribers: proCount,
    },
    quotes: {
      total: totalQuotes,
      statuses: quoteStatuses,
      aiGenerated: quotesWithAI,
      aiSkipped: quotesSkippedAI,
      totalMaterials,
      avgMaterialsPerQuote: totalQuotes > 0 ? Math.round((totalMaterials / totalQuotes) * 10) / 10 : 0,
      totalValue,
      avgValue: allQuoteTotals.length > 0 ? Math.round(totalValue / allQuoteTotals.length * 100) / 100 : 0,
      medianValue: allQuoteTotals.length > 0 ? allQuoteTotals[Math.floor(allQuoteTotals.length / 2)] : 0,
      minValue: allQuoteTotals.length > 0 ? allQuoteTotals[0] : 0,
      maxValue: allQuoteTotals.length > 0 ? allQuoteTotals[allQuoteTotals.length - 1] : 0,
      avgMarkup: markupValues.length > 0 ? Math.round(markupValues.reduce((a, b) => a + b, 0) / markupValues.length * 10) / 10 : 0,
      laborRateMedian: laborRates.length > 0 ? laborRates[Math.floor(laborRates.length / 2)] : 0,
      favoritesSaved: favoritesCount,
    },
    invoices: {
      total: totalInvoices,
      statuses: invoiceStatuses,
      quoteToInvoiceRate: totalQuotes > 0 ? Math.round(totalInvoices / totalQuotes * 1000) / 10 : 0,
    },
    mrr: proCount * 2900,
    cohortedFunnel: Array.from(cohortMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data })),
    acquisition: {
      platforms: platformCounts,
      authMethods: authMethodCounts,
    },
    emailPipeline,
    dropoffSegments,
    tradeRetention,
    tradeTypes,
    jobTypes: Object.entries(jobTypesMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count })),
    quotesByMonth: Object.entries(quotesByMonthMap).sort().map(([month, count]) => ({ month, count })),
    signupsByMonth: Object.entries(signupsByMonthMap).sort().map(([month, count]) => ({ month, count })),
    users: usersList,
    recentQuotes: recentQuotes.slice(0, 30),
    cancellations,
    acceptanceLinksGenerated: tokensSnap.size,
    emailsSent,
    emailCategories,
    retention: {
      activeLastWeek,
      activeLastMonth,
      neverReturned,
    },
    referrals: {
      totalCodes: totalReferralCodes,
      totalReferrals: totalReferralsCount,
      convertedReferrals: totalConvertedReferrals,
      pendingReferrals: totalPendingReferrals,
      affiliates: affiliatesList,
      topReferrers: topReferrersList.slice(0, 20),
    },
  };
}

function generateDashboardPage(data: AnalyticsData, key: string): string {
  const d = data;
  const funnelMax = d.funnel.totalSignups || 1;
  const funnelSteps = [
    { label: 'Signups', value: d.funnel.totalSignups },
    { label: 'Onboarded', value: d.funnel.onboarded },
    { label: '1+ Quotes', value: d.funnel.createdQuote },
    { label: '5+ Quotes', value: d.funnel.created5PlusQuotes },
    { label: 'Invoiced', value: d.funnel.createdInvoice },
    { label: 'Pro', value: d.funnel.proSubscribers },
  ];

  const funnelHtml = funnelSteps.map(s => {
    const pct = Math.max((s.value / funnelMax) * 100, 2);
    const convPct = ((s.value / funnelMax) * 100).toFixed(0);
    return `<div class="funnel-row">
      <span class="funnel-label">${s.label}</span>
      <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${pct}%">${s.value}</div></div>
      <span class="funnel-pct">${convPct}%</span>
    </div>`;
  }).join('');

  // Quote status badges
  const statusColors: Record<string, string> = { draft: '#64748b', sent: '#3b82f6', accepted: '#22c55e', completed: '#10b981', rejected: '#ef4444', cancelled: '#f59e0b', unknown: '#94a3b8' };
  const statusHtml = Object.entries(d.quotes.statuses).map(([s, c]) =>
    `<span class="badge" style="background:${statusColors[s] || '#64748b'}">${escapeHtml(s)}: ${c}</span>`
  ).join(' ');

  // Monthly trend bars
  const allMonths = [...new Set([...d.signupsByMonth.map(m => m.month), ...d.quotesByMonth.map(m => m.month)])].sort();
  const signupMap = Object.fromEntries(d.signupsByMonth.map(m => [m.month, m.count]));
  const quoteMap = Object.fromEntries(d.quotesByMonth.map(m => [m.month, m.count]));
  const maxMonthly = Math.max(...allMonths.map(m => Math.max(signupMap[m] || 0, quoteMap[m] || 0)), 1);

  const trendsHtml = allMonths.map(m => {
    const su = signupMap[m] || 0;
    const qu = quoteMap[m] || 0;
    return `<div class="trend-col">
      <div class="trend-bars">
        <div class="trend-bar signup" style="height:${Math.max((su / maxMonthly) * 100, 3)}%" title="Signups: ${su}">${su || ''}</div>
        <div class="trend-bar quotes" style="height:${Math.max((qu / maxMonthly) * 100, 3)}%" title="Quotes: ${qu}">${qu || ''}</div>
      </div>
      <span class="trend-label">${m.substring(2)}</span>
    </div>`;
  }).join('');

  // Cohorted funnel heatmap
  const cohortColor = (pct: number): string => {
    if (pct >= 60) return 'rgba(34,197,94,0.35)';
    if (pct >= 40) return 'rgba(34,197,94,0.2)';
    if (pct >= 25) return 'rgba(234,179,8,0.25)';
    if (pct >= 10) return 'rgba(251,146,60,0.2)';
    return pct > 0 ? 'rgba(239,68,68,0.15)' : 'transparent';
  };
  const cohortCell = (count: number, total: number): string => {
    if (total === 0) return '<td class="cohort-cell">-</td>';
    const pct = Math.round(count / total * 100);
    return `<td class="cohort-cell" style="background:${cohortColor(pct)}"><span class="cohort-count">${count}</span> <span class="cohort-pct">${pct}%</span></td>`;
  };
  const cohortRowsHtml = d.cohortedFunnel.map(c => {
    const monthLabel = c.month.substring(2); // e.g. "25-10"
    return `<tr>
      <td style="color:#94a3b8;font-weight:500">${monthLabel}</td>
      <td class="cohort-cell" style="background:rgba(59,130,246,0.2)"><span class="cohort-count">${c.signups}</span></td>
      ${cohortCell(c.onboarded, c.signups)}
      ${cohortCell(c.createdQuote, c.signups)}
      ${cohortCell(c.created5Plus, c.signups)}
      ${cohortCell(c.invoiced, c.signups)}
      ${cohortCell(c.pro, c.signups)}
    </tr>`;
  }).join('');

  // Acquisition bars
  const platformTotal = Object.values(d.acquisition.platforms).reduce((a, b) => a + b, 0) || 1;
  const platformColors: Record<string, string> = { ios: '#007AFF', android: '#3DDC84', web: '#f97316' };
  const platformBarsHtml = Object.entries(d.acquisition.platforms)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => {
      const pct = Math.max((c / platformTotal) * 100, 3);
      return `<div class="acq-row">
        <span class="acq-label">${escapeHtml(p.charAt(0).toUpperCase() + p.slice(1))}</span>
        <div class="acq-bar-wrap"><div class="acq-bar" style="width:${pct}%;background:${platformColors[p] || '#64748b'}">${c} (${Math.round(c / platformTotal * 100)}%)</div></div>
      </div>`;
    }).join('');

  const authTotal = Object.values(d.acquisition.authMethods).reduce((a, b) => a + b, 0) || 1;
  const authColors: Record<string, string> = { email: '#64748b', google: '#4285F4', apple: '#f8fafc' };
  const authBarsHtml = Object.entries(d.acquisition.authMethods)
    .sort((a, b) => b[1] - a[1])
    .map(([m, c]) => {
      const pct = Math.max((c / authTotal) * 100, 3);
      return `<div class="acq-row">
        <span class="acq-label">${escapeHtml(m.charAt(0).toUpperCase() + m.slice(1))}</span>
        <div class="acq-bar-wrap"><div class="acq-bar" style="width:${pct}%;background:${authColors[m] || '#64748b'}">${c} (${Math.round(c / authTotal * 100)}%)</div></div>
      </div>`;
    }).join('');

  // Email pipeline
  const ep = d.emailPipeline;
  const pipelineSteps = [
    { label: 'Welcome', count: ep.welcome, color: '#3b82f6' },
    { label: 'Tip 1', count: ep.onboardingTip1, color: '#8b5cf6' },
    { label: 'Tip 2', count: ep.onboardingTip2, color: '#a855f7' },
    { label: 'Tip 3', count: ep.onboardingTip3, color: '#c084fc' },
    { label: 'Re-engage', count: ep.reEngagement, color: '#f59e0b' },
    { label: 'Follow-up', count: ep.quoteFollowUp, color: '#22c55e' },
  ];
  const pipelineHtml = pipelineSteps.map((s, i) =>
    `<div class="pipe-step">
      <div class="pipe-box" style="border-color:${s.color}"><div class="pipe-count" style="color:${s.color}">${s.count}</div><div class="pipe-label">${s.label}</div></div>
      ${i < pipelineSteps.length - 1 ? '<div class="pipe-arrow">&#8594;</div>' : ''}
    </div>`
  ).join('');

  // Referrals section
  const referralsKpiHtml = `
    <div class="kpi-grid" style="margin-bottom:0">
      <div class="kpi"><div class="value">${d.referrals.totalCodes}</div><div class="label">Referral Codes</div></div>
      <div class="kpi"><div class="value">${d.referrals.totalReferrals}</div><div class="label">Total Referrals</div></div>
      <div class="kpi"><div class="value">${d.referrals.convertedReferrals}</div><div class="label">Converted</div></div>
      <div class="kpi"><div class="value">${d.referrals.pendingReferrals}</div><div class="label">Pending (30d)</div></div>
      <div class="kpi"><div class="value">${d.referrals.affiliates.length}</div><div class="label">Affiliates</div></div>
    </div>`;

  const affiliatesRowsHtml = d.referrals.affiliates.length > 0
    ? d.referrals.affiliates.map(a => `<tr>
        <td>${escapeHtml(a.email)}</td>
        <td><code>${escapeHtml(a.referralCode)}</code></td>
        <td class="num">${a.totalReferrals}</td>
        <td class="num">${a.convertedReferrals}</td>
        <td class="num">${(a.commissionRate * 100).toFixed(0)}%</td>
        <td class="num">$${(a.totalEarnings / 100).toFixed(2)}</td>
        <td class="num">$${(a.pendingEarnings / 100).toFixed(2)}</td>
        <td class="num">$${(a.paidEarnings / 100).toFixed(2)}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="muted" style="text-align:center">No affiliates yet</td></tr>';

  const topReferrersRowsHtml = d.referrals.topReferrers.length > 0
    ? d.referrals.topReferrers.map(r => `<tr>
        <td>${escapeHtml(r.email)}</td>
        <td><code>${escapeHtml(r.referralCode)}</code></td>
        <td class="num">${r.totalReferrals}</td>
        <td class="num">${r.convertedReferrals}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted" style="text-align:center">No referrals yet</td></tr>';

  // Stage colors
  const stageColors: Record<string, string> = { new: '#3b82f6', onboarding: '#a855f7', active: '#22c55e', pro: '#f97316', 'at-risk': '#eab308', churned: '#ef4444' };

  // Drop-off segments
  const segmentColors = ['#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#22c55e', '#eab308'];
  const dropoffHtml = d.dropoffSegments.map((seg, i) => {
    const color = segmentColors[i % segmentColors.length];
    const emailList = seg.emails.join(', ');
    return `<div class="segment-card" style="border-left:3px solid ${color}">
      <div class="seg-header">
        <div>
          <div class="seg-name">${escapeHtml(seg.name)} <span class="seg-count">${seg.count}</span></div>
          <div class="seg-desc">${escapeHtml(seg.description)}</div>
        </div>
        <button class="copy-btn" onclick="copyEmails(this, '${escapeHtml(emailList).replace(/'/g, '\\&#39;')}')" title="Copy emails">Copy Emails</button>
      </div>
      ${seg.count > 0 ? `<div class="seg-emails">${seg.emails.map(e => `<span class="seg-email">${escapeHtml(e)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  // Trade retention
  const tradeRetHtml = d.tradeRetention.map(t => {
    const retColor = t.retentionPct >= 30 ? '#22c55e' : t.retentionPct >= 15 ? '#eab308' : '#ef4444';
    return `<tr>
      <td>${escapeHtml(t.trade)}</td>
      <td class="num">${t.total}</td>
      <td class="num" style="color:#22c55e">${t.active}</td>
      <td class="num" style="color:#ef4444">${t.churned}</td>
      <td class="num"><span style="color:${retColor};font-weight:600">${t.retentionPct}%</span></td>
    </tr>`;
  }).join('');

  // Users table — expandable rows with quote detail
  const usersRowsHtml = d.users.map((u, idx) => {
    const stageColor = stageColors[u.stage] || '#64748b';
    const jobsList = u.quoteJobs.length > 0 ? u.quoteJobs.map(j => `<span class="job-tag">${escapeHtml(j)}</span>`).join('') : '<span class="muted">-</span>';
    const daysAgo = u.daysSinceLogin;
    const daysColor = daysAgo <= 7 ? '#22c55e' : daysAgo <= 30 ? '#eab308' : '#ef4444';
    return `<tr class="user-row" data-stage="${escapeHtml(u.stage)}" data-idx="${idx}" onclick="toggleDetail(${idx})">
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.businessName)}</td>
      <td>${escapeHtml(u.tradeType)}</td>
      <td class="num">${u.quotes}</td>
      <td class="num">${u.sentQuotes}/${u.acceptedQuotes}</td>
      <td><span class="badge" style="background:${stageColor}">${escapeHtml(u.stage)}</span></td>
      <td style="color:${daysColor}">${daysAgo}d ago</td>
      <td>${u.signupDate}</td>
    </tr>
    <tr class="detail-row" id="detail-${idx}" style="display:none">
      <td colspan="8" style="padding:12px 16px;background:#0f172a;border-left:3px solid ${stageColor}">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:12px">
          <div>
            <div class="muted" style="margin-bottom:4px">PLATFORM / AUTH</div>
            <div>${escapeHtml(u.platform || 'unknown')} / ${escapeHtml(u.authMethod || 'unknown')}</div>
          </div>
          <div>
            <div class="muted" style="margin-bottom:4px">QUOTE TIMELINE</div>
            <div>First: ${u.firstQuoteDate || 'never'} | Last: ${u.lastQuoteDate || 'never'}</div>
          </div>
          <div>
            <div class="muted" style="margin-bottom:4px">AVG QUOTE VALUE</div>
            <div>${u.avgQuoteValue > 0 ? '$' + u.avgQuoteValue.toLocaleString() : '-'}</div>
          </div>
        </div>
        <div style="margin-top:8px;font-size:12px">
          <span class="muted">JOBS QUOTED:</span> ${jobsList}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Stage counts for filter buttons
  const stageCounts: Record<string, number> = {};
  d.users.forEach(u => { stageCounts[u.stage] = (stageCounts[u.stage] || 0) + 1; });

  // Recent quotes table
  const recentRowsHtml = d.recentQuotes.slice(0, 20).map(q => {
    const statusColor = statusColors[q.status] || '#64748b';
    return `<tr>
      <td>${q.date.split('T')[0]}</td>
      <td>${escapeHtml(q.email)}</td>
      <td class="num">$${q.total.toFixed(2)}</td>
      <td><span class="badge" style="background:${statusColor}">${escapeHtml(q.status)}</span></td>
      <td>${escapeHtml(q.job.substring(0, 30))}</td>
      <td>${escapeHtml(q.customer)} (${q.materialsCount} items)</td>
    </tr>`;
  }).join('');

  // Job types list
  const jobTypesHtml = d.jobTypes.slice(0, 10).map(j =>
    `<div class="job-row"><span class="job-name">${escapeHtml(j.name)}</span><span class="job-count">${j.count}x</span></div>`
  ).join('');

  // Cancellation table
  const cancelTableHtml = d.cancellations.length > 0
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Email</th><th>Reason</th><th>Feedback</th></tr></thead>
        <tbody>${d.cancellations.map(c => `<tr>
          <td>${c.date || '-'}</td>
          <td>${escapeHtml(c.email || '-')}</td>
          <td><span class="badge" style="background:#ef4444">${escapeHtml(c.reason)}</span></td>
          <td style="white-space:normal;max-width:300px;color:#94a3b8">${escapeHtml(c.feedback) || '<span class="muted">-</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<div class="muted">No cancellations</div>';

  // Stage filter buttons HTML
  const stageFilterHtml = ['all', 'new', 'onboarding', 'active', 'pro', 'at-risk', 'churned'].map(s => {
    const count = s === 'all' ? d.users.length : (stageCounts[s] || 0);
    const color = s === 'all' ? '#64748b' : (stageColors[s] || '#64748b');
    return `<button class="stage-btn${s === 'all' ? ' active' : ''}" data-filter="${s}" style="--btn-color:${color}">${s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} (${count})</button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuoteMate Admin Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      padding: 20px;
      padding-top: 60px;
      line-height: 1.5;
    }

    /* Sticky nav */
    .topnav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 10;
      background: #0f172a; border-bottom: 1px solid #334155;
      padding: 10px 20px; display: flex; gap: 16px; overflow-x: auto;
      font-size: 12px; -webkit-overflow-scrolling: touch;
    }
    .topnav a { color: #94a3b8; text-decoration: none; white-space: nowrap; padding: 4px 0; }
    .topnav a:hover { color: #f97316; }

    .header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
    }
    .header h1 { font-size: 24px; color: #f97316; }
    .header .meta { color: #64748b; font-size: 13px; }
    .refresh-btn {
      background: #1e293b; border: 1px solid #334155; color: #f8fafc;
      padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
    }
    .refresh-btn:hover { border-color: #f97316; }

    .kpi-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px; margin-bottom: 24px;
    }
    .kpi {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      padding: 16px; text-align: center;
    }
    .kpi .value { font-size: 28px; font-weight: 700; color: #f97316; }
    .kpi .label { font-size: 12px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi.highlight { border-color: #f97316; }

    .card {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      padding: 20px; margin-bottom: 20px;
    }
    .card h2 { font-size: 16px; color: #f97316; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }

    /* Funnel */
    .funnel-row { display: flex; align-items: center; margin-bottom: 8px; gap: 8px; }
    .funnel-label { width: 90px; font-size: 13px; color: #94a3b8; text-align: right; }
    .funnel-bar-wrap { flex: 1; background: #0f172a; border-radius: 6px; height: 28px; overflow: hidden; }
    .funnel-bar { background: linear-gradient(90deg, #f97316, #fb923c); height: 100%; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; min-width: 28px; color: #fff; }
    .funnel-pct { width: 40px; font-size: 13px; color: #64748b; }

    /* Cohort heatmap */
    .cohort-cell { padding: 6px 10px; text-align: center; border: 1px solid #334155; }
    .cohort-count { font-weight: 600; color: #f8fafc; }
    .cohort-pct { font-size: 10px; color: #94a3b8; margin-left: 2px; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; color: #fff; }
    .badge.pro { background: #f97316; }
    .badge.free { background: #334155; color: #94a3b8; }

    /* Acquisition bars */
    .acq-row { display: flex; align-items: center; margin-bottom: 8px; gap: 8px; }
    .acq-label { width: 70px; font-size: 13px; color: #94a3b8; text-align: right; }
    .acq-bar-wrap { flex: 1; background: #0f172a; border-radius: 6px; height: 28px; overflow: hidden; }
    .acq-bar { height: 100%; border-radius: 6px; display: flex; align-items: center; padding-left: 10px; font-size: 12px; font-weight: 600; min-width: 40px; color: #fff; }

    /* Email pipeline */
    .pipeline { display: flex; align-items: center; gap: 4px; overflow-x: auto; padding: 8px 0; }
    .pipe-step { display: flex; align-items: center; gap: 4px; }
    .pipe-box { border: 2px solid; border-radius: 10px; padding: 12px 16px; text-align: center; min-width: 80px; background: #0f172a; }
    .pipe-count { font-size: 22px; font-weight: 700; }
    .pipe-label { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .pipe-arrow { color: #334155; font-size: 18px; }

    /* Stage filter buttons */
    .stage-filters { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .stage-btn {
      background: #0f172a; border: 1px solid #334155; color: #94a3b8;
      padding: 4px 12px; border-radius: 16px; cursor: pointer; font-size: 12px;
      transition: all 0.15s;
    }
    .stage-btn:hover, .stage-btn.active { border-color: var(--btn-color); color: #f8fafc; background: color-mix(in srgb, var(--btn-color) 15%, #0f172a); }

    /* Search */
    .search-input {
      width: 100%; padding: 8px 12px; background: #0f172a; border: 1px solid #334155;
      border-radius: 8px; color: #f8fafc; font-size: 13px; margin-bottom: 12px; outline: none;
    }
    .search-input:focus { border-color: #f97316; }

    /* Trends */
    .trends-container { display: flex; gap: 4px; align-items: flex-end; height: 140px; padding-top: 10px; }
    .trend-col { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
    .trend-bars { display: flex; gap: 2px; align-items: flex-end; height: 110px; width: 100%; }
    .trend-bar { flex: 1; border-radius: 4px 4px 0 0; display: flex; align-items: flex-end; justify-content: center; font-size: 10px; color: #fff; min-height: 3px; padding-bottom: 2px; }
    .trend-bar.signup { background: #3b82f6; }
    .trend-bar.quotes { background: #f97316; }
    .trend-label { font-size: 10px; color: #64748b; margin-top: 4px; white-space: nowrap; }
    .legend { display: flex; gap: 16px; margin-bottom: 8px; font-size: 12px; color: #94a3b8; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }

    /* Tables */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #64748b; font-weight: 500; padding: 8px 12px; border-bottom: 1px solid #334155; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: #0f172a; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    /* Job types */
    .job-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #0f172a; font-size: 13px; }
    .job-name { color: #cbd5e1; }
    .job-count { color: #f97316; font-weight: 600; }

    .muted { color: #64748b; }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #0f172a; font-size: 13px; }
    .stat-label { color: #94a3b8; }
    .stat-value { color: #f8fafc; font-weight: 500; }

    /* Platform badges */
    .plat-badges { display: flex; gap: 8px; justify-content: center; margin-top: -12px; margin-bottom: 20px; flex-wrap: wrap; }
    .plat-badge { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 500; }

    /* Drop-off segments */
    .segment-card {
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      padding: 14px 16px; margin-bottom: 10px;
    }
    .seg-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .seg-name { font-size: 14px; font-weight: 600; color: #f8fafc; }
    .seg-count { font-size: 20px; font-weight: 700; color: #f97316; margin-left: 6px; }
    .seg-desc { font-size: 12px; color: #64748b; margin-top: 2px; }
    .seg-emails { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
    .seg-email { font-size: 11px; padding: 2px 8px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; color: #94a3b8; }
    .copy-btn {
      background: #1e293b; border: 1px solid #334155; color: #94a3b8;
      padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 11px;
      white-space: nowrap; transition: all 0.15s;
    }
    .copy-btn:hover { border-color: #f97316; color: #f8fafc; }
    .copy-btn.copied { background: #22c55e; border-color: #22c55e; color: #fff; }

    /* Job tags */
    .job-tag { display: inline-block; font-size: 11px; padding: 1px 8px; background: #334155; border-radius: 4px; color: #cbd5e1; margin: 1px 2px; }

    /* Expandable user rows */
    .user-row { cursor: pointer; }
    .user-row:hover td { background: #0f172a; }
    .detail-row td { border-bottom: 2px solid #334155; }
  </style>
</head>
<body>
  <!-- Sticky Nav -->
  <nav class="topnav">
    <a href="#kpis">KPIs</a>
    <a href="#cohorts">Cohorts</a>
    <a href="#dropoff">Drop-off</a>
    <a href="#trades">Trades</a>
    <a href="#funnel">Funnel</a>
    <a href="#acquisition">Acquisition</a>
    <a href="#emails">Emails</a>
    <a href="#trends">Trends</a>
    <a href="#users">Users</a>
    <a href="#quotes">Quotes</a>
    <a href="#jobs">Jobs</a>
    <a href="#cancellations">Cancellations</a>
    <a href="#referrals">Referrals</a>
  </nav>

  <div class="header">
    <div>
      <h1>QuoteMate Dashboard</h1>
      <div class="meta">Generated: ${new Date(d.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} AEST</div>
    </div>
    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
  </div>

  <!-- KPI Cards -->
  <div id="kpis" class="kpi-grid">
    <div class="kpi"><div class="value">${d.funnel.totalSignups}</div><div class="label">Total Users</div></div>
    <div class="kpi"><div class="value">${d.retention.activeLastWeek}</div><div class="label">Active (7d)</div></div>
    <div class="kpi"><div class="value">${d.retention.activeLastMonth}</div><div class="label">Active (30d)</div></div>
    <div class="kpi"><div class="value">${d.quotes.total}</div><div class="label">Total Quotes</div></div>
    <div class="kpi"><div class="value">$${Math.round(d.quotes.totalValue).toLocaleString()}</div><div class="label">Total Quoted</div></div>
    <div class="kpi highlight"><div class="value">${d.funnel.proSubscribers}</div><div class="label">Pro Subs</div></div>
    <div class="kpi highlight"><div class="value">$${(d.mrr / 100).toFixed(0)}</div><div class="label">MRR</div></div>
    <div class="kpi"><div class="value">${d.invoices.total}</div><div class="label">Invoices</div></div>
    <div class="kpi"><div class="value">${d.retention.neverReturned}</div><div class="label">Never Returned</div></div>
  </div>

  <!-- Platform badges -->
  <div class="plat-badges">
    ${Object.entries(d.acquisition.platforms).sort((a, b) => b[1] - a[1]).map(([p, c]) =>
      `<span class="plat-badge" style="background:${platformColors[p] || '#64748b'}30;color:${platformColors[p] || '#94a3b8'}">${p.toUpperCase()}: ${c}</span>`
    ).join('')}
    <span class="plat-badge" style="background:#33415530;color:#94a3b8">Emails: ${d.emailsSent}</span>
    <span class="plat-badge" style="background:#33415530;color:#94a3b8">Acceptance Links: ${d.acceptanceLinksGenerated}</span>
    <span class="plat-badge" style="background:#33415530;color:#94a3b8">Material Favs: ${d.quotes.favoritesSaved}</span>
  </div>

  <!-- Cohorted Funnel Heatmap -->
  <div id="cohorts" class="card">
    <h2>Conversion by Signup Month</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Month</th><th>Signups</th><th>Onboarded</th><th>1+ Quotes</th><th>5+ Quotes</th><th>Invoiced</th><th>Pro</th>
        </tr></thead>
        <tbody>${cohortRowsHtml}</tbody>
      </table>
    </div>
  </div>

  <!-- Drop-off Analysis -->
  <div id="dropoff" class="card">
    <h2>Where Users Drop Off</h2>
    ${dropoffHtml}
  </div>

  <!-- Trade Retention -->
  <div id="trades" class="two-col">
    <div class="card">
      <h2>Retention by Trade</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Trade</th><th>Total</th><th>Active</th><th>Churned</th><th>Retention</th></tr></thead>
          <tbody>${tradeRetHtml || '<tr><td colspan="5" class="muted" style="text-align:center">Not enough data</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Top Job Types</h2>
      ${jobTypesHtml}
    </div>
  </div>

  <!-- Funnel + Quote Stats -->
  <div id="funnel" class="two-col">
    <div class="card">
      <h2>Overall Funnel</h2>
      ${funnelHtml}
    </div>
    <div class="card">
      <h2>Quote Statistics</h2>
      <div class="stat-row"><span class="stat-label">Statuses</span><span class="stat-value">${statusHtml}</span></div>
      <div class="stat-row"><span class="stat-label">AI Generated</span><span class="stat-value">${d.quotes.aiGenerated} / ${d.quotes.total} (${d.quotes.total > 0 ? Math.round(d.quotes.aiGenerated / d.quotes.total * 100) : 0}%)</span></div>
      <div class="stat-row"><span class="stat-label">Avg Value</span><span class="stat-value">$${d.quotes.avgValue.toFixed(2)}</span></div>
      <div class="stat-row"><span class="stat-label">Median Value</span><span class="stat-value">$${d.quotes.medianValue.toFixed(2)}</span></div>
      <div class="stat-row"><span class="stat-label">Range</span><span class="stat-value">$${d.quotes.minValue.toFixed(0)} - $${d.quotes.maxValue.toFixed(0)}</span></div>
      <div class="stat-row"><span class="stat-label">Avg Markup</span><span class="stat-value">${d.quotes.avgMarkup}%</span></div>
      <div class="stat-row"><span class="stat-label">Median Labor Rate</span><span class="stat-value">$${d.quotes.laborRateMedian}/hr</span></div>
      <div class="stat-row"><span class="stat-label">Avg Materials/Quote</span><span class="stat-value">${d.quotes.avgMaterialsPerQuote}</span></div>
      <div class="stat-row"><span class="stat-label">Quote-to-Invoice</span><span class="stat-value">${d.invoices.quoteToInvoiceRate}%</span></div>
    </div>
  </div>

  <!-- Acquisition -->
  <div id="acquisition" class="two-col">
    <div class="card">
      <h2>Platform Split</h2>
      ${platformBarsHtml || '<div class="muted">No platform data yet</div>'}
    </div>
    <div class="card">
      <h2>Auth Method</h2>
      ${authBarsHtml || '<div class="muted">No auth data yet</div>'}
    </div>
  </div>

  <!-- Email Pipeline -->
  <div id="emails" class="card">
    <h2>Automated Email Pipeline</h2>
    <div class="pipeline">${pipelineHtml}</div>
    <div style="margin-top:12px;display:flex;gap:12px;font-size:12px;color:#94a3b8">
      <span>Total sent: <strong style="color:#f8fafc">${d.emailsSent}</strong></span>
      ${Object.entries(d.emailCategories).map(([cat, count]) =>
        `<span>${escapeHtml(cat)}: <strong style="color:#f8fafc">${count}</strong></span>`
      ).join('')}
    </div>
  </div>

  <!-- Trends -->
  <div id="trends" class="card">
    <h2>Monthly Trends</h2>
    <div class="legend">
      <span><span class="legend-dot" style="background:#3b82f6"></span> Signups</span>
      <span><span class="legend-dot" style="background:#f97316"></span> Quotes</span>
    </div>
    <div class="trends-container">${trendsHtml}</div>
  </div>

  <!-- Users Table -->
  <div id="users" class="card">
    <h2>Users (${d.users.length})</h2>
    <input type="text" id="userSearch" class="search-input" placeholder="Search by email, business, trade...">
    <div class="stage-filters">${stageFilterHtml}</div>
    <div class="table-wrap">
      <table id="usersTable">
        <thead><tr>
          <th>Email</th><th>Business</th><th>Trade</th><th>Quotes</th><th>Sent/Won</th><th>Stage</th><th>Last Active</th><th>Signed Up</th>
        </tr></thead>
        <tbody>${usersRowsHtml}</tbody>
      </table>
    </div>
  </div>

  <!-- Recent Quotes -->
  <div id="quotes" class="card">
    <h2>Recent Quotes</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th><th>User</th><th>Total</th><th>Status</th><th>Job</th><th>Customer</th>
        </tr></thead>
        <tbody>${recentRowsHtml}</tbody>
      </table>
    </div>
  </div>

  <div id="cancellations" class="card">
    <h2>Cancellations (${d.cancellations.length})</h2>
    ${cancelTableHtml}
  </div>

  <!-- Referrals & Affiliates -->
  <div id="referrals" class="card">
    <h2>Referrals & Affiliates</h2>
    ${referralsKpiHtml}
  </div>

  <div class="two-col">
    <div class="card">
      <h2>Affiliates</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Email</th><th>Code</th><th>Referrals</th><th>Converted</th><th>Rate</th><th>Total</th><th>Pending</th><th>Paid</th>
          </tr></thead>
          <tbody>${affiliatesRowsHtml}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Top Referrers</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Email</th><th>Code</th><th>Referrals</th><th>Converted</th>
          </tr></thead>
          <tbody>${topReferrersRowsHtml}</tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    // Auto-refresh every 5 minutes
    setInterval(function() { location.reload(); }, 5 * 60 * 1000);

    // Toggle user detail row
    function toggleDetail(idx) {
      var row = document.getElementById('detail-' + idx);
      if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
    }

    // Copy emails to clipboard
    function copyEmails(btn, emails) {
      navigator.clipboard.writeText(emails).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy Emails'; btn.classList.remove('copied'); }, 2000);
      });
    }

    // Filter user rows (handles user-row + detail-row pairs)
    function filterUsers() {
      var q = document.getElementById('userSearch').value.toLowerCase();
      var activeFilter = document.querySelector('.stage-btn.active');
      var stage = activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
      document.querySelectorAll('#usersTable tbody tr.user-row').forEach(function(row) {
        var matchesSearch = !q || row.textContent.toLowerCase().includes(q);
        var matchesStage = stage === 'all' || row.getAttribute('data-stage') === stage;
        var show = matchesSearch && matchesStage;
        row.style.display = show ? '' : 'none';
        var idx = row.getAttribute('data-idx');
        var detail = document.getElementById('detail-' + idx);
        if (detail && !show) detail.style.display = 'none';
      });
    }

    // User table search
    document.getElementById('userSearch').addEventListener('input', filterUsers);

    // Stage filter buttons
    document.querySelectorAll('.stage-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.stage-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        filterUsers();
      });
    });

    // Smooth scroll for nav
    document.querySelectorAll('.topnav a').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  </script>
</body>
</html>`;
}

export const adminDashboard = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    if (!verifyAdminKey(req, res)) return;

    try {
      const data = await getAdminAnalyticsData();

      // JSON format for API consumers
      if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
        res.status(200).json(data);
        return;
      }

      // HTML dashboard
      res.status(200).send(generateDashboardPage(data, req.query.key as string));
    } catch (error: any) {
      res.status(500).send(generateErrorPage('Dashboard Error', error.message));
    }
  });

// ============================================================
// SEND UPDATE ANNOUNCEMENT EMAIL
// ============================================================
export const sendUpdateAnnouncement = functions
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const corsHandler = cors({ origin: true });
    corsHandler(req, res, async () => {
      // Gate with admin key
      const adminKey = process.env.ADMIN_DASHBOARD_KEY;
      if (!adminKey || req.query.key !== adminKey) {
        res.status(403).send('Unauthorized');
        return;
      }

      try {
        // Optional: send to a single email for testing
        const testEmail = req.query.email as string;

        if (testEmail) {
          // Send to single address (for testing)
          const success = await sendUpdateAnnouncementEmail(testEmail, '', 'test');
          res.status(200).json({ sent: success ? 1 : 0, failed: success ? 0 : 1 });
          return;
        }

        // Send to all users
        const authUsers = await admin.auth().listUsers(1000);
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const user of authUsers.users) {
          const email = user.email;
          if (!email) { skipped++; continue; }

          // Get business name
          let businessName = '';
          try {
            const settingsDoc = await admin.firestore()
              .doc(`users/${user.uid}/settings/business`)
              .get();
            if (settingsDoc.exists) {
              businessName = settingsDoc.data()?.businessName || '';
            }
          } catch (e) { /* ignore */ }

          try {
            const success = await sendUpdateAnnouncementEmail(email, businessName, user.uid);
            if (success) sent++; else failed++;
          } catch (e) {
            failed++;
          }
        }

        res.status(200).json({ sent, failed, skipped, total: authUsers.users.length });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  });

// ==========================================
// Feedback Function
// ==========================================

/**
 * Submit feedback directly from the app.
 * Sends an email to the admin with the user's feedback.
 */
export const submitFeedback = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const userId = context.auth.uid;
  const category = (data?.category || 'General').trim().slice(0, 100);
  const feedback = (data?.feedback || '').trim().slice(0, 5000);

  if (!feedback) {
    throw new functions.https.HttpsError('invalid-argument', 'Feedback text is required');
  }

  // Get user email
  const userEmail = await getUserEmail(userId) || 'Unknown';

  const success = await sendFeedbackEmail(userEmail, userId, category, feedback);

  if (!success) {
    throw new functions.https.HttpsError('internal', 'Failed to send feedback');
  }

  // Also store in Firestore for reference
  await admin.firestore().collection('feedback').add({
    userId,
    userEmail,
    category,
    feedback,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// ==========================================
// Referral Program Functions
// ==========================================

/**
 * Generate a unique referral code for a user.
 * Callable function — requires authentication.
 */
export const generateReferralCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const userId = context.auth.uid;
  const firestore = admin.firestore();
  const referralRef = firestore.doc(`users/${userId}/profile/referral`);

  // Check if user already has a code
  const existing = await referralRef.get();
  if (existing.exists && existing.data()?.referralCode) {
    return { referralCode: existing.data()!.referralCode };
  }

  // Generate unique 6-char code with QM- prefix
  let code = '';
  let attempts = 0;
  while (attempts < 10) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let raw = '';
    for (let i = 0; i < 6; i++) {
      raw += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = `QM-${raw}`;

    // Check uniqueness
    const codeDoc = await firestore.doc(`referrals/${code}`).get();
    if (!codeDoc.exists) break;
    attempts++;
  }

  if (!code) {
    throw new functions.https.HttpsError('internal', 'Failed to generate unique code');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  // Write both docs atomically
  const batch = firestore.batch();
  batch.set(referralRef, {
    referralCode: code,
    referredBy: null,
    totalReferrals: 0,
    convertedReferrals: 0,
    // Affiliate is NOT enabled by default — must be enabled by admin
    isAffiliate: false,
    commissionRate: 0,
    totalEarnings: 0,
    pendingEarnings: 0,
    paidEarnings: 0,
    lastPayoutAt: null,
    createdAt: now,
  }, { merge: true });

  batch.set(firestore.doc(`referrals/${code}`), {
    referrerUserId: userId,
    createdAt: now,
  });

  await batch.commit();

  return { referralCode: code };
});

/**
 * Apply a referral code to the current user.
 * Callable function — requires authentication.
 */
export const applyReferralCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const userId = context.auth.uid;
  const referralCode = (data?.referralCode || '').trim().toUpperCase();

  if (!referralCode) {
    throw new functions.https.HttpsError('invalid-argument', 'Referral code is required');
  }

  const firestore = admin.firestore();

  // Check if this user already has a referrer
  const userReferralRef = firestore.doc(`users/${userId}/profile/referral`);
  const userReferral = await userReferralRef.get();
  if (userReferral.exists && userReferral.data()?.referredBy) {
    throw new functions.https.HttpsError('already-exists', 'You have already applied a referral code');
  }

  // Validate the referral code
  const codeDoc = await firestore.doc(`referrals/${referralCode}`).get();
  if (!codeDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Invalid referral code — not found');
  }

  const referrerUserId = codeDoc.data()!.referrerUserId;

  // Can't refer yourself
  if (referrerUserId === userId) {
    throw new functions.https.HttpsError('invalid-argument', "You can't use your own referral code");
  }

  // Save referredBy on the new user + increment referrer's totalReferrals
  const batch = firestore.batch();

  batch.set(userReferralRef, {
    referredBy: referrerUserId,
  }, { merge: true });

  const referrerReferralRef = firestore.doc(`users/${referrerUserId}/profile/referral`);
  batch.set(referrerReferralRef, {
    totalReferrals: admin.firestore.FieldValue.increment(1),
  }, { merge: true });

  await batch.commit();

  return { success: true };
});

/**
 * Process referral commission when a referred user pays for Pro.
 * Called internally from subscription update handlers.
 * Records affiliate commission earnings only — no Pro reward is granted.
 */
async function processReferralCommission(
  userId: string,
  platform?: string,
  productId?: string,
  grossAmountCents?: number
): Promise<void> {
  const firestore = admin.firestore();
  const userReferralRef = firestore.doc(`users/${userId}/profile/referral`);
  const userReferral = await userReferralRef.get();

  if (!userReferral.exists) return;
  const data = userReferral.data()!;
  const referrerUserId = data.referredBy;

  if (!referrerUserId) return;

  // Record affiliate earning for this billing period (recurring commission)
  if (platform && productId && grossAmountCents) {
    try {
      await recordAffiliateEarning(
        userId, referrerUserId, platform, productId,
        grossAmountCents, getBillingPeriod()
      );
    } catch (err) {
    }
  }
}

// ============================================
// Affiliate Earnings API
// ============================================

/**
 * Get affiliate earnings for the authenticated user.
 * Returns summary stats and list of earnings.
 */
export const getAffiliateEarnings = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const userId = context.auth.uid;
  const firestore = admin.firestore();

  // Get referral profile for summary
  const referralRef = firestore.doc(`users/${userId}/profile/referral`);
  const referralDoc = await referralRef.get();
  const referralData = referralDoc.exists ? referralDoc.data()! : {};

  // Get earnings list
  const earningsSnap = await firestore
    .collection(`users/${userId}/affiliateEarnings`)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const earnings = earningsSnap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      referredUserId: d.referredUserId,
      referredUserEmail: d.referredUserEmail,
      platform: d.platform,
      grossAmount: d.grossAmount,
      platformFee: d.platformFee,
      netRevenue: d.netRevenue,
      commissionRate: d.commissionRate,
      commissionAmount: d.commissionAmount,
      billingPeriod: d.billingPeriod,
      productId: d.productId,
      status: d.status,
      createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
    };
  });

  return {
    summary: {
      isAffiliate: referralData.isAffiliate || false,
      commissionRate: referralData.commissionRate || DEFAULT_COMMISSION_RATE,
      totalEarnings: referralData.totalEarnings || 0,
      pendingEarnings: referralData.pendingEarnings || 0,
      paidEarnings: referralData.paidEarnings || 0,
      lastPayoutAt: referralData.lastPayoutAt?.toDate?.()?.toISOString() || null,
      totalReferrals: referralData.totalReferrals || 0,
      convertedReferrals: referralData.convertedReferrals || 0,
    },
    earnings,
  };
});

/**
 * Enable or disable a user as an affiliate (admin use).
 * Sets their commission rate and affiliate status.
 * Call from Firebase console or admin tool.
 */
export const setAffiliateStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
  const callerEmail = context.auth.token?.email || '';
  if (!adminEmails.includes(callerEmail)) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can manage affiliates');
  }

  const { userId, isAffiliate, commissionRate } = data || {};

  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId is required');
  }

  const firestore = admin.firestore();
  const referralRef = firestore.doc(`users/${userId}/profile/referral`);

  await referralRef.set({
    isAffiliate: isAffiliate !== false,
    commissionRate: commissionRate || DEFAULT_COMMISSION_RATE,
  }, { merge: true });


  return { success: true };
});

/**
 * Record a manual affiliate payout (admin use).
 * Call this after you have paid an affiliate via bank transfer/PayPal.
 */
export const recordAffiliatePayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  // Simple admin check — only the app owner can record payouts
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
  const callerEmail = context.auth.token?.email || '';
  if (!adminEmails.includes(callerEmail)) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can record payouts');
  }

  const { affiliateUserId, amount, paymentMethod, reference } = data || {};

  if (!affiliateUserId || !amount) {
    throw new functions.https.HttpsError('invalid-argument', 'affiliateUserId and amount are required');
  }

  const firestore = admin.firestore();

  // Mark pending earnings as paid
  const pendingEarnings = await firestore
    .collection(`users/${affiliateUserId}/affiliateEarnings`)
    .where('status', '==', 'pending')
    .get();

  const batch = firestore.batch();
  const earningIds: string[] = [];

  for (const doc of pendingEarnings.docs) {
    batch.update(doc.ref, {
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    earningIds.push(doc.id);
  }

  // Create payout record
  const payoutRef = firestore.collection('affiliatePayouts').doc();
  batch.set(payoutRef, {
    affiliateUserId,
    amount,
    paymentMethod: paymentMethod || 'bank_transfer',
    reference: reference || '',
    earningIds,
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update referrer's totals
  const referralRef = firestore.doc(`users/${affiliateUserId}/profile/referral`);
  batch.set(referralRef, {
    pendingEarnings: 0,
    paidEarnings: admin.firestore.FieldValue.increment(amount),
    lastPayoutAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();

  return { success: true, earningsMarkedPaid: earningIds.length };
});

// ============================================================
// Aussie Push Notification System — Helper & Cloud Functions
// ============================================================

const db = admin.firestore();

/**
 * Send an Aussie-themed push notification to a user.
 * Fetches FCM tokens, checks notification preferences, and sends via FCM.
 */
async function sendAussiePush(
  userId: string,
  event: AussieEvent,
  vars: Record<string, string> = {},
  dataPayload: Record<string, string> = {}
): Promise<void> {
  // Check notification preferences
  const prefsDoc = await db.collection('users').doc(userId).collection('settings').doc('notificationPreferences').get();
  const prefs = prefsDoc.exists ? prefsDoc.data() : {};

  const prefMap: Record<string, string> = {
    quote_accepted: 'quoteUpdates',
    quote_rejected: 'quoteUpdates',
    quote_viewed: 'quoteUpdates',
    quote_expiring: 'quoteUpdates',
    invoice_paid: 'invoiceUpdates',
    invoice_overdue: 'invoiceUpdates',
    daily_motivation: 'dailyMotivation',
    milestone: 'milestoneCelebrations',
    inactivity: 'inactivityNudges',
    draft_nudge: 'inactivityNudges',
  };

  const prefKey = prefMap[event];
  if (prefs && prefKey && prefs[prefKey] === false) {
    return;
  }

  const fcmTokensSnapshot = await db.collection('users').doc(userId).collection('fcmTokens').get();
  if (fcmTokensSnapshot.empty) {
    return;
  }

  const tokens = fcmTokensSnapshot.docs.map(doc => doc.data().token);
  const aussieMsg = getAussieMessage(event, vars);

  const message = {
    notification: {
      title: aussieMsg.title,
      body: aussieMsg.body,
    },
    data: {
      type: event,
      ...dataPayload,
    },
    tokens,
  };

  const fcmResponse = await admin.messaging().sendEachForMulticast(message);

  // Clean up invalid tokens
  const tokensToDelete: string[] = [];
  fcmResponse.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      tokensToDelete.push(fcmTokensSnapshot.docs[idx].id);
    }
  });
  if (tokensToDelete.length > 0) {
    const batch = db.batch();
    for (const tokenDocId of tokensToDelete) {
      batch.delete(db.collection('users').doc(userId).collection('fcmTokens').doc(tokenDocId));
    }
    await batch.commit();
  }
}

// -----------------------------------------------------------
// onQuoteViewed — Firestore trigger: when quote lastViewedAt changes
// -----------------------------------------------------------
export const onQuoteViewed = functions.firestore
  .document('users/{userId}/quotes/{quoteId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { userId, quoteId } = context.params;

    // Only fire when lastViewedAt is set/updated and wasn't just updated by the owner
    if (!after.lastViewedAt || before.lastViewedAt?.toMillis?.() === after.lastViewedAt?.toMillis?.()) {
      return;
    }

    // Don't notify if quote is already accepted/rejected
    if (['accepted', 'rejected', 'completed'].includes(after.status)) {
      return;
    }

    await sendAussiePush(userId, 'quote_viewed', {
      customer: after.customerName || 'A customer',
      job: after.job?.name || 'the job',
    }, { quoteId });
  });

// -----------------------------------------------------------
// onInvoiceStatusChanged — Firestore trigger: when invoice status changes to paid
// -----------------------------------------------------------
export const onInvoiceStatusChanged = functions.firestore
  .document('users/{userId}/invoices/{invoiceId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { userId, invoiceId } = context.params;

    // Only fire when status changes to 'paid'
    if (before.status === after.status || after.status !== 'paid') {
      return;
    }

    await sendAussiePush(userId, 'invoice_paid', {
      customer: after.customerName || 'A customer',
      job: after.job?.name || 'the job',
    }, { invoiceId });
  });

// -----------------------------------------------------------
// onInvoiceOverdue — Scheduled daily: nudge about overdue invoices
// -----------------------------------------------------------
export const onInvoiceOverdue = functions.pubsub
  .schedule('every day 09:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const invoicesSnapshot = await userDoc.ref
        .collection('invoices')
        .where('status', 'in', ['sent', 'partial', 'overdue'])
        .get();

      for (const invoiceDoc of invoicesSnapshot.docs) {
        const invoice = invoiceDoc.data();
        const dueDate = invoice.dueDate?.toDate ? invoice.dueDate.toDate() : new Date(invoice.dueDate);

        if (dueDate >= now) continue; // Not overdue yet

        // Check if we already nudged today
        const lastOverdueNudge = invoice.lastOverdueNudgeAt?.toDate ? invoice.lastOverdueNudgeAt.toDate() : null;
        if (lastOverdueNudge) {
          const hoursSinceNudge = (now.getTime() - lastOverdueNudge.getTime()) / (1000 * 60 * 60);
          if (hoursSinceNudge < 23) continue; // Already nudged within the last day
        }

        await sendAussiePush(userDoc.id, 'invoice_overdue', {
          customer: invoice.customerName || 'A customer',
          job: invoice.job?.name || 'the job',
        }, { invoiceId: invoiceDoc.id });

        // Mark as nudged
        await invoiceDoc.ref.update({ lastOverdueNudgeAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

  });

// -----------------------------------------------------------
// onQuoteExpiring — Scheduled daily: remind about quotes expiring within 48hrs
// -----------------------------------------------------------
export const onQuoteExpiring = functions.pubsub
  .schedule('every day 09:30')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const in48hrs = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const quotesSnapshot = await userDoc.ref
        .collection('quotes')
        .where('status', '==', 'sent')
        .get();

      for (const quoteDoc of quotesSnapshot.docs) {
        const quote = quoteDoc.data();

        // Check if the acceptance token is expiring (30 days from creation)
        if (!quote.acceptanceTokenCreatedAt) continue;
        const tokenCreatedAt = quote.acceptanceTokenCreatedAt.toDate
          ? quote.acceptanceTokenCreatedAt.toDate()
          : new Date(quote.acceptanceTokenCreatedAt);
        const expiresAt = new Date(tokenCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

        if (expiresAt <= now || expiresAt > in48hrs) continue; // Already expired or not expiring soon

        // Check if already notified about expiring
        if (quote.expiryNotifiedAt) continue;

        await sendAussiePush(userDoc.id, 'quote_expiring', {
          customer: quote.customerName || 'A customer',
          job: quote.job?.name || 'the job',
        }, { quoteId: quoteDoc.id });

        await quoteDoc.ref.update({ expiryNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

  });

// -----------------------------------------------------------
// quoteFollowUp — Scheduled every 30 mins: send follow-up email 2hrs after first quote created
// -----------------------------------------------------------
export const quoteFollowUp = functions.pubsub
  .schedule('every 30 minutes')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      // Check if we already sent a follow-up for this user
      const emailStateDoc = await userDoc.ref.collection('settings').doc('emailState').get();
      if (emailStateDoc.exists && emailStateDoc.data()?.quoteFollowUpSentAt) continue;

      // Get all quotes for this user
      const allQuotes = await userDoc.ref
        .collection('quotes')
        .orderBy('createdAt', 'asc')
        .limit(2)
        .get();

      // Only proceed if user has exactly 1 quote (their first)
      if (allQuotes.size !== 1) continue;

      const quoteDoc = allQuotes.docs[0];
      const quote = quoteDoc.data();

      // Check if quote was created at least 2 hours ago
      const createdAt = quote.createdAt?.toDate ? quote.createdAt.toDate() : new Date(quote.createdAt);
      const twoHoursAfter = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
      if (now < twoHoursAfter) continue;

      const email = await getUserEmail(userDoc.id);
      if (!email) continue;

      let businessName = '';
      try {
        const settingsDoc = await db.doc(`users/${userDoc.id}/settings/business`).get();
        businessName = settingsDoc.data()?.businessName || '';
      } catch {}

      const sent = await sendQuoteFollowUpEmail(
        email,
        businessName,
        quote.job?.name || 'the job',
        quote.total || 0,
        userDoc.id
      );

      if (sent) {
        await userDoc.ref.collection('settings').doc('emailState').set({
          quoteFollowUpSentAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

  });

// -----------------------------------------------------------
// dailyMotivation — Scheduled: Aussie motivation at 7:30am AEST
// -----------------------------------------------------------
export const dailyMotivation = functions.pubsub
  .schedule('every day 07:30')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      // Only send to users who have FCM tokens (active users)
      const tokensSnapshot = await userDoc.ref.collection('fcmTokens').get();
      if (tokensSnapshot.empty) continue;

      await sendAussiePush(userDoc.id, 'daily_motivation');
    }

  });

// -----------------------------------------------------------
// milestoneChecker — Scheduled daily: check for quote count milestones
// -----------------------------------------------------------
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

export const milestoneChecker = functions.pubsub
  .schedule('every day 10:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const quotesSnapshot = await userDoc.ref.collection('quotes').get();
      const quoteCount = quotesSnapshot.size;

      // Find the highest milestone achieved
      const achievedMilestone = [...MILESTONES].reverse().find(m => quoteCount >= m);
      if (!achievedMilestone) continue;

      // Check if already celebrated
      const profileDoc = await userDoc.ref.collection('settings').doc('milestones').get();
      const lastCelebrated = profileDoc.exists ? profileDoc.data()?.lastCelebratedMilestone || 0 : 0;

      if (achievedMilestone <= lastCelebrated) continue;

      await sendAussiePush(userDoc.id, 'milestone', {
        n: String(achievedMilestone),
      });

      await userDoc.ref.collection('settings').doc('milestones').set({
        lastCelebratedMilestone: achievedMilestone,
        lastCelebratedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

  });

// -----------------------------------------------------------
// inactivityNudge — Scheduled weekly: nudge users inactive for 7+ days
// -----------------------------------------------------------
export const inactivityNudge = functions.pubsub
  .schedule('every monday 10:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      // Check last activity — use updatedAt on most recent quote as a proxy
      const recentQuoteSnapshot = await userDoc.ref
        .collection('quotes')
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get();

      let lastActive: Date | null = null;
      if (!recentQuoteSnapshot.empty) {
        const lastQuote = recentQuoteSnapshot.docs[0].data();
        lastActive = lastQuote.updatedAt?.toDate ? lastQuote.updatedAt.toDate() : null;
      }

      // Also check invoices
      const recentInvoiceSnapshot = await userDoc.ref
        .collection('invoices')
        .orderBy('updatedAt', 'desc')
        .limit(1)
        .get();

      if (!recentInvoiceSnapshot.empty) {
        const lastInvoice = recentInvoiceSnapshot.docs[0].data();
        const invoiceDate = lastInvoice.updatedAt?.toDate ? lastInvoice.updatedAt.toDate() : null;
        if (invoiceDate && (!lastActive || invoiceDate > lastActive)) {
          lastActive = invoiceDate;
        }
      }

      // Skip if active recently or no activity data
      if (!lastActive || lastActive > sevenDaysAgo) continue;

      // Check if we already nudged recently (within 7 days)
      const nudgeDoc = await userDoc.ref.collection('settings').doc('nudges').get();
      const lastNudgedAt = nudgeDoc.exists ? nudgeDoc.data()?.lastNudgedAt?.toDate?.() : null;
      if (lastNudgedAt && (now.getTime() - lastNudgedAt.getTime()) < 7 * 24 * 60 * 60 * 1000) {
        continue;
      }

      await sendAussiePush(userDoc.id, 'inactivity');

      await userDoc.ref.collection('settings').doc('nudges').set({
        lastNudgedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

  });

// -----------------------------------------------------------
// draftNudge — Scheduled daily: nudge users about aging draft quotes
// Tier 1 (24hrs): push only
// Tier 2 (3 days): push + email
// Tier 3 (7 days): email only (final nudge)
// -----------------------------------------------------------
export const draftNudge = functions.pubsub
  .schedule('every day 11:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const usersSnapshot = await db.collection('users').get();
    let processed = 0;
    let nudgesSent = 0;
    let errors = 0;

    for (const userDoc of usersSnapshot.docs) {
      const draftsSnapshot = await userDoc.ref
        .collection('quotes')
        .where('status', '==', 'draft')
        .get();

      if (draftsSnapshot.empty) continue;

      const draftsToPush: Array<{ doc: FirebaseFirestore.QueryDocumentSnapshot; tier: number; daysOld: number }> = [];
      const draftsForEmail: Array<{ customerName: string; jobName: string; total: number; daysOld: number }> = [];
      let emailTier = 0;

      for (const quoteDoc of draftsSnapshot.docs) {
        const quote = quoteDoc.data();

        // Skip incomplete drafts (no customer = probably just started)
        if (!quote.customerName) continue;

        const updatedAt = quote.updatedAt?.toDate ? quote.updatedAt.toDate() : (quote.createdAt?.toDate ? quote.createdAt.toDate() : null);
        if (!updatedAt) continue;

        const daysOld = Math.floor((now.getTime() - updatedAt.getTime()) / oneDayMs);
        const currentTier = quote.draftNudgeTier || 0;

        let targetTier = 0;
        if (daysOld >= 7 && currentTier < 3) targetTier = 3;
        else if (daysOld >= 3 && currentTier < 2) targetTier = 2;
        else if (daysOld >= 1 && currentTier < 1) targetTier = 1;

        if (targetTier === 0) continue;

        draftsToPush.push({ doc: quoteDoc, tier: targetTier, daysOld });

        // Collect for email (tier 2 and 3 get emails)
        if (targetTier >= 2) {
          draftsForEmail.push({
            customerName: quote.customerName || 'Unknown',
            jobName: quote.job?.name || 'Custom Job',
            total: quote.total || 0,
            daysOld,
          });
          emailTier = Math.max(emailTier, targetTier);
        }
      }

      if (draftsToPush.length === 0) continue;
      processed++;

      try {
        // Send push for each draft (tier 1, 2, 3)
        for (const draft of draftsToPush) {
          const quote = draft.doc.data();
          await sendAussiePush(userDoc.id, 'draft_nudge', {
            customer: quote.customerName || 'A customer',
            job: quote.job?.name || 'the job',
          }, { quoteId: draft.doc.id });

          // Mark tier on the quote doc
          await draft.doc.ref.update({
            draftNudgeTier: draft.tier,
            lastDraftNudgeAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          nudgesSent++;
        }

        // Send email summary (tier 2 and 3 only)
        if (draftsForEmail.length > 0) {
          const email = await getUserEmail(userDoc.id);
          if (email) {
            let businessName = '';
            try {
              const settingsDoc = await db.doc(`users/${userDoc.id}/settings/business`).get();
              businessName = settingsDoc.data()?.businessName || '';
            } catch {}

            await sendDraftNudgeEmail(email, businessName, draftsForEmail, emailTier, userDoc.id);
          }
        }
      } catch (err: any) {
        functions.logger.error(`draftNudge error for user ${userDoc.id}`, err?.message);
        errors++;
      }
    }

    functions.logger.info(`draftNudge complete`, { processed, nudgesSent, errors });
  });

/**
 * Send an affiliate invite email (admin use).
 */
export const sendAffiliateInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
  const callerEmail = context.auth.token?.email || '';
  if (!adminEmails.includes(callerEmail)) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can send affiliate invites');
  }

  const { email } = data || {};
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'email is required');
  }

  const success = await sendAffiliateInviteEmail(email);
  if (!success) {
    throw new functions.https.HttpsError('internal', 'Failed to send affiliate invite email');
  }

  return { success: true };
});

// ============================================
// Xero Integration
// Sync invoices and payments to Xero accounting
// ============================================

// Xero credentials
const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID || '';
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || process.env.XERO_SECRET || '';
const XERO_REDIRECT_URI = process.env.XERO_REDIRECT_URI || 'https://quotemateapp.au/xero/callback';
const XERO_SCOPES = 'accounting.invoices accounting.contacts accounting.payments accounting.settings.read offline_access';

/**
 * Get Xero OAuth tokens from Firestore for a user.
 * Automatically refreshes if the access token is expired.
 */
async function getXeroTokens(userId: string): Promise<{ accessToken: string; tenantId: string } | null> {
  const firestore = admin.firestore();
  const connRef = firestore.doc(`users/${userId}/settings/xeroConnection`);
  const connDoc = await connRef.get();

  if (!connDoc.exists) return null;

  const data = connDoc.data()!;
  const { accessToken, refreshToken, tokenExpiresAt, tenantId } = data;

  if (!accessToken || !refreshToken || !tenantId) return null;

  // Token still valid (with 60s buffer)
  if (tokenExpiresAt && tokenExpiresAt > Date.now() + 60_000) {
    return { accessToken, tenantId };
  }

  // Refresh the token
  try {
    const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      await tokenResponse.text();
      // Mark connection as disconnected
      await connRef.update({ syncEnabled: false, disconnectedReason: 'token_refresh_failed' });
      return null;
    }

    const tokenData: any = await tokenResponse.json();
    const newAccessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 1800; // 30 minutes default

    const updateData: any = {
      accessToken: newAccessToken,
      tokenExpiresAt: Date.now() + expiresIn * 1000,
    };
    // Only update refresh token if Xero returns a new one (rotation)
    if (tokenData.refresh_token) {
      updateData.refreshToken = tokenData.refresh_token;
    }
    await connRef.update(updateData);

    return { accessToken: newAccessToken, tenantId };
  } catch (error) {
    return null;
  }
}

/**
 * Start Xero OAuth flow — returns the authorization URL.
 * The mobile app opens this URL in the system browser.
 */
export const getXeroAuthUrl = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    if (!XERO_CLIENT_ID) {
      res.status(500).json({ error: 'Xero integration not configured' });
      return;
    }

    // Generate a state parameter that includes the user ID (for the callback)
    const state = Buffer.from(JSON.stringify({
      uid: decodedToken.uid,
      ts: Date.now(),
    })).toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: XERO_CLIENT_ID,
      redirect_uri: XERO_REDIRECT_URI,
      scope: XERO_SCOPES,
      state,
    });

    const authUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`;

    res.status(200).json({ authUrl, state });
  });
});

/**
 * Xero OAuth callback — exchanges the auth code for tokens.
 * Called from the callback page hosted on Firebase Hosting.
 */
export const xeroCallback = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { code, state } = req.body;

    if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    // Decode the state to get user ID
    let stateData: { uid: string; ts: number };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Reject if state is older than 10 minutes
    if (Date.now() - stateData.ts > 10 * 60 * 1000) {
      res.status(400).json({ error: 'Authorization expired. Please try again.' });
      return;
    }

    const userId = stateData.uid;

    try {
      // Exchange auth code for tokens
      const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: XERO_REDIRECT_URI,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        await tokenResponse.text();
        res.status(400).json({ error: 'Failed to connect to Xero. Please try again.' });
        return;
      }

      const tokenData: any = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresIn = tokenData.expires_in || 1800;

      // Get the list of connected tenants (organisations)
      const tenantsResponse = await fetch('https://api.xero.com/connections', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!tenantsResponse.ok) {
        res.status(500).json({ error: 'Failed to retrieve Xero organisations' });
        return;
      }

      const tenants: any[] = await tenantsResponse.json();
      if (tenants.length === 0) {
        res.status(400).json({ error: 'No Xero organisations found. Please ensure you have a Xero account.' });
        return;
      }

      // Use the first tenant (most tradies have one org)
      const tenant = tenants[0];

      // Store connection in Firestore
      const firestore = admin.firestore();
      await firestore.doc(`users/${userId}/settings/xeroConnection`).set({
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        accessToken,
        refreshToken,
        tokenExpiresAt: Date.now() + expiresIn * 1000,
        connectedAt: new Date().toISOString(),
        syncEnabled: true,
        disconnectedReason: null,
      });


      // Return tenants so the callback page can show which org was connected
      res.status(200).json({
        success: true,
        tenantName: tenant.tenantName,
        allTenants: tenants.map((t: any) => ({ id: t.tenantId, name: t.tenantName })),
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Internal error connecting to Xero' });
    }
  });
});

/**
 * Switch which Xero tenant (organisation) is active.
 */
export const xeroSelectTenant = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { tenantId, tenantName } = req.body;
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(tenantName)) {
      res.status(400).json({ error: 'Missing tenantId or tenantName' });
      return;
    }

    const firestore = admin.firestore();
    await firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`).update({
      tenantId,
      tenantName,
    });

    res.status(200).json({ success: true });
  });
});

/**
 * Disconnect Xero — revoke tokens and remove connection.
 */
export const xeroDisconnect = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const firestore = admin.firestore();
    const connRef = firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`);
    const connDoc = await connRef.get();

    if (connDoc.exists) {
      const data = connDoc.data()!;
      // Attempt to revoke the refresh token at Xero
      if (data.refreshToken) {
        try {
          await fetch('https://identity.xero.com/connect/revocation', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              token: data.refreshToken,
            }).toString(),
          });
        } catch (revokeError) {
        }
      }

      await connRef.delete();
    }

    res.status(200).json({ success: true });
  });
});

/**
 * Check Xero connection status.
 */
export const checkXeroConnection = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const firestore = admin.firestore();
    const connDoc = await firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`).get();

    if (!connDoc.exists) {
      res.status(200).json({ connected: false });
      return;
    }

    const data = connDoc.data()!;
    res.status(200).json({
      connected: true,
      tenantName: data.tenantName || null,
      tenantId: data.tenantId || null,
      connectedAt: data.connectedAt || null,
      lastSyncAt: data.lastSyncAt || null,
      syncEnabled: data.syncEnabled ?? true,
      disconnectedReason: data.disconnectedReason || null,
    });
  });
});

/**
 * Push an invoice to Xero (create or update).
 * Handles contact upsert + invoice create/update in one call.
 */
export const pushInvoiceToXero = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { invoice } = req.body;
    if (!invoice || !invoice.id) {
      res.status(400).json({ error: 'Missing invoice data' });
      return;
    }

    const tokens = await getXeroTokens(decodedToken.uid);
    if (!tokens) {
      res.status(401).json({ error: 'Xero not connected or token expired. Please reconnect.' });
      return;
    }

    const { accessToken, tenantId } = tokens;
    const xeroHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      // Step 1: Upsert contact
      let xeroContactId = invoice.xeroContactId || null;

      if (!xeroContactId && invoice.customerName) {
        // Search for existing contact by name
        const escapedName = invoice.customerName.replace(/"/g, '\\"');
        const whereClause = encodeURIComponent(`Name=="${escapedName}"`);
        const contactSearch = await fetch(
          `https://api.xero.com/api.xro/2.0/Contacts?where=${whereClause}`,
          { headers: xeroHeaders }
        );

        if (contactSearch.ok) {
          const contactData: any = await contactSearch.json();
          if (contactData.Contacts && contactData.Contacts.length > 0) {
            xeroContactId = contactData.Contacts[0].ContactID;
          }
        }
      }

      if (!xeroContactId) {
        // Create new contact
        const contactPayload = {
          Name: invoice.customerName || 'Unknown Customer',
          EmailAddress: invoice.customerEmail || undefined,
          Phones: invoice.customerPhone ? [{
            PhoneType: 'DEFAULT',
            PhoneNumber: invoice.customerPhone,
          }] : undefined,
          Addresses: invoice.jobAddress ? [{
            AddressType: 'STREET',
            AddressLine1: invoice.jobAddress,
            Country: 'AU',
          }] : undefined,
        };

        const createContact = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify({ Contacts: [contactPayload] }),
        });

        if (createContact.ok) {
          const created: any = await createContact.json();
          if (created.Contacts && created.Contacts.length > 0) {
            xeroContactId = created.Contacts[0].ContactID;
          }
        } else {
          await createContact.text();
        }
      }

      // Step 2: Build invoice line items
      const lineItems: any[] = [];

      // Material line items
      if (invoice.materials && Array.isArray(invoice.materials)) {
        for (const mat of invoice.materials) {
          lineItems.push({
            Description: mat.name || 'Material',
            Quantity: mat.quantity || 1,
            UnitAmount: mat.price || 0,
            AccountCode: '200',
            TaxType: 'OUTPUT',
          });
        }
      }

      // Labour line items — one per section if sectioned, otherwise one from top-level
      if (Array.isArray(invoice.sections) && invoice.sections.length > 0) {
        for (const s of invoice.sections) {
          const totalHours = (s.laborHours || 0) * (s.multiplier || 1);
          if (totalHours > 0 && (s.laborRate || 0) > 0) {
            lineItems.push({
              Description: `Labour - ${s.name || 'Section'}`,
              Quantity: totalHours,
              UnitAmount: s.laborRate,
              AccountCode: '200',
              TaxType: 'OUTPUT',
            });
          }
        }
      } else if (invoice.laborHours > 0 && invoice.laborRate > 0) {
        lineItems.push({
          Description: `Labour - ${invoice.job?.name || 'General'}`,
          Quantity: invoice.laborHours,
          UnitAmount: invoice.laborRate,
          AccountCode: '200',
          TaxType: 'OUTPUT',
        });
      }

      // Markup line item
      if (invoice.markupAmount > 0) {
        lineItems.push({
          Description: 'Markup',
          Quantity: 1,
          UnitAmount: invoice.markupAmount,
          AccountCode: '200',
          TaxType: 'OUTPUT',
        });
      }

      // Fallback: if no line items, create a summary line
      if (lineItems.length === 0) {
        lineItems.push({
          Description: invoice.job?.name || 'Services',
          Quantity: 1,
          UnitAmount: invoice.subtotal || invoice.total || 0,
          AccountCode: '200',
          TaxType: 'OUTPUT',
        });
      }

      // Step 3: Determine Xero invoice status
      let xeroStatus = 'DRAFT';
      if (invoice.status === 'sent' || invoice.status === 'partial' || invoice.status === 'overdue') {
        xeroStatus = 'AUTHORISED';
      } else if (invoice.status === 'paid') {
        xeroStatus = 'AUTHORISED'; // Payment will be added separately
      }

      // Step 4: Build invoice payload
      const formatDate = (d: string | Date) => {
        const date = new Date(d);
        return date.toISOString().split('T')[0]; // YYYY-MM-DD
      };

      const invoicePayload: any = {
        Type: 'ACCREC', // Accounts Receivable
        Contact: { ContactID: xeroContactId },
        InvoiceNumber: invoice.invoiceNumber || undefined,
        Reference: invoice.job?.name || undefined,
        Date: formatDate(invoice.issueDate),
        DueDate: formatDate(invoice.dueDate),
        Status: xeroStatus,
        // Tell Xero whether our UnitAmounts already include GST or not, so it
        // applies the right tax treatment. Mirrors the doc's pricesIncludeGst.
        LineAmountTypes: invoice.pricesIncludeGst === true ? 'Inclusive' : 'Exclusive',
        LineItems: lineItems,
        CurrencyCode: 'AUD',
      };

      // Step 5: Create or update the invoice
      let xeroInvoiceId = invoice.xeroInvoiceId || null;
      let xeroResponse;

      if (xeroInvoiceId) {
        // Update existing invoice
        invoicePayload.InvoiceID = xeroInvoiceId;
        xeroResponse = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify({ Invoices: [invoicePayload] }),
        });
      } else {
        // Create new invoice
        xeroResponse = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify({ Invoices: [invoicePayload] }),
        });
      }

      if (!xeroResponse.ok) {
        const errText = await xeroResponse.text();
        res.status(400).json({ error: 'Failed to sync invoice to Xero', details: errText });
        return;
      }

      const xeroResult: any = await xeroResponse.json();
      const xeroInvoice = xeroResult.Invoices?.[0];
      xeroInvoiceId = xeroInvoice?.InvoiceID || xeroInvoiceId;

      // Step 6: Update the QuoteMate invoice in Firestore with Xero IDs
      const firestore = admin.firestore();
      const invoiceRef = firestore.doc(`users/${decodedToken.uid}/invoices/${invoice.id}`);
      await invoiceRef.update({
        xeroInvoiceId,
        xeroContactId,
        xeroSyncStatus: 'synced',
        xeroSyncedAt: new Date().toISOString(),
        xeroSyncError: null,
      });

      // Update last sync time on connection
      await firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`).update({
        lastSyncAt: new Date().toISOString(),
      });

      // Verify GST totals match
      const xeroTotal = xeroInvoice?.Total;
      const quoteMateTotal = invoice.total;
      if (xeroTotal && Math.abs(xeroTotal - quoteMateTotal) > 0.02) {
      }


      res.status(200).json({
        success: true,
        xeroInvoiceId,
        xeroContactId,
        xeroTotal: xeroTotal || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Internal error syncing to Xero' });
    }
  });
});

/**
 * Push a payment to Xero for an invoice that's already synced.
 */
export const pushPaymentToXero = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { xeroInvoiceId, amount, date, paymentMethod } = req.body;

    if (!xeroInvoiceId || !amount) {
      res.status(400).json({ error: 'Missing xeroInvoiceId or amount' });
      return;
    }

    const tokens = await getXeroTokens(decodedToken.uid);
    if (!tokens) {
      res.status(401).json({ error: 'Xero not connected or token expired. Please reconnect.' });
      return;
    }

    const { accessToken, tenantId } = tokens;
    const xeroHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      // Map QuoteMate payment method to Xero account code
      // Default to a general bank account; user can adjust in Xero
      // Xero AU default chart of accounts: 800=Petty Cash, 090=Business Bank Account
      // Fall back to the system bank account if codes don't exist
      const accountCode = paymentMethod === 'cash' ? '800' : '090';

      const formatDate = (d: string | Date) => {
        const dt = new Date(d);
        return dt.toISOString().split('T')[0];
      };

      const paymentPayload = {
        Invoice: { InvoiceID: xeroInvoiceId },
        Account: { Code: accountCode },
        Date: formatDate(date || new Date()),
        Amount: amount,
        Reference: `QuoteMate payment${paymentMethod ? ` (${paymentMethod})` : ''}`,
      };

      const paymentResponse = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
        method: 'PUT',
        headers: xeroHeaders,
        body: JSON.stringify({ Payments: [paymentPayload] }),
      });

      if (!paymentResponse.ok) {
        const errText = await paymentResponse.text();
        res.status(400).json({ error: 'Failed to record payment in Xero', details: errText });
        return;
      }

      const paymentResult: any = await paymentResponse.json();
      const xeroPaymentId = paymentResult.Payments?.[0]?.PaymentID;

      // Update last sync time
      const firestore = admin.firestore();
      await firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`).update({
        lastSyncAt: new Date().toISOString(),
      });


      res.status(200).json({
        success: true,
        xeroPaymentId,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Internal error recording payment in Xero' });
    }
  });
});

/**
 * Bulk push multiple invoices to Xero.
 * Processes sequentially to respect rate limits.
 */
export const xeroBulkSync = functions.runWith({ timeoutSeconds: 300 }).https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    const { invoiceIds } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      res.status(400).json({ error: 'Missing or empty invoiceIds array' });
      return;
    }

    // Cap at 50 invoices per bulk sync
    const ids = invoiceIds.slice(0, 50);
    const firestore = admin.firestore();
    const results: { invoiceId: string; success: boolean; error?: string; xeroInvoiceId?: string }[] = [];

    for (const id of ids) {
      try {
        // Load invoice from Firestore
        const invoiceDoc = await firestore.doc(`users/${decodedToken.uid}/invoices/${id}`).get();
        if (!invoiceDoc.exists) {
          results.push({ invoiceId: id, success: false, error: 'Invoice not found' });
          continue;
        }

        const invoice = invoiceDoc.data()!;
        invoice.id = id;

        // Reuse the push logic by making an internal call structure
        const tokens = await getXeroTokens(decodedToken.uid);
        if (!tokens) {
          results.push({ invoiceId: id, success: false, error: 'Xero not connected' });
          break; // No point continuing if not connected
        }

        const { accessToken, tenantId } = tokens;
        const xeroHeaders = {
          'Authorization': `Bearer ${accessToken}`,
          'xero-tenant-id': tenantId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };

        // Upsert contact (same logic as single push)
        let xeroContactId = invoice.xeroContactId || null;
        if (!xeroContactId && invoice.customerName) {
          const escapedName = invoice.customerName.replace(/"/g, '\\"');
          const whereClause = encodeURIComponent(`Name=="${escapedName}"`);
          const contactSearch = await fetch(
            `https://api.xero.com/api.xro/2.0/Contacts?where=${whereClause}`,
            { headers: xeroHeaders }
          );
          if (contactSearch.ok) {
            const contactData: any = await contactSearch.json();
            if (contactData.Contacts?.length > 0) {
              xeroContactId = contactData.Contacts[0].ContactID;
            }
          }

          if (!xeroContactId) {
            const contactPayload = {
              Name: invoice.customerName || 'Unknown Customer',
              ...(invoice.customerEmail && { EmailAddress: invoice.customerEmail }),
              ...(invoice.customerPhone && { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: invoice.customerPhone }] }),
              ...(invoice.jobAddress && { Addresses: [{ AddressType: 'STREET', AddressLine1: invoice.jobAddress, Country: 'AU' }] }),
            };
            const createContact = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
              method: 'POST',
              headers: xeroHeaders,
              body: JSON.stringify({ Contacts: [contactPayload] }),
            });
            if (createContact.ok) {
              const created: any = await createContact.json();
              xeroContactId = created.Contacts?.[0]?.ContactID;
            } else {
            }
          }
        }

        // Build line items
        const lineItems: any[] = [];
        if (invoice.materials && Array.isArray(invoice.materials)) {
          for (const mat of invoice.materials) {
            lineItems.push({
              Description: mat.name || 'Material',
              Quantity: mat.quantity || 1,
              UnitAmount: mat.price || 0,
              AccountCode: '200',
              TaxType: 'OUTPUT',
            });
          }
        }
        if (Array.isArray(invoice.sections) && invoice.sections.length > 0) {
          for (const s of invoice.sections) {
            const totalHours = (s.laborHours || 0) * (s.multiplier || 1);
            if (totalHours > 0 && (s.laborRate || 0) > 0) {
              lineItems.push({
                Description: `Labour - ${s.name || 'Section'}`,
                Quantity: totalHours,
                UnitAmount: s.laborRate,
                AccountCode: '200',
                TaxType: 'OUTPUT',
              });
            }
          }
        } else if (invoice.laborHours > 0 && invoice.laborRate > 0) {
          lineItems.push({
            Description: `Labour - ${invoice.job?.name || 'General'}`,
            Quantity: invoice.laborHours,
            UnitAmount: invoice.laborRate,
            AccountCode: '200',
            TaxType: 'OUTPUT',
          });
        }
        if (invoice.markupAmount > 0) {
          lineItems.push({ Description: 'Markup', Quantity: 1, UnitAmount: invoice.markupAmount, AccountCode: '200', TaxType: 'OUTPUT' });
        }
        if (lineItems.length === 0) {
          lineItems.push({ Description: invoice.job?.name || 'Services', Quantity: 1, UnitAmount: invoice.subtotal || 0, AccountCode: '200', TaxType: 'OUTPUT' });
        }

        let xeroStatus = 'DRAFT';
        if (['sent', 'partial', 'overdue', 'paid'].includes(invoice.status)) {
          xeroStatus = 'AUTHORISED';
        }

        const formatDate = (d: any) => new Date(d).toISOString().split('T')[0];

        const invoicePayload: any = {
          Type: 'ACCREC',
          Contact: { ContactID: xeroContactId },
          InvoiceNumber: invoice.invoiceNumber || undefined,
          Date: formatDate(invoice.issueDate),
          DueDate: formatDate(invoice.dueDate),
          Status: xeroStatus,
          LineAmountTypes: 'Exclusive',
          LineItems: lineItems,
          CurrencyCode: 'AUD',
        };

        if (invoice.xeroInvoiceId) {
          invoicePayload.InvoiceID = invoice.xeroInvoiceId;
        }

        const xeroResponse = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
          method: 'POST',
          headers: xeroHeaders,
          body: JSON.stringify({ Invoices: [invoicePayload] }),
        });

        if (xeroResponse.ok) {
          const xeroResult: any = await xeroResponse.json();
          const xeroInvoiceId = xeroResult.Invoices?.[0]?.InvoiceID;

          await firestore.doc(`users/${decodedToken.uid}/invoices/${id}`).update({
            xeroInvoiceId,
            xeroContactId,
            xeroSyncStatus: 'synced',
            xeroSyncedAt: new Date().toISOString(),
            xeroSyncError: null,
          });

          results.push({ invoiceId: id, success: true, xeroInvoiceId });
        } else {
          const errText = await xeroResponse.text();
          await firestore.doc(`users/${decodedToken.uid}/invoices/${id}`).update({
            xeroSyncStatus: 'error',
            xeroSyncError: errText.slice(0, 500),
          });
          results.push({ invoiceId: id, success: false, error: errText.slice(0, 200) });
        }

        // Rate limit: wait 500ms between pushes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        results.push({ invoiceId: id, success: false, error: error.message || 'Unknown error' });
      }
    }

    // Update last sync time
    await firestore.doc(`users/${decodedToken.uid}/settings/xeroConnection`).update({
      lastSyncAt: new Date().toISOString(),
    });

    const successCount = results.filter(r => r.success).length;

    res.status(200).json({ results, successCount, totalCount: results.length });
  });
});

/**
 * Get contacts from Xero for the authenticated user.
 * Returns active contacts with name, email, phone, and address.
 */
export const getXeroContacts = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const tokens = await getXeroTokens(decodedToken.uid);
    if (!tokens) {
      res.status(400).json({ error: 'Xero not connected' });
      return;
    }

    const { accessToken, tenantId } = tokens;
    const xeroHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Accept': 'application/json',
    };

    try {
      const whereClause = encodeURIComponent('ContactStatus=="ACTIVE"');
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/Contacts?where=${whereClause}&order=Name&pageSize=100`,
        { headers: xeroHeaders }
      );

      if (!response.ok) {
        await response.text();
        res.status(502).json({ error: 'Failed to fetch contacts from Xero' });
        return;
      }

      const data: any = await response.json();
      const contacts = (data.Contacts || []).map((c: any) => ({
        ContactID: c.ContactID,
        Name: c.Name,
        EmailAddress: c.EmailAddress || null,
        Phones: c.Phones || [],
        Addresses: c.Addresses || [],
      }));

      res.status(200).json({ contacts });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
});

// ============================================
// Bunnings Scraper Proxy
// ============================================
// Routes scraper requests through Firebase Functions so API keys stay server-side.

const SCRAPER_URL = process.env.BUNNINGS_SCRAPER_URL || '';
const SCRAPER_API_KEY = process.env.BUNNINGS_SCRAPER_API_KEY || '';

export const bunningsScraperSearch = functions.runWith({ timeoutSeconds: 120 }).https.onRequest((req, res) => {
  const corsHandler = cors({ origin: true });
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!SCRAPER_URL || !SCRAPER_API_KEY) {
      res.status(503).json({ success: false, error: 'Scraper not configured' });
      return;
    }

    try {
      const { searchTerm, limit = 5, sortBy = 'relevance' } = req.body;

      if (!searchTerm) {
        res.status(400).json({ success: false, error: 'searchTerm is required' });
        return;
      }

      const response = await fetch(`${SCRAPER_URL}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': SCRAPER_API_KEY,
        },
        body: JSON.stringify({ searchTerm, limit, sortBy }),
      });

      if (!response.ok) {
        await response.text();
        res.status(response.status).json({ success: false, error: `Scraper returned ${response.status}` });
        return;
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Proxy error' });
    }
  });
});

export const bunningsScraperBatchSearch = functions.runWith({ timeoutSeconds: 540, memory: '512MB' }).https.onRequest((req, res) => {
  const corsHandler = cors({ origin: true });
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!SCRAPER_URL || !SCRAPER_API_KEY) {
      res.status(503).json({ success: false, error: 'Scraper not configured' });
      return;
    }

    try {
      const { searches } = req.body;

      if (!searches || !Array.isArray(searches)) {
        res.status(400).json({ success: false, error: 'searches array is required' });
        return;
      }

      const response = await fetch(`${SCRAPER_URL}/api/batch-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': SCRAPER_API_KEY,
        },
        body: JSON.stringify({ searches }),
      });

      if (!response.ok) {
        await response.text();
        res.status(response.status).json({ success: false, error: `Scraper returned ${response.status}` });
        return;
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Proxy error' });
    }
  });
});

export const bunningsScraperProduct = functions.runWith({ timeoutSeconds: 120 }).https.onRequest((req, res) => {
  const corsHandler = cors({ origin: true });
  corsHandler(req, res, async () => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!SCRAPER_URL || !SCRAPER_API_KEY) {
      res.status(503).json({ success: false, error: 'Scraper not configured' });
      return;
    }

    try {
      const itemNumber = req.query.itemNumber as string;

      if (!itemNumber) {
        res.status(400).json({ success: false, error: 'itemNumber query param is required' });
        return;
      }

      const response = await fetch(`${SCRAPER_URL}/api/product/${itemNumber}`, {
        headers: { 'X-API-Key': SCRAPER_API_KEY },
      });

      if (!response.ok) {
        if (response.status === 404) {
          res.status(404).json({ success: false, product: null });
          return;
        }
        res.status(response.status).json({ success: false, error: `Scraper returned ${response.status}` });
        return;
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Proxy error' });
    }
  });
});

export const bunningsScraperHealth = functions.https.onRequest((req, res) => {
  const corsHandler = cors({ origin: true });
  corsHandler(req, res, async () => {
    if (!SCRAPER_URL || !SCRAPER_API_KEY) {
      res.status(200).json({ success: false, status: 'not_configured' });
      return;
    }

    try {
      const response = await fetch(`${SCRAPER_URL}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        res.status(200).json({ success: false, status: 'unhealthy' });
        return;
      }

      const data = await response.json();
      res.status(200).json(data);
    } catch (error: any) {
      res.status(200).json({ success: false, status: 'unreachable' });
    }
  });
});

// ============================================
// Bunnings Scraper — Claude fallback proxy
// ============================================
// The bunnings-scraper microservice used to call the Anthropic API directly when
// Playwright failed to load Bunnings pages. That meant:
//   1. The Anthropic API key had to live in the scraper's GitHub secrets / .env
//   2. There was no central control point for cost — a single bad day burnt $22+
//      because every Playwright failure triggered a Claude web_search call
//
// These two functions move all Anthropic calls behind Firebase, so:
//   - The Anthropic key only lives here (already configured as ANTHROPIC_API_KEY)
//   - We can add a budget cap, kill switch, and centralised metrics in one place
//   - Rotating the key doesn't require redeploying the scraper
//
// Both endpoints are protected by the existing BUNNINGS_SCRAPER_API_KEY shared
// secret so only the scraper can call them.

function authenticateScraperRequest(req: any, res: any): boolean {
  const providedKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
  if (!SCRAPER_API_KEY) {
    res.status(503).json({ success: false, error: 'Scraper auth not configured on Firebase' });
    return false;
  }
  if (providedKey !== SCRAPER_API_KEY) {
    res.status(401).json({ success: false, error: 'Invalid API key' });
    return false;
  }
  return true;
}

/**
 * Claude product search via web_search tool. Replaces claudeWebSearch in
 * bunnings-scraper/src/claude-fallback.ts. Called when Playwright fails to load
 * a Bunnings page. No web_search tool — we're asking Claude to ESTIMATE
 * products and prices from its training data, NOT do live web lookups.
 *
 * Why no web_search: the previous implementation with the web_search tool was
 * costing $5-10 per call in pathological cases (Claude would loop: search,
 * visit page 1, visit page 2, re-search, etc., burning 500K+ tokens per call).
 * One runaway quote could hit $50+ in a few minutes.
 *
 * The Claude-guess version costs ~$0.005 per call (short prompt, short output,
 * no tools). It's less accurate — prices and item numbers are estimates, not
 * verified against the live Bunnings site — so products are returned with
 * low confidence. Callers / the UI should treat these as "best guess" data
 * and prompt the user to verify.
 */
export const claudeProductSearch = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest((req, res) => {
    const corsHandler = cors({ origin: true });
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' });
        return;
      }

      if (!authenticateScraperRequest(req, res)) return;

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) {
        res.status(503).json({ success: false, error: 'Anthropic key not configured' });
        return;
      }

      const { searchTerm, limit = 5 } = req.body || {};
      if (!searchTerm || typeof searchTerm !== 'string') {
        res.status(400).json({ success: false, error: 'searchTerm is required' });
        return;
      }

      const prompt = `You are helping an Australian tradesperson estimate material costs. Based on your knowledge of Bunnings Warehouse (bunnings.com.au) products, suggest up to ${limit} likely product matches for: "${searchTerm}"

These are ESTIMATES from your training data — you do not have live web access. Give your best guess of typical Bunnings products, brands, and current AUD prices (including GST).

Return ONLY a JSON code block in this exact shape:
\`\`\`json
{
  "products": [
    {
      "productName": "full product name as it would appear on Bunnings",
      "price": 29.99,
      "itemNumber": "",
      "brand": "Brand Name",
      "productUrl": "",
      "imageUrl": "",
      "description": "one-sentence product description"
    }
  ]
}
\`\`\`

Rules:
- Price is a number in AUD including GST. Use your best estimate; don't set to -1.
- Leave itemNumber, productUrl, and imageUrl as empty strings — you don't have access to the live site.
- Brand: manufacturer for branded items (e.g. "Makita"), treatment/grade for generic timber (e.g. "H3 Treated Pine").
- Pick the products a tradie would most likely want — prefer the actual item over accessories.
- If you genuinely have no idea what product matches, return an empty products array instead of making things up.
- Return ONLY the JSON code block, no other text.`;

      try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            // NO tools — pure text completion. Previous web_search tool caused
            // runaway cost ($5-10/call in worst case).
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!anthropicResponse.ok) {
          const errText = await anthropicResponse.text();
          console.error(`[claudeProductSearch] Anthropic ${anthropicResponse.status}: ${errText}`);
          res.status(502).json({
            success: false,
            error: `Anthropic returned ${anthropicResponse.status}`,
            details: errText.slice(0, 500),
          });
          return;
        }

        const data: any = await anthropicResponse.json();

        // Extract text from content blocks
        let textContent = '';
        for (const block of data.content || []) {
          if (block.type === 'text') textContent += block.text;
        }

        // Parse JSON from response — code block first, then raw
        const codeBlockMatch = textContent.match(/```json\s*([\s\S]*?)```/);
        const jsonStr = codeBlockMatch
          ? codeBlockMatch[1]
          : textContent.match(/\{[\s\S]*"products"[\s\S]*\}/)?.[0];

        if (!jsonStr) {
          res.status(200).json({ success: true, products: [] });
          return;
        }

        const parsed = JSON.parse(jsonStr);
        const products = Array.isArray(parsed.products) ? parsed.products.slice(0, limit) : [];

        res.status(200).json({ success: true, products });
      } catch (error: any) {
        console.error('[claudeProductSearch] Error:', error);
        res.status(500).json({ success: false, error: error.message || 'Unknown error' });
      }
    });
  });

/**
 * Claude verify/enrich scraped products. Replaces claudeVerifyResults. Cheaper
 * than the search variant — no web_search tool, just text reasoning over a
 * pre-scraped list.
 */
export const claudeVerifyProducts = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onRequest((req, res) => {
    const corsHandler = cors({ origin: true });
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method not allowed' });
        return;
      }

      if (!authenticateScraperRequest(req, res)) return;

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) {
        res.status(503).json({ success: false, error: 'Anthropic key not configured' });
        return;
      }

      const { searchTerm, products } = req.body || {};
      if (!searchTerm || !Array.isArray(products)) {
        res.status(400).json({ success: false, error: 'searchTerm and products[] required' });
        return;
      }

      if (products.length === 0) {
        res.status(200).json({ success: true, verified: [] });
        return;
      }

      const productSummary = products.map((p: any, i: number) => ({
        index: i,
        name: p.productName,
        price: p.price,
        brand: p.brand,
        itemNumber: p.itemNumber,
        url: p.productUrl,
      }));

      const prompt = `A user searched for "${searchTerm}" on Bunnings. Review these scraped results and fix any issues.

Products found:
${JSON.stringify(productSummary, null, 2)}

Return a JSON code block:
\`\`\`json
{
  "verified": [
    {
      "index": 0,
      "relevant": true,
      "brand": "Corrected Brand Name",
      "confidence": "high"
    }
  ]
}
\`\`\`

Rules:
- Set "relevant" to false for products that DON'T match what the user is searching for
  - e.g. if searching for "timber 90x45", a "Joist Hanger" or "Post Bracket" is NOT relevant
  - accessories, fixings, and hardware are NOT the same as the main product
- Fix the "brand" field:
  - For branded products use the manufacturer (e.g. "Makita", "DeWalt", "Pryda")
  - For generic timber/building products, use treatment/grade (e.g. "H3 Treated Pine", "MGP10 Blue Pine")
  - NEVER use dimensions as brand (e.g. "90" is NOT a brand)
- Set confidence: "high" if product closely matches search, "medium" if partially matches, "low" if poor match
- Return ALL products with your assessment - don't skip any`;

      try {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!anthropicResponse.ok) {
          const errText = await anthropicResponse.text();
          console.error(`[claudeVerifyProducts] Anthropic ${anthropicResponse.status}: ${errText}`);
          res.status(502).json({
            success: false,
            error: `Anthropic returned ${anthropicResponse.status}`,
          });
          return;
        }

        const data: any = await anthropicResponse.json();

        let textContent = '';
        for (const block of data.content || []) {
          if (block.type === 'text') textContent += block.text;
        }

        const codeBlockMatch = textContent.match(/```json\s*([\s\S]*?)```/);
        const jsonStr = codeBlockMatch
          ? codeBlockMatch[1]
          : textContent.match(/\{[\s\S]*"verified"[\s\S]*\}/)?.[0];

        if (!jsonStr) {
          res.status(200).json({ success: true, verified: [] });
          return;
        }

        const parsed = JSON.parse(jsonStr);
        const verified = Array.isArray(parsed.verified) ? parsed.verified : [];

        res.status(200).json({ success: true, verified });
      } catch (error: any) {
        console.error('[claudeVerifyProducts] Error:', error);
        res.status(500).json({ success: false, error: error.message || 'Unknown error' });
      }
    });
  });

// ============================================
// Supplier Portal Functions
// ============================================

/**
 * Public endpoint for supplier price list extraction (no auth, IP rate-limited).
 * Same extraction logic as extractSupplierPriceList but for the portal.
 */
export const extractSupplierPriceListPublic = functions
  .runWith({ timeoutSeconds: 240, memory: '1GB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      // IP-based rate limiting: 10 requests per hour
      const clientIp = getClientIp(req);
      const allowed = await checkRateLimit(
        `ip:${clientIp}`,
        { maxRequests: 10, windowMs: 3_600_000 },
        res
      );
      if (!allowed) return;

      try {
        const { pdfBase64, imageBase64, supplierName, defaultUnit } = req.body;

        if (!pdfBase64 && (!Array.isArray(imageBase64) || imageBase64.length === 0)) {
          res.status(400).json({ error: 'Provide either pdfBase64 or imageBase64[]' });
          return;
        }
        if (Array.isArray(imageBase64) && imageBase64.length > 10) {
          res.status(400).json({ error: 'Maximum 10 images per import' });
          return;
        }
        if (typeof pdfBase64 === 'string' && pdfBase64.length > 14_000_000) {
          res.status(400).json({ error: 'PDF too large (max 10 MB)' });
          return;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!geminiApiKey && !anthropicApiKey) {
          res.status(500).json({ error: 'No LLM API keys configured' });
          return;
        }

        const prompt = buildExtractSupplierPrompt(supplierName, defaultUnit);
        const input: ExtractionInput = { pdfBase64, imageBase64 };

        let parsed: any | null = null;
        let primaryError: Error | null = null;

        if (geminiApiKey) {
          try {
            parsed = await callGeminiForExtraction(geminiApiKey, prompt, input);
          } catch (err: any) {
            primaryError = err;
            console.warn('Gemini extraction failed, falling back to Claude:', err.message);
          }
        }

        if (!parsed) {
          if (!anthropicApiKey) {
            throw primaryError || new Error('Gemini failed and no Anthropic fallback key configured');
          }
          try {
            parsed = await callClaudeForExtraction(anthropicApiKey, prompt, input);
          } catch (fallbackErr: any) {
            throw new Error(
              `Price list extraction failed — ${primaryError ? `Gemini: ${primaryError.message.slice(0, 80)}; ` : ''}Claude: ${fallbackErr.message.slice(0, 80)}`
            );
          }
        }

        res.status(200).json({
          supplierName: parsed.supplierName || supplierName || '',
          supplierContact: parsed.supplierContact && typeof parsed.supplierContact === 'object'
            ? parsed.supplierContact
            : null,
          items: Array.isArray(parsed.items) ? parsed.items : [],
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  });

/**
 * Firestore trigger: when a tradie subscribes/unsubscribes from a supplier.
 * On create: copies all supplier price items to the tradie's materialFavorites.
 * On delete: removes all synced favorites from that supplier.
 */
export const onSubscriberWrite = functions.firestore
  .document('suppliers/{supplierId}/subscribers/{tradieUid}')
  .onWrite(async (change, context) => {
    const { supplierId, tradieUid } = context.params;
    const firestore = admin.firestore();

    if (!change.before.exists && change.after.exists) {
      // --- Subscribe: copy supplier's price items to tradie's favorites ---
      const priceItemsSnap = await firestore
        .collection(`suppliers/${supplierId}/priceItems`)
        .get();

      const batch = firestore.batch();
      for (const itemDoc of priceItemsSnap.docs) {
        const item = itemDoc.data();
        const favRef = firestore.doc(
          `users/${tradieUid}/materialFavorites/${supplierId}_${itemDoc.id}`
        );
        batch.set(favRef, {
          productName: item.name || '',
          store: item.supplierName || supplierId,
          price: item.price ?? null,
          unit: item.unit || 'each',
          coveragePerUnit: item.coveragePerUnit ?? null,
          coverageUnit: item.coverageUnit ?? null,
          keywords: item.keywords || [],
          isPersonalRate: true,
          source: 'subscribed',
          sourceRef: supplierId,
          lastUpdatedAt: new Date().toISOString(),
        });
      }

      // Increment subscriber count
      batch.update(firestore.doc(`suppliers/${supplierId}`), {
        subscriberCount: admin.firestore.FieldValue.increment(1),
      });

      await batch.commit();
    } else if (change.before.exists && !change.after.exists) {
      // --- Unsubscribe: remove synced favorites ---
      const favoritesSnap = await firestore
        .collection(`users/${tradieUid}/materialFavorites`)
        .where('source', '==', 'subscribed')
        .where('sourceRef', '==', supplierId)
        .get();

      const batch = firestore.batch();
      for (const favDoc of favoritesSnap.docs) {
        batch.delete(favDoc.ref);
      }

      // Decrement subscriber count
      batch.update(firestore.doc(`suppliers/${supplierId}`), {
        subscriberCount: admin.firestore.FieldValue.increment(-1),
      });

      await batch.commit();
    }
  });

/**
 * Firestore trigger: when a supplier creates/updates/deletes a price item.
 * Propagates the change to all subscribers' materialFavorites.
 */
export const onSupplierPriceItemWrite = functions.firestore
  .document('suppliers/{supplierId}/priceItems/{itemSlug}')
  .onWrite(async (change, context) => {
    const { supplierId, itemSlug } = context.params;
    const firestore = admin.firestore();

    // Get supplier doc for the name
    const supplierDoc = await firestore.doc(`suppliers/${supplierId}`).get();
    const supplierName = supplierDoc.data()?.name || supplierId;

    // Get all subscriber UIDs
    const subscribersSnap = await firestore
      .collection(`suppliers/${supplierId}/subscribers`)
      .get();

    if (subscribersSnap.empty) {
      // Update item count even with no subscribers
      if (change.after.exists !== change.before.exists) {
        const countSnap = await firestore
          .collection(`suppliers/${supplierId}/priceItems`)
          .count()
          .get();
        await firestore.doc(`suppliers/${supplierId}`).update({
          itemCount: countSnap.data().count,
        });
      }
      return;
    }

    const batch = firestore.batch();

    if (change.after.exists) {
      // Create or update — sync to all subscribers
      const item = change.after.data()!;
      for (const subDoc of subscribersSnap.docs) {
        const tradieUid = subDoc.id;
        const favRef = firestore.doc(
          `users/${tradieUid}/materialFavorites/${supplierId}_${itemSlug}`
        );
        batch.set(favRef, {
          productName: item.name || '',
          store: supplierName,
          price: item.price ?? null,
          unit: item.unit || 'each',
          coveragePerUnit: item.coveragePerUnit ?? null,
          coverageUnit: item.coverageUnit ?? null,
          keywords: item.keywords || [],
          isPersonalRate: true,
          source: 'subscribed',
          sourceRef: supplierId,
          lastUpdatedAt: new Date().toISOString(),
        });
      }
    } else {
      // Delete — remove from all subscribers
      for (const subDoc of subscribersSnap.docs) {
        const tradieUid = subDoc.id;
        const favRef = firestore.doc(
          `users/${tradieUid}/materialFavorites/${supplierId}_${itemSlug}`
        );
        batch.delete(favRef);
      }
    }

    // Update item count
    if (change.after.exists !== change.before.exists) {
      const countSnap = await firestore
        .collection(`suppliers/${supplierId}/priceItems`)
        .count()
        .get();
      batch.update(firestore.doc(`suppliers/${supplierId}`), {
        itemCount: countSnap.data().count,
      });
    }

    await batch.commit();
  });

/**
 * Callable: set custom claim { role: 'supplier', supplierId } on the caller.
 */
export const setSupplierClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }

  const { supplierId } = data;
  if (!supplierId || typeof supplierId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'supplierId is required');
  }

  // Verify caller owns this supplier doc
  const firestore = admin.firestore();
  const supplierDoc = await firestore.doc(`suppliers/${supplierId}`).get();
  if (!supplierDoc.exists || supplierDoc.data()?.ownerUid !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not the supplier owner');
  }

  await admin.auth().setCustomUserClaims(context.auth.uid, {
    role: 'supplier',
    supplierId,
  });

  return { success: true };
});

/**
 * HTTP endpoint: create a pending deep link (no auth, IP rate-limited).
 * Called by the /join/ landing page when a non-app user scans the QR code.
 */
export const createPendingLink = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const clientIp = getClientIp(req);
    const allowed = await checkRateLimit(
      `ip:${clientIp}`,
      { maxRequests: 10, windowMs: 3_600_000 },
      res
    );
    if (!allowed) return;

    try {
      const { supplierId } = req.body;
      if (!supplierId || typeof supplierId !== 'string') {
        res.status(400).json({ error: 'supplierId is required' });
        return;
      }

      const userAgent = req.headers['user-agent'] || '';
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${clientIp}:${userAgent}`)
        .digest('hex');

      const firestore = admin.firestore();
      await firestore.collection('pendingLinks').add({
        supplierId,
        fingerprint,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        claimed: false,
      });

      res.status(200).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * HTTP endpoint: check for a pending deep link (auth required).
 * Called by the app after first sign-in to resolve deferred deep links.
 */
export const checkPendingLink = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuth(req, res);
    if (!decodedToken) return;

    try {
      const userAgent = req.headers['user-agent'] || '';
      const clientIp = getClientIp(req);
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${clientIp}:${userAgent}`)
        .digest('hex');

      const firestore = admin.firestore();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const pendingSnap = await firestore
        .collection('pendingLinks')
        .where('fingerprint', '==', fingerprint)
        .where('claimed', '==', false)
        .where('createdAt', '>=', twentyFourHoursAgo)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (pendingSnap.empty) {
        res.status(200).json({ supplierId: null });
        return;
      }

      const linkDoc = pendingSnap.docs[0];
      await linkDoc.ref.update({ claimed: true });

      res.status(200).json({ supplierId: linkDoc.data().supplierId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Public endpoint: get a supplier's display name by ID (no auth required).
 * Used by the /join/ landing page since Firestore rules require auth for supplier reads.
 */
export const getSupplierName = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const supplierId = req.query.id as string;
    if (!supplierId || typeof supplierId !== 'string') {
      res.status(400).json({ error: 'id query param is required' });
      return;
    }

    try {
      const firestore = admin.firestore();
      const supplierDoc = await firestore.doc(`suppliers/${supplierId}`).get();
      if (!supplierDoc.exists) {
        res.status(404).json({ name: null });
        return;
      }
      res.status(200).json({ name: supplierDoc.data()?.name || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
});

// ============================================
// Square Integration
// OAuth for each tradie's Square account, pay-by-link on invoice emails,
// webhook-driven invoice reconciliation.
// Mirrors the Xero integration block above — see getXeroTokens / xeroCallback
// for reference.
// ============================================

const SQUARE_APP_ID = process.env.SQUARE_APP_ID || '';
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || '';
const SQUARE_ENV: 'sandbox' | 'production' =
  (process.env.SQUARE_ENV as 'sandbox' | 'production') || 'sandbox';
const SQUARE_REDIRECT_URI =
  process.env.SQUARE_REDIRECT_URI || 'https://quotemateapp.au/square/callback';
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
const SQUARE_WEBHOOK_NOTIFICATION_URL =
  process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
  'https://us-central1-hansendev.cloudfunctions.net/squareWebhook';
// OAuth scopes required for pay-by-link, reading merchant/location info, and
// in-person Tap to Pay via the Mobile Payments SDK.
const SQUARE_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'PAYMENTS_READ',
  'PAYMENTS_WRITE',
  'PAYMENTS_WRITE_IN_PERSON',
  'ORDERS_READ',
  'ORDERS_WRITE',
];

function squareApiBase(): string {
  return SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

function squareOAuthBase(): string {
  // Square's OAuth endpoints live under the same host as the API.
  return squareApiBase();
}

// ---- Token-at-rest encryption --------------------------------------------
// Square access & refresh tokens are stored encrypted in Firestore so a
// database leak alone doesn't expose merchant payment credentials.
// Format on disk: `enc:v1:base64(iv ‖ authTag ‖ ciphertext)` (AES-256-GCM).
// Legacy plaintext values are tolerated by decryptSquareToken so existing
// records keep working and get re-encrypted on the next token refresh.
const SQUARE_TOKEN_ENC_PREFIX = 'enc:v1:';
function getSquareEncKey(): Buffer | null {
  const raw = process.env.SQUARE_TOKEN_ENC_KEY || '';
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

function encryptSquareToken(plaintext: string): string {
  const key = getSquareEncKey();
  if (!key) {
    // No key configured → fall back to plaintext to avoid breaking connect.
    // Production deploys must set SQUARE_TOKEN_ENC_KEY.
    console.warn('[square] SQUARE_TOKEN_ENC_KEY not set — storing tokens in plaintext');
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return SQUARE_TOKEN_ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptSquareToken(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith(SQUARE_TOKEN_ENC_PREFIX)) {
    // Legacy plaintext — return as-is. Next refresh will re-encrypt.
    return value;
  }
  const key = getSquareEncKey();
  if (!key) {
    console.error('[square] SQUARE_TOKEN_ENC_KEY missing — cannot decrypt token');
    return null;
  }
  try {
    const packed = Buffer.from(value.slice(SQUARE_TOKEN_ENC_PREFIX.length), 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err: any) {
    console.error('[square] token decrypt failed', { message: err?.message });
    return null;
  }
}

/**
 * Fetch a user's Square tokens from Firestore. Refreshes if expired (with 60s buffer).
 * Mirrors getXeroTokens above.
 */
async function getSquareTokens(
  userId: string,
): Promise<{ accessToken: string; merchantId: string; locationId?: string } | null> {
  const firestore = admin.firestore();
  const connRef = firestore.doc(`users/${userId}/settings/squareConnection`);
  const connDoc = await connRef.get();
  if (!connDoc.exists) return null;

  const data = connDoc.data()!;
  const { accessToken: storedAccess, refreshToken: storedRefresh, tokenExpiresAt, merchantId, locationId } = data;
  if (!storedAccess || !storedRefresh || !merchantId) return null;

  const accessToken = decryptSquareToken(storedAccess);
  const refreshToken = decryptSquareToken(storedRefresh);
  if (!accessToken || !refreshToken) return null;

  if (tokenExpiresAt && tokenExpiresAt > Date.now() + 60_000) {
    // Legacy plaintext rows get lazily upgraded to encrypted on next refresh,
    // but if we're returning a cached token we still want to migrate eagerly
    // when we notice the stored value isn't in the encrypted format.
    if (!String(storedAccess).startsWith(SQUARE_TOKEN_ENC_PREFIX) ||
        !String(storedRefresh).startsWith(SQUARE_TOKEN_ENC_PREFIX)) {
      await connRef.update({
        accessToken: encryptSquareToken(accessToken),
        refreshToken: encryptSquareToken(refreshToken),
      });
    }
    return { accessToken, merchantId, locationId };
  }

  try {
    const tokenResponse = await fetch(`${squareOAuthBase()}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': '2024-10-17',
      },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text().catch(() => '');
      console.error('[square] token refresh failed', { userId, status: tokenResponse.status, body: errBody.slice(0, 300) });
      await connRef.update({ disconnectedReason: 'token_refresh_failed' });
      return null;
    }

    const tokenData: any = await tokenResponse.json();
    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token || refreshToken;
    // Square returns expires_at as an ISO timestamp.
    const expiresAtMs = tokenData.expires_at
      ? new Date(tokenData.expires_at).getTime()
      : Date.now() + 30 * 24 * 60 * 60 * 1000; // default 30 days

    await connRef.update({
      accessToken: encryptSquareToken(newAccessToken),
      refreshToken: encryptSquareToken(newRefreshToken),
      tokenExpiresAt: expiresAtMs,
    });

    return { accessToken: newAccessToken, merchantId, locationId };
  } catch (error) {
    return null;
  }
}

/**
 * Internal helper: record a payment against a Xero invoice without going
 * through the HTTP handler. Used by the Square webhook when an invoice has
 * already been synced to Xero.
 */
async function pushPaymentToXeroInternal(
  userId: string,
  xeroInvoiceId: string,
  amount: number,
  date: Date,
  paymentMethod: string,
): Promise<void> {
  const tokens = await getXeroTokens(userId);
  if (!tokens) return;

  const { accessToken, tenantId } = tokens;
  const accountCode = paymentMethod === 'cash' ? '800' : '090';
  const dateStr = date.toISOString().split('T')[0];

  try {
    const response = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        Payments: [
          {
            Invoice: { InvoiceID: xeroInvoiceId },
            Account: { Code: accountCode },
            Date: dateStr,
            Amount: amount,
            Reference: `QuoteMate payment (${paymentMethod})`,
          },
        ],
      }),
    });

    if (response.ok) {
      await admin.firestore()
        .doc(`users/${userId}/settings/xeroConnection`)
        .update({ lastSyncAt: new Date().toISOString() });
    }
  } catch {
    // Best-effort: webhook succeeds even if Xero sync fails. Tradie can resync
    // manually from the invoice if needed.
  }
}

/**
 * Start Square OAuth flow — returns the authorization URL for the hosted
 * Square consent page. Mirrors getXeroAuthUrl above.
 */
export const getSquareAuthUrl = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    if (!SQUARE_APP_ID) {
      res.status(500).json({ error: 'Square integration not configured' });
      return;
    }

    const state = Buffer.from(
      JSON.stringify({ uid: decodedToken.uid, ts: Date.now() }),
    ).toString('base64url');

    const params = new URLSearchParams({
      client_id: SQUARE_APP_ID,
      response_type: 'code',
      scope: SQUARE_SCOPES.join(' '),
      redirect_uri: SQUARE_REDIRECT_URI,
      session: 'false', // force account selection
      state,
    });

    const authUrl = `${squareOAuthBase()}/oauth2/authorize?${params.toString()}`;
    res.status(200).json({ authUrl, state, env: SQUARE_ENV });
  });
});

/**
 * Square OAuth callback — exchanges the auth code for tokens. Called from
 * the Next.js route app/square/callback/page.tsx in the QuoteMateAppWebsite
 * repo, which receives Square's redirect and POSTs { code, state } here.
 */
export const squareCallback = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { code, state } = req.body;
    if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    let stateData: { uid: string; ts: number };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    if (Date.now() - stateData.ts > 10 * 60 * 1000) {
      res.status(400).json({ error: 'Authorization expired. Please try again.' });
      return;
    }

    const userId = stateData.uid;

    try {
      const tokenResponse = await fetch(`${squareOAuthBase()}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Square-Version': '2024-10-17',
        },
        body: JSON.stringify({
          client_id: SQUARE_APP_ID,
          client_secret: SQUARE_APP_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: SQUARE_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        await tokenResponse.text();
        res.status(400).json({ error: 'Failed to connect to Square. Please try again.' });
        return;
      }

      const tokenData: any = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const merchantId = tokenData.merchant_id;
      const expiresAtMs = tokenData.expires_at
        ? new Date(tokenData.expires_at).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      if (!accessToken || !refreshToken || !merchantId) {
        res.status(400).json({ error: 'Square did not return a complete token set' });
        return;
      }

      // Verify Square granted every scope we actually need. Square's OAuth
      // only returns the `scope` field when the granted set *differs* from the
      // requested set — an absent or empty `scope` means Square granted what
      // we asked for, not that it granted nothing. So we only enforce the
      // scope check when Square explicitly reports scopes back to us.
      const grantedScopes: string[] | null = typeof tokenData.scope === 'string' && tokenData.scope.trim()
        ? tokenData.scope.split(/[\s,]+/).filter(Boolean)
        : Array.isArray(tokenData.scope) && tokenData.scope.length > 0
          ? tokenData.scope
          : null;
      if (grantedScopes) {
        const missingScopes = SQUARE_SCOPES.filter((s) => !grantedScopes.includes(s));
        if (missingScopes.length > 0) {
          console.warn('[square] OAuth scope mismatch', { userId, requested: SQUARE_SCOPES, granted: grantedScopes, missing: missingScopes });
          res.status(400).json({
            error: `Square connection is missing required permissions: ${missingScopes.join(', ')}. Please reconnect and accept all requested permissions.`,
          });
          return;
        }
      }

      // Fetch merchant profile + default location (best-effort; non-fatal).
      let merchantName: string | undefined;
      let locationId: string | undefined;
      let locationName: string | undefined;

      try {
        const merchResp = await fetch(`${squareApiBase()}/v2/merchants/${merchantId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Square-Version': '2024-10-17',
          },
        });
        if (merchResp.ok) {
          const merchJson: any = await merchResp.json();
          merchantName = merchJson?.merchant?.business_name;
        }
      } catch {}

      try {
        const locResp = await fetch(`${squareApiBase()}/v2/locations`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Square-Version': '2024-10-17',
          },
        });
        if (locResp.ok) {
          const locJson: any = await locResp.json();
          const loc = locJson?.locations?.[0];
          locationId = loc?.id;
          locationName = loc?.name;
        }
      } catch {}

      const firestore = admin.firestore();
      await firestore.doc(`users/${userId}/settings/squareConnection`).set({
        merchantId,
        merchantName: merchantName || null,
        locationId: locationId || null,
        locationName: locationName || null,
        accessToken: encryptSquareToken(accessToken),
        refreshToken: encryptSquareToken(refreshToken),
        tokenExpiresAt: expiresAtMs,
        env: SQUARE_ENV,
        connectedAt: new Date().toISOString(),
        disconnectedReason: null,
      });

      res.status(200).json({
        success: true,
        merchantName: merchantName || null,
        locationName: locationName || null,
        env: SQUARE_ENV,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Internal error connecting to Square' });
    }
  });
});

/**
 * Check Square connection status. Returns only non-sensitive fields.
 */
export const checkSquareConnection = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const firestore = admin.firestore();
    const connDoc = await firestore
      .doc(`users/${decodedToken.uid}/settings/squareConnection`)
      .get();

    if (!connDoc.exists) {
      res.status(200).json({ connected: false });
      return;
    }

    const data = connDoc.data()!;
    res.status(200).json({
      connected: true,
      merchantId: data.merchantId || null,
      merchantName: data.merchantName || null,
      locationId: data.locationId || null,
      locationName: data.locationName || null,
      env: data.env || SQUARE_ENV,
      connectedAt: data.connectedAt || null,
      disconnectedReason: data.disconnectedReason || null,
    });
  });
});

/**
 * Disconnect Square — revoke tokens at Square and delete the connection doc.
 */
export const squareDisconnect = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const firestore = admin.firestore();
    const connRef = firestore.doc(`users/${decodedToken.uid}/settings/squareConnection`);
    const connDoc = await connRef.get();

    if (connDoc.exists) {
      const data = connDoc.data()!;
      const plainAccessToken = decryptSquareToken(data.accessToken);
      if (plainAccessToken) {
        try {
          await fetch(`${squareOAuthBase()}/oauth2/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Client ${SQUARE_APP_SECRET}`,
              'Square-Version': '2024-10-17',
            },
            body: JSON.stringify({
              client_id: SQUARE_APP_ID,
              access_token: plainAccessToken,
              merchant_id: data.merchantId,
            }),
          });
        } catch {
          // Revoke is best-effort; we still clear the Firestore doc below.
        }
      }
      await connRef.delete();
    }

    res.status(200).json({ success: true });
  });
});

/**
 * Compute Square pricing for a payment: the amount charged to the customer
 * (incl. optional passthrough surcharge), the QuoteMate app fee we take via
 * Square's app_fee_money mechanism, and the surcharge portion for display.
 *
 * All percentages are hardcoded in shared/pdf/squareFees.ts — not editable
 * per-tradie because the passthrough is bounded by ACCC cost-of-acceptance
 * rules and our platform cut is a business decision, not a setting.
 */
function computeSquarePricing(
  baseDollars: number,
  business: any,
  channel: 'online' | 'in_person',
): {
  chargedDollars: number;
  surchargeDollars: number;
  appFeeCents: number;
  surchargeSuffix: string;
} {
  const surchargeOn = business?.surchargePaymentFees === true;
  const surchargePct = surchargeOn ? PASSTHROUGH_SURCHARGE_PCT : 0;
  const surchargeCents = surchargePct > 0
    ? dollarsToCents(baseDollars * (surchargePct / 100))
    : 0;
  const chargedCents = dollarsToCents(baseDollars) + surchargeCents;

  // App fee is computed off the CHARGED amount so we get our cut on the
  // surcharge portion too (which otherwise would only benefit Square).
  const appFeePct = channel === 'in_person'
    ? QM_APP_FEE_PCT_IN_PERSON
    : QM_APP_FEE_PCT_ONLINE;
  const appFeeCents = Math.max(0, dollarsToCents(
    centsToDollars(chargedCents) * (appFeePct / 100),
  ));

  return {
    chargedDollars: centsToDollars(chargedCents),
    surchargeDollars: centsToDollars(surchargeCents),
    appFeeCents,
    surchargeSuffix: surchargeOn ? ` (incl. ${PASSTHROUGH_SURCHARGE_PCT}% card surcharge)` : '',
  };
}

/**
 * Create a Square hosted payment link for an invoice.
 * Called server-side from sendInvoiceEmail when the tradie has Square connected.
 * Also exposed as an HTTP endpoint so the client can regenerate on demand.
 */
async function createSquarePaymentLinkInternal(
  userId: string,
  invoiceId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string } | null> {
  const firestore = admin.firestore();
  const invoiceRef = firestore.doc(`users/${userId}/invoices/${invoiceId}`);
  const invoiceDoc = await invoiceRef.get();
  if (!invoiceDoc.exists) return null;
  const invoice = invoiceDoc.data()!;

  const tokens = await getSquareTokens(userId);
  if (!tokens) return null;

  const total = Number(invoice.total) || 0;
  if (total <= 0) return null;

  // Apply the business's card surcharge (if any) so the customer pays
  // total + surcharge and Square's fee doesn't eat the tradie's margin.
  const businessDoc = await firestore.doc(`users/${userId}/settings/business`).get();
  const businessSettings = businessDoc.exists ? businessDoc.data() : {};
  const { chargedDollars, appFeeCents, surchargeSuffix } =
    computeSquarePricing(total, businessSettings, 'online');

  const amountCents = dollarsToCents(chargedDollars);
  const jobName = invoice.job?.name || 'Job';
  const invoiceNumber = invoice.invoiceNumber || invoiceId.slice(0, 8);
  const idempotencyKey = `qm-invoice-${userId}-${invoiceId}-${Date.now()}`;

  const body: any = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: `Invoice ${invoiceNumber} — ${jobName}${surchargeSuffix}`.slice(0, 250),
      price_money: { amount: amountCents, currency: 'AUD' },
      location_id: tokens.locationId,
      // QuoteMate platform fee — deducted from the tradie's payout and sent
      // to our Square developer account automatically.
      app_fee_money: { amount: appFeeCents, currency: 'AUD' },
    },
    payment_note: `QuoteMate invoice ${invoiceNumber}${surchargeSuffix}`,
    checkout_options: {
      allow_tipping: false,
    },
  };

  const resp = await fetch(`${squareApiBase()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-10-17',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error('[square] createSquarePaymentLinkInternal failed', {
      userId, invoiceId, status: resp.status, body: errBody.slice(0, 500),
    });
    return null;
  }

  const json: any = await resp.json();
  const paymentLink = json?.payment_link;
  const paymentLinkId = paymentLink?.id;
  const paymentLinkUrl = paymentLink?.url || paymentLink?.long_url;
  const orderId: string | undefined = paymentLink?.order_id;
  if (!paymentLinkId || !paymentLinkUrl) {
    console.error('[square] createSquarePaymentLinkInternal missing link fields', { userId, invoiceId });
    return null;
  }

  await invoiceRef.set(
    {
      squarePaymentLinkId: paymentLinkId,
      squarePaymentLinkUrl: paymentLinkUrl,
    },
    { merge: true },
  );

  // Index by orderId — every payment webhook carries order_id, giving us an
  // O(1) lookup without needing the merchant's access token. We also keep a
  // secondary index by paymentLinkId in case Square's event ever includes it.
  if (orderId) {
    await firestore.doc(`squarePaymentOrders/${orderId}`).set({
      userId,
      invoiceId,
      paymentLinkId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await firestore.doc(`squarePaymentLinks/${paymentLinkId}`).set({
    userId,
    invoiceId,
    orderId: orderId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { paymentLinkId, paymentLinkUrl };
}

/**
 * Phase-3 minter: thin facade over the index.ts internal mint helpers so
 * documentHandlers.createOrRotatePaymentLink can stay free of Square HTTP/auth
 * code. Each mint call inside still performs its own legacy-field write +
 * orderId index registration; the rotator reads the doc state and decides
 * whether to call us at all.
 */
const phase3SquareMinter: SquareLinkMinter = {
  mintDeposit: async (userId: string, quoteId: string) => {
    return createSquareDepositPaymentLinkInternal(userId, quoteId);
  },
  mintQuoteFull: async (userId: string, quoteId: string) => {
    return createSquareFullQuotePaymentLinkInternal(userId, quoteId);
  },
  mintInvoice: async (userId: string, invoiceId: string) => {
    return createSquarePaymentLinkInternal(userId, invoiceId);
  },
};

/**
 * Wrap the legacy mint helper to also rotate the unified active link on the
 * Document. Returns the legacy-shaped result for back-compat with callers
 * that read paymentLinkId/paymentLinkUrl.
 */
async function mintAndRotate(
  userId: string,
  legacyTargetId: string,
  expectedKind: 'deposit' | 'quote_full' | 'invoice',
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; depositAmount?: number; amount?: number } | null> {
  // Resolve to the unified document id. For deposit/quote_full the legacy id
  // is the quoteId (which is also the unified docId). For invoices the
  // unified doc may live under the source quote's id (collapsed).
  let unifiedDocId: string = legacyTargetId;
  if (expectedKind === 'invoice') {
    const inv = await loadDocumentForInvoiceId(userId, legacyTargetId);
    if (inv) unifiedDocId = inv.id;
  }
  const rotated = await createOrRotatePaymentLink(userId, unifiedDocId, phase3SquareMinter);
  if (!rotated) {
    // Rotation declined (e.g. doc has no link need). Fall back to the raw
    // legacy mint so callers like the take-payment sheet still get a URL.
    if (expectedKind === 'deposit') {
      return createSquareDepositPaymentLinkInternal(userId, legacyTargetId);
    }
    if (expectedKind === 'quote_full') {
      return createSquareFullQuotePaymentLinkInternal(userId, legacyTargetId);
    }
    return createSquarePaymentLinkInternal(userId, legacyTargetId);
  }
  return { paymentLinkId: rotated.paymentLinkId, paymentLinkUrl: rotated.url };
}

export const createSquarePaymentLink = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    // Accept either:
    //   legacy: { invoiceId }
    //   new:    { kind: 'invoice' | 'quote_deposit' | 'quote_full', targetId }
    const { invoiceId, kind, targetId } = req.body || {};

    if (kind === 'quote_deposit') {
      if (!isNonEmptyString(targetId)) {
        res.status(400).json({ error: 'Missing targetId' });
        return;
      }
      const result = await mintAndRotate(decodedToken.uid, targetId, 'deposit');
      if (!result) {
        res.status(400).json({ error: 'Failed to create Square deposit payment link' });
        return;
      }
      res.status(200).json({ success: true, reused: false, ...result });
      return;
    }

    if (kind === 'quote_full') {
      if (!isNonEmptyString(targetId)) {
        res.status(400).json({ error: 'Missing targetId' });
        return;
      }
      const result = await mintAndRotate(decodedToken.uid, targetId, 'quote_full');
      if (!result) {
        res.status(400).json({ error: 'Failed to create Square full quote payment link' });
        return;
      }
      res.status(200).json({ success: true, reused: false, ...result });
      return;
    }

    const id = isNonEmptyString(targetId) ? targetId : invoiceId;
    if (!isNonEmptyString(id)) {
      res.status(400).json({ error: 'Missing invoiceId' });
      return;
    }

    const result = await mintAndRotate(decodedToken.uid, id, 'invoice');
    if (!result) {
      res.status(400).json({ error: 'Failed to create Square payment link' });
      return;
    }
    res.status(200).json({ success: true, reused: false, ...result });
  });
});

/**
 * Mint a Square hosted payment link for a quote's deposit. Called from the
 * acceptance flow when a customer accepts a quote that has depositPercentage > 0
 * and the tradie has Square connected. Idempotent-ish: if a deposit link already
 * exists on the quote, we return it instead of minting a new one.
 *
 * Mirrors createSquarePaymentLinkInternal but writes to the quote (not invoice)
 * and tags the squarePaymentOrders index entry with kind: 'quote_deposit' so the
 * webhook routes payment confirmation back to the quote.
 */
async function createSquareDepositPaymentLinkInternal(
  userId: string,
  quoteId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; depositAmount: number } | null> {
  const firestore = admin.firestore();
  const quoteRef = firestore.doc(`users/${userId}/quotes/${quoteId}`);
  const quoteDoc = await quoteRef.get();
  if (!quoteDoc.exists) return null;
  const quote = quoteDoc.data()!;

  if (quote.requireDeposit !== true) return null;
  const depositPct = Number(quote.depositPercentage) || 0;
  if (depositPct <= 0) return null;
  const total = Number(quote.total) || 0;
  if (total <= 0) return null;
  const depositAmount = Number(quote.depositAmount) || centsToDollars(dollarsToCents(total * (depositPct / 100)));
  if (depositAmount <= 0) return null;

  // Reuse an existing link only while it's still fresh. Square payment links
  // default to a 24-hour expiry; reusing after that serves the customer a
  // 404. Treat anything >23h old as stale and mint a new one.
  const SQUARE_LINK_TTL_MS = 23 * 60 * 60 * 1000;
  const linkCreatedAt: number | undefined = quote.depositPaymentLinkCreatedAt
    ? (typeof quote.depositPaymentLinkCreatedAt === 'number'
        ? quote.depositPaymentLinkCreatedAt
        : quote.depositPaymentLinkCreatedAt?.toMillis?.() ?? Date.parse(String(quote.depositPaymentLinkCreatedAt)))
    : undefined;
  const linkFresh = linkCreatedAt && (Date.now() - linkCreatedAt) < SQUARE_LINK_TTL_MS;
  // Also re-mint if the deposit amount changed since the link was issued
  // (e.g. tradie edited the quote total). The old link would charge the
  // old amount, which would confuse both parties.
  const amountMatchesLink = Number(quote.depositAmount) === depositAmount;
  if (quote.depositPaymentLinkId && quote.depositPaymentLinkUrl && linkFresh && amountMatchesLink) {
    return {
      paymentLinkId: quote.depositPaymentLinkId,
      paymentLinkUrl: quote.depositPaymentLinkUrl,
      depositAmount,
    };
  }

  const tokens = await getSquareTokens(userId);
  if (!tokens) return null;

  const businessDoc = await firestore.doc(`users/${userId}/settings/business`).get();
  const businessSettings = businessDoc.exists ? businessDoc.data() : {};
  const { chargedDollars, appFeeCents, surchargeSuffix } =
    computeSquarePricing(depositAmount, businessSettings, 'online');

  const amountCents = dollarsToCents(chargedDollars);
  const jobName = quote.job?.name || 'Job';
  const quoteNumber = quote.quoteNumber || quoteId.slice(0, 8);
  const idempotencyKey = `qm-quote-deposit-${userId}-${quoteId}-${Date.now()}`;

  const body: any = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: `Deposit for Quote ${quoteNumber} — ${jobName}${surchargeSuffix}`.slice(0, 250),
      price_money: { amount: amountCents, currency: 'AUD' },
      location_id: tokens.locationId,
      app_fee_money: { amount: appFeeCents, currency: 'AUD' },
    },
    payment_note: `QuoteMate deposit on quote ${quoteNumber}${surchargeSuffix}`,
    checkout_options: { allow_tipping: false },
  };

  const resp = await fetch(`${squareApiBase()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-10-17',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error('[square] createSquareDepositPaymentLinkInternal failed', {
      userId, quoteId, status: resp.status, body: errBody.slice(0, 500),
    });
    return null;
  }

  const json: any = await resp.json();
  const paymentLink = json?.payment_link;
  const paymentLinkId = paymentLink?.id;
  const paymentLinkUrl = paymentLink?.url || paymentLink?.long_url;
  const orderId: string | undefined = paymentLink?.order_id;
  if (!paymentLinkId || !paymentLinkUrl) {
    console.error('[square] createSquareDepositPaymentLinkInternal missing link fields', { userId, quoteId });
    return null;
  }

  await quoteRef.set(
    {
      depositPaymentLinkId: paymentLinkId,
      depositPaymentLinkUrl: paymentLinkUrl,
      depositPaymentLinkCreatedAt: Date.now(),
      depositAmount,
    },
    { merge: true },
  );

  if (orderId) {
    await firestore.doc(`squarePaymentOrders/${orderId}`).set({
      userId,
      quoteId,
      paymentLinkId,
      kind: 'quote_deposit',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await firestore.doc(`squarePaymentLinks/${paymentLinkId}`).set({
    userId,
    quoteId,
    kind: 'quote_deposit',
    orderId: orderId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { paymentLinkId, paymentLinkUrl, depositAmount };
}

/**
 * Mint a Square hosted payment link for the FULL outstanding balance of a
 * quote (total − depositPaid). Used when the tradie chooses "Full amount" in
 * TakePaymentSheet and wants to share a pay link instead of using Tap to Pay.
 *
 * Writes to `fullPaymentLink*` fields to avoid colliding with deposit links.
 * Tags the orderId index with kind: 'quote_full' so the webhook can treat the
 * incoming payment as closing out the quote (currently: adds to depositPaid;
 * tradie converts to invoice afterwards with full credit).
 */
async function createSquareFullQuotePaymentLinkInternal(
  userId: string,
  quoteId: string,
): Promise<{ paymentLinkId: string; paymentLinkUrl: string; amount: number } | null> {
  const firestore = admin.firestore();
  const quoteRef = firestore.doc(`users/${userId}/quotes/${quoteId}`);
  const quoteDoc = await quoteRef.get();
  if (!quoteDoc.exists) return null;
  const quote = quoteDoc.data()!;

  const total = Number(quote.total) || 0;
  if (total <= 0) return null;
  const depositPaid = Number(quote.depositPaid) || 0;
  const amount = Math.max(0, total - depositPaid);
  if (amount <= 0) return null;

  // Reuse a fresh existing link if total + depositPaid haven't changed.
  const SQUARE_LINK_TTL_MS = 23 * 60 * 60 * 1000;
  const linkCreatedAt: number | undefined = quote.fullPaymentLinkCreatedAt
    ? (typeof quote.fullPaymentLinkCreatedAt === 'number'
        ? quote.fullPaymentLinkCreatedAt
        : quote.fullPaymentLinkCreatedAt?.toMillis?.() ?? Date.parse(String(quote.fullPaymentLinkCreatedAt)))
    : undefined;
  const linkFresh = linkCreatedAt && (Date.now() - linkCreatedAt) < SQUARE_LINK_TTL_MS;
  const amountMatchesLink = Number(quote.fullPaymentLinkAmount) === amount;
  if (quote.fullPaymentLinkId && quote.fullPaymentLinkUrl && linkFresh && amountMatchesLink) {
    return {
      paymentLinkId: quote.fullPaymentLinkId,
      paymentLinkUrl: quote.fullPaymentLinkUrl,
      amount,
    };
  }

  const tokens = await getSquareTokens(userId);
  if (!tokens) return null;

  const businessDoc = await firestore.doc(`users/${userId}/settings/business`).get();
  const businessSettings = businessDoc.exists ? businessDoc.data() : {};
  const { chargedDollars, appFeeCents, surchargeSuffix } =
    computeSquarePricing(amount, businessSettings, 'online');

  const amountCents = dollarsToCents(chargedDollars);
  const jobName = quote.job?.name || 'Job';
  const quoteNumber = quote.quoteNumber || quoteId.slice(0, 8);
  const idempotencyKey = `qm-quote-full-${userId}-${quoteId}-${Date.now()}`;

  const body: any = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name: `Quote ${quoteNumber} — ${jobName}${surchargeSuffix}`.slice(0, 250),
      price_money: { amount: amountCents, currency: 'AUD' },
      location_id: tokens.locationId,
      app_fee_money: { amount: appFeeCents, currency: 'AUD' },
    },
    payment_note: `QuoteMate full payment on quote ${quoteNumber}${surchargeSuffix}`,
    checkout_options: { allow_tipping: false },
  };

  const resp = await fetch(`${squareApiBase()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-10-17',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error('[square] createSquareFullQuotePaymentLinkInternal failed', {
      userId, quoteId, status: resp.status, body: errBody.slice(0, 500),
    });
    return null;
  }

  const json: any = await resp.json();
  const paymentLink = json?.payment_link;
  const paymentLinkId = paymentLink?.id;
  const paymentLinkUrl = paymentLink?.url || paymentLink?.long_url;
  const orderId: string | undefined = paymentLink?.order_id;
  if (!paymentLinkId || !paymentLinkUrl) {
    console.error('[square] createSquareFullQuotePaymentLinkInternal missing link fields', { userId, quoteId });
    return null;
  }

  await quoteRef.set(
    {
      fullPaymentLinkId: paymentLinkId,
      fullPaymentLinkUrl: paymentLinkUrl,
      fullPaymentLinkCreatedAt: Date.now(),
      fullPaymentLinkAmount: amount,
    },
    { merge: true },
  );

  if (orderId) {
    await firestore.doc(`squarePaymentOrders/${orderId}`).set({
      userId,
      quoteId,
      paymentLinkId,
      kind: 'quote_full',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await firestore.doc(`squarePaymentLinks/${paymentLinkId}`).set({
    userId,
    quoteId,
    kind: 'quote_full',
    orderId: orderId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { paymentLinkId, paymentLinkUrl, amount };
}

/**
 * Square webhook — verifies HMAC-SHA256 signature, handles payment.updated
 * with status COMPLETED, and flips the invoice to paid.
 *
 * NOTE: Firebase Functions v1 gives us req.rawBody; we use it directly so the
 * signature over the exact received bytes stays valid.
 */
export const squareWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const signature =
    (req.headers['x-square-hmacsha256-signature'] as string) ||
    (req.headers['x-square-signature'] as string) ||
    '';
  const rawBody = (req.rawBody || Buffer.from('')).toString('utf8');

  // HMAC-SHA256 over (notificationUrl + rawBody) using the signature key.
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    res.status(500).send('Webhook not configured');
    return;
  }

  const expected = crypto
    .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(SQUARE_WEBHOOK_NOTIFICATION_URL + rawBody)
    .digest('base64');

  const sigBuf = Buffer.from(signature, 'base64');
  const expBuf = Buffer.from(expected, 'base64');
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    res.status(401).send('Invalid signature');
    return;
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  // Respond 200 fast so Square doesn't retry on downstream failures — we've
  // already verified the signature. Handler errors are swallowed server-side.
  res.status(200).json({ received: true });

  try {
    const eventType = event?.type;

    // Dispute events (chargebacks + inquiries) route to a separate handler.
    // Square keeps these on their own lifecycle rather than piggybacking on
    // the payment events, so a paid invoice can silently flip to "disputed"
    // without the tradie noticing unless we surface it here.
    if (
      eventType === 'dispute.created' ||
      eventType === 'dispute.state.updated' ||
      eventType === 'dispute.evidence_added'
    ) {
      await handleSquareDisputeEvent(event).catch((err) => {
        console.error('[square] dispute handler failed', { message: err?.message });
      });
      return;
    }

    if (eventType !== 'payment.updated' && eventType !== 'payment.created') {
      return;
    }

    const payment = event?.data?.object?.payment;
    if (!payment) return;

    const status = payment.status; // APPROVED | COMPLETED | CANCELED | FAILED
    if (status !== 'COMPLETED') return;

    const orderId = payment.order_id;
    if (!orderId) return;

    // Resolve (userId, invoiceId) via the orderId index populated at link creation.
    // Every Square payment event carries order_id, so this is O(1) and doesn't
    // require calling back into Square with the merchant's access token.
    const firestore = admin.firestore();
    const indexDoc = await firestore.doc(`squarePaymentOrders/${orderId}`).get();
    if (!indexDoc.exists) return;
    const idx = indexDoc.data()!;
    const userId: string | null = idx.userId || null;
    if (!userId) return;

    // Quote deposit payment — update the quote, not an invoice. The deposit is
    // tracked as a credit on the quote and gets deducted when the final invoice
    // is created from the quote. If the quote isn't already accepted, paying the
    // deposit IS the acceptance — flip status and fire the same side-effects
    // (tradie email + push) that the Accept page would have.
    if (idx.kind === 'quote_deposit' || idx.kind === 'quote_full') {
      const quoteId: string | null = idx.quoteId || null;
      if (!quoteId) return;
      const quoteRef = firestore.doc(`users/${userId}/quotes/${quoteId}`);
      const quoteDoc = await quoteRef.get();
      if (!quoteDoc.exists) return;
      const quote = quoteDoc.data()!;
      if (quote.depositSquarePaymentId && quote.depositSquarePaymentId === payment.id) return;

      const paidAmountDollars = centsToDollars(Number(payment?.amount_money?.amount) || 0);
      // For deposits: cap at the expected depositAmount; for full-quote
      // payments: cap at the quote total. Keeps surcharge from inflating
      // the "paid" bucket beyond what the quote line says.
      const expectedCap = idx.kind === 'quote_full'
        ? Number(quote.total) || 0
        : Number(quote.depositAmount) || paidAmountDollars;
      const paidAgainstQuote = expectedCap > 0
        ? Math.min(paidAmountDollars, expectedCap)
        : paidAmountDollars;
      const newDepositPaid = Math.max(Number(quote.depositPaid) || 0, paidAgainstQuote);
      const quoteTotal = Number(quote.total) || 0;
      const newPaidTotal = idx.kind === 'quote_full'
        ? Math.max(Number(quote.paidTotal) || 0, paidAgainstQuote)
        : newDepositPaid;
      const wasAlreadyAccepted = quote.status === 'accepted' || !!quote.respondedAt;

      // Record T&C acceptance against the snapshot taken at send time.
      // Legal basis: the customer received the PDF containing these terms
      // and completing payment = accepting them (flagged in the email copy).
      const tcSource: 'pay_link' | 'tap_to_pay' =
        idx.source === 'in_app' ? 'tap_to_pay' : 'pay_link';
      const tcAcceptance = quote.termsVersionHash
        ? {
            versionHash: quote.termsVersionHash,
            at: admin.firestore.FieldValue.serverTimestamp(),
            source: tcSource,
          }
        : null;

      const update: any = {
        depositPaid: newDepositPaid,
        depositPaidAt: admin.firestore.FieldValue.serverTimestamp(),
        depositSquarePaymentId: payment.id,
        paidTotal: newPaidTotal,
        balanceDue: Math.max(0, quoteTotal - newPaidTotal),
        // Payment reconciled; clear any previous sync-error banner.
        paymentSyncError: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (tcAcceptance) {
        if (idx.kind === 'quote_full') {
          update.fullTcAccepted = tcAcceptance;
        } else {
          update.depositTcAccepted = tcAcceptance;
        }
      }
      // Reverse-lookup index so dispute events (which don't carry order_id)
      // can resolve back to this quote via payment.id. Stamped with amount +
      // appFee so the admin revenue view can aggregate QuoteMate earnings.
      {
        const paidCents = Number(payment?.amount_money?.amount) || 0;
        const channel: 'in_person' | 'online' = idx.source === 'in_app' ? 'in_person' : 'online';
        const feePct = channel === 'in_person' ? QM_APP_FEE_PCT_IN_PERSON : QM_APP_FEE_PCT_ONLINE;
        const appFeeCents = Math.max(0, dollarsToCents(centsToDollars(paidCents) * (feePct / 100)));
        await firestore.doc(`squarePayments/${payment.id}`).set({
          userId,
          quoteId,
          kind: idx.kind,
          orderId,
          amountCents: paidCents,
          appFeeCents,
          channel,
          currency: payment?.amount_money?.currency || 'AUD',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (!wasAlreadyAccepted) {
        update.status = 'accepted';
        update.respondedAt = admin.firestore.FieldValue.serverTimestamp();
        update.respondedBy = quote.customerName || 'Client';
      }
      await quoteRef.set(update, { merge: true });

      // Phase-2: also push the payment into the unified document ledger so the
      // documents/{quoteId} view reflects this payment without waiting for the
      // mirror trigger to re-derive paidTotal/balanceDue from the quote.
      try {
        await applyPaymentToDocument({
          userId,
          paymentId: payment.id,
          orderId,
          amountCents: Number(payment?.amount_money?.amount) || 0,
          source: idx.source === 'in_app' ? 'in_app' : 'pay_link',
          kind: idx.kind,
          quoteId,
        });
      } catch (err: any) {
        functions.logger.warn('phase2_unified_payment_write_failed', {
          paymentId: payment.id, kind: idx.kind, message: err?.message,
        });
      }

      // Fire acceptance side-effects exactly once, only when this payment is
      // what flipped the quote (avoids double-firing if the customer accepted
      // separately first).
      if (!wasAlreadyAccepted) {
        try {
          const settingsDoc = await firestore.doc(`users/${userId}/settings/business`).get();
          const businessSettings = settingsDoc.exists ? settingsDoc.data() : null;
          if (businessSettings?.email) {
            const quoteNumber = quote.quoteNumber || quote.id;
            await sendQuoteAcceptedEmail(
              businessSettings.email,
              quote.customerName,
              quoteNumber,
              Number(quote.total) || 0,
              null,
              userId,
            );
          }
        } catch {
          // Swallow.
        }
        try {
          const fcmSnap = await firestore.collection(`users/${userId}/fcmTokens`).get();
          if (!fcmSnap.empty) {
            const tokens = fcmSnap.docs.map((d) => d.data().token).filter(Boolean);
            const aussieMsg = getAussieMessage('quote_accepted', {
              customer: quote.customerName,
              job: quote.job?.name || 'the job',
            });
            await admin.messaging().sendEachForMulticast({
              notification: { title: aussieMsg.title, body: aussieMsg.body },
              data: { quoteId: quote.id, type: 'quote_response', response: 'accepted' },
              tokens,
            });
          }
        } catch {
          // Swallow.
        }
      }
      return;
    }

    const invoiceId: string | null = idx.invoiceId || null;
    if (!invoiceId) return;

    const invoiceRef = firestore.doc(`users/${userId}/invoices/${invoiceId}`);
    const invoiceDoc = await invoiceRef.get();
    if (!invoiceDoc.exists) return;
    const invoice = invoiceDoc.data()!;

    // Idempotency: skip if we've already recorded this payment id.
    if (invoice.squarePaymentId && invoice.squarePaymentId === payment.id) return;

    const paidAmountDollars = centsToDollars(Number(payment?.amount_money?.amount) || 0);
    const total = Number(invoice.total) || 0;
    // Cap at invoice total so a surcharged payment (total + 1.9%) doesn't
    // report the invoice as "overpaid". The actual received amount is on
    // Square's side for reconciliation/payout reports.
    const paidAgainstInvoice = Math.min(paidAmountDollars, total);
    const newPaidAmount = Math.max(Number(invoice.paidAmount) || 0, paidAgainstInvoice);
    const newStatus = newPaidAmount + 0.005 >= total ? 'paid' : 'partial';

    const invoiceTcSource: 'pay_link' | 'tap_to_pay' =
      idx.source === 'in_app' ? 'tap_to_pay' : 'pay_link';
    const invoiceTcAcceptance = invoice.termsVersionHash
      ? {
          versionHash: invoice.termsVersionHash,
          at: admin.firestore.FieldValue.serverTimestamp(),
          source: invoiceTcSource,
        }
      : null;

    await invoiceRef.set(
      {
        status: newStatus,
        paidAmount: newPaidAmount,
        paidTotal: newPaidAmount,
        balanceDue: Math.max(0, total - newPaidAmount),
        paidDate: admin.firestore.FieldValue.serverTimestamp(),
        paymentMethod: 'card',
        paymentNotes: `Square payment ${payment.id}`,
        squarePaymentId: payment.id,
        squarePaidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Reconciled successfully — drop any stale error banner.
        paymentSyncError: admin.firestore.FieldValue.delete(),
        ...(invoiceTcAcceptance ? { tcAccepted: invoiceTcAcceptance } : {}),
      },
      { merge: true },
    );
    // Reverse-lookup index so dispute events (which carry disputed payment
    // id but not order id) can resolve back to this invoice. Also stamped with
    // amount + appFee so the admin revenue view can aggregate QuoteMate earnings.
    {
      const paidCents = Number(payment?.amount_money?.amount) || 0;
      const channel: 'in_person' | 'online' = idx.source === 'in_app' ? 'in_person' : 'online';
      const feePct = channel === 'in_person' ? QM_APP_FEE_PCT_IN_PERSON : QM_APP_FEE_PCT_ONLINE;
      const appFeeCents = Math.max(0, dollarsToCents(centsToDollars(paidCents) * (feePct / 100)));
      await firestore.doc(`squarePayments/${payment.id}`).set({
        userId,
        invoiceId,
        orderId,
        kind: 'invoice',
        amountCents: paidCents,
        appFeeCents,
        channel,
        currency: payment?.amount_money?.currency || 'AUD',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // Phase-2: push the payment into the unified document ledger so the
    // documents/{id} view reflects this payment immediately.
    try {
      await applyPaymentToDocument({
        userId,
        paymentId: payment.id,
        orderId,
        amountCents: Number(payment?.amount_money?.amount) || 0,
        source: idx.source === 'in_app' ? 'in_app' : 'pay_link',
        kind: 'invoice',
        invoiceId,
      });
    } catch (err: any) {
      functions.logger.warn('phase2_unified_payment_write_failed', {
        paymentId: payment.id, kind: 'invoice', message: err?.message,
      });
    }

    // If the invoice has already been pushed to Xero, record the payment
    // there too. Best-effort; errors are swallowed inside the helper.
    if (invoice.xeroInvoiceId) {
      await pushPaymentToXeroInternal(
        userId,
        invoice.xeroInvoiceId,
        paidAmountDollars,
        new Date(),
        'card',
      );
    }
  } catch (err: any) {
    // Already responded 200 so Square doesn't retry. But we MUST NOT lose the
    // event — stamp a paymentSyncError onto the affected doc so the tradie
    // sees a banner and can manually reconcile instead of the payment
    // vanishing into the logs.
    console.error('[square] webhook reconciliation failed', {
      eventType: event?.type, message: err?.message,
    });
    try {
      await recordPaymentSyncError(event, err?.message || 'Unknown error');
    } catch (recErr: any) {
      console.error('[square] recordPaymentSyncError threw', { message: recErr?.message });
    }
  }
});

/**
 * Stamp `paymentSyncError` onto the invoice/quote associated with a failed
 * Square webhook reconciliation. Best-effort: if we can't resolve the doc
 * we at least logged above. Called from the webhook catch block only.
 */
async function recordPaymentSyncError(event: any, message: string): Promise<void> {
  const firestore = admin.firestore();
  const payment = event?.data?.object?.payment;
  const orderId: string | undefined = payment?.order_id;
  if (!orderId) return;
  const indexDoc = await firestore.doc(`squarePaymentOrders/${orderId}`).get();
  if (!indexDoc.exists) return;
  const idx = indexDoc.data()!;
  if (!idx.userId) return;
  const err = {
    at: admin.firestore.FieldValue.serverTimestamp(),
    code: 'webhook_reconcile_failed',
    message: message.slice(0, 500),
    paymentId: payment?.id || null,
  };
  if (idx.kind === 'quote_deposit' || idx.kind === 'quote_full') {
    if (idx.quoteId) {
      await firestore.doc(`users/${idx.userId}/quotes/${idx.quoteId}`).set(
        { paymentSyncError: err },
        { merge: true },
      );
    }
  } else if (idx.invoiceId) {
    await firestore.doc(`users/${idx.userId}/invoices/${idx.invoiceId}`).set(
      { paymentSyncError: err },
      { merge: true },
    );
  }
}

/**
 * Handle a Square dispute webhook. Routes via the squarePayments reverse
 * index populated when payments are reconciled, writes the dispute to a
 * per-user subcollection for history, stamps disputeStatus on the affected
 * invoice/quote, and emails the tradie so they can respond in time — Square
 * gives merchants a short window to submit evidence before the chargeback is
 * finalised.
 */
async function handleSquareDisputeEvent(event: any): Promise<void> {
  const firestore = admin.firestore();
  const dispute = event?.data?.object?.dispute;
  if (!dispute) return;
  const disputeId: string | undefined = dispute.id;
  const paymentId: string | undefined = dispute.disputed_payment?.payment_id;
  if (!disputeId || !paymentId) return;

  const lookupDoc = await firestore.doc(`squarePayments/${paymentId}`).get();
  if (!lookupDoc.exists) {
    console.warn('[square] dispute event without matching payment index', { disputeId, paymentId });
    return;
  }
  const lookup = lookupDoc.data()!;
  const userId: string | null = lookup.userId || null;
  if (!userId) return;

  const disputeState: string = dispute.state || 'UNKNOWN';
  const disputeRef = firestore.doc(`users/${userId}/squareDisputes/${disputeId}`);
  await disputeRef.set(
    {
      disputeId,
      paymentId,
      state: disputeState,
      reason: dispute.reason || null,
      amountCents: Number(dispute.amount_money?.amount) || 0,
      currency: dispute.amount_money?.currency || 'AUD',
      dueAt: dispute.evidence_deadline || null,
      orderId: lookup.orderId || null,
      invoiceId: lookup.invoiceId || null,
      quoteId: lookup.quoteId || null,
      eventType: event?.type || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Stamp on the parent invoice/quote so the ViewInvoice/ViewQuote screen
  // can surface a banner. Only overwrite if the new state is newer or the
  // doc has no disputeId yet (multiple events for the same dispute).
  const parentUpdate = {
    disputeStatus: disputeState,
    disputeId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (lookup.invoiceId) {
    await firestore.doc(`users/${userId}/invoices/${lookup.invoiceId}`).set(
      parentUpdate,
      { merge: true },
    );
  } else if (lookup.quoteId) {
    await firestore.doc(`users/${userId}/quotes/${lookup.quoteId}`).set(
      parentUpdate,
      { merge: true },
    );
  }

  // Notify the tradie on dispute.created + state changes that require action.
  // dispute.state.updated fires on every state transition, so we filter to the
  // states where the tradie needs to do something.
  const actionableStates = new Set([
    'INQUIRY_EVIDENCE_REQUIRED',
    'EVIDENCE_REQUIRED',
    'LOST',
  ]);
  const isNewDispute = event?.type === 'dispute.created';
  if (isNewDispute || actionableStates.has(disputeState)) {
    try {
      const settingsDoc = await firestore.doc(`users/${userId}/settings/business`).get();
      const businessEmail: string | null = settingsDoc.data()?.email || null;
      if (businessEmail) {
        const amount = centsToDollars(Number(dispute.amount_money?.amount) || 0);
        const subject = isNewDispute
          ? `Chargeback opened — respond within Square deadline`
          : `Dispute update: ${disputeState.replace(/_/g, ' ').toLowerCase()}`;
        const bodyHtml = `
          <p>A customer has ${isNewDispute ? 'opened a chargeback dispute' : 'updated the dispute'} against a Square payment.</p>
          <ul>
            <li><strong>Amount:</strong> $${amount.toFixed(2)} AUD</li>
            <li><strong>Reason:</strong> ${dispute.reason || 'Not provided'}</li>
            <li><strong>State:</strong> ${disputeState}</li>
            ${dispute.evidence_deadline ? `<li><strong>Evidence due:</strong> ${dispute.evidence_deadline}</li>` : ''}
          </ul>
          <p>Respond in the Square dashboard. Don't miss the deadline or you'll lose the dispute by default.</p>
        `;
        await sendEmail({
          to: businessEmail,
          subject,
          htmlContent: bodyHtml,
          category: 'transactional',
          userId,
          tags: ['square', 'dispute'],
        }).catch(() => {/* best effort */});
      }
    } catch (err: any) {
      console.warn('[square] dispute notification email failed', { disputeId, message: err?.message });
    }
  }
}

/**
 * Record an in-app (Mobile Payments SDK / Tap to Pay) payment so the Square
 * webhook can flip invoice/quote status when `payment.updated` fires. Writes
 * into the same `squarePaymentOrders/{orderId}` index used by hosted
 * payment-link mints, so the existing webhook handler reconciles both paths.
 */
export const recordInAppSquarePayment = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const { kind, targetId, paymentId, orderId, amountCents, fallbackTerms } = req.body || {};
    if (
      (kind !== 'invoice' && kind !== 'quote_deposit') ||
      !isNonEmptyString(targetId) ||
      !isNonEmptyString(paymentId) ||
      !isNonEmptyString(orderId) ||
      typeof amountCents !== 'number'
    ) {
      res.status(400).json({ error: 'Missing fields' });
      return;
    }

    const firestore = admin.firestore();
    const userId = decodedToken.uid;

    // Match Donkw's index schema: webhook reads { userId, invoiceId } or
    // { userId, quoteId, kind: 'quote_deposit' }.
    const indexDoc: any = {
      userId,
      paymentId,
      amountCents,
      source: 'in_app',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (kind === 'quote_deposit') {
      indexDoc.quoteId = targetId;
      indexDoc.kind = 'quote_deposit';
    } else {
      indexDoc.invoiceId = targetId;
    }

    await firestore
      .doc(`squarePaymentOrders/${orderId}`)
      .set(indexDoc, { merge: true });

    // Fallback terms: if the client passed terms AND the target doc has no
    // snapshot of its own, write them now so the webhook can stamp a real
    // acceptance record. We do NOT overwrite an existing snapshot — the
    // per-quote record of what the customer saw at send time is load-bearing.
    if (isNonEmptyString(fallbackTerms)) {
      const trimmed = String(fallbackTerms).trim();
      if (trimmed) {
        const targetPath = kind === 'quote_deposit'
          ? `users/${userId}/quotes/${targetId}`
          : `users/${userId}/invoices/${targetId}`;
        const targetRef = firestore.doc(targetPath);
        try {
          const snap = await targetRef.get();
          const existing = snap.exists ? snap.data() : null;
          if (!existing?.termsVersionHash) {
            await targetRef.set(
              {
                termsSnapshot: trimmed,
                termsVersionHash: hashTerms(trimmed),
              },
              { merge: true },
            );
          }
        } catch (err: any) {
          console.warn('[square] fallback-terms snapshot failed', {
            userId, targetId, message: err?.message,
          });
        }
      }
    }

    res.status(200).json({ success: true });
  });
});

/**
 * Fetch a Square Mobile Payments SDK authorization for the client. The SDK's
 * `authorize(accessToken, locationId)` expects the merchant's OAuth access
 * token directly — we hand ours back decrypted. This is secure for QuoteMate
 * because each tradie is the sole user of their own device, and the stored
 * token is already scoped to that tradie's Firebase UID.
 *
 * The response field is called `authorizationCode` for legacy client
 * compatibility; the value is the access token that the SDK expects.
 */
export const getSquareMobileAuthCode = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const decodedToken = await verifyAuthWithRateLimit(req, res);
    if (!decodedToken) return;

    const tokens = await getSquareTokens(decodedToken.uid);
    if (!tokens) {
      res.status(401).json({ error: 'Square not connected.' });
      return;
    }
    if (!tokens.locationId) {
      res.status(400).json({ error: 'No Square location configured.' });
      return;
    }

    // Return the access token directly. getSquareTokens already refreshes it
    // lazily if it's within 60s of expiry, so the client gets a fresh value.
    res.status(200).json({
      authorizationCode: tokens.accessToken,
      accessToken: tokens.accessToken,
      locationId: tokens.locationId,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// NSW FuelCheck — daily average prices cached to Firestore /config/fuelPrices
// ────────────────────────────────────────────────────────────────────────────

const NSW_FUEL_BASE = 'https://api.onegov.nsw.gov.au';

async function fetchNswFuelToken(): Promise<string> {
  const key = process.env.NSW_FUELCHECK_API_KEY;
  const secret = process.env.NSW_FUELCHECK_API_SECRET;
  if (!key || !secret) throw new Error('NSW FuelCheck credentials missing');
  const basic = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(
    `${NSW_FUEL_BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`,
    { method: 'GET', headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw new Error(`NSW token fetch failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('NSW token response missing access_token');
  return json.access_token;
}

async function computeNswFuelAverages() {
  const token = await fetchNswFuelToken();
  const txId = crypto.randomUUID();
  const res = await fetch(`${NSW_FUEL_BASE}/FuelPriceCheck/v2/fuel/prices`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.NSW_FUELCHECK_API_KEY || '',
      transactionid: txId,
      requesttimestamp: (() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const hh24 = d.getHours();
        const hh = hh24 % 12 || 12;
        const ampm = hh24 < 12 ? 'AM' : 'PM';
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(hh)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
      })(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  if (!res.ok) throw new Error(`NSW prices fetch failed: ${res.status}`);
  const json = (await res.json()) as { prices?: Array<{ fueltype: string; price: number }> };
  const sums: Record<string, { total: number; n: number }> = {};
  for (const p of json.prices || []) {
    if (typeof p.price !== 'number' || p.price <= 0) continue;
    const key = String(p.fueltype || '').toUpperCase();
    if (!key) continue;
    sums[key] = sums[key] || { total: 0, n: 0 };
    sums[key].total += p.price;
    sums[key].n += 1;
  }
  const averages: Record<string, number> = {};
  for (const [k, v] of Object.entries(sums)) {
    if (v.n > 0) averages[k] = Math.round((v.total / v.n) * 10) / 10; // cents/L, 1dp
  }
  return averages;
}

async function writeFuelPrices(averages: Record<string, number>) {
  const db = admin.firestore();
  await db.doc('config/fuelPrices').set(
    {
      source: 'nsw-fuelcheck',
      region: 'NSW',
      currency: 'AUD',
      unit: 'cents_per_litre',
      averages,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export const refreshNswFuelPrices = functions.pubsub
  .schedule('every day 06:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const averages = await computeNswFuelAverages();
    await writeFuelPrices(averages);
    return null;
  });

// Manual/admin trigger to populate the cache on demand (also used for the
// initial seed before the first scheduled run).
export const refreshNswFuelPricesNow = functions.https.onRequest(async (req, res) => {
  try {
    const adminKey = req.get('x-admin-key') || req.query.key;
    if (!adminKey || adminKey !== process.env.ADMIN_DASHBOARD_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const averages = await computeNswFuelAverages();
    await writeFuelPrices(averages);
    res.json({ ok: true, averages });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'refresh failed' });
  }
});
