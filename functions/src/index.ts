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

// CORS configuration
const corsHandler = cors({ origin: true });

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

    try {
      const { priceId, userId, successUrl, cancelUrl } = req.body;

      if (!priceId || !userId) {
        res.status(400).json({ error: 'Missing required parameters' });
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

    try {
      const { priceId, userId } = req.body;

      if (!priceId || !userId) {
        res.status(400).json({ error: 'Missing required parameters' });
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

    try {
      const { userId, returnUrl } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'Missing userId' });
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

    try {
      const { userId, reason, feedback } = req.body;

      if (!userId || !reason) {
        res.status(400).json({ error: 'Missing required parameters' });
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

    try {
      const { userId, userEmail, reason, feedback, timestamp } = req.body;

      // Log with a special prefix so it's easy to find in logs
      console.log('🚫 ===== CANCELLATION FEEDBACK =====');
      console.log('📧 User Email:', userEmail);
      console.log('🆔 User ID:', userId);
      console.log('📝 Reason:', reason);
      console.log('💬 Additional Feedback:', feedback || 'None provided');
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

    try {
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'Missing userId' });
        return;
      }

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
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  console.log(`📝 Subscription ${subscription.id} ${subscription.status} for customer ${customerId}`);
  console.log(`   Period: ${new Date(subscription.current_period_start * 1000).toISOString()} to ${new Date(subscription.current_period_end * 1000).toISOString()}`);
  // No database storage needed - subscription status can be queried directly from Stripe
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  console.log(`❌ Subscription ${subscription.id} canceled for customer ${customerId}`);
  // No database storage needed - subscription status can be queried directly from Stripe
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
 * Analyze Job Description using Anthropic Claude API
 * This Cloud Function acts as a proxy to avoid CORS issues on web
 */
export const analyzeJobDescription = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const { jobDescription, tradeContext } = req.body;

      if (!jobDescription) {
        res.status(400).json({ error: 'Missing jobDescription' });
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

    try {
      const { materialName, hardwareStoreUrls } = req.body;

      if (!materialName) {
        res.status(400).json({ error: 'Missing materialName' });
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

    try {
      const { productName } = req.body;

      if (!productName) {
        res.status(400).json({ error: 'Missing productName' });
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

    try {
      const { itemNumber } = req.body;

      if (!itemNumber) {
        res.status(400).json({ error: 'Missing itemNumber' });
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

    try {
      const { itemNumber, branchCode } = req.body;

      if (!itemNumber) {
        res.status(400).json({ error: 'Missing itemNumber' });
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

    try {
      const { url } = req.body;

      if (!url) {
        res.status(400).json({ error: 'Missing url' });
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

    try {
      const { transcribedText } = req.body;

      if (!transcribedText) {
        res.status(400).json({ error: 'Missing transcribedText' });
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

    try {
      const { html, searchTerm, store, requestedQuantity, requestedUnit } = req.body;

      if (!html || !searchTerm || !store) {
        res.status(400).json({ error: 'Missing required parameters' });
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
