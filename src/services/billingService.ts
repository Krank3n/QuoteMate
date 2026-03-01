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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class BillingService {
  private isInitialized = false;
  private initializationAttempts = 0;

  async initialize(): Promise<boolean> {
    try {
      if (!RNIap) {
        console.log('[IAP] expo-iap module not available on this platform');
        return false;
      }
      if (this.isInitialized) {
        return true;
      }

      console.log('[IAP] Initializing billing service...');

      // Retry initConnection up to 3 times — sandbox can be slow on first launch
      const maxRetries = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[IAP] initConnection attempt ${attempt}/${maxRetries}`);
          await RNIap.initConnection();
          this.isInitialized = true;
          this.initializationAttempts = attempt;
          console.log(`[IAP] Billing service initialized successfully on attempt ${attempt}`);
          return true;
        } catch (err: any) {
          lastError = err;
          console.warn(`[IAP] initConnection attempt ${attempt} failed:`, err?.code, err?.message);
          if (isIapNotAvailable(err)) {
            // No point retrying if IAP is genuinely unavailable
            break;
          }
          if (attempt < maxRetries) {
            // Wait before retrying — increasing delay each attempt
            await delay(1000 * attempt);
          }
        }
      }

      // All attempts failed
      if (isIapNotAvailable(lastError)) {
        console.log('[IAP] In-app purchases not available on this device');
      } else if (lastError?.message?.includes('SpillingKt') || lastError?.message?.includes('ClassNotFoundException')) {
        console.log('[IAP] Billing module has compatibility issues, disabling IAP');
      } else {
        console.error('[IAP] All initConnection attempts failed:', lastError?.code, lastError?.message);
      }
      this.isInitialized = false;
      return false;
    } catch (error: any) {
      console.error('[IAP] Unexpected error during initialize:', error?.code, error?.message);
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
        console.error('[IAP] No subscription products configured for this platform');
        return [];
      }

      console.log('[IAP] Fetching products for SKUs:', SUBSCRIPTION_PRODUCTS);
      let products = await this.fetchProductsWithRetry(SUBSCRIPTION_PRODUCTS);

      // If fetching all SKUs returned nothing, try fetching each individually
      // (a misconfigured product can cause the entire batch to fail)
      if ((!products || products.length === 0) && SUBSCRIPTION_PRODUCTS.length > 1) {
        console.log('[IAP] Batch fetch returned empty, trying individual SKUs...');
        const individualResults: any[] = [];
        for (const sku of SUBSCRIPTION_PRODUCTS) {
          try {
            const result = await RNIap.fetchProducts({ skus: [sku], type: 'subs' });
            if (result && result.length > 0) {
              individualResults.push(...result);
            } else {
              console.warn(`[IAP] Product ${sku} returned empty`);
            }
          } catch (skuError: any) {
            console.warn(`[IAP] Failed to fetch product ${sku}:`, skuError?.code, skuError?.message);
          }
        }
        products = individualResults;
      }

      // If still empty after individual fetch, try reconnecting and fetching again
      if ((!products || products.length === 0) && this.isInitialized) {
        console.log('[IAP] Products still empty, attempting connection reset...');
        try {
          await RNIap.endConnection();
          this.isInitialized = false;
          await delay(1000);
          const reinit = await this.initialize();
          if (reinit) {
            products = await RNIap.fetchProducts({ skus: SUBSCRIPTION_PRODUCTS, type: 'subs' });
            console.log('[IAP] Products after reconnect:', JSON.stringify(products, null, 2));
          }
        } catch (reconnectError: any) {
          console.warn('[IAP] Reconnect attempt failed:', reconnectError?.code, reconnectError?.message);
        }
      }

      console.log(`[IAP] Final product count: ${products?.length || 0}`);
      return products || [];
    } catch (error: any) {
      if (isIapNotAvailable(error)) {
        console.log('[IAP] In-app purchases not available on this device');
      } else {
        console.error('[IAP] Error getting products:', error?.code, error?.message);
      }
      return [];
    }
  }

  private async fetchProductsWithRetry(skus: string[]): Promise<any[]> {
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[IAP] fetchProducts attempt ${attempt}/${maxRetries}`);
        const products = await RNIap.fetchProducts({ skus, type: 'subs' });
        console.log(`[IAP] Attempt ${attempt} returned ${products?.length || 0} products`);

        if (products && products.length > 0) {
          console.log('[IAP] Fetched products:', JSON.stringify(products, null, 2));
          return products;
        }

        // Products returned empty — wait and retry (sandbox may need time)
        if (attempt < maxRetries) {
          console.log(`[IAP] Empty result, retrying in ${attempt}s...`);
          await delay(1000 * attempt);
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[IAP] fetchProducts attempt ${attempt} error:`, err?.code, err?.message);
        if (attempt < maxRetries) {
          await delay(1000 * attempt);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
    return [];
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

      console.log('[IAP] Purchasing subscription:', sku);

      if (Platform.OS === 'android') {
        const products = await RNIap.fetchProducts({ skus: [sku], type: 'subs' });
        console.log('[IAP] Product details for purchase:', JSON.stringify(products, null, 2));

        if (!products || products.length === 0) {
          throw new Error('Product not found');
        }

        const product = products[0];

        // expo-iap 3.x: subscriptionOffers is the primary field, subscriptionOfferDetailsAndroid is deprecated
        const offerDetails = product.subscriptionOffers || product.subscriptionOfferDetailsAndroid;
        if (offerDetails && offerDetails.length > 0) {
          const offerToken = offerDetails[0].offerToken;
          console.log('[IAP] Using offer token:', offerToken);

          const purchase = await RNIap.requestPurchase({
            request: {
              google: {
                skus: [sku],
                subscriptionOffers: [{ sku, offerToken }]
              }
            },
            type: 'subs'
          });
          console.log('[IAP] Purchase successful:', purchase);
          return purchase;
        } else {
          console.warn('[IAP] No subscription offers found, attempting purchase without offers');
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
      console.log('[IAP] Purchase successful:', purchase);
      return purchase;
    } catch (error: any) {
      if (isUserCancelled(error)) {
        console.log('[IAP] User cancelled purchase');
      } else {
        console.error('[IAP] Error purchasing subscription:', error?.code, error?.message);
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
        console.log('[IAP] Active subscriptions:', subscriptions);
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
      console.error('[IAP] Error getting active subscriptions:', error?.code, error?.message);
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
      console.error('[IAP] Error checking subscription status:', error);
      return false;
    }
  }

  async finishTransaction(purchase: any): Promise<void> {
    try {
      if (!purchase) {
        console.error('[IAP] No purchase to finish');
        return;
      }
      await RNIap.finishTransaction({ purchase, isConsumable: false });
      console.log('[IAP] Transaction finished:', purchase.transactionId || purchase.id);
    } catch (error: any) {
      console.error('[IAP] Error finishing transaction:', error?.code, error?.message);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (!this.isInitialized) {
        return;
      }
      await RNIap.endConnection();
      this.isInitialized = false;
      console.log('[IAP] Billing service disconnected');
    } catch (error: any) {
      console.error('[IAP] Error disconnecting billing:', error?.code, error?.message);
      this.isInitialized = false;
    }
  }
}

export const billingService = new BillingService();
