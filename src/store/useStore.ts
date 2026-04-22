/**
 * Global state management with Zustand
 * Handles quotes, business settings, and persistence
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { Quote, BusinessSettings, Material, SubscriptionStatus, Invoice, PaymentMethod, ReferralInfo, XeroConnection, XeroSyncStatus, Contact } from '../types';
import { Document } from '../types/document';
import { TourPhase } from '../components/tour/tourFlow';
import { updateQuoteCalculations, healBrokenLabourSections } from '../utils/quoteCalculator';
import { calculateDueDate } from '../utils/invoiceCalculator';
import { reconcileNextNumber } from '../utils/nextNumber';
import { firestoreService } from '../services/firestoreService';
import { documentService } from '../services/documentService';
import { ensureJobForDocument, ensureJobForQuote } from './useJobStore';
import { auth } from '../config/firebase';

/**
 * A user-visible record of the last sync failure. Populated by the saveDraft /
 * saveQuote / saveInvoice / favorites catch blocks so a banner can warn the user
 * that their latest edit hasn't reached the cloud yet — instead of failing
 * silently like the original "changes won't stick" bug.
 */
export interface SyncError {
  kind: 'quote' | 'invoice' | 'favorite';
  id: string;
  message: string;
  /** ISO timestamp the error occurred */
  at: string;
}

interface AppState {
  // Business settings
  businessSettings: BusinessSettings | null;
  setBusinessSettings: (settings: BusinessSettings) => Promise<void>;
  loadBusinessSettings: () => Promise<void>;

  // Quotes
  quotes: Quote[];
  currentQuote: Quote | null;
  /**
   * Map of quote id → updatedAt (ms) for writes that have been issued to Firestore
   * but not yet acknowledged. Used by mergeRemoteQuotes to ignore stale snapshots
   * that would otherwise revert the user's unsynced edits.
   */
  pendingQuoteWrites: Record<string, number>;

  /**
   * The most recent unrecovered sync failure. Set by saveDraft/saveQuote/saveInvoice
   * when a Firestore write fails so the UI can surface a banner. Cleared on success
   * or when the user dismisses it. Without this we have zero signal when sync breaks.
   */
  lastSyncError: SyncError | null;
  setSyncError: (err: SyncError | null) => void;
  clearSyncError: () => void;

  // Quote operations
  createNewQuote: () => void;
  setCurrentQuote: (quote: Quote | null) => void;
  saveQuote: (quote: Quote) => Promise<void>;
  saveDraft: (quote: Quote) => Promise<void>;
  deleteQuote: (quoteId: string) => Promise<void>;
  duplicateQuote: (quote: Quote) => Promise<void>;
  updateQuote: (quote: Quote) => void;
  loadQuotes: () => Promise<void>;
  /**
   * Merge a snapshot of quotes from the realtime Firestore listener into local state.
   * Per-id rules:
   *   - If a pending local write is newer than the snapshot's updatedAt → keep local.
   *   - If local quote's updatedAt is newer than the snapshot's → keep local.
   *   - Otherwise take remote.
   * Locals that are missing from the snapshot are dropped UNLESS they have a pending
   * write (which means we just created them and the listener echo hasn't caught up yet).
   */
  mergeRemoteQuotes: (remote: Quote[]) => void;

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
  /** Mirror of pendingQuoteWrites for invoices — used by mergeRemoteInvoices. */
  pendingInvoiceWrites: Record<string, number>;

  // Invoice operations
  createNewInvoice: () => void;
  createInvoiceFromQuote: (quote: Quote) => Promise<Invoice>;
  setCurrentInvoice: (invoice: Invoice | null) => void;
  updateInvoice: (invoice: Invoice) => void;
  saveInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (invoiceId: string) => Promise<void>;
  loadInvoices: () => Promise<void>;
  /** Mirror of mergeRemoteQuotes for invoices. */
  mergeRemoteInvoices: (remote: Invoice[]) => void;
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

  // Template material staging (for adding materials to templates from AddMaterialScreen)
  pendingTemplateMaterial: Material | null;
  setPendingTemplateMaterial: (material: Material | null) => void;

  // Contacts
  contacts: Contact[];
  contactsLoaded: boolean;
  xeroContacts: Contact[];
  loadContacts: () => Promise<void>;
  saveContact: (contact: Contact) => Promise<void>;
  deleteContact: (contactId: string) => Promise<void>;
  importContacts: (contacts: Contact[]) => Promise<void>;
  syncXeroContacts: () => Promise<void>;
  migrateCustomersToContacts: () => Promise<void>;

  // Xero integration
  xeroConnection: XeroConnection | null;
  xeroLoading: boolean;
  loadXeroConnection: () => Promise<void>;
  setXeroConnection: (connection: XeroConnection | null) => void;
  pushInvoiceToXero: (invoice: Invoice) => Promise<void>;
  pushPaymentToXero: (invoiceId: string, xeroInvoiceId: string, amount: number, date: Date, method?: string) => Promise<void>;
  xeroBulkSync: (invoiceIds: string[]) => Promise<{ successCount: number; totalCount: number }>;

  // Unified Documents (phase-5 client cutover) — reads from
  // users/{uid}/documents and writes both there AND to the legacy collection
  // via the canonical adapter so older app builds still see live data.
  documents: Document[];
  documentsLoaded: boolean;
  loadDocuments: () => Promise<void>;
  listenToDocuments: () => void;
  saveDocument: (doc: Document) => Promise<void>;
  getDocumentById: (id: string) => Document | undefined;
  getDocumentByLegacyId: (legacyId: string) => Document | undefined;
  convertDocumentToInvoice: (documentId: string) => Promise<Document>;

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
  XERO_CONNECTION: '@quotemate:xero_connection',
  CONTACTS: '@quotemate:contacts',
  CONTACTS_MIGRATED: '@quotemate:contacts_migrated',
};

/**
 * Record a sync failure: log to console for dev/CI visibility, then capture it on
 * the store so the SyncErrorBanner can warn the user. The original bug went
 * unnoticed for ages because every sync failure was silently swallowed.
 *
 * Exported so other services (e.g. materialFavorites) can route their own
 * sync failures through the same banner instead of silently swallowing them.
 */
export function logSyncError(kind: SyncError['kind'], id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[sync] ${kind} ${id} failed:`, message, error);
  useStore.setState({
    lastSyncError: { kind, id, message, at: new Date().toISOString() },
  });
}

// Helper to check if we need to reset monthly count
const getMonthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const getMonthEnd = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
};

// Cached map keyed on the documents array identity. Rebuilt whenever the
// store swaps in a new array (every set({ documents })), so lookups stay
// O(1) during the hot path (screen focus, preview paint).
let legacyDocIndexCache: { docs: Document[]; map: Map<string, Document> } | null = null;
function buildLegacyDocIndex(docs: Document[]): Map<string, Document> {
  if (legacyDocIndexCache && legacyDocIndexCache.docs === docs) {
    return legacyDocIndexCache.map;
  }
  const map = new Map<string, Document>();
  for (const d of docs) {
    // Doc id itself is the common case — invoiceId/quoteId lookups go here.
    if (!map.has(d.id)) map.set(d.id, d);
    if (d.legacyQuoteId && !map.has(d.legacyQuoteId)) map.set(d.legacyQuoteId, d);
    if (d.legacyInvoiceId && !map.has(d.legacyInvoiceId)) map.set(d.legacyInvoiceId, d);
  }
  legacyDocIndexCache = { docs, map };
  return map;
}

// Create the store
export const useStore = create<AppState>((set, get) => ({
  // Initial state
  businessSettings: null,
  quotes: [],
  currentQuote: null,
  pendingQuoteWrites: {},
  lastSyncError: null,
  setSyncError: (err) => set({ lastSyncError: err }),
  clearSyncError: () => set({ lastSyncError: null }),
  isOnboarded: false,
  hasSeenTour: false,
  seenScreenTours: [],
  subscriptionStatus: null,
  nextQuoteNumber: 1,
  invoices: [],
  currentInvoice: null,
  nextInvoiceNumber: 1,
  pendingInvoiceWrites: {},
  referralInfo: null,
  // Template material staging
  pendingTemplateMaterial: null,
  setPendingTemplateMaterial: (material) => set({ pendingTemplateMaterial: material }),

  contacts: [],
  contactsLoaded: false,
  xeroContacts: [],
  unifiedTourActive: false,
  unifiedTourPhase: null,
  unifiedTourQuoteId: null,
  documents: [],
  documentsLoaded: false,

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
      // silently ignore
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
      laborUnit: 'hours' as const,
      laborTotal: 0,
      materialsSubtotal: 0,
      markup: businessSettings?.defaultMarkup || 20,
      laborMarkup: businessSettings?.defaultLaborMarkup ?? businessSettings?.defaultMarkup ?? 20,
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
      // Phase-8: ensure a Job exists before the legacy quote hits Firestore —
      // the mirror carries jobId into the unified Document, and the trigger
      // needs an existing Job to update aggregates against.
      const withJob = await ensureJobForQuote(quote);
      const calculatedQuote = updateQuoteCalculations({
        ...withJob,
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
        // Track this write as pending so the realtime listener won't revert our
        // local edit if a stale snapshot arrives before the write is acknowledged.
        const writeTs = calculatedQuote.updatedAt.getTime();
        set((state) => ({
          pendingQuoteWrites: { ...state.pendingQuoteWrites, [calculatedQuote.id]: writeTs },
        }));

        firestoreService.saveQuote(calculatedQuote)
          .then(() => {
            // Clear the pending entry only if no NEWER write has been queued in
            // the meantime. If the user kept editing while we were syncing, leave
            // the newer pending entry in place so the listener still defers to local.
            set((state) => {
              if (state.pendingQuoteWrites[calculatedQuote.id] !== writeTs) return {};
              const { [calculatedQuote.id]: _, ...rest } = state.pendingQuoteWrites;
              // Also clear any lingering sync error for this quote on success.
              const clearError = state.lastSyncError?.kind === 'quote' && state.lastSyncError.id === calculatedQuote.id;
              return clearError
                ? { pendingQuoteWrites: rest, lastSyncError: null }
                : { pendingQuoteWrites: rest };
            });
          })
          .catch((err) => {
            // Leave the pending entry in place — the listener will keep deferring
            // to local until the next save attempt succeeds. Surface the error so
            // the user knows their edit isn't safely in the cloud yet.
            logSyncError('quote', calculatedQuote.id, err);
          });
      }
    } catch (error) {
      // silently ignore
    }
  },

  // Merge a remote snapshot of quotes into local state without clobbering unsynced edits.
  mergeRemoteQuotes: (remote: Quote[]) => {
    const { quotes: local, pendingQuoteWrites } = get();
    const localById = new Map(local.map((q) => [q.id, q] as const));
    const remoteIds = new Set<string>();
    const merged: Quote[] = [];

    for (const r of remote) {
      remoteIds.add(r.id);
      const localQ = localById.get(r.id);
      const pendingTs = pendingQuoteWrites[r.id];
      const remoteTs = r.updatedAt instanceof Date ? r.updatedAt.getTime() : 0;

      if (pendingTs && pendingTs > remoteTs && localQ) {
        // We have a newer in-flight local write — keep it.
        merged.push(localQ);
        continue;
      }

      if (
        localQ &&
        localQ.updatedAt instanceof Date &&
        localQ.updatedAt.getTime() > remoteTs
      ) {
        // Local is newer than the snapshot (e.g. our write landed but the listener
        // echoed an older revision first). Keep local.
        merged.push(localQ);
        continue;
      }

      merged.push(r);
    }

    // Locally created quotes that haven't yet been acknowledged by the listener.
    // Without this, a snapshot delivered before our write round-trips would erase them.
    for (const [id, q] of localById) {
      if (!remoteIds.has(id) && pendingQuoteWrites[id]) {
        merged.push(q);
      }
    }

    // Match the listener's existing ordering (newest first).
    merged.sort((a, b) => {
      const aTs = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bTs = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bTs - aTs;
    });

    // Reconcile the predicted next quote number against the merged set so
    // the preview header doesn't predict a value that collides with
    // Firestore. Cheap — one scan over the array.
    const reconciledNextNumber = reconcileNextNumber({
      items: merged,
      field: (q) => q.quoteNumber,
      prefix: 'Q',
      cached: get().nextQuoteNumber,
    });
    set({ quotes: merged, nextQuoteNumber: reconciledNextNumber });
  },

  // Save quote to storage
  saveQuote: async (quote: Quote) => {
    try {
      const { quotes, getNextQuoteNumber, subscriptionStatus } = get();

      // Phase-8: auto-create a Job on first save if one isn't linked already.
      const withJob = await ensureJobForQuote(quote);

      // Update or add quote
      const existingIndex = quotes.findIndex((q) => q.id === withJob.id);
      const isNewQuote = existingIndex < 0;
      let calculatedQuote = updateQuoteCalculations(withJob);

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
        // Track this write as pending so the listener won't revert our local copy
        // before the round-trip completes. Mirrors the saveDraft behaviour.
        const writeTs = calculatedQuote.updatedAt.getTime();
        set((state) => ({
          pendingQuoteWrites: { ...state.pendingQuoteWrites, [calculatedQuote.id]: writeTs },
        }));
        try {
          await firestoreService.saveQuote(calculatedQuote);
          set((state) => {
            if (state.pendingQuoteWrites[calculatedQuote.id] !== writeTs) return {};
            const { [calculatedQuote.id]: _, ...rest } = state.pendingQuoteWrites;
            const clearError = state.lastSyncError?.kind === 'quote' && state.lastSyncError.id === calculatedQuote.id;
            return clearError
              ? { pendingQuoteWrites: rest, lastSyncError: null }
              : { pendingQuoteWrites: rest };
          });
        } catch (syncError) {
          logSyncError('quote', calculatedQuote.id, syncError);
        }
      }

      // For new quotes when not authenticated, do client-side increment
      if (isNewQuote && !auth.currentUser) {
        const { incrementQuoteCount } = get();
        await incrementQuoteCount();
      }
    } catch (error) {
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
          // silently ignore
        }
      }
    } catch (error) {
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
          // silently ignore
        }
      }
    } catch (error) {
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
          // Backfill laborMarkup from material markup for legacy quotes
          const backfilled = cloudQuotes.map((q) =>
            q.laborMarkup === undefined ? { ...q, laborMarkup: q.markup } : q
          );
          // Save to local storage for offline access
          await AsyncStorage.setItem(
            STORAGE_KEYS.QUOTES,
            JSON.stringify(backfilled)
          );
          const reconciledNextNumber = reconcileNextNumber({
            items: backfilled,
            field: (q) => q.quoteNumber,
            prefix: 'Q',
            cached: get().nextQuoteNumber,
          });
          set({ quotes: backfilled, nextQuoteNumber: reconciledNextNumber });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.QUOTES);
      if (stored) {
        const parsed: Quote[] = JSON.parse(stored, (key, value) => {
          // Parse date strings back to Date objects
          if (key === 'createdAt' || key === 'updatedAt') {
            return new Date(value);
          }
          return value;
        });
        // Backfill laborMarkup from material markup for legacy quotes
        const quotes = parsed.map((q) =>
          q.laborMarkup === undefined ? { ...q, laborMarkup: q.markup } : q
        );
        const reconciledNextNumber = reconcileNextNumber({
          items: quotes,
          field: (q) => q.quoteNumber,
          prefix: 'Q',
          cached: get().nextQuoteNumber,
        });
        set({ quotes, nextQuoteNumber: reconciledNextNumber });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && quotes.length > 0) {
          for (const quote of quotes) {
            await firestoreService.saveQuote(quote);
          }
        }
      }
    } catch (error) {
      // silently ignore
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
      // silently ignore
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
      // silently ignore
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
        firestoreService.saveSubscriptionStatus(updatedSubscription).catch(() => {
          // silently ignore
        });
      }
    } catch (error) {
      // silently ignore
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
      // silently ignore
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
      // silently ignore
    }
  },

  // Tour
  setHasSeenTour: async (value: boolean) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TOUR_SEEN, JSON.stringify(value));
      set({ hasSeenTour: value });

      // Sync to Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.saveTourStatus(value);
      }
    } catch (error) {
      // silently ignore
    }
  },

  checkTourStatus: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudTourStatus = await firestoreService.loadTourStatus();
        if (cloudTourStatus !== null) {
          await AsyncStorage.setItem(STORAGE_KEYS.TOUR_SEEN, JSON.stringify(cloudTourStatus));
          set({ hasSeenTour: cloudTourStatus });
        } else {
          // Fallback to local, and sync up if local says seen
          const stored = await AsyncStorage.getItem(STORAGE_KEYS.TOUR_SEEN);
          if (stored) {
            const hasSeenTour = JSON.parse(stored);
            set({ hasSeenTour });
            if (hasSeenTour) {
              await firestoreService.saveTourStatus(hasSeenTour);
            }
          }
        }

        const cloudScreenTours = await firestoreService.loadSeenScreenTours();
        if (cloudScreenTours) {
          // Merge cloud and local screen tours
          const localStored = await AsyncStorage.getItem('@quotemate:seen_screen_tours');
          const localTours: string[] = localStored ? JSON.parse(localStored) : [];
          const merged = [...new Set([...localTours, ...cloudScreenTours])];
          await AsyncStorage.setItem('@quotemate:seen_screen_tours', JSON.stringify(merged));
          set({ seenScreenTours: merged });
          // Sync merged list back if local had extras
          if (merged.length > cloudScreenTours.length) {
            await firestoreService.saveSeenScreenTours(merged);
          }
        } else {
          const screenToursStored = await AsyncStorage.getItem('@quotemate:seen_screen_tours');
          if (screenToursStored) {
            const parsed = JSON.parse(screenToursStored);
            set({ seenScreenTours: parsed });
            if (parsed.length > 0) {
              await firestoreService.saveSeenScreenTours(parsed);
            }
          }
        }
        return;
      }

      // Fallback to local storage only
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.TOUR_SEEN);
      if (stored) {
        set({ hasSeenTour: JSON.parse(stored) });
      }
      const screenToursStored = await AsyncStorage.getItem('@quotemate:seen_screen_tours');
      if (screenToursStored) {
        set({ seenScreenTours: JSON.parse(screenToursStored) });
      }
    } catch (error) {
      // silently ignore
    }
  },

  markScreenTourSeen: async (tourId: string) => {
    try {
      const { seenScreenTours } = get();
      if (seenScreenTours.includes(tourId)) return;
      const updated = [...seenScreenTours, tourId];
      await AsyncStorage.setItem('@quotemate:seen_screen_tours', JSON.stringify(updated));
      set({ seenScreenTours: updated });

      // Sync to Firestore if user is signed in
      if (auth.currentUser) {
        await firestoreService.saveSeenScreenTours(updated);
      }
    } catch (error) {
      // silently ignore
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
      // silently ignore
    }
  },

  getNextQuoteNumber: async () => {
    // Reconcile against the actually-persisted quote numbers so a fresh
    // install / second device doesn't restart the counter from Q-001
    // (see utils/nextNumber.ts for the why).
    const { nextQuoteNumber: cached, quotes } = get();
    const next = reconcileNextNumber({
      items: quotes,
      field: (q) => q.quoteNumber,
      prefix: 'Q',
      cached,
    });
    const quoteNumber = `Q-${String(next).padStart(3, '0')}`;

    // Increment and save for next time
    const newNextQuoteNumber = next + 1;
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
      laborUnit: 'hours' as const,
      laborTotal: 0,
      materialsSubtotal: 0,
      markup: businessSettings?.defaultMarkup || 20,
      laborMarkup: businessSettings?.defaultLaborMarkup ?? businessSettings?.defaultMarkup ?? 20,
      markupAmount: 0,
      subtotal: 0,
      gst: 0,
      total: 0,
      status: 'draft',
      paymentTerms: 'net_14',
    };

    set({ currentInvoice: newInvoice });
  },

  createInvoiceFromQuote: async (quote: Quote) => {
    // Phase-5: prefer the unified convertDocumentToInvoice path when a
    // matching document exists (server canonicalises via setDocumentStage,
    // mirror trigger projects to the legacy invoices collection).
    const matchingDoc = get().getDocumentByLegacyId(quote.id);
    if (matchingDoc && matchingDoc.type === 'quote' && !matchingDoc.invoicedAt) {
      try {
        const converted = await get().convertDocumentToInvoice(matchingDoc.id);
        const invoice: Invoice = (await import('../types/documentAdapter')).documentToInvoice(converted);
        set({ currentInvoice: invoice });
        return invoice;
      } catch {
        // Fall through to the legacy path on failure.
      }
    }

    // Idempotency: if this quote has already been invoiced, return the
    // existing invoice instead of minting a duplicate. Tapping Convert twice
    // (or doing it on two devices) used to spawn two invoices and the
    // customer would receive two payment links for the same job.
    if (quote.invoiceId) {
      const { invoices } = get();
      const existing = invoices.find((i) => i.id === quote.invoiceId);
      if (existing) {
        set({ currentInvoice: existing });
        return existing;
      }
      // invoiceId set but the invoice is gone (deleted) — fall through and
      // mint a fresh one. The back-reference will be overwritten below.
    }

    const now = new Date();
    // If the customer paid a deposit against this quote, deduct it from the
    // invoice total. The deposit is rendered as a credit line on the PDF/email
    // ("Deposit of $X already paid"). depositPaid wins over depositAmount —
    // we only credit money actually received, not what was *supposed* to be paid.
    const depositCredit = Math.max(0, Number(quote.depositPaid) || 0);
    const adjustedTotal = Math.max(0, (quote.total || 0) - depositCredit);
    const newInvoice: Invoice = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      issueDate: now,
      dueDate: calculateDueDate(now, 'net_14'),
      contactId: quote.contactId,
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
      laborUnit: quote.laborUnit,
      laborTotal: quote.laborTotal,
      sections: quote.sections,
      materialsSubtotal: quote.materialsSubtotal,
      markup: quote.markup,
      laborMarkup: quote.laborMarkup ?? quote.markup,
      markupAmount: quote.markupAmount,
      subtotal: quote.subtotal,
      gst: quote.gst,
      total: adjustedTotal,
      status: 'draft',
      paymentTerms: 'net_14',
      sourceQuoteId: quote.id,
      notes: quote.notes,
      ...(depositCredit > 0
        ? { depositCredit, depositCreditFromQuoteId: quote.id }
        : {}),
    };

    set({ currentInvoice: newInvoice });

    // Stamp the back-reference on the source quote so subsequent convert
    // taps short-circuit. Use the existing saveQuote so AsyncStorage +
    // Firestore + the realtime listener stay consistent.
    const { saveQuote } = get();
    const sourceQuote = get().quotes.find((q) => q.id === quote.id);
    if (sourceQuote) {
      try {
        await saveQuote({
          ...sourceQuote,
          invoiceId: newInvoice.id,
          invoicedAt: now,
          updatedAt: now,
        });
      } catch {
        // Non-fatal — the invoice is still created locally; the back-ref
        // can re-stamp on the next save. Re-converting before the back-ref
        // lands will create a duplicate, but that's the existing behaviour.
      }
    }

    return newInvoice;
  },

  setCurrentInvoice: (invoice: Invoice | null) => {
    set({ currentInvoice: invoice });
  },

  updateInvoice: (invoice: Invoice) => {
    // Heal legacy broken-labour invoices the same way quotes are healed.
    const healed = healBrokenLabourSections(invoice);
    // Apply same calculations as quotes — sections-aware (plus optional extra
    // labour hours added on top of section sums), with separate material + labor markup
    const extraHours = healed.laborExtraHours ?? 0;
    const laborTotal = healed.sections && healed.sections.length > 0
      ? healed.sections.reduce((sum, s) => sum + s.laborTotal, 0) + (extraHours * healed.laborRate)
      : healed.laborRate * healed.laborHours;
    const materialsSubtotal = healed.materials.reduce((sum, m) => sum + m.totalPrice, 0);
    const subtotal = laborTotal + materialsSubtotal;
    const laborMarkupPercent = healed.laborMarkup ?? healed.markup ?? 0;
    const markupAmount =
      materialsSubtotal * (healed.markup / 100) + laborTotal * (laborMarkupPercent / 100);
    const subtotalWithMarkup = subtotal + markupAmount;
    const gst = subtotalWithMarkup * 0.1;
    const total = subtotalWithMarkup + gst;

    set({
      currentInvoice: {
        ...healed,
        laborTotal,
        materialsSubtotal,
        subtotal,
        markupAmount,
        gst,
        total,
      },
    });
  },

  saveInvoice: async (invoice: Invoice) => {
    try {
      const { invoices, getNextInvoiceNumber } = get();

      // Phase-8: auto-create a Job on first save if one isn't linked already.
      // Converted-from-quote invoices already carry jobId, so this is a no-op
      // for that common path.
      const withJob = await ensureJobForQuote(invoice);

      const existingIndex = invoices.findIndex((i) => i.id === withJob.id);
      const isNewInvoice = existingIndex < 0;
      let updatedInvoice = { ...withJob, updatedAt: new Date() };

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
        // Track this write as pending so the realtime invoice listener won't
        // revert our local edit before the round-trip completes.
        const writeTs = updatedInvoice.updatedAt.getTime();
        set((state) => ({
          pendingInvoiceWrites: { ...state.pendingInvoiceWrites, [updatedInvoice.id]: writeTs },
        }));
        try {
          await firestoreService.saveInvoice(updatedInvoice);
          set((state) => {
            const updates: Partial<AppState> = {};
            if (state.pendingInvoiceWrites[updatedInvoice.id] === writeTs) {
              const { [updatedInvoice.id]: _, ...rest } = state.pendingInvoiceWrites;
              updates.pendingInvoiceWrites = rest;
            }
            if (state.lastSyncError?.kind === 'invoice' && state.lastSyncError.id === updatedInvoice.id) {
              updates.lastSyncError = null;
            }
            return updates;
          });
        } catch (syncError) {
          logSyncError('invoice', updatedInvoice.id, syncError);
        }
      }
    } catch (error) {
      throw error;
    }
  },

  // Merge a remote snapshot of invoices into local state without clobbering unsynced edits.
  // Mirrors mergeRemoteQuotes — same per-id rules.
  mergeRemoteInvoices: (remote: Invoice[]) => {
    const { invoices: local, pendingInvoiceWrites } = get();
    const localById = new Map(local.map((i) => [i.id, i] as const));
    const remoteIds = new Set<string>();
    const merged: Invoice[] = [];

    for (const r of remote) {
      remoteIds.add(r.id);
      const localI = localById.get(r.id);
      const pendingTs = pendingInvoiceWrites[r.id];
      const remoteTs = r.updatedAt instanceof Date ? r.updatedAt.getTime() : 0;

      if (pendingTs && pendingTs > remoteTs && localI) {
        merged.push(localI);
        continue;
      }

      if (
        localI &&
        localI.updatedAt instanceof Date &&
        localI.updatedAt.getTime() > remoteTs
      ) {
        merged.push(localI);
        continue;
      }

      merged.push(r);
    }

    for (const [id, i] of localById) {
      if (!remoteIds.has(id) && pendingInvoiceWrites[id]) {
        merged.push(i);
      }
    }

    merged.sort((a, b) => {
      const aTs = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bTs = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bTs - aTs;
    });

    const reconciledNextNumber = reconcileNextNumber({
      items: merged,
      field: (i) => i.invoiceNumber,
      prefix: 'INV',
      cached: get().nextInvoiceNumber,
    });
    set({ invoices: merged, nextInvoiceNumber: reconciledNextNumber });
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
          // silently ignore
        }
      }
    } catch (error) {
      throw error;
    }
  },

  loadInvoices: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudInvoices = await firestoreService.loadInvoices();
        if (cloudInvoices.length > 0) {
          // Backfill laborMarkup from material markup for legacy invoices
          const backfilled = cloudInvoices.map((i) =>
            i.laborMarkup === undefined ? { ...i, laborMarkup: i.markup } : i
          );
          // Save to local storage for offline access
          await AsyncStorage.setItem(
            STORAGE_KEYS.INVOICES,
            JSON.stringify(backfilled)
          );
          const reconciledNextNumber = reconcileNextNumber({
            items: backfilled,
            field: (i) => i.invoiceNumber,
            prefix: 'INV',
            cached: get().nextInvoiceNumber,
          });
          set({ invoices: backfilled, nextInvoiceNumber: reconciledNextNumber });
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.INVOICES);
      if (stored) {
        const parsed: Invoice[] = JSON.parse(stored, (key, value) => {
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
        // Backfill laborMarkup from material markup for legacy invoices
        const invoices = parsed.map((i) =>
          i.laborMarkup === undefined ? { ...i, laborMarkup: i.markup } : i
        );
        const reconciledNextNumber = reconcileNextNumber({
          items: invoices,
          field: (i) => i.invoiceNumber,
          prefix: 'INV',
          cached: get().nextInvoiceNumber,
        });
        set({ invoices, nextInvoiceNumber: reconciledNextNumber });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && invoices.length > 0) {
          for (const invoice of invoices) {
            await firestoreService.saveInvoice(invoice);
          }
        }
      }
    } catch (error) {
      // silently ignore
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
      // silently ignore
    }
  },

  getNextInvoiceNumber: async () => {
    // Reconcile against the actually-persisted invoice numbers —
    // mirror of getNextQuoteNumber's handling.
    const { nextInvoiceNumber: cached, invoices } = get();
    const next = reconcileNextNumber({
      items: invoices,
      field: (i) => i.invoiceNumber,
      prefix: 'INV',
      cached,
    });
    const invoiceNumber = `INV-${String(next).padStart(3, '0')}`;

    // Increment and save for next time
    const newNextInvoiceNumber = next + 1;
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
          // silently ignore
        }
      }
    } catch (error) {
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
        // Clear Xero sync (new invoice needs fresh sync)
        xeroInvoiceId: undefined,
        xeroContactId: undefined,
        xeroSyncStatus: undefined,
        xeroSyncedAt: undefined,
        xeroSyncError: undefined,
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
          // silently ignore
        }
      }

      return duplicatedInvoice;
    } catch (error) {
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
      // silently ignore
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
        // silently ignore
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
        // silently ignore
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

  // Contacts
  loadContacts: async () => {
    try {
      // If user is signed in, try loading from Firestore first
      if (auth.currentUser) {
        const cloudContacts = await firestoreService.loadContacts();
        if (cloudContacts.length > 0) {
          await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(cloudContacts));
          set({ contacts: cloudContacts, contactsLoaded: true });

          // Run migration check after loading
          const migrated = await AsyncStorage.getItem(STORAGE_KEYS.CONTACTS_MIGRATED);
          if (!migrated) {
            await get().migrateCustomersToContacts();
          }
          return;
        }
      }

      // Fallback to local storage
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CONTACTS);
      if (stored) {
        const contacts: Contact[] = JSON.parse(stored);
        set({ contacts, contactsLoaded: true });

        // Sync to cloud if user is signed in but no cloud data exists
        if (auth.currentUser && contacts.length > 0) {
          await firestoreService.saveContacts(contacts);
        }
      } else {
        set({ contactsLoaded: true });
      }

      // Run migration check
      const migrated = await AsyncStorage.getItem(STORAGE_KEYS.CONTACTS_MIGRATED);
      if (!migrated) {
        await get().migrateCustomersToContacts();
      }
    } catch (error) {
      set({ contactsLoaded: true });
    }
  },

  saveContact: async (contact: Contact) => {
    try {
      const { contacts, quotes, invoices } = get();
      const existingIndex = contacts.findIndex((c) => c.id === contact.id);
      const updated =
        existingIndex >= 0
          ? contacts.map((c) => (c.id === contact.id ? contact : c))
          : [...contacts, contact];

      await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(updated));
      set({ contacts: updated });

      if (auth.currentUser) {
        firestoreService.saveContact(contact).catch(() => {});
      }

      // Sync snapshot fields on linked quotes and invoices
      const linkedQuotes = quotes.filter((q) => q.contactId === contact.id);
      if (linkedQuotes.length > 0) {
        const updatedQuotes = quotes.map((q) =>
          q.contactId === contact.id
            ? { ...q, customerName: contact.name, customerEmail: contact.email, customerPhone: contact.phone, jobAddress: contact.address || q.jobAddress }
            : q
        );
        await AsyncStorage.setItem(STORAGE_KEYS.QUOTES, JSON.stringify(updatedQuotes));
        set({ quotes: updatedQuotes });
        if (auth.currentUser) {
          for (const q of updatedQuotes.filter((q) => q.contactId === contact.id)) {
            firestoreService.saveQuote(q).catch(() => {});
          }
        }
      }

      const linkedInvoices = invoices.filter((i) => i.contactId === contact.id);
      if (linkedInvoices.length > 0) {
        const updatedInvoices = invoices.map((i) =>
          i.contactId === contact.id
            ? { ...i, customerName: contact.name, customerEmail: contact.email, customerPhone: contact.phone, jobAddress: contact.address || i.jobAddress }
            : i
        );
        await AsyncStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(updatedInvoices));
        set({ invoices: updatedInvoices });
        if (auth.currentUser) {
          for (const i of updatedInvoices.filter((i) => i.contactId === contact.id)) {
            firestoreService.saveInvoice(i).catch(() => {});
          }
        }
      }
    } catch (error) {
      throw error;
    }
  },

  deleteContact: async (contactId: string) => {
    try {
      const { contacts } = get();
      const updated = contacts.filter((c) => c.id !== contactId);

      await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(updated));
      set({ contacts: updated });

      if (auth.currentUser) {
        firestoreService.deleteContact(contactId).catch(() => {});
      }
    } catch (error) {
      throw error;
    }
  },

  importContacts: async (newContacts: Contact[]) => {
    try {
      const { contacts } = get();
      const all = [...contacts, ...newContacts];

      await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(all));
      set({ contacts: all });

      if (auth.currentUser) {
        firestoreService.saveContacts(newContacts).catch(() => {});
      }
    } catch (error) {
      throw error;
    }
  },

  syncXeroContacts: async () => {
    try {
      const xeroService = await import('../services/xeroService');
      const xeroContacts = await xeroService.fetchXeroContacts();
      set({ xeroContacts });
    } catch (error) {
      throw error;
    }
  },

  migrateCustomersToContacts: async () => {
    try {
      const { quotes, invoices, contacts } = get();
      const existingNames = new Set(contacts.map((c) => c.name.toLowerCase().trim()));
      const customerMap = new Map<string, { name: string; email?: string; phone?: string; address?: string; xeroContactId?: string }>();

      // Extract from quotes
      for (const quote of quotes) {
        const key = quote.customerName.toLowerCase().trim();
        if (key && !existingNames.has(key) && !customerMap.has(key)) {
          customerMap.set(key, {
            name: quote.customerName,
            email: quote.customerEmail,
            phone: quote.customerPhone,
            address: quote.jobAddress,
          });
        }
      }

      // Extract from invoices (may have xeroContactId)
      for (const invoice of invoices) {
        const key = invoice.customerName.toLowerCase().trim();
        if (key && !existingNames.has(key)) {
          const existing = customerMap.get(key);
          if (existing) {
            if (invoice.xeroContactId) existing.xeroContactId = invoice.xeroContactId;
            if (!existing.email && invoice.customerEmail) existing.email = invoice.customerEmail;
            if (!existing.phone && invoice.customerPhone) existing.phone = invoice.customerPhone;
          } else {
            customerMap.set(key, {
              name: invoice.customerName,
              email: invoice.customerEmail,
              phone: invoice.customerPhone,
              address: invoice.jobAddress,
              xeroContactId: invoice.xeroContactId,
            });
          }
        }
      }

      if (customerMap.size > 0) {
        const { createContact } = await import('../services/contactService');
        const newContacts: Contact[] = Array.from(customerMap.values()).map((c) =>
          createContact({
            name: c.name,
            email: c.email,
            phone: c.phone,
            address: c.address,
            source: 'quote',
            xeroContactId: c.xeroContactId,
          })
        );

        await get().importContacts(newContacts);
      }

      await AsyncStorage.setItem(STORAGE_KEYS.CONTACTS_MIGRATED, 'true');
    } catch (error) {
      // silently ignore
    }
  },

  // Xero integration
  xeroConnection: null,
  xeroLoading: false,

  loadXeroConnection: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.XERO_CONNECTION);
      if (stored) {
        set({ xeroConnection: JSON.parse(stored) });
      }
    } catch (error) {
      // silently ignore
    }
  },

  setXeroConnection: (connection: XeroConnection | null) => {
    set({ xeroConnection: connection });
    if (connection) {
      AsyncStorage.setItem(STORAGE_KEYS.XERO_CONNECTION, JSON.stringify(connection)).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEYS.XERO_CONNECTION).catch(() => {});
    }
  },

  pushInvoiceToXero: async (invoice: Invoice) => {
    const { invoices } = get();
    const xeroService = await import('../services/xeroService');

    // Mark as syncing
    const syncingInvoices = invoices.map((i) =>
      i.id === invoice.id ? { ...i, xeroSyncStatus: 'syncing' as XeroSyncStatus } : i
    );
    set({ invoices: syncingInvoices });

    try {
      const result = await xeroService.pushInvoiceToXero(invoice);

      // Update invoice with Xero IDs
      const updatedInvoice: Invoice = {
        ...invoice,
        xeroInvoiceId: result.xeroInvoiceId,
        xeroContactId: result.xeroContactId,
        xeroSyncStatus: 'synced' as XeroSyncStatus,
        xeroSyncedAt: new Date(),
        xeroSyncError: undefined,
        updatedAt: new Date(),
      };

      const updatedInvoices = get().invoices.map((i) =>
        i.id === invoice.id ? updatedInvoice : i
      );

      await AsyncStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(updatedInvoices));
      set({ invoices: updatedInvoices });

      // Update Xero connection last sync time
      const { xeroConnection } = get();
      if (xeroConnection) {
        const updatedConnection = { ...xeroConnection, lastSyncAt: new Date().toISOString() };
        set({ xeroConnection: updatedConnection });
        await AsyncStorage.setItem(STORAGE_KEYS.XERO_CONNECTION, JSON.stringify(updatedConnection));
      }
    } catch (error: any) {
      // Mark as error
      const errorInvoices = get().invoices.map((i) =>
        i.id === invoice.id
          ? { ...i, xeroSyncStatus: 'error' as XeroSyncStatus, xeroSyncError: error.message || 'Sync failed' }
          : i
      );
      await AsyncStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(errorInvoices));
      set({ invoices: errorInvoices });
      throw error;
    }
  },

  pushPaymentToXero: async (invoiceId: string, xeroInvoiceId: string, amount: number, date: Date, method?: string) => {
    const xeroService = await import('../services/xeroService');
    await xeroService.pushPaymentToXero(invoiceId, xeroInvoiceId, amount, date, method);
  },

  xeroBulkSync: async (invoiceIds: string[]) => {
    set({ xeroLoading: true });
    try {
      const xeroService = await import('../services/xeroService');
      const result = await xeroService.xeroBulkSync(invoiceIds);

      // Reload invoices to get updated Xero fields from Firestore
      const { loadInvoices } = get();
      await loadInvoices();

      return { successCount: result.successCount, totalCount: result.totalCount };
    } finally {
      set({ xeroLoading: false });
    }
  },

  // Unified Documents
  loadDocuments: async () => {
    if (!auth.currentUser) return;
    try {
      const docs = await documentService.loadDocuments();
      set({ documents: docs, documentsLoaded: true });
    } catch {
      set({ documentsLoaded: true });
    }
  },

  listenToDocuments: () => {
    if (!auth.currentUser) return;
    documentService.listenToDocuments((documents) => {
      set({ documents, documentsLoaded: true });
    });
  },

  saveDocument: async (document: Document) => {
    // Phase-8: auto-create a Job if this doc isn't linked to one yet. The
    // server trigger (onDocumentWriteSyncJob) needs an existing Job before
    // aggregates can land — so we create it client-side before the save.
    const withJob = await ensureJobForDocument(document);
    const next = { ...withJob, updatedAt: Date.now() };
    // Optimistic local update
    set((state) => {
      const existing = state.documents.findIndex((d) => d.id === next.id);
      const documents = existing >= 0
        ? state.documents.map((d, i) => (i === existing ? next : d))
        : [...state.documents, next];
      return { documents };
    });
    if (auth.currentUser) {
      try {
        await documentService.saveDocument(next);
      } catch (err) {
        logSyncError(next.type === 'invoice' ? 'invoice' : 'quote', next.id, err);
      }
    }
  },

  getDocumentById: (id: string) => {
    return get().documents.find((d) => d.id === id);
  },

  getDocumentByLegacyId: (legacyId: string) => {
    const docs = get().documents;
    const index = buildLegacyDocIndex(docs);
    return index.get(legacyId);
  },

  convertDocumentToInvoice: async (documentId: string) => {
    const existing = get().getDocumentById(documentId);
    if (!existing) {
      throw new Error('Document not found');
    }
    // Idempotent: already an invoice — short-circuit before any RPC.
    if (existing.type === 'invoice' || existing.invoicedAt) {
      return existing;
    }
    // Stamp client-side first so the UI updates immediately, then ask the
    // server to canonicalise via setDocumentStage. The server is the source
    // of truth for the stage transition; the optimistic update keeps the
    // dashboard responsive on slow connections.
    const now = Date.now();
    const depositCredit = Math.max(0, Number(existing.depositPaid) || 0);
    const adjustedTotal = Math.max(0, (existing.total || 0) - depositCredit);
    const invoiceNumber = await get().getNextInvoiceNumber();
    const optimistic: Document = {
      ...existing,
      type: 'invoice',
      stage: 'invoice_sent',
      number: invoiceNumber,
      invoicedAt: now,
      issueDate: now,
      dueDate: calculateDueDate(new Date(now), 'net_14').getTime(),
      paymentTerms: 'net_14',
      total: adjustedTotal,
      legacyInvoiceId: existing.id,
      updatedAt: now,
    };
    set((state) => ({
      documents: state.documents.map((d) => (d.id === documentId ? optimistic : d)),
    }));
    if (auth.currentUser) {
      try {
        const { httpsCallable, getFunctions } = await import('firebase/functions');
        const fn = httpsCallable(getFunctions(), 'convertDocumentToInvoice');
        await fn({ documentId, invoiceNumber });
      } catch (err) {
        // Server failed — keep the optimistic state but log so the user can
        // retry. Mirror trigger will reconcile on the next legacy write.
        logSyncError('invoice', documentId, err);
      }
    }
    return optimistic;
  },

  // Clear all data (for logout)
  clearAllData: async () => {
    try {
      // Clear AsyncStorage
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.QUOTES,
        STORAGE_KEYS.BUSINESS_SETTINGS,
        STORAGE_KEYS.ONBOARDED,
        STORAGE_KEYS.SUBSCRIPTION,
        STORAGE_KEYS.INVOICES,
        STORAGE_KEYS.NEXT_QUOTE_NUMBER,
        STORAGE_KEYS.NEXT_INVOICE_NUMBER,
        STORAGE_KEYS.TOUR_SEEN,
        STORAGE_KEYS.XERO_CONNECTION,
        STORAGE_KEYS.CONTACTS,
        STORAGE_KEYS.CONTACTS_MIGRATED,
        '@quotemate:seen_screen_tours',
      ]);
      // Reset store state to initial values
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
        xeroConnection: null,
        xeroLoading: false,
        contacts: [],
        contactsLoaded: false,
        xeroContacts: [],
        documents: [],
        documentsLoaded: false,
      });
    } catch (error) {
      throw error;
    }
  },
}));
