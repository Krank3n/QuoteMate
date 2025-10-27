import { Platform } from 'react-native';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import Constants from 'expo-constants';
import { stripeConfig } from '../config/stripeConfig';

/**
 * Stripe Service for Web Platform
 * Handles Stripe checkout and subscription management for web
 */

const STRIPE_PUBLISHABLE_KEY = stripeConfig.publishableKey;

const API_BASE_URL = process.env.API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl || '';

class StripeService {
  private stripe: Stripe | null = null;
  private isInitialized = false;

  /**
   * Initialize Stripe (web only)
   */
  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'web') {
      console.log('Stripe service is only available on web');
      return false;
    }

    if (this.isInitialized && this.stripe) {
      return true;
    }

    try {
      if (!STRIPE_PUBLISHABLE_KEY) {
        console.error('Stripe publishable key is missing');
        return false;
      }

      this.stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
      this.isInitialized = true;
      console.log('✅ Stripe initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing Stripe:', error);
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
      console.log('🔄 Creating payment intent...');

      const response = await fetch(`${API_BASE_URL}/createPaymentIntent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          userId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Payment intent created');

      if (!data.clientSecret) {
        throw new Error('No client secret returned from server');
      }

      return data.clientSecret;
    } catch (error: any) {
      console.error('❌ Error creating payment intent:', error);
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
      console.log('🔄 Creating checkout session...');

      // Call your backend to create a checkout session
      const response = await fetch(`${API_BASE_URL}/createCheckoutSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          userId,
          successUrl: `${window.location.origin}/?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/?canceled=true`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Checkout session created:', data.sessionId);

      if (!data.sessionId) {
        throw new Error('No session ID returned from server');
      }

      // Use the URL returned from the backend
      if (data.url) {
        console.log('🔀 Redirecting to Stripe Checkout URL...');
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned from server');
      }
    } catch (error: any) {
      console.error('❌ Error creating checkout session:', error);
      throw error;
    }
  }

  /**
   * Create a customer portal session for managing subscriptions
   */
  async createPortalSession(userId: string): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}/createPortalSession`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          returnUrl: window.location.origin,
        }),
      });

      const { url } = await response.json();
      return url;
    } catch (error: any) {
      console.error('❌ Error creating portal session:', error);
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
      const response = await fetch(`${API_BASE_URL}/getSubscriptionStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();
      return {
        isPremium: data.isPremium || false,
        subscriptionId: data.subscriptionId || null,
        expiryDate: data.expiryDate || null,
      };
    } catch (error) {
      console.error('❌ Error checking subscription status:', error);
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
