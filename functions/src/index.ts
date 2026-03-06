import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import cors from 'cors';
import fetch from 'node-fetch';

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

function escapeHtml(str: string): string {
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
      freeQuotesLimit: 5,
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
      freeQuotesLimit: 5,
    }, { merge: true });

    console.log(`✅ Firestore updated for user ${userId}: isPro=false (subscription deleted)`);
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
  // You could send an email notification here
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
          freeQuotesLimit: 5,
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

        // Pro users can always create quotes
        if (subscriptionData.isPro) {
          const newCount = (subscriptionData.quotesThisMonth || 0) + 1;
          transaction.set(subscriptionRef, {
            ...subscriptionData,
            quotesThisMonth: newCount,
            currentPeriodStart: subscriptionData.currentPeriodStart || monthStart,
            currentPeriodEnd: subscriptionData.currentPeriodEnd || monthEnd,
          }, { merge: true });
          return { allowed: true, quotesThisMonth: newCount, freeQuotesLimit: subscriptionData.freeQuotesLimit || 5, isPro: true };
        }

        // Free users: check quota
        const currentCount = subscriptionData.quotesThisMonth || 0;
        const limit = subscriptionData.freeQuotesLimit || 5;

        if (currentCount >= limit) {
          return { allowed: false, quotesThisMonth: currentCount, freeQuotesLimit: limit, isPro: false };
        }

        // Increment and save
        const newCount = currentCount + 1;
        transaction.set(subscriptionRef, {
          ...subscriptionData,
          quotesThisMonth: newCount,
          currentPeriodStart: subscriptionData.currentPeriodStart || monthStart,
          currentPeriodEnd: subscriptionData.currentPeriodEnd || monthEnd,
        }, { merge: true });

        return { allowed: true, quotesThisMonth: newCount, freeQuotesLimit: limit, isPro: false };
      });

      if (!result.allowed) {
        res.status(403).json({
          error: 'Quote limit reached',
          quotesThisMonth: result.quotesThisMonth,
          freeQuotesLimit: result.freeQuotesLimit,
          isPro: result.isPro,
        });
        return;
      }

      res.status(200).json({
        success: true,
        quotesThisMonth: result.quotesThisMonth,
        freeQuotesLimit: result.freeQuotesLimit,
        isPro: result.isPro,
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
        freeQuotesLimit: 5,
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
        freeQuotesLimit: 5,
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

      // Send email notification to business owner via Brevo
      const brevoApiKey = functions.config().brevo?.api_key || process.env.BREVO_API_KEY;
      if (brevoApiKey && businessSettings?.email) {
        try {
          const statusEmoji = response === 'accepted' ? '✅' : '❌';
          const statusText = response === 'accepted' ? 'ACCEPTED' : 'DECLINED';

          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key': brevoApiKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              sender: {
                email: 'noreply@hansendev.com.au',
                name: 'QuoteMate',
              },
              to: [{ email: businessSettings.email }],
              subject: `${statusEmoji} Quote ${statusText} - ${foundQuote.customerName}`,
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: ${response === 'accepted' ? '#22c55e' : '#ef4444'};">
                    Quote ${statusText}
                  </h2>
                  <p>Great news! Your quote has been responded to.</p>
                  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Customer:</strong> ${foundQuote.customerName}</p>
                    <p><strong>Job:</strong> ${foundQuote.job?.name || 'N/A'}</p>
                    <p><strong>Quote Number:</strong> ${foundQuote.quoteNumber || foundQuote.id}</p>
                    <p><strong>Total:</strong> $${foundQuote.total?.toFixed(2) || '0.00'}</p>
                    <p><strong>Response:</strong> <span style="color: ${response === 'accepted' ? '#22c55e' : '#ef4444'}; font-weight: bold;">${statusText}</span></p>
                    ${safeClientNotes ? `<p><strong>Client Notes:</strong> ${escapeHtml(safeClientNotes)}</p>` : ''}
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">
                    Open QuoteMate to view the full details.
                  </p>
                </div>
              `,
            }),
          });
          console.log('📧 Email notification sent to business owner via Brevo');
        } catch (emailError: any) {
          console.error('❌ Error sending email notification:', emailError);
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
