import { Platform } from 'react-native';

// Safely import expo-iap only if available
let RNIap: any = null;
try {
  RNIap = require('expo-iap');
} catch (error) {
  // silently ignore - not available on this platform
}

// Subscription product IDs (must match App Store Connect & Google Play Console)
export const SUBSCRIPTION_SKUS = Platform.OS === 'android'
  ? { MONTHLY: 'quotemate_premium_monthly', YEARLY: 'quotemate_premium_yearly' }
  : { MONTHLY: 'quotemate_pro_monthly', YEARLY: 'quotemate_pro_yearly' };

// Every SKU this app has ever sold on either store. SUBSCRIPTION_SKUS is the
// current platform's *sellable* pair, which is deliberately narrower — but a
// subscriber can still be sitting on a SKU we no longer offer here (there is a
// live Android subscriber on quotemate_pro_yearly, which is not in Android's
// pair). Recovery must recognise those or it silently skips real payers.
export const ALL_KNOWN_SUBSCRIPTION_SKUS = [
  'quotemate_premium_monthly',
  'quotemate_premium_yearly',
  'quotemate_pro_monthly',
  'quotemate_pro_yearly',
];

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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

class BillingService {
  private isInitialized = false;
  private initializationAttempts = 0;

  async initialize(): Promise<boolean> {
    try {
      if (!RNIap) {
        return false;
      }
      if (this.isInitialized) {
        return true;
      }

      // Retry initConnection up to 3 times — sandbox can be slow on first launch
      const maxRetries = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await withTimeout(RNIap.initConnection(), 10000, 'initConnection');
          this.isInitialized = true;
          this.initializationAttempts = attempt;
          return true;
        } catch (err: any) {
          lastError = err;
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
      this.isInitialized = false;
      return false;
    } catch (error: any) {
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
        return [];
      }

      let products = await this.fetchProductsWithRetry(SUBSCRIPTION_PRODUCTS);

      // If fetching all SKUs returned nothing, try fetching each individually
      // (a misconfigured product can cause the entire batch to fail)
      if ((!products || products.length === 0) && SUBSCRIPTION_PRODUCTS.length > 1) {
        const individualResults: any[] = [];
        for (const sku of SUBSCRIPTION_PRODUCTS) {
          try {
            const result = await RNIap.fetchProducts({ skus: [sku], type: 'subs' });
            if (result && result.length > 0) {
              individualResults.push(...result);
            }
          } catch (skuError: any) {
            // silently ignore
          }
        }
        products = individualResults;
      }

      // If still empty after individual fetch, try reconnecting and fetching again
      if ((!products || products.length === 0) && this.isInitialized) {
        try {
          await RNIap.endConnection();
          this.isInitialized = false;
          await delay(1000);
          const reinit = await this.initialize();
          if (reinit) {
            products = await RNIap.fetchProducts({ skus: SUBSCRIPTION_PRODUCTS, type: 'subs' });
          }
        } catch (reconnectError: any) {
          // silently ignore
        }
      }

      return products || [];
    } catch (error: any) {
      return [];
    }
  }

  private async fetchProductsWithRetry(skus: string[]): Promise<any[]> {
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const products = await withTimeout(
          RNIap.fetchProducts({ skus, type: 'subs' }),
          15000,
          'fetchProducts'
        ) as any[];
        if (products && products.length > 0) {
          return products;
        }

        // Products returned empty — wait and retry (sandbox may need time)
        if (attempt < maxRetries) {
          await delay(1000 * attempt);
        }
      } catch (err: any) {
        lastError = err;
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


      if (Platform.OS === 'android') {
        const products = await RNIap.fetchProducts({ skus: [sku], type: 'subs' });
        if (!products || products.length === 0) {
          throw new Error('Product not found');
        }

        const product = products[0];

        // expo-iap 3.x: subscriptionOffers is the primary field, subscriptionOfferDetailsAndroid is deprecated
        const offerDetails = product.subscriptionOffers || product.subscriptionOfferDetailsAndroid;
        if (offerDetails && offerDetails.length > 0) {
          const offerToken = offerDetails[0].offerToken;
          const purchase = await RNIap.requestPurchase({
            request: {
              google: {
                skus: [sku],
                subscriptionOffers: [{ sku, offerToken }]
              }
            },
            type: 'subs'
          });
          return purchase;
        } else {
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
      return purchase;
    } catch (error: any) {
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
      return [];
    }
  }

  /**
   * Purchases the store still considers outstanding, across EVERY SKU we have
   * ever sold — not just the current platform's sellable pair.
   *
   * Deliberately does not pass onlyIncludeActiveItemsIOS: a transaction left
   * unfinished by a failed validation is exactly what we need back, and that
   * is the case this exists to repair.
   */
  async getRecoverablePurchases(): Promise<any[]> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) return [];
      }

      const purchases = await RNIap.getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
      });
      if (!purchases || !Array.isArray(purchases)) return [];

      return purchases.filter((p: any) => ALL_KNOWN_SUBSCRIPTION_SKUS.includes(p?.productId));
    } catch (error: any) {
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
      return false;
    }
  }

  async finishTransaction(purchase: any): Promise<void> {
    try {
      if (!purchase) {
        return;
      }
      await RNIap.finishTransaction({ purchase, isConsumable: false });
    } catch (error: any) {
      // silently ignore
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (!this.isInitialized) {
        return;
      }
      await RNIap.endConnection();
      this.isInitialized = false;
    } catch (error: any) {
      this.isInitialized = false;
    }
  }
}

export const billingService = new BillingService();
