import * as functions from 'firebase-functions';
import Stripe from 'stripe';
import cors from 'cors';
import fetch from 'node-fetch';

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
      console.log('Checkout session URL:', session.url);

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
      }

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
 * Create a subscription with payment method (for embedded checkout)
 * This allows users to subscribe without redirecting to Stripe's hosted page
 */
export const createSubscriptionWithPayment = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    try {
      const { priceId, userId, paymentMethodId } = req.body;

      if (!priceId || !userId || !paymentMethodId) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      console.log('Creating subscription for user:', userId);

      // Check if customer already exists
      let customerId: string;
      const customerList = await stripe.customers.search({
        query: `metadata['firebaseUserId']:'${userId}'`,
        limit: 1,
      });

      if (customerList.data.length > 0) {
        customerId = customerList.data[0].id;
        console.log('Found existing customer:', customerId);
      } else {
        // Create new customer
        const customer = await stripe.customers.create({
          metadata: {
            firebaseUserId: userId,
          },
          payment_method: paymentMethodId,
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });
        customerId = customer.id;
        console.log('Created new customer:', customerId);
      }

      // Attach payment method to customer if not already attached
      try {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
      } catch (attachError: any) {
        // Payment method might already be attached
        console.log('Payment method attach info:', attachError.message);
      }

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        default_payment_method: paymentMethodId,
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId,
        },
      });

      console.log('Created subscription:', subscription.id);

      // Check if payment requires action (3D Secure)
      const invoice = subscription.latest_invoice as any;
      const paymentIntent = invoice?.payment_intent;

      if (paymentIntent?.status === 'requires_action') {
        res.status(200).json({
          subscriptionId: subscription.id,
          clientSecret: paymentIntent.client_secret,
          requiresAction: true,
        });
      } else if (paymentIntent?.status === 'succeeded') {
        res.status(200).json({
          subscriptionId: subscription.id,
          requiresAction: false,
          status: 'active',
        });
      } else {
        res.status(400).json({
          error: 'Payment failed',
          status: paymentIntent?.status,
        });
      }
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
      const { jobDescription } = req.body;

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

      const prompt = `You are an expert Australian tradie assistant. Analyze the following job description and generate a detailed materials list with Bunnings search terms.

Job Description: "${jobDescription}"

Provide a JSON response with the following structure:
{
  "jobSummary": "A brief summary of the job",
  "estimatedHours": <number of hours>,
  "materials": [
    {
      "name": "Material name as it should appear in quote",
      "searchTerm": "Specific Bunnings search term (be very specific with brands/sizes)",
      "quantity": <number>,
      "unit": "each|m|L|kg|box|pack",
      "reasoning": "Why this material is needed"
    }
  ]
}

Guidelines:
- Use specific Bunnings product terms (e.g., "treated pine H3 90x45 2.4m" not just "timber")
- Include all materials: timber, screws, nails, stain/paint, concrete, etc.
- Be realistic with quantities - round up for waste
- Include safety/prep materials if relevant (sandpaper, drop sheets, etc.)
- Estimate labor hours realistically for an experienced tradie
- Common Australian brands: Bunnings, Ozito, Ramset, Selleys, Dunlop, etc.

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
          model: 'claude-3-5-sonnet-20241022',
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

      // Call Anthropic API
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
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

      // Handle different response formats
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

      // Parse JSON response
      let jsonStr = textContent.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/, '').replace(/\n?```$/, '');
      }

      const result = JSON.parse(jsonStr);

      res.status(200).json({
        price: result.price || null,
        productName: result.productName,
        store: result.store || 'Bunnings (estimated)',
        url: undefined,
      });
    } catch (error: any) {
      console.error('Error searching material price:', error);
      res.status(500).json({ error: error.message });
    }
  });
});
