import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import cors from 'cors';
import fetch from 'node-fetch';
import {
  getUserEmail,
  sendWelcomeEmail,
  sendQuoteAcceptedEmail,
  sendQuoteDeclinedEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
  sendReEngagementEmail,
  sendOnboardingTipEmail,
  sendUpdateAnnouncementEmail,
  handleUnsubscribe,
} from './email';

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Stripe with mode toggle (test or live)
const stripeMode = process.env.STRIPE_MODE || 'test';
const isTestMode = stripeMode === 'test';

// Select the appropriate secret key based on mode
const stripeSecretKey = isTestMode
  ? (functions.config().stripe?.test_secret_key || process.env.STRIPE_TEST_SECRET_KEY || '')
  : (functions.config().stripe?.live_secret_key || process.env.STRIPE_LIVE_SECRET_KEY || '');

console.log(`🔑 Initializing Stripe in ${stripeMode.toUpperCase()} mode`);

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16',
});

// CORS configuration - whitelist allowed origins
const allowedOrigins = [
  'https://us-central1-hansendev.cloudfunctions.net',
  'https://hansendev.web.app',
  'https://hansendev.firebaseapp.com',
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
    console.error('Rate limit check failed:', error);
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
    console.error('Auth token verification failed:', error);
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

      console.log('Creating checkout session for user:', userId);

      // Create Stripe customer directly (no database needed)
      const customer = await stripe.customers.create({
        metadata: {
          firebaseUserId: userId,
        },
      });

      console.log('Created Stripe customer:', customer.id);

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

      console.log('Created checkout session:', session.id);

      res.status(200).json({
        sessionId: session.id,
        url: session.url
      });
    } catch (error: any) {
      console.error('Error creating checkout session:', error);
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

      console.log('Creating subscription for user:', userId);

      // Find or create Stripe customer
      let customerId: string;
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length > 0) {
        customerId = customerList.data[0].id;
        console.log('Found existing customer:', customerId);
      } else {
        const customer = await stripe.customers.create({
          metadata: {
            firebaseUserId: userId,
          },
        });
        customerId = customer.id;
        console.log('Created new customer:', customerId);
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

      console.log('Created subscription:', subscription.id);
      console.log('Payment intent:', paymentIntent.id);

      res.status(200).json({
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        customerId,
      });
    } catch (error: any) {
      console.error('Error creating subscription:', error);
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
      console.error('Error creating portal session:', error);
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

      console.log('🚫 Canceling subscription for user:', userId);

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

      console.log('✅ Subscription canceled at period end:', subscription.id);

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

      console.log('📝 Cancellation reason saved to Firestore');

      res.status(200).json({
        success: true,
        message: 'Subscription canceled successfully',
        cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
        periodEnd: new Date(canceledSubscription.current_period_end * 1000).toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error canceling subscription:', error);
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
      const { userId, userEmail, reason, feedback, timestamp } = req.body;

      if (!isNonEmptyString(reason)) {
        res.status(400).json({ error: 'Missing or invalid reason' });
        return;
      }

      const safeReason = sanitizeString(reason, 500);
      const safeFeedback = typeof feedback === 'string' ? sanitizeString(feedback, 2000) : '';
      const safeEmail = typeof userEmail === 'string' ? sanitizeString(userEmail, 320) : '';

      // Log with a special prefix so it's easy to find in logs
      console.log('🚫 ===== CANCELLATION FEEDBACK =====');
      console.log('📧 User Email:', safeEmail);
      console.log('🆔 User ID:', userId);
      console.log('📝 Reason:', safeReason);
      console.log('💬 Additional Feedback:', safeFeedback || 'None provided');
      console.log('📅 Timestamp:', timestamp);
      console.log('🚫 ==================================');

      res.status(200).json({ success: true, message: 'Feedback logged successfully' });
    } catch (error: any) {
      console.error('Error logging cancellation feedback:', error);
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
      console.error('Error getting subscription status:', error);
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
  const webhookSecret = functions.config().stripe?.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '';

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
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
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle successful checkout session
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const customerId = session.customer as string;

  if (!userId) {
    console.error('No userId in session metadata');
    return;
  }

  console.log(`✅ Checkout completed for user ${userId}, customer ${customerId}`);
  // No database storage needed - customer data is in Stripe with firebaseUserId in metadata
}

/**
 * Handle subscription created or updated
 * Writes subscription status to Firestore so all platforms can sync
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  console.log(`📝 Subscription ${subscription.id} ${subscription.status} for customer ${customerId}`);
  console.log(`   Period: ${new Date(subscription.current_period_start * 1000).toISOString()} to ${new Date(subscription.current_period_end * 1000).toISOString()}`);

  try {
    // Look up Firebase user ID from Stripe customer metadata
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      console.error('Customer has been deleted:', customerId);
      return;
    }

    const userId = customer.metadata?.firebaseUserId;
    if (!userId) {
      console.error('No firebaseUserId in customer metadata for:', customerId);
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

    console.log(`✅ Firestore updated for user ${userId}: isPro=${isActive}`);
  } catch (error) {
    console.error('Error updating Firestore from webhook:', error);
  }
}

/**
 * Handle subscription deletion
 * Marks user as non-premium in Firestore
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  console.log(`❌ Subscription ${subscription.id} canceled for customer ${customerId}`);

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      console.error('Customer has been deleted:', customerId);
      return;
    }

    const userId = customer.metadata?.firebaseUserId;
    if (!userId) {
      console.error('No firebaseUserId in customer metadata for:', customerId);
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

    console.log(`✅ Firestore updated for user ${userId}: isPro=false (subscription deleted)`);

    // Send cancellation email
    try {
      const email = await getUserEmail(userId);
      if (email) {
        const settingsDoc = await firestore.doc(`users/${userId}/settings/business`).get();
        const businessName = settingsDoc.data()?.businessName || '';
        await sendSubscriptionCancelledEmail(email, businessName, userId);
      }
    } catch (emailError) {
      console.error('Error sending cancellation email:', emailError);
    }
  } catch (error) {
    console.error('Error updating Firestore from webhook:', error);
  }
}

/**
 * Handle successful payment
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  console.log(`Payment succeeded for customer ${customerId}`);
}

/**
 * Handle failed payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  console.log(`Payment failed for customer ${customerId}`);

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
    console.error('Error sending payment failed email:', error);
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
      console.error('Error checking quota:', error);
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

      console.log(`🍎 Validating Apple receipt for user ${userId}, product ${productId}`);

      // Validate receipt with Apple's servers
      const receiptData = purchaseToken || transactionId;
      const sharedSecret = functions.config().apple?.shared_secret || process.env.APPLE_SHARED_SECRET || '';

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
              console.warn(`Apple validation failed with status ${appleData.status} at ${url}`);
            }
          }
        } catch (appleError) {
          console.warn('Apple receipt validation API call failed, falling back to trust-based:', appleError);
        }
      } else {
        console.warn('Apple shared secret not configured, skipping server validation');
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

      console.log(`✅ Apple receipt ${appleValidated ? 'validated' : 'saved (unvalidated)'} for user ${userId}`);

      res.status(200).json({
        success: true,
        isPremium: true,
        validated: appleValidated,
        expiryDate: expiryDate.toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error validating Apple receipt:', error);
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

      console.log(`🤖 Validating Google receipt for user ${userId}, product ${productId}`);

      let googleValidated = false;
      let googleExpiryDate: Date | null = null;

      // Validate with Google Play Developer API if service account is configured
      const googleServiceAccount = functions.config().google?.service_account_json || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const googlePackageName = functions.config().google?.package_name || process.env.GOOGLE_PACKAGE_NAME || 'com.quotemate.app';

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
              console.warn('Google subscription expired');
            }
          }
        } catch (googleError) {
          console.warn('Google Play validation failed, falling back to trust-based:', googleError);
        }
      } else {
        console.warn('Google service account not configured or no purchase token, skipping server validation');
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

      console.log(`✅ Google receipt ${googleValidated ? 'validated' : 'saved (unvalidated)'} for user ${userId}`);

      res.status(200).json({
        success: true,
        isPremium: true,
        validated: googleValidated,
        expiryDate: expiryDate.toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error validating Google receipt:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Analyze Job Description using Anthropic Claude API
 * This Cloud Function acts as a proxy to avoid CORS issues on web
 */
export const analyzeJobDescription = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const decodedToken = await verifyAuthWithRateLimit(req, res, RATE_LIMITS.heavy);
    if (!decodedToken) return;

    try {
      const { jobDescription, tradeContext } = req.body;

      if (!isNonEmptyString(jobDescription)) {
        res.status(400).json({ error: 'Missing or invalid jobDescription' });
        return;
      }
      if (jobDescription.length > 50000) {
        res.status(400).json({ error: 'jobDescription exceeds maximum length' });
        return;
      }

      // Get API key from Firebase config
      const anthropicApiKey = functions.config().anthropic?.api_key || process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
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

      // Determine which stores will be searched
      const stores = tradeContext?.hardwareStores || ['bunnings.com.au'];
      const storeNames = stores.map((url: string) => {
        if (url.includes('bunnings')) return 'Bunnings';
        if (url.includes('mitre10')) return 'Mitre 10';
        if (url.includes('reece')) return 'Reece';
        if (url.includes('middy')) return 'Middy\'s';
        return url;
      });
      const storesText = storeNames.join(', ');

      const prompt = `You are an expert Australian tradie assistant specializing in construction and trade work. Analyze the following job description and generate a detailed materials list with generic search terms that work across multiple hardware stores.

Job Description: "${jobDescription}"${contextSection}

Hardware Stores that will be searched: ${storesText}

Provide a JSON response with the following structure:
{
  "jobSummary": "A brief summary of the job",
  "estimatedHours": <number of hours>,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Generic product search term (material type, size, specs - NOT brand-specific)",
      "quantity": <number>,
      "unit": "each|m|L|kg|box|pack",
      "reasoning": "Why this material is needed"
    }
  ]
}

Guidelines:
- Use GENERIC product terms that work across ${storesText}
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

      // Call Anthropic API
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 2000,
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

      res.status(200).json({
        materials: parsed.materials || [],
        estimatedHours: parsed.estimatedHours || 8,
        jobSummary: parsed.jobSummary || '',
      });
    } catch (error: any) {
      console.error('Error analyzing job description:', error);
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
      const anthropicApiKey = functions.config().anthropic?.api_key || process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
      }

      const storeList = (hardwareStoreUrls || []).join(', ');

      const prompt = `You are a pricing expert for Australian hardware stores like Bunnings.

Material: "${materialName}"
Store context: ${storeList}

Based on your knowledge of typical Australian hardware store pricing, estimate a reasonable price for this material.
Consider typical Bunnings/hardware store pricing from 2024.

Return ONLY a JSON object in this exact format (no other text):
{
  "price": <number>,
  "productName": "<material name>",
  "store": "Bunnings (estimated)",
  "confidence": "<low|medium|high>"
}

Important:
- Return the price as a number only (e.g., 12.50, not "$12.50")
- Base your estimate on typical hardware store pricing
- If you cannot estimate, return { "price": null }
- Return ONLY valid JSON, no markdown, no other text

Example:
{"price": 15.90, "productName": "Treated Pine H3 90x45mm 2.4m", "store": "Bunnings (estimated)", "confidence": "medium"}`;

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
        console.error('No text content in response');
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
      console.error('Error searching material price:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Reece API Endpoints
 * Integration with Reece Group API for plumbing supplies
 * API Docs: https://docs.api.reecegroup.com.au/latest/index.html#tag/Pricing
 *
 * Setup instructions:
 * 1. Register for API access at https://developers.reecegroup.com.au/
 * 2. Obtain API credentials (client_id, client_secret)
 * 3. Set up Firebase config: firebase functions:config:set reece.client_id="xxx" reece.client_secret="xxx"
 */

// Token cache to avoid requesting a new token on every call
let reeceTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get OAuth token for Reece API
 */
async function getReeceAuthToken(): Promise<string | null> {
  try {
    // Check if we have a valid cached token
    if (reeceTokenCache && reeceTokenCache.expiresAt > Date.now()) {
      return reeceTokenCache.token;
    }

    const reeceClientId = functions.config().reece?.client_id || process.env.REECE_CLIENT_ID;
    const reeceClientSecret = functions.config().reece?.client_secret || process.env.REECE_CLIENT_SECRET;

    if (!reeceClientId || !reeceClientSecret) {
      console.log('Reece API credentials not configured');
      return null;
    }

    // Request OAuth token
    const tokenResponse = await fetch('https://api.reecegroup.com.au/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: reeceClientId,
        client_secret: reeceClientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Failed to get Reece OAuth token:', errorText);
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
    console.error('Error getting Reece auth token:', error);
    return null;
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
      console.error('Error checking Reece API:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

/**
 * Search for a product in Reece catalog
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

      // Get OAuth token
      const token = await getReeceAuthToken();
      if (!token) {
        console.log('Reece API credentials not configured - returning null');
        res.status(200).json({ product: null });
        return;
      }

      // Search for product using the catalog/search endpoint
      console.log('Searching Reece catalog for:', productName);
      const searchResponse = await fetch(
        `https://api.reecegroup.com.au/api/v1/catalog/search?query=${encodeURIComponent(productName)}&limit=5`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Reece product search failed:', searchResponse.status, errorText);
        res.status(200).json({ product: null });
        return;
      }

      const searchData = await searchResponse.json();

      // Return the first matching product if found
      if (searchData.products && searchData.products.length > 0) {
        const product = searchData.products[0];
        console.log('Found product:', product.itemNumber, product.description);

        res.status(200).json({
          product: {
            itemNumber: product.itemNumber,
            description: product.description,
            brand: product.brand,
            category: product.category,
          },
        });
      } else {
        console.log('No products found for:', productName);
        res.status(200).json({ product: null });
      }
    } catch (error: any) {
      console.error('Error searching Reece product:', error);
      res.status(200).json({ product: null });
    }
  });
});

/**
 * Get price for a Reece product
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

      // Get OAuth token
      const token = await getReeceAuthToken();
      if (!token) {
        console.log('Reece API credentials not configured - returning null');
        res.status(200).json({ price: null });
        return;
      }

      // Get pricing using the pricing endpoint
      console.log('Getting price for Reece item:', itemNumber);
      const priceResponse = await fetch(
        `https://api.reecegroup.com.au/api/v1/pricing/${encodeURIComponent(itemNumber)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!priceResponse.ok) {
        const errorText = await priceResponse.text();
        console.error('Reece price fetch failed:', priceResponse.status, errorText);
        res.status(200).json({ price: null });
        return;
      }

      const priceData = await priceResponse.json();

      // Extract price (prefer GST-inclusive price)
      const price = priceData.priceIncGst || priceData.price;

      if (price != null) {
        console.log('Found price for', itemNumber, ':', price);
        res.status(200).json({
          price,
          currency: priceData.currency || 'AUD',
          priceIncGst: priceData.priceIncGst,
        });
      } else {
        console.log('No price available for:', itemNumber);
        res.status(200).json({ price: null });
      }
    } catch (error: any) {
      console.error('Error getting Reece price:', error);
      res.status(200).json({ price: null });
    }
  });
});

/**
 * Get inventory for a Reece product
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

      // Get OAuth token
      const token = await getReeceAuthToken();
      if (!token) {
        console.log('Reece API credentials not configured - returning null');
        res.status(200).json({ inventory: null });
        return;
      }

      // Get inventory using the inventory endpoint
      const url = branchCode
        ? `https://api.reecegroup.com.au/api/v1/inventory/${encodeURIComponent(itemNumber)}?branchCode=${encodeURIComponent(branchCode)}`
        : `https://api.reecegroup.com.au/api/v1/inventory/${encodeURIComponent(itemNumber)}`;

      console.log('Getting inventory for Reece item:', itemNumber, branchCode ? `at ${branchCode}` : '');
      const inventoryResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!inventoryResponse.ok) {
        const errorText = await inventoryResponse.text();
        console.error('Reece inventory fetch failed:', inventoryResponse.status, errorText);
        res.status(200).json({ inventory: null });
        return;
      }

      const inventoryData = await inventoryResponse.json();

      if (inventoryData) {
        console.log('Found inventory for', itemNumber);
        res.status(200).json({
          inventory: {
            itemNumber: inventoryData.itemNumber,
            branchCode: inventoryData.branchCode,
            quantityAvailable: inventoryData.quantityAvailable || 0,
          },
        });
      } else {
        console.log('No inventory data for:', itemNumber);
        res.status(200).json({ inventory: null });
      }
    } catch (error: any) {
      console.error('Error getting Reece inventory:', error);
      res.status(200).json({ inventory: null });
    }
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

      console.log('Fetching HTML from:', url);

      // Option 1: Try with ScraperAPI if configured (most reliable)
      const scraperApiKey = functions.config().scraperapi?.key || process.env.SCRAPERAPI_KEY;

      if (scraperApiKey) {
        console.log('Using ScraperAPI for enhanced scraping...');
        try {
          const scraperUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&country_code=au&render=true`;
          const scraperResponse = await fetch(scraperUrl);

          if (scraperResponse.ok) {
            const html = await scraperResponse.text();
            console.log('✅ ScraperAPI succeeded, HTML length:', html.length);
            res.status(200).json({ html, method: 'scraperapi' });
            return;
          }
          console.warn('ScraperAPI failed:', scraperResponse.status);
        } catch (scraperError) {
          console.error('ScraperAPI error:', scraperError);
        }
      }

      // Option 2: Enhanced direct fetch with realistic browser fingerprinting
      console.log('Trying enhanced direct fetch with realistic headers...');

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
        console.error('Enhanced fetch failed:', response.status);
        res.status(response.status).json({
          error: `Failed to fetch: ${response.statusText}`,
          method: 'direct',
        });
        return;
      }

      const html = await response.text();
      console.log('✅ Enhanced fetch succeeded, HTML length:', html.length);
      res.status(200).json({ html, method: 'direct' });
    } catch (error: any) {
      console.error('Error fetching store HTML:', error);
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
      const { transcribedText } = req.body;

      if (!isNonEmptyString(transcribedText)) {
        res.status(400).json({ error: 'Missing or invalid transcribedText' });
        return;
      }
      if (transcribedText.length > 50000) {
        res.status(400).json({ error: 'transcribedText exceeds maximum length' });
        return;
      }

      const anthropicApiKey = functions.config().anthropic?.api_key || process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        res.status(500).json({ error: 'Anthropic API key not configured' });
        return;
      }

      const prompt = `You are a helpful assistant for Australian tradies. Clean up the following voice-transcribed job description and generate a concise job title.

Transcribed Text: "${transcribedText}"

Tasks:
1. Fix any transcription errors or unclear phrases
2. Improve grammar and formatting while keeping the tradie's natural language
3. Keep all important details (measurements, materials, locations, etc.)
4. Generate a short, professional job title (3-7 words)

Provide a JSON response with this structure:
{
  "cleanedDescription": "The cleaned and formatted description",
  "suggestedTitle": "Short Job Title"
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

      res.status(200).json({
        cleanedDescription: parsed.cleanedDescription || transcribedText,
        suggestedTitle: parsed.suggestedTitle || '',
      });
    } catch (error: any) {
      console.error('Error cleaning up transcription:', error);
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

      const anthropicApiKey = functions.config().anthropic?.api_key || process.env.ANTHROPIC_API_KEY;

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
      console.error('Error parsing products HTML:', error);
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

      const anthropicApiKey = functions.config().anthropic?.api_key || process.env.ANTHROPIC_API_KEY;

      if (!anthropicApiKey) {
        console.error('Missing Anthropic API key');
        res.status(200).json({
          selectedIndex: 1,
          reasoning: 'No AI selection available - using first product'
        });
        return;
      }

      console.log(`🤖 Selecting best product from ${products.length} options for: "${requestedProductName}"`);

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
        const errorText = await response.text();
        console.error('❌ Claude API error:', response.status, errorText);
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

      console.log(`✅ Selected product ${selectedIndex}: ${reasoning}`);

      res.status(200).json({
        selectedIndex,
        reasoning
      });
    } catch (error: any) {
      console.error('Error selecting best product:', error);
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

      console.log(`🔑 Generating acceptance link for quote ${quoteId}`);

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

      console.log(`✅ Generated acceptance link for quote ${quoteId}`);

      res.status(200).json({
        success: true,
        acceptanceUrl,
        token,
      });
    } catch (error: any) {
      console.error('❌ Error generating acceptance link:', error);
      res.status(500).json({ success: false, error: error.message });
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

      console.log(`🔍 Looking up quote by acceptance token`);

      const db = admin.firestore();
      let foundQuote: any = null;
      let businessSettings: any = null;
      const tokenHash = hashToken(token);

      // O(1) lookup via dedicated tokens collection (hashed)
      let tokenDoc = await db.collection('quoteAcceptanceTokens').doc(tokenHash).get();

      // Fallback: try unhashed doc ID for tokens created before hashing migration
      if (!tokenDoc.exists) {
        tokenDoc = await db.collection('quoteAcceptanceTokens').doc(token).get();
      }

      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data()!;
        const quoteDoc = await db.collection('users').doc(tokenData.userId)
          .collection('quotes').doc(tokenData.quoteId).get();

        if (quoteDoc.exists) {
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

      // Check if token has expired (30 days)
      const tokenCreatedAt = foundQuote.acceptanceTokenCreatedAt?.toDate?.() ||
        new Date(foundQuote.acceptanceTokenCreatedAt);
      const now = new Date();
      if (now.getTime() - tokenCreatedAt.getTime() > TOKEN_EXPIRATION_MS) {
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

      // Return quote data for the acceptance page (excluding sensitive fields)
      res.status(200).json({
        success: true,
        quote: {
          id: foundQuote.id,
          quoteNumber: foundQuote.quoteNumber,
          customerName: foundQuote.customerName,
          jobName: foundQuote.job?.name,
          jobDescription: foundQuote.job?.description,
          materials: foundQuote.materials?.map((m: any) => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            totalPrice: m.totalPrice,
          })),
          laborTotal: foundQuote.laborTotal,
          materialsSubtotal: foundQuote.materialsSubtotal,
          subtotal: foundQuote.subtotal,
          gst: foundQuote.gst,
          total: foundQuote.total,
          notes: foundQuote.notes,
          createdAt: foundQuote.createdAt,
        },
        business: {
          name: businessSettings?.businessName || 'Your Trade Business',
          email: businessSettings?.email,
          phone: businessSettings?.phone,
        },
      });
    } catch (error: any) {
      console.error('❌ Error getting quote for acceptance:', error);
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

      console.log(`📝 Processing quote response: ${response}`);

      const db = admin.firestore();
      let foundQuoteRef: admin.firestore.DocumentReference | null = null;
      let foundQuote: any = null;
      let foundUserId: string = '';
      let businessSettings: any = null;
      const tokenHash = hashToken(token);

      // O(1) lookup via dedicated tokens collection (hashed)
      let tokenDoc = await db.collection('quoteAcceptanceTokens').doc(tokenHash).get();

      // Fallback: try unhashed doc ID for tokens created before hashing migration
      if (!tokenDoc.exists) {
        tokenDoc = await db.collection('quoteAcceptanceTokens').doc(token).get();
      }

      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data()!;
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

      // Check token expiration
      const tokenCreatedAt = foundQuote.acceptanceTokenCreatedAt?.toDate?.() ||
        new Date(foundQuote.acceptanceTokenCreatedAt);
      const now = new Date();
      if (now.getTime() - tokenCreatedAt.getTime() > TOKEN_EXPIRATION_MS) {
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

      console.log(`✅ Quote ${foundQuote.id} marked as ${response}`);

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
          console.error('Error sending email notification:', emailError);
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
          const statusEmoji = response === 'accepted' ? '✅' : '❌';

          const message = {
            notification: {
              title: `Quote ${response === 'accepted' ? 'Accepted' : 'Declined'} ${statusEmoji}`,
              body: `${foundQuote.customerName} has ${response} your quote for ${foundQuote.job?.name || 'the job'}.`,
            },
            data: {
              quoteId: foundQuote.id,
              type: 'quote_response',
              response: response,
            },
            tokens: tokens,
          };

          const fcmResponse = await admin.messaging().sendEachForMulticast(message);
          console.log(`📱 Push notifications sent: ${fcmResponse.successCount} success, ${fcmResponse.failureCount} failed`);
        }
      } catch (fcmError: any) {
        console.error('❌ Error sending push notification:', fcmError);
        // Don't fail the request if push fails
      }

      res.status(200).json({
        success: true,
        message: response === 'accepted'
          ? 'Thank you! The quote has been accepted. The business will be in touch soon.'
          : 'The quote has been declined. The business has been notified.',
      });
    } catch (error: any) {
      console.error('❌ Error responding to quote:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * Serve the quote acceptance web page
 * A self-contained HTML page that fetches quote data and handles responses
 */
export const quoteAcceptancePage = functions.https.onRequest(async (req, res) => {
  if (!(await checkRateLimit(`ip:${getClientIp(req)}`, RATE_LIMITS.public, res))) return;

  const token = req.query.token as string;

  if (!token || typeof token !== 'string' || token.length > 200) {
    res.status(400).send(generateErrorPage('Invalid Token', 'The quote token provided is missing or invalid.'));
    return;
  }

  // Serve the HTML page that will fetch quote data via JavaScript
  res.status(200).send(generateAcceptancePage(token));
});

/**
 * Generate the quote acceptance HTML page
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
    .logo h1 {
      font-size: 28px;
      color: #f97316;
      margin-bottom: 8px;
    }
    .logo p { color: #94a3b8; font-size: 14px; }
    .business-name {
      text-align: center;
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f8fafc;
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
    .material-price { font-weight: 500; color: #f97316; }
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
    .totals-row.total .amount { color: #f97316; }
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
      border-top-color: #f97316;
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
    .already-responded h2 { color: #f97316; }
    .contact-info {
      background: #0f172a;
      padding: 16px;
      border-radius: 8px;
      margin-top: 16px;
    }
    .contact-info p { margin-bottom: 8px; }
    .contact-info a { color: #f97316; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <h1>QuoteMate</h1>
        <p>Professional Quoting Made Easy</p>
      </div>

      <div id="content">
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading quote details...</p>
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
        '<div class="business-name">' + escapeHtml(business.name) + '</div>' +
        '<div class="quote-number">Quote #' + escapeHtml(quote.quoteNumber || quote.id) + '</div>' +

        '<div class="section">' +
          '<div class="section-title">Job Details</div>' +
          '<div class="job-name">' + escapeHtml(quote.jobName || 'Quote') + '</div>' +
          (quote.jobDescription ? '<div class="job-desc">' + escapeHtml(quote.jobDescription) + '</div>' : '') +
        '</div>' +

        (materialsHtml ?
          '<div class="section">' +
            '<div class="section-title">Materials</div>' +
            materialsHtml +
          '</div>' : '') +

        '<div class="section">' +
          '<div class="section-title">Summary</div>' +
          '<div class="totals-row"><span>Materials</span><span>' + formatCurrency(quote.materialsSubtotal) + '</span></div>' +
          '<div class="totals-row"><span>Labour</span><span>' + formatCurrency(quote.laborTotal) + '</span></div>' +
          '<div class="totals-row"><span>Subtotal</span><span>' + formatCurrency(quote.subtotal) + '</span></div>' +
          '<div class="totals-row"><span>GST (10%)</span><span>' + formatCurrency(quote.gst) + '</span></div>' +
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

  await sendWelcomeEmail(email, businessName, user.uid);
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
 * Runs daily, sends tips on day 1, 3, and 7 after signup
 */
export const sendOnboardingDrip = functions.pubsub
  .schedule('every day 09:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();

    // Get all users with email state
    const emailStatesSnapshot = await db.collectionGroup('settings')
      .where('signupAt', '!=', null)
      .get();

    for (const doc of emailStatesSnapshot.docs) {
      // Only process emailState documents
      if (doc.id !== 'emailState') continue;

      const data = doc.data();
      const signupAt = data.signupAt?.toDate?.() || new Date(data.signupAt);
      const lastTip = data.lastOnboardingTip || 0;
      const userId = doc.ref.parent.parent?.id;

      if (!userId || lastTip >= 3) continue; // All tips sent

      const daysSinceSignup = Math.floor((now.getTime() - signupAt.getTime()) / (1000 * 60 * 60 * 24));

      let tipToSend = 0;
      if (daysSinceSignup >= 7 && lastTip < 3) tipToSend = 3;
      else if (daysSinceSignup >= 3 && lastTip < 2) tipToSend = 2;
      else if (daysSinceSignup >= 1 && lastTip < 1) tipToSend = 1;

      if (tipToSend === 0) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      let businessName = '';
      try {
        const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
        businessName = settingsDoc.data()?.businessName || '';
      } catch {}

      const sent = await sendOnboardingTipEmail(email, businessName, tipToSend, userId);
      if (sent) {
        await doc.ref.update({ lastOnboardingTip: tipToSend });
      }
    }

    console.log('Onboarding drip campaign completed');
  });

/**
 * Scheduled: Re-engagement emails
 * Runs daily, targets users inactive for 14+ days
 */
export const sendReEngagement = functions.pubsub
  .schedule('every day 10:00')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const db = admin.firestore();
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get users who haven't been active in 14+ days
    const emailStatesSnapshot = await db.collectionGroup('settings')
      .where('lastActivityAt', '<', fourteenDaysAgo)
      .get();

    for (const doc of emailStatesSnapshot.docs) {
      if (doc.id !== 'emailState') continue;

      const data = doc.data();
      const lastActivityAt = data.lastActivityAt?.toDate?.() || new Date(data.lastActivityAt);
      const lastReEngagementAt = data.lastReEngagementAt?.toDate?.();
      const userId = doc.ref.parent.parent?.id;

      if (!userId) continue;

      // Don't send if we already sent a re-engagement email in the last 30 days
      if (lastReEngagementAt && lastReEngagementAt > thirtyDaysAgo) continue;

      const daysSinceActive = Math.floor((now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24));

      const email = await getUserEmail(userId);
      if (!email) continue;

      let businessName = '';
      try {
        const settingsDoc = await db.doc(`users/${userId}/settings/business`).get();
        businessName = settingsDoc.data()?.businessName || '';
      } catch {}

      const sent = await sendReEngagementEmail(email, businessName, daysSinceActive, userId);
      if (sent) {
        await doc.ref.update({
          lastReEngagementAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    console.log('Re-engagement campaign completed');
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
      await admin.firestore()
        .doc(`users/${decodedToken.uid}/settings/emailState`)
        .set({
          lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('Error updating activity timestamp:', error);
      res.status(500).json({ error: error.message });
    }
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
      console.error('Error updating email preferences:', error);
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
  const expectedKey = functions.config().admin?.dashboard_key || process.env.ADMIN_DASHBOARD_KEY;

  if (!expectedKey) {
    console.error('Admin dashboard key not configured');
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
  users: Array<{
    email: string;
    businessName: string;
    tradeType: string;
    quotes: number;
    invoices: number;
    isPro: boolean;
    quotesThisMonth: number;
    platform: string;
    favorites: number;
    signupDate: string;
    lastLogin: string;
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
  cancellations: Array<{ reason: string; date: string }>;
  acceptanceLinksGenerated: number;
  emailsSent: number;
  emailCategories: Record<string, number>;
  retention: {
    activeLastWeek: number;
    activeLastMonth: number;
    neverReturned: number;
  };
}

async function getAdminAnalyticsData(): Promise<AnalyticsData> {
  const db = admin.firestore();

  // Get auth users for signup/login data
  const authResult = await admin.auth().listUsers(1000);
  const authUsers = authResult.users;

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
        const [quotesSnap, invoicesSnap, settingsSnap, onbSnap, subSnap, favsSnap] = await Promise.all([
          db.collection(`users/${userId}/quotes`).get(),
          db.collection(`users/${userId}/invoices`).get(),
          db.doc(`users/${userId}/settings/business`).get(),
          db.doc(`users/${userId}/profile/onboarding`).get(),
          db.doc(`users/${userId}/profile/subscription`).get(),
          db.collection(`users/${userId}/materialFavorites`).get(),
        ]);

        const userQuotes = quotesSnap.size;
        const userInvoices = invoicesSnap.size;
        totalQuotes += userQuotes;
        totalInvoices += userInvoices;
        favoritesCount += favsSnap.size;

        // Process quotes
        for (const qDoc of quotesSnap.docs) {
          const q = qDoc.data();
          quoteStatuses[q.status || 'unknown'] = (quoteStatuses[q.status || 'unknown'] || 0) + 1;
          if (q.total) allQuoteTotals.push(q.total);
          if (q.materials) totalMaterials += q.materials.length;
          if (q.aiSkipped) quotesSkippedAI++; else quotesWithAI++;
          if (q.markup) markupValues.push(q.markup);
          if (q.laborRate) laborRates.push(q.laborRate);
          if (q.job?.name) {
            jobTypesMap[q.job.name] = (jobTypesMap[q.job.name] || 0) + 1;
          }
          if (q.createdAt) {
            let date: Date;
            try { date = q.createdAt.toDate(); } catch { date = new Date(q.createdAt); }
            if (date && !isNaN(date.getTime())) {
              const m = date.toISOString().substring(0, 7);
              quotesByMonthMap[m] = (quotesByMonthMap[m] || 0) + 1;
              recentQuotes.push({
                date: date.toISOString(),
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
        let platform = '';
        if (subSnap.exists) {
          const sub = subSnap.data()!;
          isPro = sub.isPro || false;
          quotesThisMonth = sub.quotesThisMonth || 0;
          platform = sub.platform || '';
          if (isPro) proCount++;
        }

        usersList.push({
          email: authInfo.email,
          businessName: bizName,
          tradeType: trade,
          quotes: userQuotes,
          invoices: userInvoices,
          isPro,
          quotesThisMonth,
          platform,
          favorites: favsSnap.size,
          signupDate: new Date(authInfo.createdAt).toISOString().split('T')[0],
          lastLogin: new Date(authInfo.lastLogin).toISOString().split('T')[0],
        });
      } catch (e) {
        // Skip users with issues
      }
    }));
  }

  // Top-level collections
  const [cancellationsSnap, tokensSnap] = await Promise.all([
    db.collection('cancellations').get(),
    db.collection('quoteAcceptanceTokens').get(),
  ]);

  let emailsSent = 0;
  const emailCategories: Record<string, number> = {};
  try {
    const emailSnap = await db.collection('emailLog').get();
    emailsSent = emailSnap.size;
    emailSnap.forEach(d => {
      const cat = d.data().category || 'unknown';
      emailCategories[cat] = (emailCategories[cat] || 0) + 1;
    });
  } catch { /* no email log */ }

  const cancellations: AnalyticsData['cancellations'] = [];
  cancellationsSnap.forEach(d => {
    const c = d.data();
    let dateStr = '';
    try { dateStr = c.canceledAt?.toDate?.().toISOString().split('T')[0] || ''; } catch { /* */ }
    cancellations.push({ reason: c.reason || '(none)', date: dateStr });
  });

  // Compute quote stats
  allQuoteTotals.sort((a, b) => a - b);
  const totalValue = allQuoteTotals.reduce((a, b) => a + b, 0);
  laborRates.sort((a, b) => a - b);

  // Sort users and quotes
  usersList.sort((a, b) => b.quotes - a.quotes);
  recentQuotes.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
  const statusColors: Record<string, string> = { draft: '#64748b', sent: '#3b82f6', accepted: '#22c55e', rejected: '#ef4444', unknown: '#94a3b8' };
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

  // Users table
  const usersRowsHtml = d.users.map(u => {
    const proTag = u.isPro ? '<span class="badge pro">PRO</span>' : '<span class="badge free">Free</span>';
    return `<tr>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.businessName)}</td>
      <td>${escapeHtml(u.tradeType)}</td>
      <td class="num">${u.quotes}</td>
      <td class="num">${u.invoices}</td>
      <td>${proTag}</td>
      <td>${u.signupDate}</td>
      <td>${u.lastLogin}</td>
    </tr>`;
  }).join('');

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

  // Cancellation reasons
  const cancelHtml = d.cancellations.length > 0
    ? d.cancellations.map(c => `<div class="cancel-row">${escapeHtml(c.reason)}${c.date ? ' <span class="muted">(' + c.date + ')</span>' : ''}</div>`).join('')
    : '<div class="muted">No cancellations</div>';

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
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header h1 { font-size: 24px; color: #f97316; }
    .header .meta { color: #64748b; font-size: 13px; }
    .refresh-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #f8fafc;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
    }
    .refresh-btn:hover { border-color: #f97316; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .kpi .value { font-size: 28px; font-weight: 700; color: #f97316; }
    .kpi .label { font-size: 12px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
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

    /* Badges */
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; color: #fff; }
    .badge.pro { background: #f97316; }
    .badge.free { background: #334155; color: #94a3b8; }

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
    .cancel-row { padding: 6px 0; border-bottom: 1px solid #0f172a; font-size: 13px; color: #cbd5e1; }

    .muted { color: #64748b; }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #0f172a; font-size: 13px; }
    .stat-label { color: #94a3b8; }
    .stat-value { color: #f8fafc; font-weight: 500; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>QuoteMate Dashboard</h1>
      <div class="meta">Generated: ${new Date(d.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} AEST</div>
    </div>
    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
  </div>

  <!-- KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi"><div class="value">${d.funnel.totalSignups}</div><div class="label">Total Users</div></div>
    <div class="kpi"><div class="value">${d.retention.activeLastWeek}</div><div class="label">Active (7d)</div></div>
    <div class="kpi"><div class="value">${d.retention.activeLastMonth}</div><div class="label">Active (30d)</div></div>
    <div class="kpi"><div class="value">${d.quotes.total}</div><div class="label">Total Quotes</div></div>
    <div class="kpi"><div class="value">$${Math.round(d.quotes.totalValue).toLocaleString()}</div><div class="label">Total Quoted</div></div>
    <div class="kpi"><div class="value">${d.funnel.proSubscribers}</div><div class="label">Pro Subs</div></div>
    <div class="kpi"><div class="value">${d.invoices.total}</div><div class="label">Invoices</div></div>
    <div class="kpi"><div class="value">${d.retention.neverReturned}</div><div class="label">Never Returned</div></div>
  </div>

  <!-- Funnel + Quote Stats -->
  <div class="two-col">
    <div class="card">
      <h2>Conversion Funnel</h2>
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

  <!-- Trends -->
  <div class="card">
    <h2>Monthly Trends</h2>
    <div class="legend">
      <span><span class="legend-dot" style="background:#3b82f6"></span> Signups</span>
      <span><span class="legend-dot" style="background:#f97316"></span> Quotes</span>
    </div>
    <div class="trends-container">${trendsHtml}</div>
  </div>

  <!-- Users Table -->
  <div class="card">
    <h2>Users (${d.users.length})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Email</th><th>Business</th><th>Trade</th><th>Quotes</th><th>Invoices</th><th>Plan</th><th>Signed Up</th><th>Last Login</th>
        </tr></thead>
        <tbody>${usersRowsHtml}</tbody>
      </table>
    </div>
  </div>

  <!-- Recent Quotes -->
  <div class="card">
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

  <div class="two-col">
    <div class="card">
      <h2>Top Job Types</h2>
      ${jobTypesHtml}
    </div>
    <div class="card">
      <h2>Cancellations (${d.cancellations.length})</h2>
      ${cancelHtml}
      <div style="margin-top: 16px">
        <h2>Other Metrics</h2>
        <div class="stat-row"><span class="stat-label">Acceptance Links</span><span class="stat-value">${d.acceptanceLinksGenerated}</span></div>
        <div class="stat-row"><span class="stat-label">Emails Sent</span><span class="stat-value">${d.emailsSent}</span></div>
        <div class="stat-row"><span class="stat-label">Material Favorites</span><span class="stat-value">${d.quotes.favoritesSaved}</span></div>
      </div>
    </div>
  </div>

  <script>
    // Auto-refresh every 5 minutes
    setInterval(function() { location.reload(); }, 5 * 60 * 1000);
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
      console.error('Admin dashboard error:', error);
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
      const adminKey = functions.config().admin?.dashboard_key;
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
            console.error(`Failed to send to ${email}:`, e);
            failed++;
          }
        }

        res.status(200).json({ sent, failed, skipped, total: authUsers.users.length });
      } catch (error: any) {
        console.error('Send announcement error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  });
