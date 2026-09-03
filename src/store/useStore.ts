/**
 * Global state management with Zustand
 * Handles quotes, business settings, and persistence
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import { withOrigin } from '../utils/materialOrigin';
import { Quote, BusinessSettings, Material, QuoteSection, SubscriptionStatus, Invoice, PaymentMethod, ReferralInfo, XeroConnection, XeroSyncStatus, Contact, QuotePhoto } from '../types';
import { Document, DocumentPayment, DocumentPaymentMethod } from '../types/document';
import { ChatMessage, Conversation, Proposal, ProposalStatus, WorkingStatus, DraftQuoteProposal } from '../types/assistant';
import {
  generateMaterialsForQuote,
  fetchPricesForQuote,
  PipelineCancelled,
  LAST_RESORT_GUESS_PREFIX,
} from '../services/materialsPipeline';
import { pricingEventToProgress, summarisePriceCounts } from '../../shared/pricing/progress';
import type { SupplierGapSummary } from '../services/assistant/supplierGapNote';
import { reviewQuoteMaterials, isFlaggedRow, priceResettableIds, topLinesSummary, wipeStillImplausibleRows, withIntegrityIssues, QuoteReview } from '../utils/quoteReview';
import { checkDocumentIntegrity } from '../../shared/document/integrityCheck';
import { loadTemplates } from '../services/sectionTemplateService';
import { updateQuoteCalculations, healBrokenLabourSections } from '../utils/quoteCalculator';
import { updateAllMaterialPrices, updateDocumentCalculations } from '../utils/documentCalculator';
import { applySetTotal, describeSetTotalPlan } from '../utils/setTotal';
import { normalizePhoneTail } from '../utils/textMatch';
import { normaliseLabourToHours } from '../../shared/document/labourUnits';
import { isAlreadyInvoiced } from '../../shared/document/convertGuard';
import { keepSupplierPriceInclusive, resolveGstMode } from '../../shared/document/gstMode';
import {
  addPreference,
  buildRateWorkItem,
  rateLineUnitPrice,
  rateLinesCoverMaterials,
  stripLabourFromQuote,
  upsertRate,
} from '../services/quotingProfile';
import type { RateLine } from '../types';
import { calculateDueDate } from '../utils/invoiceCalculator';
import { canRevertToQuote } from '../utils/revertToQuote';
import { isEditablePayment, maxAmountForEdit } from '../utils/editablePayment';
import { reconcileNextNumber, resolveNextQuoteNumber } from '../utils/nextNumber';
import { preserveSnapshotIdentity } from '../utils/snapshotIdentity';
import { mergeTruncatedSnapshot } from '../utils/mergeTruncatedSnapshot';
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
import { maybeRequestReview } from '../services/storeReviewService';
import { ensureJobForDocument, ensureJobForQuote, useJobStore } from './useJobStore';
import { canAnalysePhotos, canRunMatePipeline } from './planGates';
import { markPricingStarted, markPricingFinished, isPricingInFlight } from '../services/assistant/pricingInFlight';
import { runPipelineOnServer } from '../services/serverPricingRun';
import { PRICING_RUN_LEDGER_KEY } from '../services/pricingRunLedger';

/**
 * A run the server owned failed (or went quiet). The server has already
 * parked the draft and may hold analysed rows the phone never saw, so the
 * recovery path must read the quote back rather than write the phone's copy
 * over it — see runScopePipeline's catch.
 */
class ServerRunFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerRunFailed';
  }
}
import { resetGeneratedScope } from '../utils/scopeReset';
import { headlineFor } from '../utils/reviewChatFormat';
import type { CustomerEditPlan } from '../utils/customerEdit';
import { auth } from '../config/firebase';
import { searchLocalSources } from '../services/localMaterialSearch';
import { loadGroups as loadSupplierGroups } from '../services/supplierGroupService';
import { applyPackAwarePricing } from '../utils/packAwarePricing';
import { roundToTwoDecimals } from '../utils/documentCalculator';

// The legacy PaymentMethod enum is finer-grained than the unified ledger's.
// Cheque and card have no ledger equivalent, so they land on 'other' — the
// human-readable detail survives in the payment's notes.
export const PAYMENT_METHOD_TO_LEDGER: Record<string, DocumentPaymentMethod> = {
  cash: 'cash',
  bank_transfer: 'bank',
  card: 'other',
  cheque: 'other',
  other: 'other',
};

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
  // `source` lands on the quote_started event — 'mate' when the Apply path
  // mints the quote, 'new_quote' (default) everywhere else.
  createNewQuote: (source?: 'new_quote' | 'mate') => void;
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
  /**
   * Record a manual payment against a unified Document's ledger. The legacy
   * `recordPayment` above only knows the `invoices` array, which is never
   * loaded at bootstrap and whose ids diverge from Document ids after a
   * quote → invoice conversion — so every payment on a modern invoice used
   * to fail with "Invoice not found". This is the id-space that actually
   * exists. Returns the updated doc so callers can report the new balance.
   */
  recordDocumentPayment: (
    documentId: string,
    amount: number,
    method: PaymentMethod,
    notes?: string,
    paymentDate?: Date
  ) => Promise<Document>;
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
  /**
   * Perform a Customer-screen edit. Takes a plan from planCustomerEdit and
   * returns the stable `c:<id>` key the screen must switch to, because the edit
   * can move the customer's derived key.
   */
  applyCustomerEdit: (plan: CustomerEditPlan) => Promise<string>;
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
  /** Undo a conversion while the invoice is still untouched — see canRevertToQuote. */
  revertDocumentToQuote: (documentId: string) => Promise<Document>;
  /** Correct a manually recorded payment. Square payments are read-only — see isEditablePayment. */
  updateDocumentPayment: (
    documentId: string,
    paymentId: string,
    patch: Partial<Pick<DocumentPayment, 'amount' | 'paidAt' | 'method' | 'notes'>>,
  ) => Promise<Document>;
  /** Remove a manually recorded payment and re-derive the totals from what's left. */
  deleteDocumentPayment: (documentId: string, paymentId: string) => Promise<Document>;
  /** Re-derive paidTotal / balanceDue / stage from a ledger and save once. */
  saveDocumentWithLedger: (doc: Document, payments: DocumentPayment[]) => Promise<Document>;
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
    context?: ApplyProposalContext,
  ) => Promise<ApplyProposalResult>;

  // Cleanup
  clearAllData: () => Promise<void>;
}

/**
 * Screen-supplied extras for an Apply. Deliberately NOT a proposal field (the
 * model can't know Storage URLs, and proposals are Firestore-synced) and NOT
 * store state (which would leak photos across chats).
 */
export interface ApplyProposalContext {
  /** Photos the tradie sent Mate in this chat, to seed onto the draft. */
  photos?: QuotePhoto[];
  /**
   * Fires the moment propose_draft_quote has minted its quote — BEFORE the
   * 15–40 s materials + pricing run. The screen uses it to hand Mate the real
   * id straight away: a scope correction typed while pricing was still
   * running used to be re-drafted as a second quote (Overton, 29 Aug 2026)
   * because the model only learned the id once the pipeline finished.
   */
  onMinted?: (quoteId: string) => void;
}

export type ApplyProposalResult =
  | {
      ok: true;
      navigate?: NavigateHint;
      note?: string;
      /**
       * The apply succeeded but the materials + pricing pipeline did NOT
       * finish — the draft exists and opens, yet its prices don't.
       *
       * This is `ok: true` on purpose: the tradie gets their draft rather than
       * an error, and the working card already tells them pricing fell over.
       * But anything that ANNOUNCES the outcome has to be able to tell the two
       * apart. Voice narration branched on `ok` alone and cheerfully said
       * "sweet, came together fine" over a quote with no prices on it, while
       * the card underneath read "Couldn't finish pricing that one."
       */
      pipelineDegraded?: true;
      review?: QuoteReview;
      /** How much of this quote the tradie's own supplier rates could price. */
      supplierGap?: SupplierGapSummary;
      /** Open a sheet over the chat. Deliberately not a NavigateHint — this
       *  one must NOT leave the conversation. */
      sheet?: AssistantSheetHint;
      /**
       * The document's total after this apply, for the "[context]" line. Mate
       * read out $1,260 and then $1,416 for a document that was never either
       * (3 Sep 2026) because the note after a rates change carried no total
       * and it guessed. Anything that changes money reports the real figure.
       */
      appliedTotal?: number;
      /** For propose_set_total: what absorbed the difference, as one clause. */
      moved?: string;
      /** For propose_pick_contact: the contact the tradie chose, now saved. */
      pickedContact?: { id: string; name: string; phone?: string; email?: string };
    }
  // `code` names machine-readable failures the screen branches on
  // (currently only 'PLAN_GATED' → Paywall); `error` stays the line shown
  // to the tradie.
  | { ok: false; error: string; code?: string };

/**
 * Something the chat screen opens ON TOP of the conversation. Kept apart from
 * NavigateHint so it can never be routed through handleNavigate — leaving the
 * chat to import a price list would lose the thread the import is for.
 */
export type AssistantSheetHint = {
  kind: 'supplier_import';
  source: 'attachment' | 'camera' | 'gallery' | 'pdf' | 'spreadsheet' | 'ask';
  supplierName?: string;
  /** Read the photo already sitting in this conversation. */
  useAttachments?: boolean;
};

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

/**
 * Fold a finished pricing run into the "did their own rates cover this?"
 * summary Mate reads. The supplier-book snapshot is imported lazily so the
 * store graph doesn't grow an AsyncStorage read at module load.
 */
async function summariseSupplierGap(
  missedTerms: string[],
  estimatedCount: number,
  materials: Material[],
): Promise<SupplierGapSummary> {
  let supplierBookPopulated = false;
  try {
    const { loadSupplierBookSnapshot } = await import('../services/supplierBook');
    supplierBookPopulated = (await loadSupplierBookSnapshot()).personalRateCount > 0;
  } catch {
    // Unreadable book reads as empty — the copy blames the phone, not the tradie.
  }
  return {
    missedTerms,
    estimatedCount,
    pricedRowCount: materials.filter((m) => (m.price ?? 0) > 0).length,
    supplierBookPopulated,
    // Read from the quote's own rows, not from one run's outcome: the audit of
    // stored quotes found most $0 lines carry no pricingSource at all — they
    // were added after a run, or a run never reached them. Mate should ask
    // about whatever lacks a real price NOW: still-$0 rows, plus rows holding
    // the pipeline's last-resort placeholder, which are the ones that most
    // need a real number. Work items are lump-sum scope lines with no unit
    // price by design and are never a gap.
    needsPriceTerms: materials
      .filter(
        (m) =>
          m.kind !== 'work' &&
          (m.quantity ?? 0) > 0 &&
          (!((m.price ?? 0) > 0) || (m.description ?? '').startsWith(LAST_RESORT_GUESS_PREFIX)),
      )
      .map((m) => m.name)
      .filter((n): n is string => !!n),
  };
}

// Wipe the price off every row the review flags (no price, AI estimate,
// low-confidence, weak product match, implausible money) so fetchPrices
// re-fetches them — it skips any row already at price > 0. Manual overrides
// and confident rows are never flagged, so they're left exactly as they were.
// requiredQty is preserved so pack rounding still works.
//
// Selection runs the FULL review, not just per-row metadata: QU-178763's
// three $187.25 twins were all priceConfidence 'high', so the old
// isFlaggedRow selection reset zero rows and the reprice Mate offered
// "re-checked" the same wrong $16,942.97.
function resetFlaggedRowsForReprice(
  materials: Material[],
  sections?: QuoteSection[] | null,
): { materials: Material[]; resetCount: number; resetIds: Set<string> } {
  const resettable = priceResettableIds(materials, sections);
  let resetCount = 0;
  const resetIds = new Set<string>();
  const next = materials.map((m) => {
    if (!isFlaggedRow(m) && !resettable.has(m.id)) return m;
    resetCount++;
    resetIds.add(m.id);
    // weakProductMatch goes too: it describes the product this row WAS priced
    // against, and that product is being thrown away. Leaving it set would
    // keep warning about a match that no longer exists if the re-fetch fails.
    return {
      ...m,
      price: 0,
      totalPrice: 0,
      priceConfidence: undefined,
      pricingSource: undefined,
      weakProductMatch: undefined,
    };
  });
  return { materials: next, resetCount, resetIds };
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
  createNewQuote: (source = 'new_quote') => {
    const { businessSettings, startTrialIfNeeded } = get();
    // Start trial on first quote creation, not on save
    startTrialIfNeeded();
    trackEvent('quote_started', { source });
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
      markup: businessSettings?.defaultMarkup || 30,
      laborMarkup: businessSettings?.defaultLaborMarkup ?? businessSettings?.defaultMarkup ?? 30,
      markupAmount: 0,
      subtotal: 0,
      gst: 0,
      total: 0,
      pricesIncludeGst: businessSettings?.pricesIncludeGst === true,
      gstRegistered: businessSettings?.gstRegistered !== false,
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
      // Forward-only TYPE guard. If the unified Document with this id has
      // already been promoted to type='invoice' (via Phase-5
      // convertDocumentToInvoice), a legacy quote save here would round-trip
      // through the mirror trigger and visibly flip it back to a quote.
      // Re-route through saveInvoice so the user's edits land on the
      // canonical invoice instead.
      {
        const unified = get().getDocumentById(quote.id);
        if (unified && unified.type === 'invoice') {
          const { invoices } = get();
          const existingInvoice = invoices.find((i) => i.id === quote.id);
          if (existingInvoice) {
            await get().saveInvoice({
              ...existingInvoice,
              materials: quote.materials,
              sections: quote.sections,
              laborRate: quote.laborRate,
              laborHours: quote.laborHours,
              // Carried for the same reason as in createInvoiceFromQuote:
              // without it the sections arrive trimmed but the adjustment
              // that paid for the trim does not, and the recompute inflates
              // the total back up.
              laborExtraHours: quote.laborExtraHours,
              markup: quote.markup,
              job: quote.job,
              updatedAt: new Date(),
            } as Invoice);
            return;
          }
          // No legacy invoice yet — silently swallow so we don't downgrade
          // the mirror. Local state already reflects what the user typed.
          return;
        }
      }
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

    // Listener echoes of our own writes deliver fresh instances of unchanged
    // quotes. Keep the old instances (and skip the write entirely when
    // nothing moved) so subscribers don't re-render mid-navigation.
    const stable = preserveSnapshotIdentity(
      local,
      merged,
      (q) => q.id,
      (q) => (q.updatedAt instanceof Date ? q.updatedAt.getTime() : NaN),
    );
    if (stable === local && reconciledNextNumber === get().nextQuoteNumber) return;
    set({ quotes: stable, nextQuoteNumber: reconciledNextNumber });
  },

  // Save quote to storage
  saveQuote: async (quote: Quote) => {
    try {
      // Forward-only TYPE guard — see saveDraft for the rationale. If the
      // unified doc with this id is already an invoice, route through
      // saveInvoice so the user's edits don't get reverted to a quote.
      {
        const unified = get().getDocumentById(quote.id);
        if (unified && unified.type === 'invoice') {
          const { invoices } = get();
          const existingInvoice = invoices.find((i) => i.id === quote.id);
          if (existingInvoice) {
            await get().saveInvoice({
              ...existingInvoice,
              materials: quote.materials,
              sections: quote.sections,
              laborRate: quote.laborRate,
              laborHours: quote.laborHours,
              // See saveDraft above — same carry, same reason.
              laborExtraHours: quote.laborExtraHours,
              markup: quote.markup,
              job: quote.job,
              updatedAt: new Date(),
            } as Invoice);
            return;
          }
          return;
        }
      }
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
          // Backfill laborMarkup, and canonicalise labour units — the legacy
          // `quotes` collection predates the documents collection's read-path
          // normalisation, so day-shaped records still arrive here.
          const backfilled = cloudQuotes.map((q) =>
            normaliseLabourToHours(q.laborMarkup === undefined ? { ...q, laborMarkup: q.markup } : q)
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
          normaliseLabourToHours(q.laborMarkup === undefined ? { ...q, laborMarkup: q.markup } : q)
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

      // Redundant with the durable trialStartedAt field by design — the
      // funnel reads events, Firestore state stays the source of truth.
      trackEvent('trial_started');

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
      const local = stored ? parseInt(stored, 10) : null;
      // Cloud floor exists only for incident-restored accounts — keeps their
      // numbering continuing from the recovered history instead of QU-1.
      const cloudFloor = auth.currentUser
        ? await firestoreService.loadQuoteCounterFloor()
        : null;
      const next = resolveNextQuoteNumber(local, cloudFloor, get().nextQuoteNumber);
      if (next !== null) {
        set({ nextQuoteNumber: next });
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
      markup: businessSettings?.defaultMarkup || 30,
      laborMarkup: businessSettings?.defaultLaborMarkup ?? businessSettings?.defaultMarkup ?? 30,
      markupAmount: 0,
      subtotal: 0,
      gst: 0,
      total: 0,
      pricesIncludeGst: businessSettings?.pricesIncludeGst === true,
      gstRegistered: businessSettings?.gstRegistered !== false,
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
      labourDisplayUnit: quote.labourDisplayUnit,
      laborTotal: quote.laborTotal,
      // The labour adjustment is part of the price, not a display detail:
      // laborTotal is Σ(sections) + laborExtraHours × laborRate, so dropping
      // it here left the invoice's own fields disagreeing with its total. The
      // next recompute (updateInvoice, or any recalc on the send path) then
      // "corrected" the total UPWARDS by the trimmed amount and quietly
      // re-billed the customer for labour the tradie had taken off.
      laborExtraHours: quote.laborExtraHours,
      sections: quote.sections,
      materialsSubtotal: quote.materialsSubtotal,
      markup: quote.markup,
      laborMarkup: quote.laborMarkup ?? quote.markup,
      markupAmount: quote.markupAmount,
      subtotal: quote.subtotal,
      gst: quote.gst,
      total: adjustedTotal,
      pricesIncludeGst: quote.pricesIncludeGst,
      gstRegistered: quote.gstRegistered,
      status: 'draft',
      paymentTerms: 'net_14',
      sourceQuoteId: quote.id,
      notes: quote.notes,
      // Carry the presentation choice across. An accepted quote must not
      // change shape the moment it becomes an invoice — the customer already
      // agreed to what they were shown. (The unified convertDocumentToInvoice
      // path above is an in-place flip, so it preserves this for free; this
      // legacy fallback mints a new record and has to copy it.) The legacy
      // pair rides along for one release, same as everywhere else.
      priceDetail: quote.priceDetail,
      showMaterialCosts: quote.showMaterialCosts,
      showLaborCosts: quote.showLaborCosts,
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
    const registered = healed.gstRegistered !== false;
    const inclusive = healed.pricesIncludeGst === true;
    const total = !registered || inclusive ? subtotalWithMarkup : subtotalWithMarkup * 1.1;
    const gst = !registered ? 0 : inclusive ? total - total / 1.1 : subtotalWithMarkup * 0.1;

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

    // Same echo-suppression as mergeRemoteQuotes.
    const stable = preserveSnapshotIdentity(
      local,
      merged,
      (i) => i.id,
      (i) => (i.updatedAt instanceof Date ? i.updatedAt.getTime() : NaN),
    );
    if (stable === local && reconciledNextNumber === get().nextInvoiceNumber) return;
    set({ invoices: stable, nextInvoiceNumber: reconciledNextNumber });
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
            normaliseLabourToHours(i.laborMarkup === undefined ? { ...i, laborMarkup: i.markup } : i)
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
          normaliseLabourToHours(i.laborMarkup === undefined ? { ...i, laborMarkup: i.markup } : i)
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

      // Invoice just went fully paid — the single best moment to ask for a
      // store rating. Hooked here (not per screen) so the manual record-payment
      // flow and the assistant flow both count; the service rate-limits and
      // never throws, so it can't disturb the payment path.
      if (newStatus === 'paid' && invoice.status !== 'paid') {
        maybeRequestReview('invoice_paid').catch(() => {});
      }

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

  recordDocumentPayment: async (
    documentId: string,
    amount: number,
    method: PaymentMethod,
    notes?: string,
    paymentDate?: Date,
  ) => {
    // Resolve in the id-space the app actually keeps loaded. A doc converted
    // from a quote keeps the quote's id while its legacy mirror gets a fresh
    // one, so a legacy-id lookup has to be tried both ways round.
    const doc =
      get().getDocumentById(documentId) ||
      get().getDocumentByLegacyId(documentId) ||
      (await documentService.getDocumentById(documentId)) ||
      undefined;
    if (!doc) throw new Error('Invoice not found');
    if (doc.type !== 'invoice') {
      throw new Error('That document is a quote, not an invoice.');
    }

    const total = Number(doc.total) || 0;
    const alreadyPaid = Number(doc.paidTotal) || 0;
    // Never bank more than is owed — the balance is the cap, matching the
    // overpayment guard the manual RecordPayment screen enforces.
    const capped = Math.min(Math.max(amount, 0), Math.max(0, total - alreadyPaid));
    const payment: DocumentPayment = {
      id: generateId(),
      kind: 'manual',
      amount: capped,
      paidAt: (paymentDate || new Date()).getTime(),
      method: PAYMENT_METHOD_TO_LEDGER[method] ?? 'other',
      ...(notes ? { notes } : {}),
    };

    const payments = [...(doc.payments || []), payment];
    const paidTotal = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const balanceDue = Math.max(0, total - paidTotal);
    // 'paid' the moment the balance closes (half a cent of slack for float
    // noise), otherwise the doc is partially paid.
    const fullyPaid = paidTotal + 0.005 >= total;

    const next: Document = {
      ...doc,
      payments,
      paidTotal,
      balanceDue,
      stage: fullyPaid ? 'paid' : 'partially_paid',
      ...(fullyPaid ? { paidInFullAt: payment.paidAt } : {}),
    };
    await get().saveDocument(next);

    // The legacy mirror is ALREADY up to date at this point: saveDocument
    // projects the document onto invoices/{id} with an absolute paidAmount.
    //
    // This used to also call the legacy recordPayment, which is additive
    // (`currentPaid + amount`) — so it read the value the projection had just
    // written and added the same payment on top. A $960 payment landed as
    // $1,920, and onInvoiceWritten then projected that doubled total back
    // over the unified ledger as one inflated entry. The input caps here and
    // in RecordPaymentScreen both run before the mirror, so neither saw it.
    if (fullyPaid && doc.stage !== 'paid') {
      // Best moment to ask — the job just got paid in full.
      maybeRequestReview('invoice_paid').catch(() => {});
    }

    return next;
  },

  updateDocumentPayment: async (documentId, paymentId, patch) => {
    const doc = get().getDocumentById(documentId);
    if (!doc) throw new Error('Invoice not found');
    const existing = (doc.payments || []).find((p) => p.id === paymentId);
    if (!existing) throw new Error('Payment not found');
    if (!isEditablePayment(existing)) {
      throw new Error('Square payments are managed in Square and can’t be edited here.');
    }

    // The append-time cap would measure against a balance that already
    // includes this payment — see maxAmountForEdit.
    const ceiling = maxAmountForEdit(doc, existing);
    const nextAmount =
      patch.amount === undefined
        ? Number(existing.amount) || 0
        : Math.min(Math.max(Number(patch.amount) || 0, 0), ceiling);

    const payments = (doc.payments || []).map((p) =>
      p.id === paymentId
        ? {
            ...p,
            amount: nextAmount,
            ...(patch.paidAt !== undefined ? { paidAt: patch.paidAt } : {}),
            ...(patch.method !== undefined ? { method: patch.method } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          }
        : p,
    );

    return await get().saveDocumentWithLedger(doc, payments);
  },

  deleteDocumentPayment: async (documentId, paymentId) => {
    const doc = get().getDocumentById(documentId);
    if (!doc) throw new Error('Invoice not found');
    const existing = (doc.payments || []).find((p) => p.id === paymentId);
    if (!existing) throw new Error('Payment not found');
    if (!isEditablePayment(existing)) {
      throw new Error('Square payments are managed in Square and can’t be removed here.');
    }
    const payments = (doc.payments || []).filter((p) => p.id !== paymentId);
    return await get().saveDocumentWithLedger(doc, payments);
  },

  /**
   * Re-derive the money fields from a ledger and save once.
   *
   * Shared by the edit and delete paths so a corrected payment lands through
   * exactly the same arithmetic as a new one — the totals, the balance and
   * the stage all come from `payments`, never from an incremental adjustment.
   * That is the property the doubling bug broke.
   */
  saveDocumentWithLedger: async (doc: Document, payments: DocumentPayment[]) => {
    const total = Number(doc.total) || 0;
    const paidTotal = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const balanceDue = Math.max(0, total - paidTotal);
    const fullyPaid = total > 0 && paidTotal + 0.005 >= total;

    // Stage follows the money. Emptying the ledger drops an invoice back to
    // 'invoice_sent' rather than leaving it reading Paid with nothing behind
    // it; a draft that never went out stays a draft.
    let stage = doc.stage;
    if (doc.type === 'invoice') {
      if (fullyPaid) stage = 'paid';
      else if (paidTotal > 0) stage = 'partially_paid';
      else if (doc.stage === 'paid' || doc.stage === 'partially_paid') {
        stage = doc.sentAt ? 'invoice_sent' : 'draft';
      }
    }

    const next: Document = {
      ...doc,
      payments,
      paidTotal,
      balanceDue,
      stage,
      ...(fullyPaid ? {} : { paidInFullAt: undefined }),
    };
    await get().saveDocument(next);
    return next;
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

      // Unified documents. These used to be skipped entirely — only the legacy
      // quotes/invoices below were synced — so editing a contact left every
      // Document (and so the whole Jobs surface, which reads Documents) showing
      // the old name and number.
      const { documents } = get();
      const linkedDocs = documents.filter((d) => d.contactId === contact.id);
      if (linkedDocs.length > 0) {
        const patched = documents.map((d) =>
          d.contactId === contact.id
            ? {
                ...d,
                customerName: contact.name,
                customerEmail: contact.email,
                customerPhone: contact.phone,
                // jobAddress deliberately untouched: it's the SITE, and a
                // customer can have several. See utils/customerEdit.
              }
            : d,
        );
        set({ documents: patched });
        if (auth.currentUser) {
          for (const d of patched.filter((d) => d.contactId === contact.id)) {
            documentService.saveDocument(d).catch(() => {});
          }
        }
      }

      // Jobs. Same omission as documents — the Jobs list, the job cards and the
      // Customer screen all read Job.customerName, so a contact edit that
      // skipped them looked like it hadn't saved.
      const jobStore = useJobStore.getState();
      const linkedJobs = jobStore.jobs.filter((j) => j.customerId === contact.id);
      for (const j of linkedJobs) {
        const needsPatch =
          j.customerName !== contact.name ||
          (j.customerEmail || undefined) !== contact.email ||
          (j.customerPhone || undefined) !== contact.phone;
        if (!needsPatch) continue;
        jobStore
          .saveJob({
            ...j,
            customerName: contact.name,
            customerEmail: contact.email,
            customerPhone: contact.phone,
          })
          .catch(() => {});
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

  /**
   * Apply an edit made on the Customer screen.
   *
   * The plan is computed by the pure planCustomerEdit (utils/customerEdit) —
   * this only performs the writes. Contact first, because every job and
   * document in the plan references its id: if the run dies partway, the
   * records point at a contact that exists rather than a dangling id.
   *
   * Returns the stable `c:<id>` key the screen should switch to, since the edit
   * may have moved the customer's derived key.
   */
  applyCustomerEdit: async (plan) => {
    await get().saveContact(plan.contact);

    const jobStore = useJobStore.getState();
    for (const job of plan.jobs) {
      await jobStore.saveJob(job);
    }
    for (const doc of plan.documents) {
      await get().saveDocument(doc);
    }

    return plan.nextCustomerKey;
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
    documentService.listenToDocuments((documents, wasTruncated) => {
      // The listener is capped while loadDocuments() is not. Replacing the
      // array wholesale on a full snapshot dropped the older tail, and a job
      // whose only invoice fell off the window then looked document-less:
      // wrong filter bucket, $0 on the card, "Create Quote" on an invoiced
      // job. Merge instead of trimming.
      const merged = mergeTruncatedSnapshot(
        get().documents,
        documents,
        (d) => d.id,
        wasTruncated,
      );
      set({ documents: merged, documentsLoaded: true });
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
    // Idempotent: already an invoice — short-circuit before any RPC. Type
    // alone, for the same reason the server guard uses it: `invoicedAt` can
    // arrive on a still-quote document from our own legacy stamp via the
    // mirror. See shared/document/convertGuard.
    if (isAlreadyInvoiced(existing)) {
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
      // Stash what this write overwrites so the conversion can be undone
      // exactly — see canRevertToQuote. Without the old number an undo
      // would have to mint a fresh one, changing the customer-facing
      // reference twice.
      convertedFromQuote: {
        ...(existing.number ? { number: existing.number } : {}),
        total: Number(existing.total) || 0,
        stage: existing.stage,
        at: now,
      },
      updatedAt: now,
    };
    // Stamp the legacy source quote BEFORE flipping the unified doc — the
    // legacy createInvoiceFromQuote path stamps its source quote, but the
    // unified path used to skip it, leaving the row as status 'draft' with
    // a wizard draftStep. That zombie fed the dashboard's "Continue draft"
    // banner for a job that was already invoiced (and possibly paid).
    // Ordering matters: once the unified doc is type 'invoice', saveQuote's
    // forward-only type guard re-routes to saveInvoice and the stamp would
    // never land on the legacy quotes row. (draftStep only clears locally —
    // firestoreService strips undefined under merge — so pickDashboardDraft
    // keys off invoiceId/invoicedAt, which do persist.)
    const sourceQuote = get().quotes.find((q) => q.id === documentId);
    if (sourceQuote && !sourceQuote.invoiceId) {
      try {
        await get().saveQuote({
          ...sourceQuote,
          invoiceId: documentId,
          invoicedAt: new Date(now),
          draftStep: undefined,
          updatedAt: new Date(now),
        });
      } catch {
        // Non-fatal — pickDashboardDraft also excludes invoiced quotes, so
        // the banner stays correct even if this stamp doesn't land.
      }
    }
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

  revertDocumentToQuote: async (documentId: string) => {
    const existing = get().getDocumentById(documentId);
    if (!existing) throw new Error('Document not found');
    // Re-check server-side-of-the-client: the sheet gates on the same
    // predicate, but state can move between rendering the row and tapping
    // it (a webhook landing a payment, say).
    if (!canRevertToQuote(existing)) {
      throw new Error('This invoice can no longer be turned back into a quote.');
    }
    const stash = existing.convertedFromQuote!;
    const now = Date.now();

    const reverted: Document = {
      ...existing,
      type: 'quote',
      // Restore the number the conversion overwrote. The invoice number
      // stays spent — tax numbering shouldn't reuse a number, so it is
      // deliberately not returned to the pool.
      ...(stash.number ? { number: stash.number } : {}),
      total: Number(stash.total) || 0,
      stage: stash.stage,
      invoicedAt: undefined,
      issueDate: undefined,
      dueDate: undefined,
      paymentTerms: undefined,
      convertedFromQuote: undefined,
      // Conversion reset Xero sync; going back leaves it unsynced too.
      xeroSyncStatus: 'not_synced',
      updatedAt: now,
    };

    await get().saveDocument(reverted);

    // saveDocument strips undefined and merges, so the invoice-only fields
    // above would survive in Firestore and come back on the next load —
    // a surviving invoicedAt makes canConvert refuse, leaving the tradie
    // unable to re-convert after undoing. Delete them for real.
    if (auth.currentUser) {
      try {
        await documentService.clearDocumentFields(documentId, [
          'invoicedAt',
          'issueDate',
          'dueDate',
          'paymentTerms',
          'convertedFromQuote',
        ]);
      } catch (err) {
        logSyncError('quote', documentId, err);
      }
    }

    // Keep the legacy quote row's forward pointer honest — pickDashboardDraft
    // and the "Continue draft" banner both key off invoiceId/invoicedAt, so
    // a stale stamp would keep the job looking invoiced.
    const sourceQuote = get().quotes.find((q) => q.id === documentId);
    if (sourceQuote?.invoiceId) {
      try {
        await get().saveQuote({
          ...sourceQuote,
          invoiceId: undefined,
          invoicedAt: undefined,
          updatedAt: new Date(now),
        });
      } catch {
        // Non-fatal: the unified doc is the source of truth.
      }
    }

    return reverted;
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
    context?: ApplyProposalContext,
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

    // Same paywall as the wizard's pricing step: the proposals below run the
    // materials + pricing pipeline, which free (post-trial) users don't get —
    // chat must not become the bypass. Checked before any pipeline call or
    // quote mint; the screen routes 'PLAN_GATED' to the Paywall.
    const planGate = (): ApplyProposalResult | null =>
      canRunMatePipeline(get().getEffectivePlan())
        ? null
        : {
            ok: false,
            code: 'PLAN_GATED',
            error: "Auto-pricing isn't in the free plan — you can add materials and prices yourself, or go Pro and I'll sort it.",
          };

    // Every Mate edit on the unified Document path used to save the rows and
    // leave the stored totals where they were — saveDocument recalculates
    // nothing, and nothing on the server does either — so get_quote and the
    // inline card showed the old total after a line was added, changed or
    // removed. Recalculate on the way through, and hand the total back.
    const saveRecalculated = async (doc: Document): Promise<Document> => {
      const next = updateDocumentCalculations(doc);
      await get().saveDocument(next);
      return next;
    };

    // A quote-targeting proposal may name a unified Document (the usual case),
    // a legacy quote that is only in the quotes array, or a legacy invoice.
    // One lookup and one recalculating save for all three, so the money
    // paths don't each carry three near-identical branches.
    type Targeted =
      | { kind: 'document'; doc: Document }
      | { kind: 'quote'; doc: Quote }
      | { kind: 'invoice'; doc: Invoice };
    // A legacy record is handed over already healed and re-totalled — the
    // exact state saveAny's updateQuoteCalculations will write — so a plan
    // made against it (set-total verifies with updateDocumentCalculations)
    // and the save can't disagree: a $0 section the heal fills in, or a row
    // whose stored totalPrice drifted from quantity × price, would otherwise
    // move the stored total after the plan had landed on the target.
    const settled = <T extends Quote | Invoice>(doc: T): T =>
      updateQuoteCalculations({ ...doc, materials: updateAllMaterialPrices(doc.materials ?? []) } as any) as any;
    const resolveAny = async (id: string): Promise<Targeted | null> => {
      const doc = await resolveDocument(id);
      if (doc) return { kind: 'document', doc };
      const quote = get().quotes.find((q) => q.id === id);
      if (quote) return { kind: 'quote', doc: settled(quote) };
      const invoice = get().invoices.find((i) => i.id === id);
      if (invoice) return { kind: 'invoice', doc: settled(invoice) };
      return null;
    };
    const saveAny = async (target: Targeted, patch: object): Promise<number> => {
      if (target.kind === 'document') return (await saveRecalculated({ ...target.doc, ...patch } as Document)).total;
      const next = updateQuoteCalculations({ ...target.doc, ...patch, updatedAt: new Date() } as any) as any;
      if (target.kind === 'quote') await get().saveQuote(next);
      else await get().saveInvoice(next);
      return next.total;
    };
    // Money paid against a record is reconciled by saveDocumentWithLedger,
    // not by a recalculation: a new total on a paid or part-paid invoice would
    // leave its balance where it was. Those belong to a credit or a new
    // invoice, the same line propose_delete_quote draws.
    // The contact a customerDraft names: the saved one when the tradie
    // already has this person (same name and same number, or same name and
    // no number on either side — a re-draft of the same job passes the same
    // draft again), else a fresh one. One smoke-alarm job put the customer in
    // the book three times (3 Sep 2026). Details the draft adds fill gaps on
    // the saved contact; they never overwrite what is there.
    const contactFromDraft = async (draft: NonNullable<DraftQuoteProposal['customerDraft']>): Promise<Contact> => {
      const nameKey = draft.name.replace(/\s+/g, ' ').trim().toLowerCase();
      const tail = draft.phone ? normalizePhoneTail(draft.phone) : '';
      const existing = get().contacts.find((c) => {
        if (c.name.replace(/\s+/g, ' ').trim().toLowerCase() !== nameKey) return false;
        const theirs = c.phone ? normalizePhoneTail(c.phone) : '';
        return tail && theirs ? tail === theirs : !tail || !theirs;
      });
      if (existing) {
        const filled: Contact = {
          ...existing,
          ...(existing.phone || !draft.phone ? {} : { phone: draft.phone }),
          ...(existing.email || !draft.email ? {} : { email: draft.email }),
          ...(existing.address || !draft.address ? {} : { address: draft.address }),
        };
        if (filled !== existing && (filled.phone !== existing.phone || filled.email !== existing.email || filled.address !== existing.address)) {
          await get().saveContact({ ...filled, updatedAt: new Date().toISOString() });
          return filled;
        }
        return existing;
      }
      const fresh: Contact = {
        id: generateId(),
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        address: draft.address,
        source: 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await get().saveContact(fresh);
      return fresh;
    };

    const paidGuard = (target: Targeted): ApplyProposalResult | null => {
      const stage = (target.doc as any).stage ?? (target.doc as any).status;
      return stage === 'paid' || stage === 'partially_paid'
        ? {
            ok: false,
            error: "That one's had money paid against it — changing the total would throw the balance out. Record a credit or a new invoice instead.",
          }
        : null;
    };

    // Analyse + price whatever is in get().currentQuote, streaming progress
    // into the chat's working card. Shared by propose_draft_quote and
    // propose_update_quote_scope so a scope correction re-runs exactly what
    // the first draft ran instead of minting a second quote.
    //
    // A clean finish stamps draftStep:'JobPreview' — the marker the wizard's
    // preview screen writes for a finished-but-unsent quote. A Mate-minted
    // draft never visits the wizard, so without the stamp it was invisible to
    // the dashboard's draft banner (pickDashboardDraft) and the unsent-quote
    // nudge (followUpNudge), which both key on that field: 28 of the week's
    // drafts (2 Sep 2026) sat unstamped with nothing in the app pointing back
    // at them. A pricing snag parks the quote on 'MaterialsList' instead —
    // the wizard step that carries Fetch Prices.
    type ScopePipelineRun =
      | { kind: 'done'; review: QuoteReview; supplierGap: SupplierGapSummary }
      | { kind: 'cancelled' }
      | { kind: 'degraded'; error: string };
    const runScopePipeline = async (
      quoteId: string,
      initial: WorkingStatus,
      // Rate-card lines already on the quote, and the two modes that skip
      // phases: lines that include materials ARE the price (no analysis, no
      // pricing), and labour-only keeps hours + sections but drops the gear
      // list and the pricing run. Labour on a rate line means the analysis's
      // hours would be a second labour charge, so they are stripped.
      options: {
        rateLines?: RateLine[];
        ratesCoverMaterials?: boolean;
        labourOnly?: boolean;
        /** Recorded on the server-side run — a first draft or a scope correction. */
        kind?: 'draft' | 'scope';
      } = {},
    ): Promise<ScopePipelineRun> => {
      const rateLineCount = options.rateLines?.length ?? 0;
      let materialCount = 0;
      // Accumulated outside the event→progress mapper: the fallback event
      // is one-shot info, not a progress frame, and the caller needs the
      // terms after the run finishes.
      const missedSupplierTerms: string[] = [];
      // Mate keeps talking to the tradie while this runs. Flag the quote as
      // mid-pricing so show_quote refuses to put an unpriced draft on screen
      // and call it ready — see pricingInFlight.
      markPricingStarted(quoteId);
      try {
        // Track the current working status so partial updates (e.g. an
        // item-priced event that only changes the detail line) don't blow
        // away the phase headline. Without merging, fast per-item events
        // overwrite the user-visible phase and the card looks like it's
        // flashing between item names with no context for what's happening.
        let currentWorking: WorkingStatus = initial;
        const reportProgress = (next: Partial<WorkingStatus>) => {
          currentWorking = { ...currentWorking, ...next };
          onProgress?.(currentWorking);
        };
        reportProgress({});

        if (options.ratesCoverMaterials) {
          // The rate card is the whole price. No analysis, no pricing run —
          // the minutes a tradie waits for materials they never wanted was
          // the whole point of saving a rate. Still a finished-but-unsent
          // draft, so it gets the same stamp.
          const rated = get().currentQuote!;
          get().updateQuote({ ...rated, draftStep: 'JobPreview' });
          await get().saveDraft(get().currentQuote!);
          const review = reviewQuoteMaterials(rated.materials, rated.sections);
          const supplierGap = await summariseSupplierGap([], 0, rated.materials);
          onProgress?.({
            phase: 'done',
            status: 'Priced off your rate card.',
            done: true,
            summary: `Priced off your rate card — ${rateLineCount} line${rateLineCount === 1 ? '' : 's'}, no materials list.`,
          });
          return { kind: 'done', review, supplierGap };
        }

        const isPro = canAnalysePhotos(get().getEffectivePlan());

        // Wraps up a labour-only draft: hours and sections, no gear list.
        const finishLabourOnly = async (analysedQuote: Quote): Promise<ScopePipelineRun> => {
          get().updateQuote({ ...analysedQuote, draftStep: 'JobPreview' });
          await get().saveDraft(get().currentQuote!);
          const review = reviewQuoteMaterials(analysedQuote.materials, analysedQuote.sections);
          const supplierGap = await summariseSupplierGap([], 0, analysedQuote.materials);
          onProgress?.({
            phase: 'done',
            status: 'Labour only — nothing to price.',
            done: true,
            summary: 'Labour only — hours and sections, no materials list.',
          });
          return { kind: 'done', review, supplierGap };
        };

        // Wraps up a priced quote — the review, the integrity check, the
        // supplier-book gap and the card's summary — whichever side priced it.
        const finishPriced = async (
          priced: Quote,
          counts: { fetchedCount: number; failedCount: number; skippedCount: number },
        ): Promise<ScopePipelineRun> => {
          // Finished but unsent — stamp the wizard step the banner and nudge read.
          get().updateQuote({ ...priced, draftStep: 'JobPreview' });
          await get().saveDraft(get().currentQuote!);
          let review = reviewQuoteMaterials(priced.materials, priced.sections);
          const integrity = checkDocumentIntegrity(priced as any);
          if (integrity.length) {
            // eslint-disable-next-line no-console
            console.warn('[Mate] integrity', quoteId, integrity.map((i) => i.code).join(','));
            review = withIntegrityIssues(review, integrity.map((i) => i.detail));
          }
          const supplierGap = await summariseSupplierGap(
            missedSupplierTerms,
            review.counts.estimated,
            priced.materials,
          );

          let pricingSummary = summarisePriceCounts(counts);
          const topLines = topLinesSummary(priced.materials);
          if (topLines) pricingSummary = `${pricingSummary}\n${topLines}`;

          onProgress?.({
            phase: 'done',
            status: `Drafted ${materialCount} item${materialCount === 1 ? '' : 's'}.`,
            done: true,
            summary: pricingSummary,
          });
          return { kind: 'done', review, supplierGap };
        };

        // ── On the server, when the server will take it ──
        // The same pipeline runs inside a Cloud Function, so locking the
        // phone or switching apps no longer kills the run, and a push says
        // when it's ready. The card streams from the run document. If the
        // server never claims the run (flag off, offline, not deployed) the
        // phone prices it below, exactly as it always has.
        const serverRun = await runPipelineOnServer(
          {
            quoteId,
            kind: options.kind ?? 'draft',
            options: { stripLabour: rateLineCount > 0, labourOnly: !!options.labourOnly },
            jobName: get().currentQuote?.job?.name,
          },
          { onProgress: (status) => reportProgress(status) },
        );
        if (serverRun.kind === 'failed') throw new ServerRunFailed(serverRun.error);
        if (serverRun.kind === 'done') {
          materialCount = serverRun.result.generatedMaterialCount;
          missedSupplierTerms.push(...serverRun.result.missedSupplierTerms);
          if (options.labourOnly) return finishLabourOnly(serverRun.quote);
          return finishPriced(serverRun.quote, serverRun.result);
        }
        // eslint-disable-next-line no-console
        console.log('[Mate] pricing on the phone —', serverRun.reason);
        // Said out loud: the card may have spent 25 s on "lining up a spot", and
        // a phone-side run does need the app kept open.
        reportProgress({
          phase: 'preflight',
          status: 'Doing this one on your phone — keep the app open a tick.',
          detail: undefined,
          runsOnServer: false,
        });

        const templates = await loadTemplates().catch(() => []);

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

        if (!analyseResult) return { kind: 'cancelled' };

        let analysed: Quote = analyseResult.updatedQuote;
        // Labour charged through rate lines: the analysis's hours would be a
        // second labour charge on top of them.
        if (rateLineCount > 0) analysed = stripLabourFromQuote(analysed);
        // Labour only: keep the hours and sections, drop the gear list.
        if (options.labourOnly) {
          analysed = { ...analysed, materials: analysed.materials.filter((m) => m.kind === 'work') };
        }
        materialCount = options.labourOnly ? 0 : analyseResult.generatedMaterialCount;

        if (options.labourOnly) return finishLabourOnly(analysed);

        get().updateQuote(analysed);
        await get().saveDraft(get().currentQuote!);

        reportProgress({
          phase: 'pricing',
          status: `Pricing ${materialCount} item${materialCount === 1 ? '' : 's'}…`,
          detail: undefined,
        });

        // ── Phase 2: pricing ──
        const pricedResult = await fetchPricesForQuote(
          {
            quote: get().currentQuote!,
            businessSettings: get().businessSettings,
            reeceConnected: null, // pipeline resolves on demand
          },
          {
            onEvent: (event) => {
              if (event.kind === 'supplier-priority-fallback') {
                missedSupplierTerms.push(...event.missedTerms);
              }
              const next = pricingEventToProgress(event);
              if (next) reportProgress(next);
            },
          },
        );

        return finishPriced(pricedResult.updatedQuote, pricedResult);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[Mate] pipeline failed', err);
        const serverSide = err instanceof ServerRunFailed;
        onProgress?.({
          phase: 'failed',
          status: "Couldn't finish pricing that one.",
          // The server's reasons are engineer-speak ("stopped reporting
          // progress"); the tradie needs to know the draft survived.
          detail: serverSide ? "Couldn't get prices back just now — your gear list is saved." : err?.message,
          done: true,
        });
        if (serverSide) {
          // The server owns the quote: it has parked the draft itself and may
          // hold analysed rows this phone never received. Read it back rather
          // than writing the stale local copy over it — a flaky read-back
          // after a finished run must not turn a priced quote into an empty
          // one. If the read fails too, only the local state moves; the
          // realtime listener brings the server's copy down when it can.
          const remote = await firestoreService.getQuote(quoteId).catch(() => null);
          if (remote) {
            get().updateQuote({ ...remote, draftStep: remote.draftStep ?? 'MaterialsList' });
            await get().saveDraft(get().currentQuote!).catch(() => {});
          } else {
            const parked = get().currentQuote;
            if (parked && parked.id === quoteId) get().updateQuote({ ...parked, draftStep: 'MaterialsList' });
          }
          return { kind: 'degraded', error: err?.message || 'unknown' };
        }
        // The draft exists but its prices don't. Park it on the wizard step
        // that carries Fetch Prices so the dashboard banner can resume it.
        const parked = get().currentQuote;
        if (parked && parked.id === quoteId) {
          get().updateQuote({ ...parked, draftStep: 'MaterialsList' });
          await get().saveDraft(get().currentQuote!).catch(() => {});
        }
        return { kind: 'degraded', error: err?.message || 'unknown' };
      } finally {
        // Clear on every exit — success, snag, or cancellation. A quote left
        // flagged would have show_quote refusing it forever.
        markPricingFinished(quoteId);
      }
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
          //
          // Resolve the target FIRST — a missing quote must fail before any
          // contact work, or a failed apply still mints a stray contact (the
          // birdhouse convo, 25 Aug 2026: repeated updates against an invented
          // quote id would each have saved a fresh "Karl" to the book).
          const target = await resolveDocument(proposal.quoteId);
          const legacyQuote = target
            ? undefined
            : get().quotes.find((q) => q.id === proposal.quoteId);
          const legacyInvoice =
            target || legacyQuote
              ? undefined
              : get().invoices.find((i) => i.id === proposal.quoteId);
          if (!target && !legacyQuote && !legacyInvoice) {
            return { ok: false, error: 'Quote not found.' };
          }
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
            contact = await contactFromDraft(proposal.customerDraft);
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
          const quote = legacyQuote;
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

          const invoice = legacyInvoice;
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

        case 'propose_import_supplier_list': {
          // Deliberately NOT plan-gated. Importing a price list is free today
          // (onboarding runs it for free users), and paywalling the one thing
          // that makes a free user's prices right would be backwards.
          return {
            ok: true,
            sheet: {
              kind: 'supplier_import',
              source: proposal.source,
              supplierName: proposal.supplierName,
              useAttachments: proposal.source === 'attachment',
            },
          };
        }

        case 'propose_draft_quote': {
          const gated = planGate();
          if (gated) return gated;
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
            contact = await contactFromDraft(proposal.customerDraft);
          }

          // Mint a new quote so business defaults (labour rate, markup, GST)
          // are stamped from settings.
          get().createNewQuote('mate');
          const fresh = get().currentQuote;
          if (!fresh) return { ok: false, error: 'Failed to create draft quote.' };
          // A real number from the counter, the way the wizard's first save
          // assigns one. A Mate draft only ever went through saveDraft, which
          // assigns nothing, so the mirror fell back to QU- + six digits of
          // the id — a figure that only ticks over every ~2.8 hours. Three
          // drafts of one smoke-alarm job were all QU-178840 (3 Sep 2026);
          // 104 numbers are shared across 51 accounts.
          const quoteNumber = await get().getNextQuoteNumber();

          // Rate-card lines, when Mate charged the job off the tradie's own
          // rates: lump-sum work items at rate × quantity, in the document's
          // GST basis (the tradie's stated basis vs the document's — NOT the
          // supplier-catalogue rule, which reads "not registered" as
          // inclusive). Labour is then on those lines, so the analysis pass's
          // hours must not land on top — and when every line includes
          // materials, the lines ARE the price: nothing to generate or price.
          const businessInclusive = get().businessSettings?.pricesIncludeGst === true;
          const docMode = resolveGstMode(fresh);
          const rateLines = proposal.rateLines ?? [];
          const rateItems = rateLines.map((line) => buildRateWorkItem(line, docMode, businessInclusive));
          const ratesCoverMaterials = rateLinesCoverMaterials(rateLines);
          const labourOnly = proposal.materialsMode === 'labour_only';

          // Stamp customer + scope. Materials come from the pipeline.
          const seeded: Quote = {
            ...fresh,
            quoteNumber,
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
            ...(rateItems.length ? { materials: [...(fresh.materials ?? []), ...rateItems] } : {}),
            laborHours: rateLines.length ? 0 : (proposal.estimatedDurationHours ?? fresh.laborHours),
            // Photos the tradie sent Mate in this chat. Seeded BEFORE the
            // analyse pass so materialsPipeline reads photos[].storageUrl on
            // its first look at the job, not after the fact.
            ...(context?.photos?.length ? { photos: context.photos.slice(0, 5) } : {}),
          };
          get().updateQuote(seeded);
          await get().saveDraft(get().currentQuote!);
          const quoteId = get().currentQuote!.id;

          // The quote exists from here on, even though its prices don't yet.
          // Hand the id to the screen NOW, not after the pipeline — see
          // ApplyProposalContext.onMinted.
          context?.onMinted?.(quoteId);

          // Run the FULL pipeline (analyse + pricing) IN CHAT via the shared
          // materialsPipeline service, streaming progress into the working
          // card the chat already mounted. After both phases complete, land
          // on JobPreview so the tradie sees the priced draft instead of an
          // empty materials screen. Rate-card lines and labour-only mode
          // short-circuit the phases they don't need — see runScopePipeline.
          const run = await runScopePipeline(
            quoteId,
            { phase: 'preflight', status: 'Getting ready…', done: false },
            { rateLines, ratesCoverMaterials, labourOnly },
          );
          if (run.kind === 'cancelled') {
            return { ok: false, error: 'Pipeline was cancelled.' };
          }
          if (run.kind === 'degraded') {
            return {
              ok: true,
              navigate: { kind: 'job_preview', quoteId },
              pipelineDegraded: true,
              note: `Pipeline snag — opened the draft, tap Fetch Prices in the wizard. (${run.error})`,
            };
          }
          const { review, supplierGap } = run;

          // If the tradie asked for an invoice up front, auto-convert at the
          // end of the pipeline so they don't have to do a second Apply.
          if (proposal.documentType === 'invoice') {
            try {
              const converted = await get().convertDocumentToInvoice(quoteId);
              return {
                ok: true,
                navigate: { kind: 'open_invoice', invoiceId: converted.id },
                review,
                supplierGap,
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
            supplierGap,
          };
        }

        case 'propose_update_quote_scope': {
          const gated = planGate();
          if (gated) return gated;
          // Two pipelines writing one quote would race each other's saves.
          // The validator already refuses the card while pricing runs; this is
          // the belt for a card minted a moment before the run started.
          if (isPricingInFlight(proposal.quoteId)) {
            return {
              ok: false,
              error: "That one's still being priced — give it a moment, then try the change again.",
            };
          }
          // Prefer the legacy quotes row: it is what Mate minted, what the
          // dashboard banner reads, and what saveDraft keeps in step with the
          // unified document. Fall back to the document for anything else.
          let base: Quote | undefined = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!base) {
            const doc = await resolveDocument(proposal.quoteId);
            if (doc) {
              const { documentToQuote } = await import('../types/documentAdapter');
              base = documentToQuote(doc);
            }
          }
          if (!base) return { ok: false, error: 'Quote not found.' };
          if (base.status && base.status !== 'draft') {
            return {
              ok: false,
              error: "That quote's already gone to the customer — changing the scope now would change what they saw. Draft a new one instead.",
            };
          }
          // The analyse pass is additive over whatever rows exist, so the
          // previous run's generated list and hours come off first — see
          // resetGeneratedScope for what survives (the tradie's own rows).
          const merged: Quote = {
            ...resetGeneratedScope(base, proposal.estimatedDurationHours),
            job: {
              ...base.job,
              name: proposal.jobName ?? base.job?.name,
              description: proposal.jobDescription ?? base.job?.description,
            },
            // Photos sent since the first draft ride onto the re-run; the ones
            // already on the quote stay. Same five-photo cap as the draft path.
            ...(context?.photos?.length
              ? {
                  photos: [
                    ...(base.photos || []),
                    ...context.photos.filter((p) => !(base!.photos || []).some((q) => q.id === p.id)),
                  ].slice(0, 5),
                }
              : {}),
          };
          get().setCurrentQuote(merged);
          // Persist the new scope before the analyse pass so a snag mid-run
          // still leaves the corrected description on the quote.
          await get().saveDraft(merged);
          const quoteId = get().currentQuote?.id || merged.id;

          const run = await runScopePipeline(
            quoteId,
            { phase: 'preflight', status: 'Redoing the materials…', done: false },
            { kind: 'scope' },
          );
          if (run.kind === 'cancelled') {
            return { ok: false, error: 'Pipeline was cancelled.' };
          }
          if (run.kind === 'degraded') {
            return {
              ok: true,
              navigate: { kind: 'job_preview', quoteId },
              pipelineDegraded: true,
              note: `Pipeline snag — the scope's updated but pricing didn't finish; tap Fetch Prices in the wizard. (${run.error})`,
            };
          }
          return {
            ok: true,
            navigate: { kind: 'job_preview', quoteId },
            review: run.review,
            supplierGap: run.supplierGap,
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
          // On a document with sections the labour is the SECTIONS: the
          // top-level hours and rate are display fields, so writing them
          // changed nothing on the customer copy — "labour to 2 hours" and
          // then "8 hours" both left INV-004 at $1,415.70 (3 Sep 2026). Hours
          // go through laborExtraHours (what the labour screen derives from
          // its total-hours input); a new rate is written onto every hourly
          // section, the way the labour screen keeps one rate per document.
          const sections = sourceQuote.sections ?? [];
          const hasSections = sections.length > 0;
          const sectionHours = sections.reduce(
            (sum, s) =>
              sum + (typeof s.laborHoursTotal === 'number' ? s.laborHoursTotal : (Number(s.laborHours) || 0) * (Number(s.multiplier) || 1)),
            0,
          );
          const nextRate = proposal.laborRate ?? sourceQuote.laborRate;
          const nextQuote: Quote = {
            ...sourceQuote,
            markup: proposal.markup ?? sourceQuote.markup,
            laborMarkup: proposal.laborMarkup ?? sourceQuote.laborMarkup,
            laborRate: nextRate,
            laborHours: proposal.laborHours ?? sourceQuote.laborHours,
            ...(hasSections && proposal.laborHours !== undefined
              ? { laborExtraHours: Math.round((proposal.laborHours - sectionHours) * 10000) / 10000 }
              : {}),
            ...(hasSections && proposal.laborRate !== undefined
              ? {
                  sections: sections.map((s) =>
                    s.pricing === 'lumpSum'
                      ? s
                      : {
                          ...s,
                          laborRate: nextRate,
                          laborTotal: Math.round((Number(s.laborHours) || 0) * nextRate * (Number(s.multiplier) || 1) * 100) / 100,
                        },
                  ),
                }
              : {}),
          };
          const recalced = updateQuoteCalculations(nextQuote);
          const nextDoc: Document = {
            ...target,
            laborRate: recalced.laborRate,
            laborHours: recalced.laborHours,
            laborExtraHours: recalced.laborExtraHours,
            sections: recalced.sections,
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
          return { ok: true, navigate: { kind: 'job_preview', quoteId: target.id }, appliedTotal: recalced.total };
        }

        case 'propose_set_total': {
          // "Make the total $1,232." The planner (utils/setTotal.ts) decides
          // what absorbs the difference — labour when there is any, otherwise
          // a lump-sum "Price adjustment" line — and lands on the figure to
          // the cent; materials are never touched. Re-planned here against
          // the live document, not the card's preview.
          const target = await resolveAny(proposal.quoteId);
          if (!target) return { ok: false, error: 'Quote not found.' };
          const paid = paidGuard(target);
          if (paid) return paid;
          const result = applySetTotal(target.doc, proposal.targetTotal);
          if (!result.ok) return { ok: false, error: result.message };
          const appliedTotal = await saveAny(target, result.patch);
          return {
            ok: true,
            navigate: { kind: 'job_preview', quoteId: target.doc.id },
            appliedTotal,
            moved: describeSetTotalPlan(result.plan),
          };
        }

        case 'propose_pick_contact': {
          // The phone's own contact picker. iOS needs no permission for it;
          // Android needs READ_CONTACTS, asked for here rather than at import.
          // Web has no picker — Mate is told, and asks for the name instead.
          const { Platform } = await import('react-native');
          if (Platform.OS === 'web') {
            return { ok: false, error: "Can't open the phone's contacts from the web app — tell me the name and I'll look them up." };
          }
          const expoContacts = await import('expo-contacts');
          if (Platform.OS === 'android') {
            const perm = await expoContacts.requestPermissionsAsync();
            if (perm.status !== 'granted') {
              return {
                ok: false,
                code: 'CONTACTS_DENIED',
                error: "Contacts access is off for QuoteMate — turn it on under the phone's Settings, then say the word and I'll open them.",
              };
            }
          }
          const picked = await expoContacts.presentContactPickerAsync();
          if (!picked) return { ok: false, error: 'No contact picked.', code: 'CANCELLED' };
          const { phoneContactToContact } = await import('../services/contactService');
          const fresh = phoneContactToContact(picked);
          // The same person already saved — same number or email — is linked,
          // not duplicated. Two "Sue and Peter Williamson" contacts came out
          // of one conversation before this existed.
          const tail = fresh.phone ? normalizePhoneTail(fresh.phone) : '';
          const email = fresh.email?.toLowerCase();
          const nameKey = fresh.name.replace(/\s+/g, ' ').trim().toLowerCase();
          const existing = get().contacts.find(
            (c) =>
              (tail && c.phone && normalizePhoneTail(c.phone) === tail) ||
              (email && c.email?.toLowerCase() === email) ||
              // A phone-book entry with no number and no email: the name is
              // all there is to match on.
              (!tail && !email && c.name.replace(/\s+/g, ' ').trim().toLowerCase() === nameKey),
          );
          const contact = existing ?? fresh;
          if (!existing) await get().saveContact(contact);
          const pickedContact = { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email };
          if (!proposal.quoteId) return { ok: true, pickedContact };
          const repointed = await get().applyProposal(
            {
              id: proposal.id,
              toolUseId: proposal.toolUseId,
              createdAt: proposal.createdAt,
              type: 'propose_update_customer',
              quoteId: proposal.quoteId,
              customerId: contact.id,
              customerName: contact.name,
            },
            onProgress,
            context,
          );
          return repointed.ok ? { ...repointed, pickedContact } : repointed;
        }

        case 'propose_add_line_item': {
          if (proposal.kind === 'work') {
            // A lump sum at a price the tradie said. Minted exactly as the
            // inline editor's Work item chip mints one — quantity 1, unit
            // 'each', price = line total, manual, no markup — so every
            // calculator, adapter and PDF path handles it unchanged. No
            // pipeline runs, so no plan gate either: a free account can type
            // a lump sum into the editor and this is the same act.
            const target = await resolveAny(proposal.quoteId);
            if (!target) return { ok: false, error: 'Quote not found.' };
            const paid = paidGuard(target);
            if (paid) return paid;
            const source = target.doc;
            // The figure as said, in the document's basis — the tradie's own
            // basis when they named one, otherwise no conversion at all.
            const price = rateLineUnitPrice(
              {
                label: proposal.searchTerm,
                quantity: 1,
                unit: 'job',
                unitPrice: proposal.price ?? 0,
                includesMaterials: true,
                ...(typeof proposal.pricesIncludeGst === 'boolean' ? { pricesIncludeGst: proposal.pricesIncludeGst } : {}),
              },
              resolveGstMode(source),
              get().businessSettings?.pricesIncludeGst === true,
            );
            const line: Material = withOrigin(
              {
                id: generateId(),
                name: proposal.searchTerm,
                kind: 'work',
                ...(proposal.scope ? { scope: proposal.scope } : {}),
                quantity: 1,
                unit: 'each',
                price,
                totalPrice: price,
                manualPriceOverride: true,
                pricingSource: 'manual',
                ...(proposal.section ? { section: proposal.section } : {}),
              } as Material,
              'manual',
            );
            const appliedTotal = await saveAny(target, { materials: [...(source.materials ?? []), line] });
            return {
              ok: true,
              ...(target.kind === 'document' ? {} : { navigate: { kind: 'job_preview', quoteId: source.id } }),
              appliedTotal,
            };
          }
          const gated = planGate();
          if (gated) return gated;
          // Try the user's supplier book FIRST — if the line item the
          // assistant is adding matches a saved supplier rate, price it
          // inline so the tradie doesn't have to wait for the pricing
          // pipeline (which was the previous behaviour and the source of
          // the "is it gone? … still cooking" UX). Pack-aware quantity is
          // computed via applyPackAwarePricing so a 32 m² ceiling pulls
          // ceil(32/8.08)=4 packs of Pink Batts at the saved rate, not 32
          // packs at the saved per-pack price.
          //
          // Falls back to a $0 stub when nothing in the supplier book
          // matches — the materials list pricing pass will resolve it on
          // next open (the old behaviour, preserved as the safety net).
          const baseUnit = normalizeMaterialUnit(proposal.unit);
          const stub: Material = withOrigin({
            id: generateId(),
            name: proposal.searchTerm,
            searchTerm: proposal.searchTerm,
            quantity: proposal.qty,
            unit: baseUnit,
            price: 0,
            totalPrice: 0,
            manualPriceOverride: false,
            ...(proposal.section ? { section: proposal.section } : {}),
          } as Material, 'recommended');

          // Local supplier-book lookup. Best-effort — any failure falls
          // through to the $0 stub so we never block adding the row.
          try {
            const supplierList = await loadSupplierGroups();
            const priorityOrder = get().businessSettings?.supplierPriority ?? [];
            const hits = await searchLocalSources(
              proposal.searchTerm,
              supplierList,
              { priorityOrder },
            );
            const top = hits[0];
            if (top && typeof top.price === 'number' && top.price > 0) {
              stub.name = top.productName || stub.name;
              stub.price = top.price;
              stub.unit = (top.unit as Material['unit']) || stub.unit;
              stub.pricingSource = 'manual';
              stub.priceConfidence = 'high';
              stub.manualPriceOverride = false;
              if (top.productUrl) stub.productUrl = top.productUrl;
              if (top.imageUrl) stub.imageUrl = top.imageUrl;
              // applyPackAwarePricing reads pack/coverage from the
              // saved-rate product name and recomputes quantity in packs
              // (e.g. 32 m² ÷ 8.08 m² per pack → 4 packs).
              applyPackAwarePricing(stub, { productName: top.productName });
              stub.totalPrice = roundToTwoDecimals(stub.price * stub.quantity);
            }
          } catch {
            // best-effort — keep the $0 stub.
          }

          const target = await resolveDocument(proposal.quoteId);
          if (target) {
            const next = await saveRecalculated({ ...target, materials: [...(target.materials ?? []), stub] });
            return { ok: true, appliedTotal: next.total };
          }
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!quote) return { ok: false, error: 'Quote not found.' };
          const next = updateQuoteCalculations({ ...quote, materials: [...quote.materials, stub], updatedAt: new Date() });
          await get().saveQuote(next);
          return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id }, appliedTotal: next.total };
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
          // Capture the parent job BEFORE we delete the doc — once the
          // document is gone we can't read its jobId back. We use this to
          // cascade-delete the parent Job when it has no other documents
          // attached. Without this, the assistant flow leaves an orphan
          // "Draft" job in the jobs list even though the user asked to
          // delete the quote (matching the manual ViewJobScreen flow,
          // which already cascades via cascadeDeleteJob).
          const parentJobId =
            target?.jobId ||
            get().quotes.find((q) => q.id === proposal.quoteId)?.jobId ||
            get().invoices.find((i) => i.id === proposal.quoteId)?.jobId;

          const cascadeParentJobIfOrphaned = async (deletedDocId: string) => {
            if (!parentJobId) return;
            try {
              const job = useJobStore.getState().getJobById(parentJobId);
              if (!job) return;
              // Count remaining docs across all sources, excluding the one
              // we just deleted. Includes the unified documents array, the
              // legacy quotes/invoices arrays, and the job's own
              // documentIds list — a doc may live in any subset depending
              // on how fresh it is.
              const remaining = new Set<string>();
              get().documents.forEach((d) => {
                if (d.id !== deletedDocId && d.jobId === parentJobId) remaining.add(d.id);
              });
              get().quotes.forEach((q) => {
                if (q.id !== deletedDocId && q.jobId === parentJobId) remaining.add(q.id);
              });
              get().invoices.forEach((i) => {
                if (i.id !== deletedDocId && i.jobId === parentJobId) remaining.add(i.id);
              });
              (job.documentIds || []).forEach((id) => {
                if (id !== deletedDocId) remaining.add(id);
              });
              if (remaining.size === 0) {
                await useJobStore.getState().deleteJob(parentJobId);
              }
            } catch {
              // best-effort — the doc was deleted, that's the main ask.
            }
          };

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
            await cascadeParentJobIfOrphaned(target.id);
            return { ok: true };
          }
          // Legacy fallbacks — the doc lives only in the old quotes/invoices
          // arrays (very fresh draft, not yet mirrored).
          const legacyQuote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (legacyQuote) {
            await get().deleteQuote(legacyQuote.id);
            await cascadeParentJobIfOrphaned(legacyQuote.id);
            return { ok: true };
          }
          const legacyInvoice = get().invoices.find((i) => i.id === proposal.quoteId);
          if (legacyInvoice) {
            await get().deleteInvoice(legacyInvoice.id);
            await cascadeParentJobIfOrphaned(legacyInvoice.id);
            return { ok: true };
          }
          return { ok: false, error: 'Quote not found — it may have already been deleted.' };
        }

        case 'propose_remember_preference': {
          // A standing rule about how they quote, saved to business settings so
          // it rides into every Mate session and every materials run — on this
          // phone and every other. Visible and removable under Trade pricing.
          const settings = get().businessSettings;
          if (!settings) return { ok: false, error: 'Set the business up first — there is nowhere to keep this yet.' };
          await get().setBusinessSettings({
            ...settings,
            quotingPreferences: addPreference(settings.quotingPreferences, proposal.text),
          });
          return { ok: true };
        }

        case 'propose_save_rate': {
          const settings = get().businessSettings;
          if (!settings) return { ok: false, error: 'Set the business up first — there is nowhere to keep this yet.' };
          await get().setBusinessSettings({
            ...settings,
            rateCard: upsertRate(settings.rateCard, {
              label: proposal.label,
              unit: proposal.unit,
              rate: proposal.rate,
              // The tradie's own basis when they said it; their usual one
              // otherwise. A business not registered for GST has no basis —
              // the card and the prompt then say nothing about GST.
              pricesIncludeGst:
                settings.gstRegistered === false
                  ? undefined
                  : (proposal.pricesIncludeGst ?? settings.pricesIncludeGst === true),
              includesMaterials: proposal.includesMaterials,
              notes: proposal.notes,
            }),
          });
          return { ok: true };
        }

        case 'propose_update_line_item': {
          // Change a row that's already on the doc. Mate could add lines and
          // delete lines but not correct one, so an unpriced row meant telling
          // the tradie to go and type it in — twice, in the conversation that
          // prompted this.
          let updatedRow: Material | undefined;
          const applyEdit = (materials: Material[]): { next: Material[]; found: boolean } => {
            let found = false;
            const next = materials.map((m) => {
              if (m.id !== proposal.materialId) return m;
              found = true;
              const price = proposal.price ?? m.price;
              // A lump sum keeps its shape: quantity 1, and the price IS the
              // line. A quantity the model passed for one is ignored.
              const quantity = m.kind === 'work' ? 1 : proposal.quantity ?? m.quantity;
              const row: Material = {
                ...m,
                name: proposal.name ?? m.name,
                price,
                quantity,
                // Stored, not derived — recompute or the customer sees the old
                // line total against the new unit price.
                totalPrice: Number((price * quantity).toFixed(2)),
                // A price the tradie set is a fact, not an estimate. Marking it
                // manual is also what clears the 'estimated' flag review_quote
                // raises, so a row they've just priced stops being reported as
                // needing a look.
                ...(proposal.price !== undefined
                  ? { pricingSource: 'manual' as const, priceConfidence: 'high' as const }
                  : {}),
              };
              updatedRow = row;
              return row;
            });
            return { next, found };
          };
          // A price the tradie gave Mate is remembered in the Supplier Book so
          // the next quote starts from THEIR number, not retail. Best-effort and
          // after the save: a failed book write must never fail the edit. The
          // book holds GST-inclusive prices, so the document's mode rides along.
          const rememberPrice = (source: { gstRegistered?: boolean; pricesIncludeGst?: boolean }) => {
            if (proposal.price === undefined || !updatedRow) return;
            // A lump sum is not a product price — "Callout $180" has no place
            // in a supplier book.
            if (updatedRow.kind === 'work') return;
            const row = updatedRow;
            const options = { pricesIncludeGst: keepSupplierPriceInclusive(source) };
            void import('../services/priceMemory')
              .then(({ rememberMaterialPrice }) => rememberMaterialPrice(row, undefined, options))
              .catch(() => {});
          };

          const target = await resolveDocument(proposal.quoteId);
          if (target) {
            const { next, found } = applyEdit(target.materials ?? []);
            if (!found) {
              return { ok: false, error: 'That line is not on the quote any more — call get_quote and try again.' };
            }
            const saved = await saveRecalculated({ ...target, materials: next });
            rememberPrice(target);
            return { ok: true, appliedTotal: saved.total };
          }
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (quote) {
            const { next, found } = applyEdit(quote.materials);
            if (!found) {
              return { ok: false, error: 'That line is not on the quote any more — call get_quote and try again.' };
            }
            const saved = updateQuoteCalculations({ ...quote, materials: next, updatedAt: new Date() });
            await get().saveQuote(saved);
            rememberPrice(quote);
            return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id }, appliedTotal: saved.total };
          }
          const invoice = get().invoices.find((i) => i.id === proposal.quoteId);
          if (invoice) {
            const { next, found } = applyEdit(invoice.materials);
            if (!found) {
              return { ok: false, error: 'That line is not on the invoice any more — call get_quote and try again.' };
            }
            const saved = updateQuoteCalculations({ ...invoice, materials: next, updatedAt: new Date() } as any) as any;
            await get().saveInvoice(saved);
            rememberPrice(invoice);
            return { ok: true, navigate: { kind: 'job_preview', quoteId: invoice.id }, appliedTotal: saved.total };
          }
          return { ok: false, error: 'Quote not found.' };
        }

        case 'propose_delete_line_item': {
          // Unified Document first so the legacy mirror tracks the change,
          // then the legacy quote/invoice arrays — one recalculating save.
          const target = await resolveAny(proposal.quoteId);
          if (!target) return { ok: false, error: 'Quote not found.' };
          const materials = target.doc.materials ?? [];
          const nextMaterials = materials.filter((m) => m.id !== proposal.materialId);
          if (nextMaterials.length === materials.length) {
            return { ok: false, error: 'Line not found — it may have already been removed.' };
          }
          const appliedTotal = await saveAny(target, { materials: nextMaterials });
          return {
            ok: true,
            ...(target.kind === 'quote' ? { navigate: { kind: 'job_preview', quoteId: target.doc.id } } : {}),
            appliedTotal,
          };
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
          const gated = planGate();
          if (gated) return gated;
          // The working card sits directly above the "Re-priced" bubble, which
          // now lists the flagged rows one per line (ReviewRows). Repeating the
          // full one-sentence summary here put the same wall of names on screen
          // twice, so the card carries just the count.
          const repriceCardSummary = (r: QuoteReview): string =>
            r.issues.length > 0 ? `${headlineFor(r)} — listed below.` : 'Every line came back with a real price.';
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
          // See the draft path — the fallback event is one-shot info, not a
          // progress frame, so it's accumulated outside the mapper.
          const missedSupplierTerms: string[] = [];

          const runReprice = async (source: Quote): Promise<{ priced: Quote; resetCount: number }> => {
            const { materials, resetCount, resetIds } = resetFlaggedRowsForReprice(source.materials, source.sections);
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
                  if (event.kind === 'supplier-priority-fallback') {
                    missedSupplierTerms.push(...event.missedTerms);
                  }
                  const next = pricingEventToProgress(event);
                  if (next) reportProgress(next);
                },
              },
            );
            // The re-fetch is deterministic — same term, same cache, same wrong
            // product. A row reset for implausible money that comes back just
            // as implausible gets wiped to $0 with an honest description
            // instead of looping the same bad match (QU-178763 re-priced its
            // $187.25 twins to the exact same $187.25).
            const wiped = wipeStillImplausibleRows(
              resetIds,
              priced.updatedQuote.materials,
              priced.updatedQuote.sections,
            );
            if (wiped.wipedCount > 0) {
              reportProgress({
                detail: `${wiped.wipedCount} row${wiped.wipedCount === 1 ? '' : 's'} kept coming back wrong — price wiped for you to set.`,
              });
            }
            return {
              priced: updateQuoteCalculations({ ...priced.updatedQuote, materials: wiped.materials }),
              resetCount,
            };
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
            const review = reviewQuoteMaterials(priced.materials, priced.sections);
            const supplierGap = await summariseSupplierGap(
              missedSupplierTerms,
              review.counts.estimated,
              priced.materials,
            );
            onProgress?.({ phase: 'done', status: 'Prices re-checked.', done: true, summary: repriceCardSummary(review) });
            return { ok: true, navigate: { kind: 'job_preview', quoteId: doc.id }, review, supplierGap };
          }

          // Legacy fallback: a draft still only in the quotes array.
          const quote = get().quotes.find((q) => q.id === proposal.quoteId);
          if (!quote) return { ok: false, error: 'Quote not found.' };
          const { priced } = await runReprice(quote);
          await get().saveQuote(priced);
          const review = reviewQuoteMaterials(priced.materials, priced.sections);
          const supplierGap = await summariseSupplierGap(
            missedSupplierTerms,
            review.counts.estimated,
            priced.materials,
          );
          onProgress?.({ phase: 'done', status: 'Prices re-checked.', done: true, summary: repriceCardSummary(review) });
          return { ok: true, navigate: { kind: 'job_preview', quoteId: quote.id }, review, supplierGap };
        }

        case 'propose_mark_paid': {
          // Resolve the invoice. Unified doc first; fall back to the legacy
          // invoices array for very old records that never made it through
          // the mirror.
          const doc = await resolveDocument(proposal.quoteId);
          if (doc && doc.type !== 'invoice') {
            return {
              ok: false,
              error: 'That\'s a quote, not an invoice. Convert it to an invoice first, then mark it paid.',
            };
          }
          let invoiceId: string | undefined = doc?.id;
          let total = Number(doc?.total ?? 0);
          let alreadyPaid = Number(doc?.paidTotal ?? 0);
          if (!invoiceId) {
            const legacy = get().invoices.find((i) => i.id === proposal.quoteId);
            if (!legacy) return { ok: false, error: 'Invoice not found.' };
            invoiceId = legacy.id;
            total = Number(legacy.total ?? 0);
            alreadyPaid = Number(legacy.paidAmount ?? 0);
          }
          const balance = Math.max(0, total - alreadyPaid);
          if (balance <= 0) {
            // Idempotent — no money to record. Surface a friendly note
            // instead of a hard error so Mate can reassure the tradie
            // the invoice is already settled.
            return {
              ok: true,
              navigate: { kind: 'open_invoice', invoiceId: invoiceId! },
              note: 'That invoice was already paid in full — nothing to record.',
            };
          }
          try {
            // Write the unified ledger when we resolved a real Document —
            // that's the id-space the app keeps loaded. Routing this through
            // the legacy recordPayment used to throw "Invoice not found" on
            // every modern invoice, because `invoices` is never populated at
            // bootstrap and a converted doc's id doesn't match its legacy row.
            if (doc) {
              await get().recordDocumentPayment(
                doc.id,
                balance,
                proposal.method ?? 'other',
                proposal.notes,
              );
            } else {
              await get().recordPayment(
                invoiceId!,
                balance,
                proposal.method ?? 'other',
                proposal.notes,
              );
            }
          } catch (err: any) {
            return { ok: false, error: err?.message || 'Failed to record payment.' };
          }
          return { ok: true, navigate: { kind: 'open_invoice', invoiceId: invoiceId! } };
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
        PRICING_RUN_LEDGER_KEY,
        // The Supplier Book cache (materialFavorites.ts, which can't be
        // imported here without a cycle). It is user data: left behind, the
        // next account on this phone would be priced off this one's rates,
        // and the cloud pull only ever ADDS to what is already local.
        'material_favorites',
        // NOT '@quotemate:job_list_prefs'. Which chip and sort the Jobs list
        // opens on is a per-device view preference, not user data — same
        // reasoning as appearance, which also survives sign-out. Don't "fix"
        // this by adding it.
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
