import { Platform } from 'react-native';
import { billingService as nativeBillingService } from './billingService';
import { stripeService, STRIPE_PRICES } from './stripeService';

/**
 * Unified Billing Service
 * Automatically routes to the correct payment provider based on platform
 * - iOS/Android: Uses react-native-iap (App Store / Google Play)
 * - Web: Uses Stripe
 */

export interface Product {
  id: string;
  title: string;
  description: string;
  price: string;
  priceValue: number;
  currency: string;
  period: 'monthly' | 'yearly';
}

export interface SubscriptionStatus {
  isPremium: boolean;
  subscriptionId: string | null;
  expiryDate: string | null;
  platform: 'ios' | 'android' | 'web' | null;
}

class UnifiedBillingService {
  private currentPlatform: 'web' | 'native';

  constructor() {
    this.currentPlatform = Platform.OS === 'web' ? 'web' : 'native';
    console.log(`🔧 Billing platform: ${this.currentPlatform}`);
  }

  /**
   * Initialize the appropriate billing service
   */
  async initialize(): Promise<boolean> {
    try {
      if (this.currentPlatform === 'web') {
        return await stripeService.initialize();
      } else {
        return await nativeBillingService.initialize();
      }
    } catch (error) {
      console.error('❌ Error initializing billing service:', error);
      return false;
    }
  }

  /**
   * Get available subscription products
   */
  async getProducts(): Promise<Product[]> {
    try {
      if (this.currentPlatform === 'web') {
        // For web, return Stripe pricing (you can fetch from backend or hardcode)
        return [
          {
            id: STRIPE_PRICES.MONTHLY,
            title: 'QuoteMate Pro Monthly',
            description: 'Unlimited quotes and premium features',
            price: '$19.00',
            priceValue: 19.0,
            currency: 'USD',
            period: 'monthly',
          },
          {
            id: STRIPE_PRICES.YEARLY,
            title: 'QuoteMate Pro Yearly',
            description: 'Unlimited quotes and premium features',
            price: '$190.00',
            priceValue: 190.0,
            currency: 'USD',
            period: 'yearly',
          },
        ];
      } else {
        // For native, get from App Store / Google Play
        const nativeProducts = await nativeBillingService.getProducts();
        return nativeProducts.map((product: any) => ({
          id: product.productId,
          title: product.title || 'QuoteMate Pro',
          description: product.description || 'Unlimited quotes',
          price: product.localizedPrice || '$19.00',
          priceValue: product.price || 19.0,
          currency: product.currency || 'USD',
          period: product.productId.includes('yearly') ? 'yearly' : 'monthly',
        }));
      }
    } catch (error) {
      console.error('❌ Error getting products:', error);
      return [];
    }
  }

  /**
   * Purchase a subscription
   */
  async purchaseSubscription(productId: string, userId: string): Promise<boolean> {
    try {
      if (this.currentPlatform === 'web') {
        // Redirect to Stripe checkout
        await stripeService.createCheckoutSession(productId, userId);
        return true; // Redirect initiated
      } else {
        // Use native in-app purchase
        const purchase = await nativeBillingService.purchaseSubscription(productId);
        return !!purchase;
      }
    } catch (error) {
      console.error('❌ Error purchasing subscription:', error);
      throw error;
    }
  }

  /**
   * Check if user has an active subscription
   * This should query your backend to get unified status
   */
  async hasActiveSubscription(userId?: string): Promise<boolean> {
    try {
      if (this.currentPlatform === 'web' && userId) {
        const status = await stripeService.checkSubscriptionStatus(userId);
        return status.isPremium;
      } else {
        // For native, check local purchases
        return await nativeBillingService.hasActiveSubscription();
      }
    } catch (error) {
      console.error('❌ Error checking subscription status:', error);
      return false;
    }
  }

  /**
   * Get subscription status with details
   */
  async getSubscriptionStatus(userId?: string): Promise<SubscriptionStatus> {
    try {
      if (this.currentPlatform === 'web' && userId) {
        const status = await stripeService.checkSubscriptionStatus(userId);
        return {
          ...status,
          platform: 'web',
        };
      } else {
        const subscriptions = await nativeBillingService.getActiveSubscriptions();
        const hasActive = subscriptions.length > 0;
        const firstSub = subscriptions[0];

        return {
          isPremium: hasActive,
          subscriptionId: firstSub?.productId || null,
          expiryDate: firstSub?.transactionDate || null,
          platform: Platform.OS as 'ios' | 'android',
        };
      }
    } catch (error) {
      console.error('❌ Error getting subscription status:', error);
      return {
        isPremium: false,
        subscriptionId: null,
        expiryDate: null,
        platform: null,
      };
    }
  }

  /**
   * Open subscription management portal
   * - Web: Opens Stripe customer portal
   * - iOS: Opens App Store subscriptions
   * - Android: Opens Google Play subscriptions
   */
  async openSubscriptionManagement(userId?: string): Promise<void> {
    try {
      if (this.currentPlatform === 'web' && userId) {
        const portalUrl = await stripeService.createPortalSession(userId);
        window.open(portalUrl, '_blank');
      } else {
        // For native platforms, you can open the respective store subscription pages
        console.log('Open native subscription management');
        // iOS: https://apps.apple.com/account/subscriptions
        // Android: https://play.google.com/store/account/subscriptions
      }
    } catch (error) {
      console.error('❌ Error opening subscription management:', error);
      throw error;
    }
  }

  /**
   * Get current platform
   */
  getPlatform(): 'web' | 'native' {
    return this.currentPlatform;
  }
}

export const unifiedBillingService = new UnifiedBillingService();
