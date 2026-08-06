import { Platform } from 'react-native';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import Constants from 'expo-constants';
import { stripeConfig } from '../config/stripeConfig';
import { auth } from '../config/firebase';

/**
 * Stripe Service for Web Platform
 * Handles Stripe checkout and subscription management for web
 */

const STRIPE_PUBLISHABLE_KEY = stripeConfig.publishableKey;

// Falling back to '' silently pointed every checkout call at the marketing
// site (POST https://quotemateapp.au/createPaymentIntent → 400 XML), so the
// modal died on "Failed to initialize payment". API_BASE_URL lives in .env but
// not .env.web, which is the file web builds read — so the web bundle never
// had a value. Default to the deployed functions host, matching PaywallScreen.
const API_BASE_URL = process.env.API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  'https://us-central1-hansendev.cloudfunctions.net';

class StripeService {
  private stripe: Stripe | null = null;
  private isInitialized = false;

  /**
   * Initialize Stripe (web only)
   */
  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'web') {
      return false;
    }

    if (this.isInitialized && this.stripe) {
      return true;
    }

    try {
      if (!STRIPE_PUBLISHABLE_KEY) {
        return false;
      }

      this.stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
      this.isInitialized = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a Payment Intent for embedded checkout
   */
  async createPaymentIntent(priceId: string, userId: string): Promise<string> {
    if (!this.isInitialized || !this.stripe) {
      throw new Error('Stripe not initialized');
    }

    try {

      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${API_BASE_URL}/createPaymentIntent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          priceId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();

      if (!data.clientSecret) {
        throw new Error('No client secret returned from server');
      }

      return data.clientSecret;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Create a checkout session and redirect to Stripe checkout
   * (Legacy method for full-page redirect)
   */
  async createCheckoutSession(priceId: string, userId: string): Promise<void> {
    if (!this.isInitialized || !this.stripe) {
      throw new Error('Stripe not initialized');
    }

    try {

      // Call your backend to create a checkout session
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${API_BASE_URL}/createCheckoutSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/?canceled=true`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();

      if (!data.sessionId) {
        throw new Error('No session ID returned from server');
      }

      // Use the URL returned from the backend
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned from server');
      }
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Create a customer portal session for managing subscriptions
   */
  async createPortalSession(userId: string): Promise<string> {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${API_BASE_URL}/createPortalSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          returnUrl: window.location.origin,
        }),
      });

      const { url } = await response.json();
      return url;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Check subscription status from backend
   */
  async checkSubscriptionStatus(userId: string): Promise<{
    isPremium: boolean;
    subscriptionId: string | null;
    expiryDate: string | null;
  }> {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${API_BASE_URL}/getSubscriptionStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      return {
        isPremium: data.isPremium || false,
        subscriptionId: data.subscriptionId || null,
        expiryDate: data.expiryDate || null,
      };
    } catch (error) {
      return {
        isPremium: false,
        subscriptionId: null,
        expiryDate: null,
      };
    }
  }
}

export const stripeService = new StripeService();

// Stripe Price IDs (dynamically loaded from config based on mode)
export { STRIPE_PRICES } from '../config/stripeConfig';
