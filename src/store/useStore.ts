/**
 * Global state management with Zustand
 * Handles quotes, business settings, and persistence
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { Quote, BusinessSettings, Material, SubscriptionStatus, Invoice, PaymentMethod, ReferralInfo } from '../types';
import { TourPhase } from '../components/tour/tourFlow';
import { updateQuoteCalculations } from '../utils/quoteCalculator';
import { calculateDueDate } from '../utils/invoiceCalculator';
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
  saveDraft: (quote: Quote) => Promise<void>;
  deleteQuote: (quoteId: string) => Promise<void>;
  duplicateQuote: (quote: Quote) => Promise<void>;
  updateQuote: (quote: Quote) => void;
  loadQuotes: () => Promise<void>;

  // Subscription
  subscriptionStatus: SubscriptionStatus | null;
  loadSubscription: () => Promise<void>;
  incrementQuoteCount: () => Promise<void>;
  canCreateQuote: () => boolean;
  startTrialIfNeeded: () => Promise<void>;
  upgradeToProMock: () => Promise<void>;

  // Onboarding
  isOnboarded: boolean;
  setOnboarded: (value: boolean) => Promise<void>;
  checkOnboarding: () => Promise<void>;

  // Tour
  hasSeenTour: boolean;
  setHasSeenTour: (value: boolean) => Promise<void>;
  checkTourStatus: () => Promise<void>;
  seenScreenTours: string[];
  markScreenTourSeen: (tourId: string) => Promise<void>;
  hasSeenScreenTour: (tourId: string) => boolean;

  // Quote numbering
  nextQuoteNumber: number;
  loadNextQuoteNumber: () => Promise<void>;
  getNextQuoteNumber: () => Promise<string>;

  // Invoices
  invoices: Invoice[];
  currentInvoice: Invoice | null;
  nextInvoiceNumber: number;

  // Invoice operations
  createNewInvoice: () => void;
  createInvoiceFromQuote: (quote: Quote) => Invoice;
  setCurrentInvoice: (invoice: Invoice | null) => void;
  updateInvoice: (invoice: Invoice) => void;
  saveInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (invoiceId: string) => Promise<void>;
  loadInvoices: () => Promise<void>;
  loadNextInvoiceNumber: () => Promise<void>;
  getNextInvoiceNumber: () => Promise<string>;
  recordPayment: (
    invoiceId: string,
    amount: number,
    method: PaymentMethod,
    notes?: string,
    paymentDate?: Date
  ) => Promise<void>;
  duplicateInvoice: (invoice: Invoice) => Promise<Invoice>;

  // Referral
  referralInfo: ReferralInfo | null;
  loadReferralInfo: () => Promise<void>;

  // Unified guided tour
  unifiedTourActive: boolean;
  unifiedTourPhase: TourPhase | null;
  unifiedTourQuoteId: string | null;
  startUnifiedTour: () => void;
  setUnifiedTourPhase: (phase: TourPhase) => void;
  endUnifiedTour: () => Promise<void>;
  skipUnifiedTour: () => Promise<void>;

  // Cleanup
  clearAllData: () => Promise<void>;
}

// Storage keys
const STORAGE_KEYS = {
  QUOTES: '@quotemate:quotes',
  BUSINESS_SETTINGS: '@quotemate:business_settings',
  ONBOARDED: '@quotemate:onboarded',
  SUBSCRIPTION: '@quotemate:subscription',
  NEXT_QUOTE_NUMBER: '@quotemate:next_quote_number',
  INVOICES: '@quotemate:invoices',
  NEXT_INVOICE_NUMBER: '@quotemate:next_invoice_number',
  TOUR_SEEN: '@quotemate:tour_seen',
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
  hasSeenTour: false,
  seenScreenTours: [],
  subscriptionStatus: null,
  nextQuoteNumber: 1,
  invoices: [],
  currentInvoice: null,
  nextInvoiceNumber: 1,
  referralInfo: null,
  unifiedTourActive: false,
  unifiedTourPhase: null,
  unifiedTourQuoteId: null,

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
    const { businessSettings, startTrialIfNeeded } = get();
    // Start trial on first quote creation, not on save
    startTrialIfNeeded();
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

  // Save draft to storage (lightweight, no quota check or number assignment)
  saveDraft: async (quote: Quote) => {
    try {
      const { quotes } = get();
      const calculatedQuote = updateQuoteCalculations({
        ...quote,
        updatedAt: new Date(),
      });

      const existingIndex = quotes.findIndex((q) => q.id === quote.id);
      let updatedQuotes: Quote[];
      if (existingIndex >= 0) {
        updatedQuotes = [...quotes];
        updatedQuotes[existingIndex] = calculatedQuote;
      } else {
        updatedQuotes = [...quotes, calculatedQuote];
      }

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        STORAGE_KEYS.QUOTES,
        JSON.stringify(updatedQuotes)
      );

      // Update state
      set({ quotes: updatedQuotes, currentQuote: calculatedQuote });

      // Sync to Firestore in background
      if (auth.currentUser) {
        firestoreService.saveQuote(calculatedQuote).catch((err) => {
          console.warn('Firestore draft sync failed:', err);
        });
      }
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  },

  // Save quote to storage
  saveQuote: async (quote: Quote) => {
    try {
      const { quotes, getNextQuoteNumber, subscriptionStatus } = get();

      // Update or add quote
      const existingIndex = quotes.findIndex((q) => q.id === quote.id);
      const isNewQuote = existingIndex < 0;
      let calculatedQuote = updateQuoteCalculations(quote);

      // For new quotes, enforce quota server-side (atomic check + increment)
      if (isNewQuote && auth.currentUser) {
        try {
          const quotaResult = await firestoreService.checkAndIncrementQuota();
          if (!quotaResult.allowed) {
            throw new Error('TRIAL_EXPIRED');
          }
          // Update local subscription state with server-authoritative count
          if (subscriptionStatus) {
            const updatedSubscription: SubscriptionStatus = {
              ...subscriptionStatus,
              quotesThisMonth: quotaResult.quotesThisMonth,
              trialStartedAt: quotaResult.trialStartedAt ? new Date(quotaResult.trialStartedAt) : subscriptionStatus.trialStartedAt,
              trialExpired: quotaResult.trialExpired || false,
            };
            await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updatedSubscription));
            set({ subscriptionStatus: updatedSubscription });
          }
        } catch (quotaError: any) {
          if (quotaError.message === 'QUOTA_EXCEEDED' || quotaError.message === 'TRIAL_EXPIRED') {
            throw quotaError;
          }
          // If quota check fails (network error), fall back to client-side check
          console.warn('Server quota check failed, using client-side check:', quotaError);
          const { canCreateQuote } = get();
          if (!canCreateQuote()) {
            throw new Error('TRIAL_EXPIRED');
          }
        }
      }

      // Assign quote number for new quotes that don't have one
      if (isNewQuote && !calculatedQuote.quoteNumber) {
        const quoteNumber = await getNextQuoteNumber();
        calculatedQuote = { ...calculatedQuote, quoteNumber };
      }

      let updatedQuotes: Quote[];
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

      // Update quotes in state but keep currentQuote (will be cleared on navigation)
      set({ quotes: updatedQuotes });

      // Sync to Firestore if user is signed in (non-blocking — local save already succeeded)
      if (auth.currentUser) {
        try {
          await firestoreService.saveQuote(calculatedQuote);
        } catch (syncError) {
          console.warn('Firestore sync failed for quote, will retry on next load:', syncError);
        }
      }

      // For new quotes when not authenticated, do client-side increment
      if (isNewQuote && !auth.currentUser) {
        const { incrementQuoteCount } = get();
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

      // Delete from Firestore if user is signed in (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.deleteQuote(quoteId);
        } catch (syncError) {
          console.warn('Firestore sync failed for quote deletion:', syncError);
        }
      }
    } catch (error) {
      console.error('Failed to delete quote:', error);
      throw error;
    }
  },

  // Duplicate quote
  duplicateQuote: async (quote: Quote) => {
    try {
      const { quotes, subscriptionStatus } = get();

      // Enforce quota server-side for new duplicate
      if (auth.currentUser) {
        try {
          const quotaResult = await firestoreService.checkAndIncrementQuota();
          if (!quotaResult.allowed) {
            throw new Error('TRIAL_EXPIRED');
          }
          if (subscriptionStatus) {
            const updatedSubscription: SubscriptionStatus = {
              ...subscriptionStatus,
              quotesThisMonth: quotaResult.quotesThisMonth,
              trialStartedAt: quotaResult.trialStartedAt ? new Date(quotaResult.trialStartedAt) : subscriptionStatus.trialStartedAt,
              trialExpired: quotaResult.trialExpired || false,
            };
            await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updatedSubscription));
            set({ subscriptionStatus: updatedSubscription });
          }
        } catch (quotaError: any) {
          if (quotaError.message === 'QUOTA_EXCEEDED' || quotaError.message === 'TRIAL_EXPIRED') {
            throw quotaError;
          }
          console.warn('Server quota check failed, using client-side check:', quotaError);
          const { canCreateQuote } = get();
          if (!canCreateQuote()) {
            throw new Error('TRIAL_EXPIRED');
          }
        }
      } else {
        const { incrementQuoteCount } = get();
        await incrementQuoteCount();
      }

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

      // Sync to Firestore if authenticated (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.saveQuote(duplicatedQuote);
        } catch (syncError) {
          console.warn('Firestore sync failed for duplicated quote:', syncError);
        }
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
      // Also load referral info for Pro access check
      if (auth.currentUser) {
        get().loadReferralInfo();
      }

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
          if (key === 'currentPeriodStart' || key === 'currentPeriodEnd' || key === 'trialStartedAt') {
            return value ? new Date(value) : value;
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
          trialStartedAt: undefined,
          trialExpired: false,
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
    if (!subscriptionStatus) return true; // Allow if no status yet (trial not started)
    if (subscriptionStatus.isPro) return true;

    // If no trial started yet, allow (first quote will start the trial)
    if (!subscriptionStatus.trialStartedAt) return true;

    // Check if trial is still active (7 days)
    const trialStart = new Date(subscriptionStatus.trialStartedAt);
    const now = new Date();
    const trialDays = 7;
    const trialEnd = new Date(trialStart.getTime() + trialDays * 24 * 60 * 60 * 1000);
    return now < trialEnd;
  },

  // Start the trial period if not already started
  startTrialIfNeeded: async () => {
    try {
      const { subscriptionStatus } = get();
      if (!subscriptionStatus) return;
      if (subscriptionStatus.isPro) return;
      if (subscriptionStatus.trialStartedAt) return; // Already started

      const now = new Date();
      const updatedSubscription: SubscriptionStatus = {
        ...subscriptionStatus,
        trialStartedAt: now,
      };

      await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updatedSubscription));
      set({ subscriptionStatus: updatedSubscription });

      // Sync to Firestore if authenticated
      if (auth.currentUser) {
        firestoreService.saveSubscriptionStatus(updatedSubscription).catch((err) => {
          console.warn('Firestore trial sync failed:', err);
        });
      }
    } catch (error) {
      console.error('Failed to start trial:', error);
    }
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

  // Tour
  setHasSeenTour: async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TOUR_SEEN, JSON.stringify(value));
      set({ hasSeenTour: value });
    } catch (error) {
      console.error('Failed to save tour status:', error);
    }
  },

  checkTourStatus: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.TOUR_SEEN);
      if (stored) {
        set({ hasSeenTour: JSON.parse(stored) });
      }
      const screenToursStored = await AsyncStorage.getItem('@quotemate:seen_screen_tours');
      if (screenToursStored) {
        set({ seenScreenTours: JSON.parse(screenToursStored) });
      }
    } catch (error) {
      console.error('Failed to check tour status:', error);
    }
  },

  markScreenTourSeen: async (tourId: string) => {
    try {
      const { seenScreenTours } = get();
      if (seenScreenTours.includes(tourId)) return;
      const updated = [...seenScreenTours, tourId];
      await AsyncStorage.setItem('@quotemate:seen_screen_tours', JSON.stringify(updated));
      set({ seenScreenTours: updated });
    } catch (error) {
      console.error('Failed to mark screen tour seen:', error);
    }
  },

  hasSeenScreenTour: (tourId: string) => {
    return get().seenScreenTours.includes(tourId);
  },

  // Quote numbering
  loadNextQuoteNumber: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.NEXT_QUOTE_NUMBER);
      if (stored) {
        const nextQuoteNumber = parseInt(stored, 10);
        set({ nextQuoteNumber });
      }
    } catch (error) {
      console.error('Failed to load next quote number:', error);
    }
  },

  getNextQuoteNumber: async () => {
    const { nextQuoteNumber } = get();
    const quoteNumber = `Q-${String(nextQuoteNumber).padStart(3, '0')}`;

    // Increment and save for next time
    const newNextQuoteNumber = nextQuoteNumber + 1;
    await AsyncStorage.setItem(STORAGE_KEYS.NEXT_QUOTE_NUMBER, String(newNextQuoteNumber));
    set({ nextQuoteNumber: newNextQuoteNumber });

    return quoteNumber;
  },

  // Invoice operations
  createNewInvoice: () => {
    const { businessSettings } = get();
    const now = new Date();
    const newInvoice: Invoice = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      issueDate: now,
      dueDate: calculateDueDate(now, 'net_14'),
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
      paymentTerms: 'net_14',
    };

    set({ currentInvoice: newInvoice });
  },

  createInvoiceFromQuote: (quote: Quote) => {
    const now = new Date();
    const newInvoice: Invoice = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      issueDate: now,
      dueDate: calculateDueDate(now, 'net_14'),
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      customerPhone: quote.customerPhone,
      jobAddress: quote.jobAddress,
      job: {
        ...quote.job,
        id: generateId(),
      },
      materials: quote.materials.map(m => ({
        ...m,
        id: generateId(),
      })),
      laborRate: quote.laborRate,
      laborHours: quote.laborHours,
      laborTotal: quote.laborTotal,
      materialsSubtotal: quote.materialsSubtotal,
      markup: quote.markup,
      markupAmount: quote.markupAmount,
      subtotal: quote.subtotal,
      gst: quote.gst,
      total: quote.total,
      status: 'draft',
      paymentTerms: 'net_14',
      sourceQuoteId: quote.id,
      notes: quote.notes,
    };

    set({ currentInvoice: newInvoice });
    return newInvoice;
  },

  setCurrentInvoice: (invoice: Invoice | null) => {
    set({ currentInvoice: invoice });
  },

  updateInvoice: (invoice: Invoice) => {
    // Apply same calculations as quotes
    const updatedInvoice = {
      ...invoice,
      laborTotal: invoice.laborRate * invoice.laborHours,
      materialsSubtotal: invoice.materials.reduce((sum, m) => sum + m.totalPrice, 0),
    };
    updatedInvoice.subtotal = updatedInvoice.laborTotal + updatedInvoice.materialsSubtotal;
    updatedInvoice.markupAmount = updatedInvoice.subtotal * (invoice.markup / 100);
    const subtotalWithMarkup = updatedInvoice.subtotal + updatedInvoice.markupAmount;
    updatedInvoice.gst = subtotalWithMarkup * 0.1;
    updatedInvoice.total = subtotalWithMarkup + updatedInvoice.gst;

    set({ currentInvoice: updatedInvoice });
  },

  saveInvoice: async (invoice: Invoice) => {
    try {
      const { invoices, getNextInvoiceNumber } = get();

      const existingIndex = invoices.findIndex((i) => i.id === invoice.id);
      const isNewInvoice = existingIndex < 0;
      let updatedInvoice = { ...invoice, updatedAt: new Date() };

      // Assign invoice number for new invoices that don't have one
      if (isNewInvoice && !updatedInvoice.invoiceNumber) {
        const invoiceNumber = await getNextInvoiceNumber();
        updatedInvoice = { ...updatedInvoice, invoiceNumber };
      }

      let updatedInvoices: Invoice[];
      if (existingIndex >= 0) {
        updatedInvoices = [...invoices];
        updatedInvoices[existingIndex] = updatedInvoice;
      } else {
        updatedInvoices = [...invoices, updatedInvoice];
      }

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        STORAGE_KEYS.INVOICES,
        JSON.stringify(updatedInvoices)
      );

      set({ invoices: updatedInvoices });

      // Sync to Firestore if user is signed in (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.saveInvoice(updatedInvoice);
        } catch (syncError) {
          console.warn('Firestore sync failed for invoice:', syncError);
        }
      }
    } catch (error) {
      console.error('Failed to save invoice:', error);
      throw error;
    }
  },

  deleteInvoice: async (invoiceId: string) => {
    try {
      const { invoices } = get();
      const updatedInvoices = invoices.filter((i) => i.id !== invoiceId);

      await AsyncStorage.setItem(
        STORAGE_KEYS.INVOICES,
        JSON.stringify(updatedInvoices)
      );

      set({ invoices: updatedInvoices });

      // Delete from Firestore if user is signed in (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.deleteInvoice(invoiceId);
        } catch (syncError) {
          console.warn('Firestore sync failed for invoice deletion:', syncError);
        }
      }
    } catch (error) {
      console.error('Failed to delete invoice:', error);
      throw error;
    }
  },

  loadInvoices: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudInvoices = await firestoreService.loadInvoices();
        if (cloudInvoices.length > 0) {
          // Save to local storage for offline access
          await AsyncStorage.setItem(
            STORAGE_KEYS.INVOICES,
            JSON.stringify(cloudInvoices)
          );
          set({ invoices: cloudInvoices });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.INVOICES);
      if (stored) {
        const invoices: Invoice[] = JSON.parse(stored, (key, value) => {
          // Parse date strings back to Date objects
          if (
            key === 'createdAt' ||
            key === 'updatedAt' ||
            key === 'issueDate' ||
            key === 'dueDate' ||
            key === 'paidDate'
          ) {
            return value ? new Date(value) : undefined;
          }
          return value;
        });
        set({ invoices });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && invoices.length > 0) {
          console.log('📤 Syncing local invoices to Firestore...');
          for (const invoice of invoices) {
            await firestoreService.saveInvoice(invoice);
          }
          console.log('✅ Local invoices synced to Firestore');
        }
      }
    } catch (error) {
      console.error('Failed to load invoices:', error);
    }
  },

  loadNextInvoiceNumber: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.NEXT_INVOICE_NUMBER);
      if (stored) {
        const nextInvoiceNumber = parseInt(stored, 10);
        set({ nextInvoiceNumber });
      }
    } catch (error) {
      console.error('Failed to load next invoice number:', error);
    }
  },

  getNextInvoiceNumber: async () => {
    const { nextInvoiceNumber } = get();
    const invoiceNumber = `INV-${String(nextInvoiceNumber).padStart(3, '0')}`;

    // Increment and save for next time
    const newNextInvoiceNumber = nextInvoiceNumber + 1;
    await AsyncStorage.setItem(STORAGE_KEYS.NEXT_INVOICE_NUMBER, String(newNextInvoiceNumber));
    set({ nextInvoiceNumber: newNextInvoiceNumber });

    return invoiceNumber;
  },

  recordPayment: async (
    invoiceId: string,
    amount: number,
    method: PaymentMethod,
    notes?: string,
    paymentDate?: Date
  ) => {
    try {
      const { invoices } = get();
      const invoice = invoices.find((i) => i.id === invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      const currentPaid = invoice.paidAmount || 0;
      const newPaidAmount = currentPaid + amount;
      const amountDue = invoice.total - newPaidAmount;

      // Determine new status
      let newStatus: Invoice['status'];
      if (amountDue <= 0) {
        newStatus = 'paid';
      } else if (newPaidAmount > 0) {
        newStatus = 'partial';
      } else {
        newStatus = invoice.status;
      }

      const updatedInvoice: Invoice = {
        ...invoice,
        paidAmount: newPaidAmount,
        paidDate: paymentDate || new Date(),
        paymentMethod: method,
        paymentNotes: notes,
        status: newStatus,
        updatedAt: new Date(),
      };

      const updatedInvoices = invoices.map((i) =>
        i.id === invoiceId ? updatedInvoice : i
      );

      await AsyncStorage.setItem(
        STORAGE_KEYS.INVOICES,
        JSON.stringify(updatedInvoices)
      );

      set({ invoices: updatedInvoices });

      // Sync to Firestore if user is signed in (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.saveInvoice(updatedInvoice);
        } catch (syncError) {
          console.warn('Firestore sync failed for payment recording:', syncError);
        }
      }
    } catch (error) {
      console.error('Failed to record payment:', error);
      throw error;
    }
  },

  duplicateInvoice: async (invoice: Invoice) => {
    try {
      const { invoices } = get();

      // Create a copy with new ID and timestamps, reset payment info
      const duplicatedInvoice: Invoice = {
        ...invoice,
        id: generateId(),
        invoiceNumber: undefined, // Will get new number on save
        createdAt: new Date(),
        updatedAt: new Date(),
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // Default 14 days
        status: 'draft',
        // Reset payment tracking
        paidAmount: undefined,
        paidDate: undefined,
        paymentMethod: undefined,
        paymentNotes: undefined,
        // Clear source quote link
        sourceQuoteId: undefined,
        // Regenerate material IDs
        materials: invoice.materials.map((m) => ({
          ...m,
          id: generateId(),
        })),
        job: {
          ...invoice.job,
          id: generateId(),
        },
      };

      // Save to local storage
      const updatedInvoices = [...invoices, duplicatedInvoice];
      await AsyncStorage.setItem(
        STORAGE_KEYS.INVOICES,
        JSON.stringify(updatedInvoices)
      );

      set({ invoices: updatedInvoices, currentInvoice: duplicatedInvoice });

      // Sync to Firestore if user is signed in (non-blocking)
      if (auth.currentUser) {
        try {
          await firestoreService.saveInvoice(duplicatedInvoice);
        } catch (syncError) {
          console.warn('Firestore sync failed for duplicated invoice:', syncError);
        }
      }

      return duplicatedInvoice;
    } catch (error) {
      console.error('Failed to duplicate invoice:', error);
      throw error;
    }
  },

  // Referral
  loadReferralInfo: async () => {
    try {
      if (auth.currentUser) {
        const info = await firestoreService.loadReferralInfo();
        set({ referralInfo: info });
      }
    } catch (error) {
      console.error('Failed to load referral info:', error);
    }
  },

  // Unified guided tour
  startUnifiedTour: () => {
    const { createNewQuote, currentQuote } = get();
    createNewQuote();
    const newQuote = get().currentQuote;
    set({
      unifiedTourActive: true,
      unifiedTourPhase: 'dashboard',
      unifiedTourQuoteId: newQuote?.id || null,
    });
  },

  setUnifiedTourPhase: (phase: TourPhase) => {
    set({ unifiedTourPhase: phase });
  },

  endUnifiedTour: async () => {
    const { unifiedTourQuoteId, deleteQuote, setHasSeenTour } = get();
    // Delete the tour dummy quote — user was told to delete it themselves,
    // but we clean it up to avoid leftovers
    if (unifiedTourQuoteId) {
      try {
        await deleteQuote(unifiedTourQuoteId);
      } catch (e) {
        console.warn('Failed to delete tour dummy quote:', e);
      }
    }
    // Mark all tours as seen
    await setHasSeenTour(true);
    const allScreenTours = ['jobDetails', 'customerDetails', 'materialsList', 'materialsListItems', 'addMaterial', 'materialsListAdded', 'laborMarkup', 'quotePreview', 'dashboardComplete'];
    const { seenScreenTours } = get();
    const updated = [...new Set([...seenScreenTours, ...allScreenTours])];
    await AsyncStorage.setItem('@quotemate:seen_screen_tours', JSON.stringify(updated));
    set({
      unifiedTourActive: false,
      unifiedTourPhase: null,
      unifiedTourQuoteId: null,
      currentQuote: null,
      seenScreenTours: updated,
    });
  },

  skipUnifiedTour: async () => {
    const { unifiedTourQuoteId, deleteQuote, setHasSeenTour } = get();
    // Delete the dummy quote on skip
    if (unifiedTourQuoteId) {
      try {
        await deleteQuote(unifiedTourQuoteId);
      } catch (e) {
        console.warn('Failed to delete tour dummy quote:', e);
      }
    }
    // Mark all tours as seen
    await setHasSeenTour(true);
    const allScreenTours = ['jobDetails', 'customerDetails', 'materialsList', 'materialsListItems', 'addMaterial', 'materialsListAdded', 'laborMarkup', 'quotePreview', 'dashboardComplete'];
    const { seenScreenTours } = get();
    const updated = [...new Set([...seenScreenTours, ...allScreenTours])];
    await AsyncStorage.setItem('@quotemate:seen_screen_tours', JSON.stringify(updated));
    set({
      unifiedTourActive: false,
      unifiedTourPhase: null,
      unifiedTourQuoteId: null,
      currentQuote: null,
      seenScreenTours: updated,
    });
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
        STORAGE_KEYS.INVOICES,
        STORAGE_KEYS.NEXT_QUOTE_NUMBER,
        STORAGE_KEYS.NEXT_INVOICE_NUMBER,
        STORAGE_KEYS.TOUR_SEEN,
        '@quotemate:seen_screen_tours',
      ]);
      console.log('✅ clearAllData: AsyncStorage cleared');

      // Reset store state to initial values
      console.log('🧹 clearAllData: Resetting store state...');
      set({
        businessSettings: null,
        quotes: [],
        currentQuote: null,
        isOnboarded: false,
        hasSeenTour: false,
        seenScreenTours: [],
        subscriptionStatus: null,
        invoices: [],
        currentInvoice: null,
        nextQuoteNumber: 1,
        nextInvoiceNumber: 1,
        referralInfo: null,
      });
      console.log('✅ clearAllData: Store state reset');

      console.log('✅ clearAllData: All app data cleared successfully');
    } catch (error) {
      console.error('❌ clearAllData: Failed to clear app data:', error);
      throw error;
    }
  },
}));
