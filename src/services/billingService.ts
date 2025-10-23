import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';

// Subscription product IDs (these must match what you create in Google Play Console)
export const SUBSCRIPTION_SKUS = {
  MONTHLY: 'quotemate_premium_monthly',
  YEARLY: 'quotemate_premium_yearly',
};

export const SUBSCRIPTION_PRODUCTS = Platform.select({
  android: [SUBSCRIPTION_SKUS.MONTHLY, SUBSCRIPTION_SKUS.YEARLY],
  ios: [SUBSCRIPTION_SKUS.MONTHLY, SUBSCRIPTION_SKUS.YEARLY],
  default: [],
});

class BillingService {
  private isInitialized = false;

  /**
   * Initialize the billing service
   */
  async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        console.log('ℹ️ Billing service already initialized');
        return true;
      }
      console.log('🔧 Initializing billing service...');
      await RNIap.initConnection();
      this.isInitialized = true;
      console.log('✅ Billing service initialized');
      return true;
    } catch (error: any) {
      // Handle IAP not available gracefully (common on iOS without setup)
      if (error?.code === 'E_IAP_NOT_AVAILABLE' || error?.message?.includes('E_IAP_NOT_AVAILABLE')) {
        console.log('ℹ️ In-app purchases not available on this platform');
      } else {
        console.error('❌ Error initializing billing:', error);
      }
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Get available subscription products
   */
  async getProducts(): Promise<RNIap.Subscription[]> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          // Don't log error if IAP is simply not available
          console.log('ℹ️ Billing service not initialized');
          return [];
        }
      }

      if (!SUBSCRIPTION_PRODUCTS || SUBSCRIPTION_PRODUCTS.length === 0) {
        console.error('❌ No subscription products configured');
        return [];
      }

      const products = await RNIap.getSubscriptions({ skus: SUBSCRIPTION_PRODUCTS });
      console.log('📦 Available products:', products);
      return products || [];
    } catch (error: any) {
      // Handle IAP not available gracefully
      if (error?.code === 'E_IAP_NOT_AVAILABLE' || error?.message?.includes('E_IAP_NOT_AVAILABLE')) {
        console.log('ℹ️ In-app purchases not available on this platform');
      } else {
        console.error('❌ Error getting products:', error);
        console.error('❌ Error details:', {
          message: error?.message,
          code: error?.code,
          stack: error?.stack?.substring(0, 200)
        });
      }
      return [];
    }
  }

  /**
   * Purchase a subscription
   */
  async purchaseSubscription(sku: string): Promise<RNIap.SubscriptionPurchase | null> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize billing service');
        }
      }

      if (!sku) {
        throw new Error('Invalid product ID');
      }

      console.log('💳 Purchasing subscription:', sku);
      const purchase = await RNIap.requestSubscription({ sku });
      console.log('✅ Purchase successful:', purchase);
      return purchase as RNIap.SubscriptionPurchase | null;
    } catch (error: any) {
      if (error?.code === 'E_USER_CANCELLED') {
        console.log('ℹ️ User cancelled purchase');
      } else {
        console.error('❌ Error purchasing subscription:', error);
        console.error('❌ Error details:', {
          message: error?.message,
          code: error?.code
        });
      }
      throw error; // Re-throw to let caller handle it
    }
  }

  /**
   * Get current subscriptions (active purchases)
   */
  async getActiveSubscriptions(): Promise<RNIap.SubscriptionPurchase[]> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          console.error('❌ Failed to initialize billing service');
          return [];
        }
      }

      const purchases = await RNIap.getAvailablePurchases();
      console.log('📋 Active subscriptions:', purchases);

      if (!purchases || !Array.isArray(purchases)) {
        console.log('ℹ️ No purchases found');
        return [];
      }

      // Filter only subscription purchases (not one-time purchases)
      return purchases.filter(p =>
        p?.productId === SUBSCRIPTION_SKUS.MONTHLY ||
        p?.productId === SUBSCRIPTION_SKUS.YEARLY
      ) as RNIap.SubscriptionPurchase[];
    } catch (error: any) {
      console.error('❌ Error getting active subscriptions:', error);
      console.error('❌ Error details:', {
        message: error?.message,
        code: error?.code
      });
      return [];
    }
  }

  /**
   * Check if user has an active subscription
   */
  async hasActiveSubscription(): Promise<boolean> {
    try {
      const subscriptions = await this.getActiveSubscriptions();
      return subscriptions.length > 0;
    } catch (error) {
      console.error('❌ Error checking subscription status:', error);
      return false;
    }
  }

  /**
   * Finish a transaction (acknowledge purchase)
   */
  async finishTransaction(purchase: RNIap.Purchase): Promise<void> {
    try {
      if (!purchase) {
        console.error('❌ No purchase to finish');
        return;
      }
      await RNIap.finishTransaction({ purchase, isConsumable: false });
      console.log('✅ Transaction finished:', purchase.transactionId);
    } catch (error: any) {
      console.error('❌ Error finishing transaction:', error);
      console.error('❌ Error details:', {
        message: error?.message,
        code: error?.code
      });
      // Don't throw - finishing transaction errors shouldn't crash the app
    }
  }

  /**
   * Clean up and disconnect
   */
  async disconnect(): Promise<void> {
    try {
      if (!this.isInitialized) {
        console.log('ℹ️ Billing service not initialized, nothing to disconnect');
        return;
      }
      await RNIap.endConnection();
      this.isInitialized = false;
      console.log('🔌 Billing service disconnected');
    } catch (error: any) {
      console.error('❌ Error disconnecting billing:', error);
      console.error('❌ Error details:', {
        message: error?.message,
        code: error?.code
      });
      // Force reset initialization state even if disconnect fails
      this.isInitialized = false;
    }
  }
}

export const billingService = new BillingService();
