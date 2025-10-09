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
      console.log('🔧 Initializing billing service...');
      await RNIap.initConnection();
      this.isInitialized = true;
      console.log('✅ Billing service initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing billing:', error);
      return false;
    }
  }

  /**
   * Get available subscription products
   */
  async getProducts(): Promise<RNIap.Subscription[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const products = await RNIap.getSubscriptions({ skus: SUBSCRIPTION_PRODUCTS });
      console.log('📦 Available products:', products);
      return products;
    } catch (error) {
      console.error('❌ Error getting products:', error);
      return [];
    }
  }

  /**
   * Purchase a subscription
   */
  async purchaseSubscription(sku: string): Promise<RNIap.SubscriptionPurchase | null> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log('💳 Purchasing subscription:', sku);
      const purchase = await RNIap.requestSubscription({ sku });
      console.log('✅ Purchase successful:', purchase);
      return purchase;
    } catch (error: any) {
      if (error.code === 'E_USER_CANCELLED') {
        console.log('ℹ️ User cancelled purchase');
      } else {
        console.error('❌ Error purchasing subscription:', error);
      }
      return null;
    }
  }

  /**
   * Get current subscriptions (active purchases)
   */
  async getActiveSubscriptions(): Promise<RNIap.SubscriptionPurchase[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const purchases = await RNIap.getAvailablePurchases();
      console.log('📋 Active subscriptions:', purchases);

      // Filter only subscription purchases (not one-time purchases)
      return purchases.filter(p =>
        p.productId === SUBSCRIPTION_SKUS.MONTHLY ||
        p.productId === SUBSCRIPTION_SKUS.YEARLY
      ) as RNIap.SubscriptionPurchase[];
    } catch (error) {
      console.error('❌ Error getting active subscriptions:', error);
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
      await RNIap.finishTransaction({ purchase, isConsumable: false });
      console.log('✅ Transaction finished:', purchase.transactionId);
    } catch (error) {
      console.error('❌ Error finishing transaction:', error);
    }
  }

  /**
   * Clean up and disconnect
   */
  async disconnect(): Promise<void> {
    try {
      await RNIap.endConnection();
      this.isInitialized = false;
      console.log('🔌 Billing service disconnected');
    } catch (error) {
      console.error('❌ Error disconnecting billing:', error);
    }
  }
}

export const billingService = new BillingService();
