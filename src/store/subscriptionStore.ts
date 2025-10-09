import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SubscriptionState {
  isPremium: boolean;
  quoteCount: number;
  subscriptionId: string | null;
  expiryDate: string | null;

  // Actions
  incrementQuoteCount: () => Promise<void>;
  setPremium: (isPremium: boolean, subscriptionId?: string, expiryDate?: string) => Promise<void>;
  checkPremiumStatus: () => Promise<boolean>;
  resetQuoteCount: () => Promise<void>;
  loadSubscriptionData: () => Promise<void>;
}

const STORAGE_KEYS = {
  QUOTE_COUNT: '@quotemate_quote_count',
  IS_PREMIUM: '@quotemate_is_premium',
  SUBSCRIPTION_ID: '@quotemate_subscription_id',
  EXPIRY_DATE: '@quotemate_expiry_date',
};

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  isPremium: false,
  quoteCount: 0,
  subscriptionId: null,
  expiryDate: null,

  incrementQuoteCount: async () => {
    const newCount = get().quoteCount + 1;
    await AsyncStorage.setItem(STORAGE_KEYS.QUOTE_COUNT, newCount.toString());
    set({ quoteCount: newCount });
  },

  setPremium: async (isPremium: boolean, subscriptionId?: string, expiryDate?: string) => {
    await AsyncStorage.setItem(STORAGE_KEYS.IS_PREMIUM, JSON.stringify(isPremium));

    if (subscriptionId) {
      await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_ID, subscriptionId);
    }

    if (expiryDate) {
      await AsyncStorage.setItem(STORAGE_KEYS.EXPIRY_DATE, expiryDate);
    }

    set({
      isPremium,
      subscriptionId: subscriptionId || null,
      expiryDate: expiryDate || null
    });
  },

  checkPremiumStatus: async () => {
    const { isPremium, expiryDate } = get();

    // Check if subscription has expired
    if (isPremium && expiryDate) {
      const expiryTime = new Date(expiryDate).getTime();
      const now = new Date().getTime();

      if (now > expiryTime) {
        await get().setPremium(false);
        return false;
      }
    }

    return isPremium;
  },

  resetQuoteCount: async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.QUOTE_COUNT, '0');
    set({ quoteCount: 0 });
  },

  loadSubscriptionData: async () => {
    try {
      const [quoteCountStr, isPremiumStr, subscriptionId, expiryDate] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.QUOTE_COUNT),
        AsyncStorage.getItem(STORAGE_KEYS.IS_PREMIUM),
        AsyncStorage.getItem(STORAGE_KEYS.SUBSCRIPTION_ID),
        AsyncStorage.getItem(STORAGE_KEYS.EXPIRY_DATE),
      ]);

      set({
        quoteCount: quoteCountStr ? parseInt(quoteCountStr, 10) : 0,
        isPremium: isPremiumStr ? JSON.parse(isPremiumStr) : false,
        subscriptionId: subscriptionId || null,
        expiryDate: expiryDate || null,
      });

      // Check if premium status is still valid
      await get().checkPremiumStatus();
    } catch (error) {
      console.error('Error loading subscription data:', error);
    }
  },
}));
