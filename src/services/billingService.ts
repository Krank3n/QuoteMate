import { Platform } from 'react-native';

// Safely import expo-iap only if available
let RNIap: any = null;
try {
  RNIap = require('expo-iap');
} catch (error) {
  console.log('expo-iap not available on this platform');
}

// Subscription product IDs (must match App Store Connect & Google Play Console)
export const SUBSCRIPTION_SKUS = {
  MONTHLY: 'quotemate_premium_monthly',
  YEARLY: 'quotemate_premium_yearly',
};

export const SUBSCRIPTION_PRODUCTS = Platform.select({
  android: [SUBSCRIPTION_SKUS.MONTHLY, SUBSCRIPTION_SKUS.YEARLY],
  ios: [SUBSCRIPTION_SKUS.MONTHLY, SUBSCRIPTION_SKUS.YEARLY],
  default: [],
});

// expo-iap 3.x uses kebab-case error codes
function isIapNotAvailable(error: any): boolean {
  const code = error?.code;
  const message = error?.message || '';
  return (
    code === 'iap-not-available' ||
    code === 'E_IAP_NOT_AVAILABLE' ||
    message.includes('iap-not-available') ||
    message.includes('E_IAP_NOT_AVAILABLE')
  );
}

function isUserCancelled(error: any): boolean {
  const code = error?.code;
  return code === 'user-cancelled' || code === 'E_USER_CANCELLED';
}

class BillingService {
  private isInitialized = false;

  async initialize(): Promise<boolean> {
    try {
      if (!RNIap) {
        console.log('In-app purchases not available on this platform');
        return false;
      }
      if (this.isInitialized) {
        return true;
      }
      console.log('Initializing billing service...');
      await RNIap.initConnection();
      this.isInitialized = true;
      console.log('Billing service initialized successfully');
      return true;
    } catch (error: any) {
      if (isIapNotAvailable(error)) {
        console.log('In-app purchases not available on this device');
      } else if (error?.message?.includes('SpillingKt') || error?.message?.includes('ClassNotFoundException')) {
        console.log('Billing module has compatibility issues, disabling IAP');
      } else {
        console.error('Error initializing billing:', error?.code, error?.message);
      }
      this.isInitialized = false;
      return false;
    }
  }

  async getProducts(): Promise<any[]> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          return [];
        }
      }

      if (!SUBSCRIPTION_PRODUCTS || SUBSCRIPTION_PRODUCTS.length === 0) {
        console.error('No subscription products configured for this platform');
        return [];
      }

      console.log('Fetching products for SKUs:', SUBSCRIPTION_PRODUCTS);
      const products = await RNIap.fetchProducts({ skus: SUBSCRIPTION_PRODUCTS, type: 'subs' });
      console.log('Fetched products:', JSON.stringify(products, null, 2));
      return products || [];
    } catch (error: any) {
      if (isIapNotAvailable(error)) {
        console.log('In-app purchases not available on this device');
      } else {
        console.error('Error getting products:', error?.code, error?.message);
      }
      return [];
    }
  }

  async purchaseSubscription(sku: string): Promise<any | null> {
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

      console.log('Purchasing subscription:', sku);

      if (Platform.OS === 'android') {
        const products = await RNIap.fetchProducts({ skus: [sku], type: 'subs' });
        console.log('Product details for purchase:', JSON.stringify(products, null, 2));

        if (!products || products.length === 0) {
          throw new Error('Product not found');
        }

        const product = products[0];

        // expo-iap 3.x: subscriptionOffers is the primary field, subscriptionOfferDetailsAndroid is deprecated
        const offerDetails = product.subscriptionOffers || product.subscriptionOfferDetailsAndroid;
        if (offerDetails && offerDetails.length > 0) {
          const offerToken = offerDetails[0].offerToken;
          console.log('Using offer token:', offerToken);

          const purchase = await RNIap.requestPurchase({
            request: {
              google: {
                skus: [sku],
                subscriptionOffers: [{ sku, offerToken }]
              }
            },
            type: 'subs'
          });
          console.log('Purchase successful:', purchase);
          return purchase;
        } else {
          console.warn('No subscription offers found, attempting purchase without offers');
        }
      }

      // iOS or Android fallback without offers
      const purchase = await RNIap.requestPurchase({
        request: {
          apple: { sku },
          google: { skus: [sku] }
        },
        type: 'subs'
      });
      console.log('Purchase successful:', purchase);
      return purchase;
    } catch (error: any) {
      if (isUserCancelled(error)) {
        console.log('User cancelled purchase');
      } else {
        console.error('Error purchasing subscription:', error?.code, error?.message);
      }
      throw error;
    }
  }

  async getActiveSubscriptions(): Promise<any[]> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          return [];
        }
      }

      // Use the dedicated getActiveSubscriptions API (expo-iap 3.x)
      // which is more reliable than filtering getAvailablePurchases
      if (RNIap.getActiveSubscriptions) {
        const subscriptions = await RNIap.getActiveSubscriptions([
          SUBSCRIPTION_SKUS.MONTHLY,
          SUBSCRIPTION_SKUS.YEARLY,
        ]);
        console.log('Active subscriptions:', subscriptions);
        return subscriptions || [];
      }

      // Fallback to getAvailablePurchases
      const purchases = await RNIap.getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });

      if (!purchases || !Array.isArray(purchases)) {
        return [];
      }

      // expo-iap 3.x uses 'productId' on Purchase objects
      return purchases.filter((p: any) =>
        p?.productId === SUBSCRIPTION_SKUS.MONTHLY ||
        p?.productId === SUBSCRIPTION_SKUS.YEARLY
      );
    } catch (error: any) {
      console.error('Error getting active subscriptions:', error?.code, error?.message);
      return [];
    }
  }

  async hasActiveSubscription(): Promise<boolean> {
    try {
      // Prefer the dedicated hasActiveSubscriptions API (expo-iap 3.x)
      if (RNIap?.hasActiveSubscriptions) {
        return await RNIap.hasActiveSubscriptions([
          SUBSCRIPTION_SKUS.MONTHLY,
          SUBSCRIPTION_SKUS.YEARLY,
        ]);
      }
      const subscriptions = await this.getActiveSubscriptions();
      return subscriptions.length > 0;
    } catch (error) {
      console.error('Error checking subscription status:', error);
      return false;
    }
  }

  async finishTransaction(purchase: any): Promise<void> {
    try {
      if (!purchase) {
        console.error('No purchase to finish');
        return;
      }
      await RNIap.finishTransaction({ purchase, isConsumable: false });
      console.log('Transaction finished:', purchase.transactionId || purchase.id);
    } catch (error: any) {
      console.error('Error finishing transaction:', error?.code, error?.message);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (!this.isInitialized) {
        return;
      }
      await RNIap.endConnection();
      this.isInitialized = false;
      console.log('Billing service disconnected');
    } catch (error: any) {
      console.error('Error disconnecting billing:', error?.code, error?.message);
      this.isInitialized = false;
    }
  }
}

export const billingService = new BillingService();
