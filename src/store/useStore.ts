/**
 * Global state management with Zustand
 * Handles quotes, business settings, and persistence
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { Quote, BusinessSettings, Material, SubscriptionStatus } from '../types';
import { updateQuoteCalculations } from '../utils/quoteCalculator';
import { firestoreService } from '../services/firestoreService';
import { auth } from '../config/firebase';

interface AppState {
  // Business settings
  businessSettings: BusinessSettings | null;
  setBusinessSettings: (settings: BusinessSettings) => Promise<void>;
  loadBusinessSettings: () => Promise<void>;

  // Quotes
  quotes: Quote[];
  currentQuote: Quote | null;

  // Quote operations
  createNewQuote: () => void;
  setCurrentQuote: (quote: Quote | null) => void;
  saveQuote: (quote: Quote) => Promise<void>;
  deleteQuote: (quoteId: string) => Promise<void>;
  duplicateQuote: (quote: Quote) => Promise<void>;
  updateQuote: (quote: Quote) => void;
  loadQuotes: () => Promise<void>;

  // Subscription
  subscriptionStatus: SubscriptionStatus | null;
  loadSubscription: () => Promise<void>;
  incrementQuoteCount: () => Promise<void>;
  canCreateQuote: () => boolean;
  upgradeToProMock: () => Promise<void>;

  // Onboarding
  isOnboarded: boolean;
  setOnboarded: (value: boolean) => Promise<void>;
  checkOnboarding: () => Promise<void>;

  // Cleanup
  clearAllData: () => Promise<void>;
}

// Storage keys
const STORAGE_KEYS = {
  QUOTES: '@quotemate:quotes',
  BUSINESS_SETTINGS: '@quotemate:business_settings',
  ONBOARDED: '@quotemate:onboarded',
  SUBSCRIPTION: '@quotemate:subscription',
};

// Helper to check if we need to reset monthly count
const getMonthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const getMonthEnd = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
};

// Create the store
export const useStore = create<AppState>((set, get) => ({
  // Initial state
  businessSettings: null,
  quotes: [],
  currentQuote: null,
  isOnboarded: false,
  subscriptionStatus: null,

  // Business settings
  setBusinessSettings: async (settings: BusinessSettings) => {
    try {
      // Save to local storage
      await AsyncStorage.setItem(
        STORAGE_KEYS.BUSINESS_SETTINGS,
        JSON.stringify(settings)
      );
      set({ businessSettings: settings });

      // Sync to Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.saveBusinessSettings(settings);
      }
    } catch (error) {
      console.error('Failed to save business settings:', error);
      throw error;
    }
  },

  loadBusinessSettings: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudSettings = await firestoreService.loadBusinessSettings();
        if (cloudSettings) {
          // Save to local storage for offline access
          await AsyncStorage.setItem(
            STORAGE_KEYS.BUSINESS_SETTINGS,
            JSON.stringify(cloudSettings)
          );
          set({ businessSettings: cloudSettings });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.BUSINESS_SETTINGS);
      if (stored) {
        const settings: BusinessSettings = JSON.parse(stored);
        set({ businessSettings: settings });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser) {
          await firestoreService.saveBusinessSettings(settings);
        }
      }
    } catch (error) {
      console.error('Failed to load business settings:', error);
    }
  },

  // Create new quote
  createNewQuote: () => {
    const { businessSettings } = get();
    const newQuote: Quote = {
      id: generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      customerName: '',
      job: {
        id: generateId(),
        name: '',
        description: '',
        template: 'custom',
      },
      materials: [],
      laborRate: businessSettings?.defaultLaborRate || 85,
      laborHours: 0,
      laborTotal: 0,
      materialsSubtotal: 0,
      markup: businessSettings?.defaultMarkup || 20,
      markupAmount: 0,
      subtotal: 0,
      gst: 0,
      total: 0,
      status: 'draft',
    };

    set({ currentQuote: newQuote });
  },

  // Set current quote (for editing)
  setCurrentQuote: (quote: Quote | null) => {
    set({ currentQuote: quote });
  },

  // Update current quote
  updateQuote: (quote: Quote) => {
    const updatedQuote = updateQuoteCalculations(quote);
    set({ currentQuote: updatedQuote });
  },

  // Save quote to storage
  saveQuote: async (quote: Quote) => {
    try {
      const { quotes, incrementQuoteCount } = get();

      // Update or add quote
      const existingIndex = quotes.findIndex((q) => q.id === quote.id);
      let updatedQuotes: Quote[];
      const isNewQuote = existingIndex < 0;
      const calculatedQuote = updateQuoteCalculations(quote);

      if (existingIndex >= 0) {
        // Update existing quote
        updatedQuotes = [...quotes];
        updatedQuotes[existingIndex] = calculatedQuote;
      } else {
        // Add new quote
        updatedQuotes = [...quotes, calculatedQuote];
      }

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        STORAGE_KEYS.QUOTES,
        JSON.stringify(updatedQuotes)
      );

      set({ quotes: updatedQuotes, currentQuote: null });

      // Sync to Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.saveQuote(calculatedQuote);
      }

      // Increment quote count for new quotes only
      if (isNewQuote) {
        await incrementQuoteCount();
      }
    } catch (error) {
      console.error('Failed to save quote:', error);
      throw error;
    }
  },

  // Delete quote
  deleteQuote: async (quoteId: string) => {
    try {
      const { quotes } = get();
      const updatedQuotes = quotes.filter((q) => q.id !== quoteId);

      await AsyncStorage.setItem(
        STORAGE_KEYS.QUOTES,
        JSON.stringify(updatedQuotes)
      );

      set({ quotes: updatedQuotes });

      // Delete from Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.deleteQuote(quoteId);
      }
    } catch (error) {
      console.error('Failed to delete quote:', error);
      throw error;
    }
  },

  // Duplicate quote
  duplicateQuote: async (quote: Quote) => {
    try {
      const { quotes, incrementQuoteCount } = get();

      // Create a copy with new ID and timestamps
      const duplicatedQuote: Quote = {
        ...quote,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'draft',
        // Regenerate material IDs
        materials: quote.materials.map(m => ({
          ...m,
          id: generateId(),
        })),
        job: {
          ...quote.job,
          id: generateId(),
        },
      };

      const updatedQuotes = [...quotes, updateQuoteCalculations(duplicatedQuote)];

      await AsyncStorage.setItem(
        STORAGE_KEYS.QUOTES,
        JSON.stringify(updatedQuotes)
      );

      set({ quotes: updatedQuotes });

      // Increment quote count since this creates a new quote
      await incrementQuoteCount();

      // Sync to Firestore if authenticated
      if (auth.currentUser) {
        await firestoreService.saveQuote(duplicatedQuote);
      }
    } catch (error) {
      console.error('Failed to duplicate quote:', error);
      throw error;
    }
  },

  // Load quotes from storage
  loadQuotes: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudQuotes = await firestoreService.loadQuotes();
        if (cloudQuotes.length > 0) {
          // Save to local storage for offline access
          await AsyncStorage.setItem(
            STORAGE_KEYS.QUOTES,
            JSON.stringify(cloudQuotes)
          );
          set({ quotes: cloudQuotes });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.QUOTES);
      if (stored) {
        const quotes: Quote[] = JSON.parse(stored, (key, value) => {
          // Parse date strings back to Date objects
          if (key === 'createdAt' || key === 'updatedAt') {
            return new Date(value);
          }
          return value;
        });
        set({ quotes });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && quotes.length > 0) {
          console.log('📤 Syncing local quotes to Firestore...');
          for (const quote of quotes) {
            await firestoreService.saveQuote(quote);
          }
          console.log('✅ Local quotes synced to Firestore');
        }
      }
    } catch (error) {
      console.error('Failed to load quotes:', error);
    }
  },

  // Subscription
  loadSubscription: async () => {
    try {
      // If user is authenticated, prioritize Firestore data
      if (auth.currentUser) {
        const firestoreSubscription = await firestoreService.loadSubscriptionStatus();
        if (firestoreSubscription) {
          const now = new Date();
          const periodEnd = new Date(firestoreSubscription.currentPeriodEnd);

          // Check if we need to reset monthly count
          if (now > periodEnd) {
            const newSubscription: SubscriptionStatus = {
              ...firestoreSubscription,
              quotesThisMonth: 0,
              currentPeriodStart: getMonthStart(),
              currentPeriodEnd: getMonthEnd(),
            };
            await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(newSubscription));
            await firestoreService.saveSubscriptionStatus(newSubscription);
            set({ subscriptionStatus: newSubscription });
          } else {
            // Save to local storage for offline access
            await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(firestoreSubscription));
            set({ subscriptionStatus: firestoreSubscription });
          }
          return;
        }
      }

      // Fallback to local storage if not authenticated or no Firestore data
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.SUBSCRIPTION);
      if (stored) {
        const subscription: SubscriptionStatus = JSON.parse(stored, (key, value) => {
          if (key === 'currentPeriodStart' || key === 'currentPeriodEnd') {
            return new Date(value);
          }
          return value;
        });

        const now = new Date();
        const periodEnd = new Date(subscription.currentPeriodEnd);

        // Check if we need to reset monthly count
        if (now > periodEnd) {
          const newSubscription: SubscriptionStatus = {
            ...subscription,
            quotesThisMonth: 0,
            currentPeriodStart: getMonthStart(),
            currentPeriodEnd: getMonthEnd(),
          };
          await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(newSubscription));
          // Sync to Firestore if authenticated
          if (auth.currentUser) {
            await firestoreService.saveSubscriptionStatus(newSubscription);
          }
          set({ subscriptionStatus: newSubscription });
        } else {
          set({ subscriptionStatus: subscription });
          // Sync to Firestore if authenticated and no cloud data exists
          if (auth.currentUser) {
            await firestoreService.saveSubscriptionStatus(subscription);
          }
        }
      } else {
        // Initialize subscription for first time
        const newSubscription: SubscriptionStatus = {
          isPro: false,
          quotesThisMonth: 0,
          currentPeriodStart: getMonthStart(),
          currentPeriodEnd: getMonthEnd(),
          freeQuotesLimit: 5,
        };
        await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(newSubscription));
        // Sync to Firestore if authenticated
        if (auth.currentUser) {
          await firestoreService.saveSubscriptionStatus(newSubscription);
        }
        set({ subscriptionStatus: newSubscription });
      }
    } catch (error) {
      console.error('Failed to load subscription:', error);
    }
  },

  incrementQuoteCount: async () => {
    try {
      const { subscriptionStatus } = get();
      if (!subscriptionStatus) return;

      const updatedSubscription: SubscriptionStatus = {
        ...subscriptionStatus,
        quotesThisMonth: subscriptionStatus.quotesThisMonth + 1,
      };

      await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updatedSubscription));
      set({ subscriptionStatus: updatedSubscription });

      // Sync to Firestore if authenticated
      if (auth.currentUser) {
        await firestoreService.saveSubscriptionStatus(updatedSubscription);
      }
    } catch (error) {
      console.error('Failed to increment quote count:', error);
    }
  },

  canCreateQuote: () => {
    const { subscriptionStatus } = get();
    if (!subscriptionStatus) return false;

    // Pro users can always create quotes
    if (subscriptionStatus.isPro) return true;

    // Free users are limited to 5 per month
    return subscriptionStatus.quotesThisMonth < subscriptionStatus.freeQuotesLimit;
  },

  upgradeToProMock: async () => {
    try {
      const { subscriptionStatus } = get();
      if (!subscriptionStatus) return;

      const updatedSubscription: SubscriptionStatus = {
        ...subscriptionStatus,
        isPro: true,
      };

      await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updatedSubscription));
      set({ subscriptionStatus: updatedSubscription });

      // Sync to Firestore if authenticated
      if (auth.currentUser) {
        await firestoreService.saveSubscriptionStatus(updatedSubscription);
      }
    } catch (error) {
      console.error('Failed to upgrade subscription:', error);
      throw error;
    }
  },

  // Onboarding
  setOnboarded: async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDED, JSON.stringify(value));
      set({ isOnboarded: value });

      // Sync to Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.saveOnboardingStatus(value);
      }
    } catch (error) {
      console.error('Failed to save onboarding status:', error);
    }
  },

  checkOnboarding: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudStatus = await firestoreService.loadOnboardingStatus();
        if (cloudStatus) {
          // Save to local storage for offline access
          await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDED, JSON.stringify(cloudStatus));
          set({ isOnboarded: cloudStatus });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDED);
      if (stored) {
        const isOnboarded = JSON.parse(stored);
        set({ isOnboarded });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && isOnboarded) {
          await firestoreService.saveOnboardingStatus(isOnboarded);
        }
      }
    } catch (error) {
      console.error('Failed to check onboarding status:', error);
    }
  },

  // Clear all data (for logout)
  clearAllData: async () => {
    try {
      console.log('🧹 clearAllData: Starting to clear all app data...');
      console.log('🧹 clearAllData: Storage keys to remove:', Object.values(STORAGE_KEYS));

      // Clear AsyncStorage
      console.log('🧹 clearAllData: Removing items from AsyncStorage...');
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.QUOTES,
        STORAGE_KEYS.BUSINESS_SETTINGS,
        STORAGE_KEYS.ONBOARDED,
        STORAGE_KEYS.SUBSCRIPTION,
      ]);
      console.log('✅ clearAllData: AsyncStorage cleared');

      // Reset store state to initial values
      console.log('🧹 clearAllData: Resetting store state...');
      set({
        businessSettings: null,
        quotes: [],
        currentQuote: null,
        isOnboarded: false,
        subscriptionStatus: null,
      });
      console.log('✅ clearAllData: Store state reset');

      console.log('✅ clearAllData: All app data cleared successfully');
    } catch (error) {
      console.error('❌ clearAllData: Failed to clear app data:', error);
      throw error;
    }
  },
}));
