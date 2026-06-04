/**
 * Global state management with Zustand
 * Handles quotes, business settings, and persistence
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { Quote, BusinessSettings, Material, SubscriptionStatus, Invoice, PaymentMethod, ReferralInfo, XeroConnection, XeroSyncStatus, Contact } from '../types';
import { Document } from '../types/document';
import {
  ChatMessage,
  Conversation,
  Proposal,
  ProposalStatus,
  WorkingStatus,
} from '../types/assistant';
import {
  generateMaterialsForQuote,
  fetchPricesForQuote,
  PipelineCancelled,
  PricingEvent,
} from '../services/materialsPipeline';
import { reviewQuoteMaterials, isFlaggedRow, QuoteReview } from '../utils/quoteReview';
import { loadTemplates } from '../services/sectionTemplateService';
import { updateQuoteCalculations, healBrokenLabourSections } from '../utils/quoteCalculator';
import { calculateDueDate } from '../utils/invoiceCalculator';
import { reconcileNextNumber } from '../utils/nextNumber';
import { firestoreService, ASSISTANT_LOGGING_ENABLED } from '../services/firestoreService';
import { documentService } from '../services/documentService';
// Static import — see note on the call sites below. Dynamic `import()` here
// (the previous shape) created a Metro lazy chunk that, in Android dev with
// Hermes + Fast Refresh, re-evaluated module boundaries when the chunk loaded
// after sign-in. That re-ran App.tsx's auth useEffect (unsubscribe →
// resubscribe → full data load) and put the user through splash → home —
// "the app rebooted itself a few seconds after Xero kicked off". Static
// import bundles xeroService into the main graph and dodges the issue.
import * as xeroService from '../services/xeroService';
import { TRIAL_MS } from '../utils/trialConfig';
import { trackEvent } from '../services/analyticsService';
import { ensureJobForDocument, ensureJobForQuote, useJobStore } from './useJobStore';
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
  /**
   * Resolved tier: re-derives from `plan`/trial state at call time so an
   * expired trial that hasn't yet been written back is reported as 'free'
   * (without Square) or 'free' once Square is connected. Falls back to
   * 'trial' when no subscription has loaded yet so first-render doesn't
   * gate behaviour for new users.
   */
  getEffectivePlan: () => 'trial' | 'free' | 'pro';
  /** True iff the trial window has elapsed and the user is not yet Pro. */
  isTrialExpired: () => boolean;
  /** Persist that the user closed the dashboard upgrade banner. */
  dismissUpgradeBanner: () => Promise<void>;

  // Onboarding
  isOnboarded: boolean;
  setOnboarded: (value: boolean) => Promise<void>;
  checkOnboarding: () => Promise<void>;

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
  pushQuoteToXero: (quote: Quote) => Promise<void>;
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
  /**
   * Clone a Document for a new Job (Duplicate flow). Keeps scope/labor/
   * materials/terms; resets stage to quote_accepted, money state to zero,
   * pay-link fields to undefined, and reassigns jobId to the new Job.
   * Returns the cloned Document.
   */
  duplicateDocumentForJob: (
    sourceDocumentId: string,
    newJobId: string,
  ) => Promise<Document>;

  // Mate assistant — chat history lives client-only in v1. The model never
  // writes here directly; it returns Proposal payloads that applyProposal
  // routes through the existing store actions.
  conversations: Conversation[];
  currentConversationId: string | null;
  startConversation: () => string;
  endConversation: () => void;
  /**
   * Discard the current chat and start a blank one. We don't keep chat
   * history — the durable output is the quote/job/invoice, and transcripts
   * still sync to Firestore for admin review. Returns the new id.
   */
  newChat: () => string;
  appendMessage: (conversationId: string, message: ChatMessage) => void;
  /**
   * Patch a single message in place — used to update a "working" card as
   * pipeline events arrive (analyse → building → done) without spawning a
   * new bubble per phase.
   */
  updateMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void;
  updateProposalStatus: (
    conversationId: string,
    messageId: string,
    proposalId: string,
    status: ProposalStatus,
  ) => void;
  // (chat history is in-memory only — no load-from-disk; see newChat)
  // Apply a proposal through the existing store actions. Returns a follow-up
  // hint the caller can use to drive navigation — keeps the store free of
  // navigation imports. The optional onProgress callback receives pipeline
  // events for proposals that run the materials pipeline (draft quote);
  // the AssistantScreen wires it into a working-card message so the user
  // sees what's happening without leaving the chat.
  applyProposal: (
    proposal: Proposal,
    onProgress?: (status: WorkingStatus) => void,
  ) => Promise<ApplyProposalResult>;

  // Cleanup
  clearAllData: () => Promise<void>;
}

export type ApplyProposalResult =
  | { ok: true; navigate?: NavigateHint; note?: string; review?: QuoteReview }
  | { ok: false; error: string };

export type NavigateHint =
  | { kind: 'job_preview'; quoteId: string }
  | { kind: 'quote_materials_list'; quoteId: string }
  | { kind: 'open_send_modal'; documentId: string; recipientEmail?: string }
  | { kind: 'open_contact'; contactId: string }
  | { kind: 'open_invoice'; invoiceId: string };

// Storage keys
const STORAGE_KEYS = {
  QUOTES: '@quotemate:quotes',
  BUSINESS_SETTINGS: '@quotemate:business_settings',
  ONBOARDED: '@quotemate:onboarded',
  SUBSCRIPTION: '@quotemate:subscription',
  NEXT_QUOTE_NUMBER: '@quotemate:next_quote_number',
  INVOICES: '@quotemate:invoices',
  NEXT_INVOICE_NUMBER: '@quotemate:next_invoice_number',
  XERO_CONNECTION: '@quotemate:xero_connection',
  CONTACTS: '@quotemate:contacts',
  CONTACTS_MIGRATED: '@quotemate:contacts_migrated',
  CONVERSATIONS: '@quotemate:mate_conversations',
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

/**
 * Recursively replace NaN/Infinity numeric fields with 0 so Firestore's JS
 * SDK doesn't reject the write. Mutates in place. Logs the path of every
 * scrubbed field so we can find the upstream calc that produced the bad
 * number. Skips Date and Array-of-non-object values to keep traversal cheap.
 *
 * Why this lives here: previously a single NaN anywhere in a Quote would
 * trip `setDoc(...)` silently — Firestore rejects, the .catch logs a sync
 * error, the user sees no UI feedback, and ensureJobForQuote has already
 * created a Job. The result: orphan jobs in production with no linked
 * quote/invoice. This scrub keeps the save path resilient.
 */
function sanitizeNonFiniteNumbers(target: any, label: string, path: string = ''): void {
  if (target === null || target === undefined) return;
  if (target instanceof Date) return;
  if (Array.isArray(target)) {
    target.forEach((v, i) => sanitizeNonFiniteNumbers(v, label, `${path}[${i}]`));
    return;
  }
  if (typeof target !== 'object') return;
  for (const key of Object.keys(target)) {
    const value = target[key];
    if (typeof value === 'number' && !Number.isFinite(value)) {
      // eslint-disable-next-line no-console
      console.warn(`[sanitize] ${label}: ${path}${path ? '.' : ''}${key} was ${value} → 0`);
      target[key] = 0;
    } else if (value && typeof value === 'object') {
      sanitizeNonFiniteNumbers(value, label, `${path}${path ? '.' : ''}${key}`);
    }
  }
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

// Map free-form units from Mate proposals to the strict Material unit union.
// The model is allowed to emit "m2"/"sqm"/"hr"/"L" — we coerce to the closest
// known unit so the wizard's calculator doesn't choke on an unknown literal.
function normalizeMaterialUnit(raw: string): Material['unit'] {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return 'each';
  if (s === 'm2' || s === 'sqm' || s === 'sq m' || s === 'm²') return 'm²';
  if (s === 'm3' || s === 'm³' || s === 'cubic m') return 'm³';
  if (s === 'm' || s === 'metre' || s === 'meter' || s === 'metres' || s === 'lm' || s === 'lin m') return 'm';
  if (s === 'kg' || s === 'kilogram' || s === 'kilograms') return 'kg';
  if (s === 'l' || s === 'litre' || s === 'liter' || s === 'litres') return 'L';
  if (s === 'box' || s === 'boxes') return 'box';
  if (s === 'pack' || s === 'packs') return 'pack';
  return 'each';
}

// Map a pricing-pipeline event onto a partial WorkingStatus update. Shared by
// the draft and reprice apply paths so their chat progress cards read the same;
// `status` carries the slow-changing phase headline, `detail` the rapid per-item
// progress (kept separate so fast item events don't blow away the headline).
function pricingEventToProgress(event: PricingEvent): Partial<WorkingStatus> | null {
  if (event.kind === 'phase-start') {
    // Clear the per-item list when we move off the batch phase so stale
    // "Searching…" rows don't linger into reconcile/individual passes.
    return {
      phase: 'pricing',
      status: event.status,
      detail: undefined,
      // Clear the per-item list on every phase boundary — the next
      // batch-chunk event repopulates it, and non-batch phases shouldn't
      // carry stale rows.
      items: undefined,
    };
  }
  if (event.kind === 'batch-chunk') {
    return {
      status:
        event.currentName || `Checking Bunnings (batch ${event.chunkIndex} of ${event.totalChunks})…`,
      detail: `${event.progress.current}/${event.progress.total} items priced`,
      items: event.items,
    };
  }
  if (event.kind === 'item-priced') {
    const progressLine = event.progress
      ? `${event.progress.current}/${event.progress.total} priced`
      : undefined;
    const itemLine = event.success
      ? `${progressLine ? progressLine + ' · ' : ''}Just priced ${event.name}`
      : `${progressLine ? progressLine + ' · ' : ''}Couldn't find ${event.name}`;
    return { detail: itemLine };
  }
  if (event.kind === 'reconcile-start') {
    return { status: 'Sorting pack sizes and quantities…', detail: 'Mate is double-checking every line.' };
  }
  if (event.kind === 'reece-reauth') {
    return { status: 'Reece sign-in expired — sort it in Settings to use Reece prices.', detail: undefined };
  }
  return null;
}

// Wipe the price off every row the review flags (no price, AI estimate,
// low-confidence) so fetchPrices re-fetches them — it skips any row already at
// price > 0. Manual overrides and confident rows are never flagged, so they're
// left exactly as they were. requiredQty is preserved so pack rounding still works.
function resetFlaggedRowsForReprice(materials: Material[]): { materials: Material[]; resetCount: number } {
  let resetCount = 0;
  const next = materials.map((m) => {
    if (!isFlaggedRow(m)) return m;
    resetCount++;
    return { ...m, price: 0, totalPrice: 0, priceConfidence: undefined, pricingSource: undefined };
  });
  return { materials: next, resetCount };
}

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
// --- Mate conversation telemetry -----------------------------------------
// Mirror Mate conversations to Firestore so transcripts + proposal outcomes
// can be reviewed to tune accuracy. Streaming text deltas (voice especially)
// call appendMessage/updateMessage many times per turn, so coalesce the burst
// into a single write that fires once activity settles and reads the latest
// conversation state at flush time — never the intermediate half-streamed
// bubbles. Timers live outside the store so the non-serializable handles never
// land in state.
const ASSISTANT_SYNC_DEBOUNCE_MS = 4000;
const assistantSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleConversationSync(conversationId: string, get: () => AppState): void {
  if (!ASSISTANT_LOGGING_ENABLED) return;
  const pending = assistantSyncTimers.get(conversationId);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    assistantSyncTimers.delete(conversationId);
    const convo = get().conversations.find((c) => c.id === conversationId);
    if (convo) void firestoreService.saveConversation(convo);
  }, ASSISTANT_SYNC_DEBOUNCE_MS);
  assistantSyncTimers.set(conversationId, timer);
}

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
  documents: [],
  documentsLoaded: false,
  conversations: [],
  currentConversationId: null,

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
    trackEvent('quote_started', { source: 'new_quote' });
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
      pricesIncludeGst: businessSettings?.pricesIncludeGst === true,
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

      // Defensive scrub: Firestore's JS SDK silently fails on NaN/Infinity
      // (the saveQuote.catch surfaces it via logSyncError but the user only
      // sees an orphan Job and no quote in the docs collection). If any
      // numeric field on the calculated quote ended up non-finite, fix it
      // before we try to persist. Most common sources: a legacy section
      // with a missing laborHours/multiplier feeding into syncJobEstimatedHours,
      // or a divide-by-zero in markup math when materialsSubtotal is 0.
      sanitizeNonFiniteNumbers(calculatedQuote, `quote ${calculatedQuote.id}`);

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

      // Assign a quote number when the quote is leaving draft state without
      // one. New quotes get a number on first save (the existing path); the
      // extra arm covers the case where a tradie advances a never-sent draft
      // straight to accepted (e.g. via the Job stage sheet) — without this,
      // the legacy quote.quoteNumber stays undefined and downstream features
      // (Xero push, customer-facing PDF) end up with a missing number.
      const needsNumber =
        !calculatedQuote.quoteNumber &&
        (isNewQuote || calculatedQuote.status !== 'draft');
      if (needsNumber) {
        const quoteNumber = await getNextQuoteNumber();
        calculatedQuote = { ...calculatedQuote, quoteNumber };
      }

      // Once the quote is past draft, clear the wizard's draftStep marker.
      // It exists so the Dashboard "Continue Draft" banner can deep-link
      // back into the wizard mid-flow; once the tradie has marked the quote
      // accepted (or sent), continuing the draft no longer makes sense and
      // the banner / "Continue Draft" sticky CTA must hide.
      if (calculatedQuote.status !== 'draft' && calculatedQuote.draftStep) {
        calculatedQuote = { ...calculatedQuote, draftStep: undefined };
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
        // Initialize subscription for first time. Plan defaults to 'trial'
        // — startTrialIfNeeded() stamps trialStartedAt on the first quote.
        const newSubscription: SubscriptionStatus = {
          isPro: false,
          plan: 'trial',
          quotesThisMonth: 0,
          currentPeriodStart: getMonthStart(),
          currentPeriodEnd: getMonthEnd(),
          freeQuotesLimit: 5,
          trialStartedAt: undefined,
          trialExpired: false,
          dismissedUpgradeBanner: false,
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
    const plan = get().getEffectivePlan();
    // Pro and free are both unlimited. Only 'trial' that has elapsed gates
    // creation — that branch is handled by getEffectivePlan resolving to
    // 'free' on its own once Square is connected; otherwise the dashboard
    // shows the trial-expired modal before the user reaches a create button.
    return plan === 'pro' || plan === 'free' || plan === 'trial';
  },

  getEffectivePlan: () => {
    const { subscriptionStatus } = get();
    if (!subscriptionStatus) return 'trial';
    if (subscriptionStatus.isPro || subscriptionStatus.plan === 'pro') return 'pro';
    if (subscriptionStatus.plan === 'free') return 'free';

    // Compute trial expiry on read so the moment the trial window elapses
    // we report 'free' even if no save has happened yet.
    if (subscriptionStatus.trialStartedAt) {
      const trialStart = new Date(subscriptionStatus.trialStartedAt);
      if (Date.now() - trialStart.getTime() >= TRIAL_MS) return 'free';
    }
    return 'trial';
  },

  isTrialExpired: () => {
    const { subscriptionStatus } = get();
    if (!subscriptionStatus) return false;
    if (subscriptionStatus.isPro || subscriptionStatus.plan === 'pro') return false;
    if (!subscriptionStatus.trialStartedAt) return false;
    const trialStart = new Date(subscriptionStatus.trialStartedAt);
    return Date.now() - trialStart.getTime() >= TRIAL_MS;
  },

  dismissUpgradeBanner: async () => {
    try {
      const { subscriptionStatus } = get();
      if (!subscriptionStatus) return;
      const updated: SubscriptionStatus = {
        ...subscriptionStatus,
        dismissedUpgradeBanner: true,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(updated));
      set({ subscriptionStatus: updated });
      if (auth.currentUser) {
        firestoreService.saveSubscriptionStatus(updated).catch(() => {});
      }
    } catch (error) {
      // silently ignore
    }
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
        plan: 'trial',
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
        plan: 'pro',
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
    trackEvent('quote_started', { source: 'new_invoice' });
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
      pricesIncludeGst: businessSettings?.pricesIncludeGst === true,
      status: 'draft',
      paymentTerms: 'net_14',
    };

    set({ currentInvoice: newInvoice });
  },

  createInvoiceFromQuote: async (quote: Quote) => {
    // Recovery path: a prior bug let the wizard's saveDraft overwrite an
    // invoice as a quote in the legacy collections (mirror trigger then
    // flipped the unified doc to type='quote'). The original Invoice with
    // the same id usually survives in state.invoices — restore that rather
    // than minting a brand-new invoice with a fresh id. saveInvoice nudges
    // the mirror trigger to put the unified doc back to type='invoice'.
    {
      const { invoices } = get();
      const orphanedInvoice = invoices.find((i) => i.id === quote.id);
      if (orphanedInvoice) {
        await get().saveInvoice(orphanedInvoice);
        set({ currentInvoice: orphanedInvoice });
        return orphanedInvoice;
      }
    }

    // Phase-5: prefer the unified convertDocumentToInvoice path when a
    // matching document exists (server canonicalises via setDocumentStage,
    // mirror trigger projects to the legacy invoices collection).
    //
    // Only fire `quote_started` once we know we're actually minting a new
    // invoice (idempotency below short-circuits if this quote has already
    // been invoiced — that's a re-open, not a new draft).
    const matchingDoc = get().getDocumentByLegacyId(quote.id);
    if (matchingDoc && matchingDoc.type === 'quote' && !matchingDoc.invoicedAt) {
      try {
        const converted = await get().convertDocumentToInvoice(matchingDoc.id);
        const invoice: Invoice = (await import('../types/documentAdapter')).documentToInvoice(converted);
        set({ currentInvoice: invoice });
        trackEvent('quote_started', { source: 'from_quote' });
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

    trackEvent('quote_started', { source: 'from_quote' });
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
      pricesIncludeGst: quote.pricesIncludeGst,
      status: 'draft',
      paymentTerms: 'net_14',
      sourceQuoteId: quote.id,
      notes: quote.notes,
      ...(depositCredit > 0
        ? { depositCredit, depositCreditFromQuoteId: quote.id }
        : {}),
      // Carry the Xero contact across so the invoice push reuses the contact
      // the quote-side push already created — avoids a duplicate contact in
      // Xero. xeroQuoteId is preserved on the quote itself; the invoice push
      // sets Reference to the source quote number for the audit trail.
      ...(quote.xeroContactId ? { xeroContactId: quote.xeroContactId } : {}),
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
    const inclusive = healed.pricesIncludeGst === true;
    const total = inclusive ? subtotalWithMarkup : subtotalWithMarkup * 1.1;
    const gst = inclusive ? total - total / 1.1 : subtotalWithMarkup * 0.1;

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
      // Show the AsyncStorage-cached connection immediately so the UI doesn't
      // flicker on app start, then refresh from server. Cache-only would lie
      // across sign-outs and account switches: AsyncStorage is per-device, so
      // a different user signing in on the same device would inherit the
      // previous account's Xero connection until they opened the integration
      // screen. The server doc at users/{uid}/settings/xeroConnection is the
      // source of truth.
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.XERO_CONNECTION);
      if (stored) {
        set({ xeroConnection: JSON.parse(stored) });
      }

      if (!auth.currentUser) return;
      const status = await xeroService.checkXeroConnection();
      if (status.connected) {
        const conn: XeroConnection = {
          tenantId: status.tenantId!,
          tenantName: status.tenantName!,
          connectedAt: status.connectedAt!,
          lastSyncAt: status.lastSyncAt,
          syncEnabled: status.syncEnabled ?? true,
        };
        set({ xeroConnection: conn });
        await AsyncStorage.setItem(STORAGE_KEYS.XERO_CONNECTION, JSON.stringify(conn));
      } else {
        set({ xeroConnection: null });
        await AsyncStorage.removeItem(STORAGE_KEYS.XERO_CONNECTION);
      }
    } catch (error) {
      // Network failure — leave whatever AsyncStorage put in place. We'd
      // rather show stale-connected and have the next push fail with a
      // clear "session expired" message than wipe a working connection on
      // a transient connectivity blip.
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

  pushQuoteToXero: async (quote: Quote) => {
    const { quotes } = get();

    const syncingQuotes = quotes.map((q) =>
      q.id === quote.id ? { ...q, xeroSyncStatus: 'syncing' as XeroSyncStatus } : q
    );
    set({ quotes: syncingQuotes });

    try {
      const result = await xeroService.pushQuoteToXero(quote);

      const updatedQuote: Quote = {
        ...quote,
        xeroQuoteId: result.xeroQuoteId,
        xeroContactId: result.xeroContactId,
        xeroSyncStatus: 'synced' as XeroSyncStatus,
        xeroSyncedAt: new Date(),
        xeroSyncError: undefined,
        updatedAt: new Date(),
      };

      const updatedQuotes = get().quotes.map((q) =>
        q.id === quote.id ? updatedQuote : q
      );

      await AsyncStorage.setItem(STORAGE_KEYS.QUOTES, JSON.stringify(updatedQuotes));
      set({ quotes: updatedQuotes });

      const { xeroConnection } = get();
      if (xeroConnection) {
        const updatedConnection = { ...xeroConnection, lastSyncAt: new Date().toISOString() };
        set({ xeroConnection: updatedConnection });
        await AsyncStorage.setItem(STORAGE_KEYS.XERO_CONNECTION, JSON.stringify(updatedConnection));
      }
    } catch (error: any) {
      const errorQuotes = get().quotes.map((q) =>
        q.id === quote.id
          ? { ...q, xeroSyncStatus: 'error' as XeroSyncStatus, xeroSyncError: error.message || 'Sync failed' }
          : q
      );
      await AsyncStorage.setItem(STORAGE_KEYS.QUOTES, JSON.stringify(errorQuotes));
      set({ quotes: errorQuotes });
      throw error;
    }
  },

  pushPaymentToXero: async (invoiceId: string, xeroInvoiceId: string, amount: number, date: Date, method?: string) => {
    await xeroService.pushPaymentToXero(invoiceId, xeroInvoiceId, amount, date, method);
  },

  xeroBulkSync: async (invoiceIds: string[]) => {
    set({ xeroLoading: true });
    try {
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
      // Convert flips type but the invoice hasn't actually been sent
      // yet — keep the doc as a draft so the tradie still has to hit
      // "Send Invoice" to actually deliver it. sendDocumentEmail
      // transitions draft → invoice_sent on send.
      stage: 'draft',
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

  duplicateDocumentForJob: async (sourceDocumentId: string, newJobId: string) => {
    const source = get().getDocumentById(sourceDocumentId);
    if (!source) throw new Error('Source document not found');
    const now = Date.now();
    // Fresh quote number for the new visit — the source's number still
    // refers to the original.
    const nextNumber = await get().getNextQuoteNumber();
    // Regenerate ids on nested collections so nothing aliases back to the
    // original; reset money + pay-link state so the new visit starts clean.
    const clone: Document = {
      ...source,
      id: generateId(),
      jobId: newJobId,
      type: 'quote',
      stage: 'quote_accepted',
      number: nextNumber,
      // Fresh lifecycle timestamps — the old ones refer to the old visit.
      createdAt: now,
      updatedAt: now,
      sentAt: undefined,
      acceptedAt: now,
      invoicedAt: undefined,
      issueDate: undefined,
      dueDate: undefined,
      // Money state — nothing has moved yet on this new visit.
      depositPaid: 0,
      depositPaidAt: undefined,
      paidTotal: 0,
      paidInFullAt: undefined,
      payments: [],
      // Pay-link state — new visit needs new links.
      depositPaymentLinkId: undefined,
      depositPaymentLinkUrl: undefined,
      depositPaymentLinkCreatedAt: undefined,
      depositSquarePaymentId: undefined,
      squarePaymentLinkId: undefined,
      squarePaymentLinkUrl: undefined,
      squarePaymentId: undefined,
      squarePaidAt: undefined,
      activePaymentLink: undefined,
      archivedPaymentLinks: undefined,
      // Xero state belongs to the source invoice, not to this new visit.
      xeroInvoiceId: undefined,
      xeroSyncStatus: undefined,
      xeroSyncedAt: undefined,
      xeroSyncError: undefined,
      legacyInvoiceId: undefined,
      legacyQuoteId: undefined,
      // Re-id nested rows so edits on one don't splash onto the other.
      materials: (source.materials ?? []).map((m) => ({ ...m, id: generateId() })),
      sections: (source.sections ?? []).map((s) => ({ ...s, id: generateId() })),
      // Photos are visit-specific; drop them.
      photos: [],
      // Draft email body/subject — stale for a new visit.
      draftEmailBody: undefined,
      draftEmailSubject: undefined,
    };
    // If the source was an invoice, its `total` had any paid deposit
    // subtracted (see convertDocumentToInvoice). Add it back so the cloned
    // quote represents the full job value, not the residual.
    const depositCredit =
      source.type === 'invoice'
        ? (source.payments ?? [])
            .filter((p) => p.kind === 'deposit')
            .reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
        : 0;
    const restoredTotal = (Number(source.total) || 0) + depositCredit;
    const finalDoc: Document = {
      ...clone,
      materialsSubtotal: Number(source.materialsSubtotal) || 0,
      laborTotal: Number(source.laborTotal) || 0,
      subtotal: Number(source.subtotal) || 0,
      markupAmount: Number(source.markupAmount) || 0,
      gst: Number(source.gst) || 0,
      total: restoredTotal,
      balanceDue: restoredTotal,
    };
    await get().saveDocument(finalDoc);
    return finalDoc;
  },

  // Mate assistant ---------------------------------------------------------
  newChat: () => {
    const id = generateId();
    const now = new Date().toISOString();
    const convo: Conversation = { id, createdAt: now, updatedAt: now, messages: [] };
    // We don't keep chat history: replace everything with one fresh, empty
    // conversation. The prior turns were already synced to Firestore for
    // admin review (scheduleConversationSync), so nothing's lost there.
    set({ conversations: [convo], currentConversationId: id });
    return id;
  },

  startConversation: () => {
    const id = generateId();
    const now = new Date().toISOString();
    const convo: Conversation = { id, createdAt: now, updatedAt: now, messages: [] };
    // Chat history is in-memory only (not persisted): a tab switch keeps the
    // current chat alive, but a cold launch starts fresh. Cap at 20 so a long
    // session can't grow the array without bound.
    const trimmed = [convo, ...get().conversations].slice(0, 20);
    set({ conversations: trimmed, currentConversationId: id });
    return id;
  },

  endConversation: () => {
    set({ currentConversationId: null });
  },

  appendMessage: (conversationId: string, message: ChatMessage) => {
    const existing = get().conversations.find((c) => c.id === conversationId);
    let next: Conversation[];
    if (existing) {
      next = get().conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, message], updatedAt: new Date().toISOString() }
          : c,
      );
    } else {
      // Defensive: a stale currentConversationId can point at a conversation
      // that's no longer in the array (e.g. just after newChat). Self-heal by
      // minting a conversation with this id so the message isn't lost.
      const now = new Date().toISOString();
      const fresh: Conversation = { id: conversationId, createdAt: now, updatedAt: now, messages: [message] };
      next = [fresh, ...get().conversations].slice(0, 20);
      set({ currentConversationId: conversationId });
    }
    set({ conversations: next });
    scheduleConversationSync(conversationId, get);
  },

  updateMessage: (conversationId, messageId, patch) => {
    const next = get().conversations.map((c) => {
      if (c.id !== conversationId) return c;
      return {
        ...c,
        updatedAt: new Date().toISOString(),
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      };
    });
    set({ conversations: next });
    scheduleConversationSync(conversationId, get);
  },

  updateProposalStatus: (conversationId, messageId, proposalId, status) => {
    const next = get().conversations.map((c) => {
      if (c.id !== conversationId) return c;
      return {
        ...c,
        updatedAt: new Date().toISOString(),
        messages: c.messages.map((m) => {
          if (m.id !== messageId) return m;
          return {
            ...m,
            proposalStatus: { ...(m.proposalStatus || {}), [proposalId]: status },
          };
        }),
      };
    });
    set({ conversations: next });
    scheduleConversationSync(conversationId, get);
  },

  applyProposal: async (
    proposal: Proposal,
    onProgress?: (status: WorkingStatus) => void,
  ): Promise<ApplyProposalResult> => {
    // Resolve a unified Document by id — local cache first, then a Firestore
    // round-trip if missing. Mate's server-side tools always return doc ids
    // from users/{uid}/documents/{docId}, so a local-cache miss (listener
    // hasn't synced, doc was just minted, another device added it) should
    // not kill the apply path. If we fetch from Firestore we also seed the
    // local cache so subsequent reads are fast.
    const resolveDocument = async (docId: string): Promise<Document | undefined> => {
      const cached = get().getDocumentById(docId) || get().getDocumentByLegacyId(docId);
      if (cached) return cached;
      // eslint-disable-next-line no-console
      console.log('[Mate] doc not in local cache, fetching from Firestore', docId);
      const fetched = await documentService.getDocumentById(docId);
      if (fetched) {
        set((state) => {
          const existing = state.documents.find((d) => d.id === fetched.id);
          const documents = existing
            ? state.documents.map((d) => (d.id === fetched.id ? fetched : d))
            : [...state.documents, fetched];
          return { documents };
        });
      }
      return fetched || undefined;
    };

    try {
      switch (proposal.type) {
        case 'propose_create_contact': {
          const newContact: Contact = {
            id: generateId(),
            name: proposal.name,
            email: proposal.email,
            phone: proposal.phone,
            address: proposal.address,
            source: 'manual',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await get().saveContact(newContact);
          return { ok: true, navigate: { kind: 'open_contact', contactId: newContact.id } };
        }

        case 'propose_update_customer': {
          // Re-point an EXISTING quote/invoice at a different contact. Resolve
          // the customer the same way propose_draft_quote does: prefer an
          // existing contact (customerId), fall back to a fresh draft we
          // create + link. Then stamp the customer onto the document and let
          // saveDocument → ensureJobForDocument sync the linked job's
          // customerName/email/phone/address (the in-chat header reads the job).
          let contact: Contact | undefined;
          if (proposal.customerId) {
            contact = get().contacts.find((c) => c.id === proposal.customerId);
            if (!contact) {
              // eslint-disable-next-line no-console
              console.log('[Mate] contact not in local cache, fetching from Firestore', proposal.customerId);
              const fetched = await firestoreService.getContactById(proposal.customerId);
              if (fetched) {
                contact = fetched;
                const next = [...get().contacts.filter((c) => c.id !== fetched.id), fetched];
                set({ contacts: next });
                AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(next)).catch(() => {});
              }
            }
            if (!contact) {
              return {
                ok: false,
                error: 'Couldn\'t find that contact in Firestore. Ask again so Mate can re-search.',
              };
            }
          } else if (proposal.customerDraft?.name) {
            contact = {
              id: generateId(),
              name: proposal.customerDraft.name,
              email: proposal.customerDraft.email,
              phone: proposal.customerDraft.phone,
              address: proposal.customerDraft.address,
              source: 'manual',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await get().saveContact(contact);
          } else {
            return { ok: false, error: 'No customer provided.' };
          }

          // syncJobFromSource only patches non-empty differing fields and never
          // the contact link, so after the save we also point the linked job's
          // customerId at the new contact.
          const syncJobContactId = async (jobId: string | undefined) => {
            if (!jobId) return;
            const job = useJobStore.getState().getJobById(jobId);
            if (job && job.customerId !== contact!.id) {
              await useJobStore.getState().saveJob({ ...job, customerId: contact!.id });
            }
          };

          // Preferred path: unified Document (covers quotes and invoices).
          const target = await resolveDocument(proposal.quoteId);
          if (target) {
            const nextDoc: Document = {
              ...target,
              contactId: contact.id,
              customerName: contact.name,
              customerEmail: contact.email,
              customerPhone: contact.phone,
              jobAddress: contact.address ?? target.jobAddress,
            };
            await get().saveDocument(nextDoc);
            await syncJobContactId(nextDoc.jobId);
            return { ok: true, navigate: { kind: 'job_preview', quoteId: nextDoc.id } };
          }

          // Legacy fallback: a draft still only in the quotes array.
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (quote) {
            const nextQuote: Quote = {
              ...quote,
              contactId: contact.id,
              customerName: contact.name,
              customerEmail: contact.email,
              customerPhone: contact.phone,
              jobAddress: contact.address ?? quote.jobAddress,
              updatedAt: new Date(),
            };
            await get().saveQuote(nextQuote);
            await syncJobContactId(get().quotes.find((q) => q.id === quote.id)?.jobId);
            return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id } };
          }

          const invoice = get().invoices.find((i) => i.id === proposal.quoteId);
          if (invoice) {
            const nextInvoice: Invoice = {
              ...invoice,
              contactId: contact.id,
              customerName: contact.name,
              customerEmail: contact.email,
              customerPhone: contact.phone,
              jobAddress: contact.address ?? invoice.jobAddress,
              updatedAt: new Date(),
            };
            await get().saveInvoice(nextInvoice);
            await syncJobContactId(get().invoices.find((i) => i.id === invoice.id)?.jobId);
            return { ok: true, navigate: { kind: 'job_preview', quoteId: invoice.id } };
          }

          return { ok: false, error: 'Quote not found.' };
        }

        case 'propose_draft_quote': {
          // Resolve customer. If customerId was provided, prefer the local
          // contacts cache, then fall back to a direct Firestore fetch —
          // find_customer reads from server-side users/{uid}/contacts, so a
          // miss in the local cache (stale loadContacts, phone-book contact
          // not yet synced, contact added on another device) shouldn't kill
          // the apply path.
          let contact: Contact | undefined;
          if (proposal.customerId) {
            contact = get().contacts.find((c) => c.id === proposal.customerId);
            if (!contact) {
              // eslint-disable-next-line no-console
              console.log('[Mate] contact not in local cache, fetching from Firestore', proposal.customerId);
              const fetched = await firestoreService.getContactById(proposal.customerId);
              if (fetched) {
                contact = fetched;
                // Add to the local cache so subsequent reads + future tabs see it.
                const next = [...get().contacts.filter((c) => c.id !== fetched.id), fetched];
                set({ contacts: next });
                AsyncStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(next)).catch(() => {});
              }
            }
            if (!contact) {
              return {
                ok: false,
                error: 'Couldn\'t find that contact in Firestore. Ask again so Mate can re-search.',
              };
            }
          } else if (proposal.customerDraft?.name) {
            contact = {
              id: generateId(),
              name: proposal.customerDraft.name,
              email: proposal.customerDraft.email,
              phone: proposal.customerDraft.phone,
              address: proposal.customerDraft.address,
              source: 'manual',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await get().saveContact(contact);
          }

          // Mint a new quote so business defaults (labour rate, markup, GST)
          // are stamped from settings.
          get().createNewQuote();
          const fresh = get().currentQuote;
          if (!fresh) return { ok: false, error: 'Failed to create draft quote.' };

          // Stamp customer + scope. Materials come from the pipeline.
          const seeded: Quote = {
            ...fresh,
            customerName: contact?.name || proposal.customerDraft?.name || '',
            customerEmail: contact?.email,
            customerPhone: contact?.phone,
            jobAddress: contact?.address,
            contactId: contact?.id,
            job: {
              ...fresh.job,
              name: proposal.jobName,
              description: proposal.jobDescription,
            },
            laborHours: proposal.estimatedDurationHours ?? fresh.laborHours,
          };
          get().updateQuote(seeded);
          await get().saveDraft(get().currentQuote!);
          const quoteId = get().currentQuote!.id;

          // Run the FULL pipeline (analyse + pricing) IN CHAT via the shared
          // materialsPipeline service. The onProgress callback streams events
          // into the working card the chat already mounted. After both phases
          // complete, navigate to JobPreview so the tradie sees the priced
          // draft instead of an empty materials screen.
          let materialCount = 0;
          let pricingSummary: string | undefined;
          let review: QuoteReview | undefined;
          try {
            // Track the current working status so partial updates (e.g. an
            // item-priced event that only changes the detail line) don't blow
            // away the phase headline. Without merging, fast per-item events
            // overwrite the user-visible phase and the card looks like it's
            // flashing between item names with no context for what's happening.
            let currentWorking: WorkingStatus = {
              phase: 'preflight',
              status: 'Getting ready…',
              done: false,
            };
            const reportProgress = (next: Partial<WorkingStatus>) => {
              currentWorking = { ...currentWorking, ...next };
              onProgress?.(currentWorking);
            };
            reportProgress({});
            const templates = await loadTemplates().catch(() => []);
            const isPro = get().getEffectivePlan() === 'pro';

            // ── Phase 1: analyse ──
            const analyseResult = await generateMaterialsForQuote(
              {
                quote: get().currentQuote!,
                businessSettings: get().businessSettings,
                isPro,
                templates,
              },
              {
                onEvent: (event) => {
                  reportProgress({
                    phase: event.phase,
                    status: event.status,
                    detail: event.detail,
                  });
                },
              },
            ).catch((err) => {
              if (err instanceof PipelineCancelled) return null;
              throw err;
            });

            if (!analyseResult) {
              return { ok: false, error: 'Pipeline was cancelled.' };
            }

            get().updateQuote(analyseResult.updatedQuote);
            await get().saveDraft(get().currentQuote!);
            materialCount = analyseResult.generatedMaterialCount;

            // ── Phase 2: pricing ──
            // Reuse the same working card. Map PricingEvents → WorkingStatus.
            // status holds the phase headline (slow-changing) while detail
            // carries the rapid per-item progress.
            reportProgress({
              phase: 'pricing',
              status: `Pricing ${materialCount} item${materialCount === 1 ? '' : 's'}…`,
              detail: undefined,
            });

            const pricedResult = await fetchPricesForQuote(
              {
                quote: get().currentQuote!,
                businessSettings: get().businessSettings,
                reeceConnected: null, // pipeline resolves on demand
              },
              {
                onEvent: (event) => {
                  const next = pricingEventToProgress(event);
                  if (next) reportProgress(next);
                },
              },
            );

            get().updateQuote(pricedResult.updatedQuote);
            await get().saveDraft(get().currentQuote!);
            review = reviewQuoteMaterials(pricedResult.updatedQuote.materials);

            const parts: string[] = [];
            if (pricedResult.fetchedCount > 0) parts.push(`${pricedResult.fetchedCount} priced`);
            if (pricedResult.failedCount > 0) parts.push(`${pricedResult.failedCount} need pricing`);
            if (pricedResult.skippedCount > 0) parts.push(`${pricedResult.skippedCount} already priced`);
            pricingSummary = parts.join(' · ') || 'Nothing to price.';

            onProgress?.({
              phase: 'done',
              status: `Drafted ${materialCount} item${materialCount === 1 ? '' : 's'}.`,
              done: true,
              summary: pricingSummary,
            });
          } catch (err: any) {
            // eslint-disable-next-line no-console
            console.warn('[Mate] pipeline failed', err);
            onProgress?.({
              phase: 'failed',
              status: 'Pipeline hit a snag.',
              detail: err?.message,
              done: true,
            });
            return {
              ok: true,
              navigate: { kind: 'job_preview', quoteId },
              note: `Pipeline snag — opened the draft, tap Fetch Prices in the wizard. (${err?.message || 'unknown'})`,
            };
          }

          // If the tradie asked for an invoice up front, auto-convert at the
          // end of the pipeline so they don't have to do a second Apply.
          if (proposal.documentType === 'invoice') {
            try {
              const converted = await get().convertDocumentToInvoice(quoteId);
              return {
                ok: true,
                navigate: { kind: 'open_invoice', invoiceId: converted.id },
                review,
              };
            } catch (err: any) {
              // eslint-disable-next-line no-console
              console.warn('[Mate] auto-convert to invoice failed', err);
              // Fall through to opening the quote — the tradie can convert manually.
            }
          }

          // Land on JobPreview (the final review screen) instead of
          // MaterialsList — pricing is already done.
          return {
            ok: true,
            navigate: { kind: 'job_preview', quoteId },
            review,
          };
        }

        case 'propose_update_quote_rates': {
          // Bump a numeric rate on the doc without re-running pricing. We
          // convert to Quote-shape so the shared calculator can re-run totals,
          // then write the updated values back onto the Document.
          const target = await resolveDocument(proposal.quoteId);
          if (!target) {
            return { ok: false, error: 'Quote not found.' };
          }
          const { documentToQuote } = await import('../types/documentAdapter');
          const sourceQuote = documentToQuote(target);
          const nextQuote: Quote = {
            ...sourceQuote,
            markup: proposal.markup ?? sourceQuote.markup,
            laborMarkup: proposal.laborMarkup ?? sourceQuote.laborMarkup,
            laborRate: proposal.laborRate ?? sourceQuote.laborRate,
            laborHours: proposal.laborHours ?? sourceQuote.laborHours,
          };
          const recalced = updateQuoteCalculations(nextQuote);
          const nextDoc: Document = {
            ...target,
            laborRate: recalced.laborRate,
            laborHours: recalced.laborHours,
            laborTotal: recalced.laborTotal,
            markup: recalced.markup,
            laborMarkup: recalced.laborMarkup,
            markupAmount: recalced.markupAmount,
            materialsSubtotal: recalced.materialsSubtotal,
            subtotal: recalced.subtotal,
            gst: recalced.gst,
            total: recalced.total,
          };
          await get().saveDocument(nextDoc);
          return { ok: true, navigate: { kind: 'job_preview', quoteId: target.id } };
        }

        case 'propose_add_line_item': {
          // We don't price line items here — stamp a placeholder material with
          // the searchTerm + qty + unit and let MaterialsList's pricing pass
          // resolve the price when the tradie next opens the quote. The
          // tradie can also edit the placeholder before pricing runs.
          const stub: Material = {
            id: generateId(),
            name: proposal.searchTerm,
            searchTerm: proposal.searchTerm,
            quantity: proposal.qty,
            unit: normalizeMaterialUnit(proposal.unit),
            price: 0,
            totalPrice: 0,
            manualPriceOverride: false,
            ...(proposal.section ? { section: proposal.section } : {}),
          };

          const target = await resolveDocument(proposal.quoteId);
          if (target) {
            const nextDoc: Document = {
              ...target,
              materials: [...(target.materials ?? []), stub],
            };
            await get().saveDocument(nextDoc);
            return { ok: true };
          }
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!quote) return { ok: false, error: 'Quote not found.' };
          await get().saveQuote({ ...quote, materials: [...quote.materials, stub], updatedAt: new Date() });
          return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id } };
        }

        case 'propose_delete_quote': {
          // Delete an entire quote/invoice document. Distinct from
          // propose_delete_line_item: that strips one row, this removes the
          // whole record. Block on paid / partially paid — those belong in
          // the books, the tradie should archive them instead.
          const target = await resolveDocument(proposal.quoteId);
          const stage =
            target?.stage ||
            get().quotes.find((q) => q.id === proposal.quoteId)?.status ||
            get().invoices.find((i) => i.id === proposal.quoteId)?.status;
          if (stage === 'paid' || stage === 'partially_paid') {
            return {
              ok: false,
              error:
                "Can't delete a paid record — the books need to stay intact. Archive it instead.",
            };
          }
          if (target) {
            // Route via the appropriate store action so the matching local
            // array (quotes vs invoices) and Firestore collection are both
            // cleared. Then belt-and-braces wipe the unified mirror in case
            // the trigger hasn't caught up.
            if (target.type === 'invoice') {
              await get().deleteInvoice(target.id);
            } else {
              await get().deleteQuote(target.id);
            }
            try {
              await documentService.deleteDocument(target.id);
            } catch {
              // best-effort — the trigger will reconcile.
            }
            set((state) => ({
              documents: state.documents.filter((d) => d.id !== target.id),
            }));
            return { ok: true };
          }
          // Legacy fallbacks — the doc lives only in the old quotes/invoices
          // arrays (very fresh draft, not yet mirrored).
          const legacyQuote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (legacyQuote) {
            await get().deleteQuote(legacyQuote.id);
            return { ok: true };
          }
          const legacyInvoice = get().invoices.find((i) => i.id === proposal.quoteId);
          if (legacyInvoice) {
            await get().deleteInvoice(legacyInvoice.id);
            return { ok: true };
          }
          return { ok: false, error: 'Quote not found — it may have already been deleted.' };
        }

        case 'propose_delete_line_item': {
          // Prefer the unified Document path so the legacy mirror tracks the
          // change; fall back to legacy quote/invoice arrays.
          const target = await resolveDocument(proposal.quoteId);
          if (target) {
            const before = (target.materials ?? []).length;
            const nextMaterials = (target.materials ?? []).filter((m) => m.id !== proposal.materialId);
            if (nextMaterials.length === before) {
              return { ok: false, error: 'Line not found — it may have already been removed.' };
            }
            const nextDoc: Document = { ...target, materials: nextMaterials };
            await get().saveDocument(nextDoc);
            return { ok: true };
          }
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (quote) {
            const before = quote.materials.length;
            const nextMaterials = quote.materials.filter((m) => m.id !== proposal.materialId);
            if (nextMaterials.length === before) {
              return { ok: false, error: 'Line not found — it may have already been removed.' };
            }
            await get().saveQuote({ ...quote, materials: nextMaterials, updatedAt: new Date() });
            return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id } };
          }
          const invoice = get().invoices.find((i) => i.id === proposal.quoteId);
          if (invoice) {
            const before = invoice.materials.length;
            const nextMaterials = invoice.materials.filter((m) => m.id !== proposal.materialId);
            if (nextMaterials.length === before) {
              return { ok: false, error: 'Line not found — it may have already been removed.' };
            }
            await get().saveInvoice({ ...invoice, materials: nextMaterials, updatedAt: new Date() });
            return { ok: true };
          }
          return { ok: false, error: 'Quote not found.' };
        }

        case 'propose_send_quote': {
          const doc = await resolveDocument(proposal.quoteId);
          if (!doc) return { ok: false, error: 'Quote not found.' };
          // If Mate pre-wrote the email, persist it onto the doc so the send
          // preview opens pre-filled (the modal reads draftEmailBody /
          // draftEmailSubject and skips auto-generation when they're set).
          // Substitute any `<business>` / `[business name]` style placeholders
          // with the actual business name from settings — the model often
          // leaves a literal placeholder in the sign-off and we never want
          // that going out to a customer.
          const businessName =
            get().businessSettings?.businessName?.trim() || '';
          const substitute = (s: string): string => {
            if (!businessName) return s;
            return s.replace(
              /[<\[{]\s*business(?:\s+name)?\s*[>\]}]/gi,
              businessName,
            );
          };
          let target = doc;
          if (proposal.draftEmailBody || proposal.draftEmailSubject) {
            target = {
              ...doc,
              ...(proposal.draftEmailBody
                ? { draftEmailBody: substitute(proposal.draftEmailBody) }
                : {}),
              ...(proposal.draftEmailSubject
                ? { draftEmailSubject: substitute(proposal.draftEmailSubject) }
                : {}),
            };
            await get().saveDocument(target);
          }
          return {
            ok: true,
            navigate: {
              kind: 'open_send_modal',
              documentId: target.id,
              recipientEmail: proposal.recipientEmail || target.customerEmail,
            },
          };
        }

        case 'propose_convert_to_invoice': {
          const doc = await resolveDocument(proposal.quoteId);
          if (doc) {
            const converted = await get().convertDocumentToInvoice(doc.id);
            return { ok: true, navigate: { kind: 'open_invoice', invoiceId: converted.id } };
          }
          // Fall back to legacy quotes array (very old drafts not yet mirrored
          // to the unified collection).
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!quote) return { ok: false, error: 'Quote not found.' };
          const invoice = await get().createInvoiceFromQuote(quote);
          return { ok: true, navigate: { kind: 'open_invoice', invoiceId: invoice.id } };
        }

        case 'propose_reprice': {
          // Re-run the pricing pipeline (price fetch + reconcile) on an EXISTING
          // quote/invoice to fix the rows review_quote flagged. We wipe the price
          // off the flagged rows first (fetchPrices skips anything already
          // priced); manual overrides and confident rows are never flagged so
          // they're untouched. Materials only — scope/labour aren't re-analysed.
          let currentWorking: WorkingStatus = { phase: 'pricing', status: 'Re-checking prices…', done: false };
          const reportProgress = (next: Partial<WorkingStatus>) => {
            currentWorking = { ...currentWorking, ...next };
            onProgress?.(currentWorking);
          };

          const runReprice = async (source: Quote): Promise<{ priced: Quote; resetCount: number }> => {
            const { materials, resetCount } = resetFlaggedRowsForReprice(source.materials);
            reportProgress({
              status: resetCount > 0 ? `Re-pricing ${resetCount} row${resetCount === 1 ? '' : 's'}…` : 'Re-checking prices…',
            });
            const priced = await fetchPricesForQuote(
              {
                quote: { ...source, materials },
                businessSettings: get().businessSettings,
                reeceConnected: null,
              },
              {
                onEvent: (event) => {
                  const next = pricingEventToProgress(event);
                  if (next) reportProgress(next);
                },
              },
            );
            return { priced: updateQuoteCalculations(priced.updatedQuote), resetCount };
          };

          // Preferred path: unified Document (covers both quotes and invoices).
          const doc = await resolveDocument(proposal.quoteId);
          if (doc) {
            const { documentToQuote } = await import('../types/documentAdapter');
            const { priced } = await runReprice(documentToQuote(doc));
            const repricedDoc: Document = {
              ...doc,
              materials: priced.materials,
              materialsSubtotal: priced.materialsSubtotal,
              laborTotal: priced.laborTotal,
              subtotal: priced.subtotal,
              markupAmount: priced.markupAmount,
              gst: priced.gst,
              total: priced.total,
            };
            await get().saveDocument(repricedDoc);
            const review = reviewQuoteMaterials(priced.materials);
            onProgress?.({ phase: 'done', status: 'Prices re-checked.', done: true, summary: review.summary });
            return { ok: true, navigate: { kind: 'job_preview', quoteId: doc.id }, review };
          }

          // Legacy fallback: a draft still only in the quotes array.
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!quote) return { ok: false, error: 'Quote not found.' };
          const { priced } = await runReprice(quote);
          await get().saveQuote(priced);
          const review = reviewQuoteMaterials(priced.materials);
          onProgress?.({ phase: 'done', status: 'Prices re-checked.', done: true, summary: review.summary });
          return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id }, review };
        }

        default:
          return { ok: false, error: 'Unknown proposal type.' };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to apply proposal.' };
    }
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
        STORAGE_KEYS.XERO_CONNECTION,
        STORAGE_KEYS.CONTACTS,
        STORAGE_KEYS.CONTACTS_MIGRATED,
        STORAGE_KEYS.CONVERSATIONS,
      ]);
      // Reset store state to initial values
      set({
        businessSettings: null,
        quotes: [],
        currentQuote: null,
        isOnboarded: false,
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
        conversations: [],
        currentConversationId: null,
      });
    } catch (error) {
      throw error;
    }
  },
}));
