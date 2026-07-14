/**
 * Firestore Service
 * Handles cloud synchronization of user data across devices
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
  query,
  orderBy,
  limit,
  runTransaction,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Quote, BusinessSettings, SubscriptionStatus, Invoice, ReferralInfo, Contact } from '../types';
import { Conversation } from '../types/assistant';
import { TRIAL_DAYS, TRIAL_MS } from '../utils/trialConfig';

/**
 * Master switch for Mate conversation logging. While this is on, every chat is
 * mirrored to Firestore (under the owning user) so we can review transcripts
 * and proposal outcomes to tune accuracy and chase down issues. Flip to false
 * to stop collecting once we've gathered enough — the only effect is that
 * `saveConversation` becomes a no-op; nothing else depends on it.
 */
export const ASSISTANT_LOGGING_ENABLED = true;

/**
 * Map any legacy invoice-style status that lived on a quote (back when Quote
 * had paid/partial/overdue in its enum) onto the closest current quote status.
 * One-shot read-time normalisation — we don't migrate the docs, we just stop
 * the bad values reaching the typed Quote shape.
 */
function normalizeQuoteStatus(status: any): Quote['status'] {
  switch (status) {
    case 'paid':
    case 'partial':
      return 'completed';
    case 'overdue':
      return 'sent';
    case 'draft':
    case 'sent':
    case 'accepted':
    case 'rejected':
    case 'completed':
    case 'cancelled':
      return status;
    default:
      return 'draft';
  }
}

/**
 * Build a SubscriptionStatus from a raw Firestore snapshot, migrating legacy
 * docs that predate the `plan` field. The Firestore field wins when present;
 * otherwise we infer from isPro/trialStartedAt so users with old docs land in
 * the right tier on their next load.
 */
function subscriptionFromSnapshotData(data: any): SubscriptionStatus {
  const trialStartedAt = data.trialStartedAt
    ? new Date(data.trialStartedAt.toDate ? data.trialStartedAt.toDate() : data.trialStartedAt)
    : undefined;

  // Trial expiry is recomputed live from `trialStartedAt + TRIAL_MS`. The
  // stored `data.trialExpired` flag is unreliable — it's only refreshed on
  // quota-check writes and can lag the truth on the snapshot (e.g. cohorts
  // we extended from 7 to 14 days). Many screens key off `!trialExpired` to
  // gate features, so this needs to be authoritative on load.
  const isProUser = data.isPro || data.plan === 'pro';
  const liveTrialExpired = !isProUser
    && !!trialStartedAt
    && Date.now() - trialStartedAt.getTime() >= TRIAL_MS;

  let plan: SubscriptionStatus['plan'];
  if (isProUser) {
    plan = 'pro';
  } else if (trialStartedAt) {
    plan = liveTrialExpired ? 'free' : 'trial';
  } else if (data.plan === 'trial' || data.plan === 'free') {
    plan = data.plan;
  } else {
    plan = 'trial';
  }

  return {
    isPro: data.isPro,
    plan,
    quotesThisMonth: data.quotesThisMonth,
    currentPeriodStart: new Date(data.currentPeriodStart),
    currentPeriodEnd: new Date(data.currentPeriodEnd),
    freeQuotesLimit: data.freeQuotesLimit,
    trialStartedAt,
    trialExpired: liveTrialExpired,
    dismissedUpgradeBanner: data.dismissedUpgradeBanner || false,
    platformFeeBps: typeof data.platformFeeBps === 'number' ? data.platformFeeBps : undefined,
  };
}

/** Recursively strip undefined values from an object (Firestore rejects them) */
function stripUndefined(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = typeof value === 'object' && value !== null ? stripUndefined(value) : value;
    }
  }
  return cleaned;
}

/**
 * Convert any Firestore-shaped date value into a JS Date.
 * Handles: Date, Firestore Timestamp, plain {seconds, nanoseconds}, ISO string, epoch number,
 * null/undefined. Returns undefined for missing or unparseable input — NEVER returns Invalid Date.
 *
 * This exists because cloud functions write `serverTimestamp()` (a Firestore Timestamp),
 * and the previous code did `new Date(timestampObj)` which silently produces Invalid Date.
 * Downstream `.toISOString()` calls then threw, breaking all subsequent saves for that quote.
 */
function toDate(value: any): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
  if (value instanceof Timestamp) return value.toDate();
  // Object that quacks like a Timestamp (covers SDK shape variations)
  if (typeof value === 'object' && typeof (value as any).toDate === 'function') {
    try {
      const d = (value as any).toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : undefined;
    } catch {
      // fall through
    }
  }
  // Plain object that survived JSON round-trip (e.g. {seconds, nanoseconds})
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return new Date((value as any).seconds * 1000 + ((value as any).nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * Convert a date-ish value into an ISO string for Firestore. Returns null for missing or
 * unparseable input — never throws. Use this in place of `value.toISOString()` whenever the
 * value originated from Firestore (could be a Timestamp object, not a JS Date).
 */
function safeIsoString(value: any): string | null {
  const d = toDate(value);
  return d ? d.toISOString() : null;
}

class FirestoreService {
  private quotesUnsubscribe: Unsubscribe | null = null;
  private settingsUnsubscribe: Unsubscribe | null = null;
  private onboardingUnsubscribe: Unsubscribe | null = null;
  private subscriptionUnsubscribe: Unsubscribe | null = null;
  private invoicesUnsubscribe: Unsubscribe | null = null;

  /**
   * Get the current user ID
   */
  private getUserId(): string | null {
    return auth.currentUser?.uid || null;
  }

  /**
   * Save a quote to Firestore
   */
  async saveQuote(quote: Quote): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const quoteRef = doc(db, 'users', userId, 'quotes', quote.id);
      // Use safeIsoString everywhere — these fields may have round-tripped through Firestore
      // as Timestamps and could be Invalid Dates if previously parsed with `new Date(<Timestamp>)`.
      // Use merge:true so we don't clobber server-only fields like acceptanceTokenHash that the
      // sendQuoteEmail cloud function maintains.
      //
      // We deliberately omit acceptanceTokenCreatedAt / respondedAt from the
      // payload when they have no value instead of writing `null`. The
      // acceptance-page expiry check does `new Date(foundQuote.acceptanceTokenCreatedAt)`
      // which, given a null, returns 1970 and makes every link look expired.
      // Writing null via merge would overwrite the server-stamped timestamp
      // from sendQuoteEmail if a local save races after the send completes.
      const payload: Record<string, any> = {
        ...quote,
        createdAt: safeIsoString(quote.createdAt) || new Date().toISOString(),
        updatedAt: safeIsoString(quote.updatedAt) || new Date().toISOString(),
        acceptanceToken: quote.acceptanceToken || null,
        respondedBy: quote.respondedBy || null,
        clientNotes: quote.clientNotes || null,
        invoicedAt: safeIsoString(quote.invoicedAt),
        syncedAt: new Date().toISOString(),
      };
      const tokenCreatedAtIso = safeIsoString(quote.acceptanceTokenCreatedAt);
      if (tokenCreatedAtIso) payload.acceptanceTokenCreatedAt = tokenCreatedAtIso;
      const respondedAtIso = safeIsoString(quote.respondedAt);
      if (respondedAtIso) payload.respondedAt = respondedAtIso;
      await setDoc(quoteRef, stripUndefined(payload), { merge: true });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Load all quotes from Firestore
   */
  async loadQuotes(): Promise<Quote[]> {
    const userId = this.getUserId();
    if (!userId) {
      return [];
    }

    try {
      const quotesRef = collection(db, 'users', userId, 'quotes');
      const q = query(quotesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const quotes: Quote[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        const createdAt = toDate(data.createdAt) || new Date();
        return {
          ...data,
          createdAt,
          updatedAt: toDate(data.updatedAt) || createdAt,
          status: normalizeQuoteStatus(data.status),
          invoicedAt: toDate(data.invoicedAt),
          // Handle new quote acceptance fields
          acceptanceTokenCreatedAt: toDate(data.acceptanceTokenCreatedAt),
          respondedAt: toDate(data.respondedAt),
        } as Quote;
      });

      return quotes;
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete a quote from Firestore
   */
  async deleteQuote(quoteId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const quoteRef = doc(db, 'users', userId, 'quotes', quoteId);
      await deleteDoc(quoteRef);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Save business settings to Firestore
   */
  async saveBusinessSettings(settings: BusinessSettings): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const settingsRef = doc(db, 'users', userId, 'settings', 'business');

      // Remove undefined values as Firestore doesn't support them
      const cleanedSettings = Object.entries(settings).reduce((acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {} as any);

      await setDoc(settingsRef, {
        ...cleanedSettings,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Load business settings from Firestore
   */
  async loadBusinessSettings(): Promise<BusinessSettings | null> {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      const settingsRef = doc(db, 'users', userId, 'settings', 'business');
      const snapshot = await getDoc(settingsRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        return data as BusinessSettings;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save onboarding status to Firestore
   */
  async saveOnboardingStatus(isOnboarded: boolean): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');
      await setDoc(profileRef, {
        isOnboarded,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Load onboarding status from Firestore
   */
  async loadOnboardingStatus(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) {
      return false;
    }

    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');
      const snapshot = await getDoc(profileRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        return data.isOnboarded || false;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Save subscription status to Firestore
   */
  async saveSubscriptionStatus(subscriptionStatus: SubscriptionStatus): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');
      await setDoc(subscriptionRef, {
        isPro: subscriptionStatus.isPro,
        plan: subscriptionStatus.plan ?? null,
        quotesThisMonth: subscriptionStatus.quotesThisMonth,
        currentPeriodStart: subscriptionStatus.currentPeriodStart.toISOString(),
        currentPeriodEnd: subscriptionStatus.currentPeriodEnd.toISOString(),
        freeQuotesLimit: subscriptionStatus.freeQuotesLimit,
        trialStartedAt: subscriptionStatus.trialStartedAt ? new Date(subscriptionStatus.trialStartedAt).toISOString() : null,
        trialExpired: subscriptionStatus.trialExpired || false,
        dismissedUpgradeBanner: subscriptionStatus.dismissedUpgradeBanner || false,
        platformFeeBps: subscriptionStatus.platformFeeBps ?? null,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cloud floor for the next-quote-number counter. Written by the July 2026
   * incident-reclaim function so restored accounts continue numbering where
   * they left off; absent for everyone else.
   */
  async loadQuoteCounterFloor(): Promise<number | null> {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      const snapshot = await getDoc(doc(db, 'users', userId, 'settings', 'counters'));
      const n = snapshot.exists() ? snapshot.data()?.nextQuoteNumber : null;
      return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Load subscription status from Firestore
   */
  async loadSubscriptionStatus(): Promise<SubscriptionStatus | null> {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');
      const snapshot = await getDoc(subscriptionRef);

      if (snapshot.exists()) {
        return subscriptionFromSnapshotData(snapshot.data());
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Listen to quotes changes in real-time
   */
  listenToQuotes(callback: (quotes: Quote[]) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      // Release the prior listener before creating a new one. Firebase auth
      // token-refresh fires onAuthStateChanged every hour, which re-invokes
      // this method — without this release, listeners stack and every Firestore
      // write triggers N parallel snapshot replays after N hours of use.
      this.quotesUnsubscribe?.();
      const quotesRef = collection(db, 'users', userId, 'quotes');
      // Cap the live listener at 100 most-recent quotes so power users with
      // years of history don't pay a full-tree re-render on every write.
      // Older docs are still fetchable via getQuotes() / archive views.
      const q = query(quotesRef, orderBy('createdAt', 'desc'), limit(100));

      this.quotesUnsubscribe = onSnapshot(q, (snapshot) => {
        const quotes: Quote[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          const createdAt = toDate(data.createdAt) || new Date();
          return {
            ...data,
            createdAt,
            updatedAt: toDate(data.updatedAt) || createdAt,
            status: normalizeQuoteStatus(data.status),
            invoicedAt: toDate(data.invoicedAt),
            // Handle new quote acceptance fields
            acceptanceTokenCreatedAt: toDate(data.acceptanceTokenCreatedAt),
            respondedAt: toDate(data.respondedAt),
          } as Quote;
        });

        callback(quotes);
      }, (error) => {
      });

      return this.quotesUnsubscribe;
    } catch (error) {
      return null;
    }
  }

  /**
   * Listen to business settings changes in real-time
   */
  listenToBusinessSettings(callback: (settings: BusinessSettings | null) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      this.settingsUnsubscribe?.();
      const settingsRef = doc(db, 'users', userId, 'settings', 'business');

      this.settingsUnsubscribe = onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          callback(data as BusinessSettings);
        } else {
          callback(null);
        }
      }, (error) => {
      });

      return this.settingsUnsubscribe;
    } catch (error) {
      return null;
    }
  }

  /**
   * Listen to onboarding status changes in real-time
   */
  listenToOnboardingStatus(callback: (isOnboarded: boolean) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      this.onboardingUnsubscribe?.();
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');

      this.onboardingUnsubscribe = onSnapshot(profileRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          callback(data.isOnboarded || false);
        } else {
          callback(false);
        }
      }, (error) => {
      });

      return this.onboardingUnsubscribe;
    } catch (error) {
      return null;
    }
  }

  /**
   * Listen to subscription status changes in real-time
   */
  listenToSubscriptionStatus(callback: (subscriptionStatus: SubscriptionStatus | null) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      this.subscriptionUnsubscribe?.();
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');

      this.subscriptionUnsubscribe = onSnapshot(subscriptionRef, (snapshot) => {
        if (snapshot.exists()) {
          callback(subscriptionFromSnapshotData(snapshot.data()));
        } else {
          callback(null);
        }
      }, (error) => {
      });

      return this.subscriptionUnsubscribe;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save an invoice to Firestore
   */
  async saveInvoice(invoice: Invoice): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const invoiceRef = doc(db, 'users', userId, 'invoices', invoice.id);
      // Use safeIsoString — these dates may have round-tripped through Firestore as Timestamps,
      // and the previous `.toISOString()` calls would throw on Invalid Date and silently kill
      // every subsequent sync. Use merge:true so we don't clobber server-only fields like
      // sentAt or status that the sendInvoiceEmail cloud function maintains.
      const nowIso = new Date().toISOString();
      await setDoc(invoiceRef, stripUndefined({
        ...invoice,
        // Optional string fields - convert undefined to null
        invoiceNumber: invoice.invoiceNumber || null,
        customerEmail: invoice.customerEmail || null,
        customerPhone: invoice.customerPhone || null,
        jobAddress: invoice.jobAddress || null,
        notes: invoice.notes || null,
        sourceQuoteId: invoice.sourceQuoteId || null,
        paymentNotes: invoice.paymentNotes || null,
        paymentMethod: invoice.paymentMethod || null,
        // Optional number fields
        customPaymentDays: invoice.customPaymentDays ?? null,
        paidAmount: invoice.paidAmount ?? null,
        // Date fields
        createdAt: safeIsoString(invoice.createdAt) || nowIso,
        updatedAt: safeIsoString(invoice.updatedAt) || nowIso,
        issueDate: safeIsoString(invoice.issueDate) || nowIso,
        dueDate: safeIsoString(invoice.dueDate) || nowIso,
        paidDate: safeIsoString(invoice.paidDate),
        // Xero integration fields
        xeroInvoiceId: invoice.xeroInvoiceId || null,
        xeroContactId: invoice.xeroContactId || null,
        xeroSyncStatus: invoice.xeroSyncStatus || null,
        xeroSyncedAt: safeIsoString(invoice.xeroSyncedAt),
        xeroSyncError: invoice.xeroSyncError || null,
        syncedAt: nowIso,
      }), { merge: true });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Load all invoices from Firestore
   */
  async loadInvoices(): Promise<Invoice[]> {
    const userId = this.getUserId();
    if (!userId) {
      return [];
    }

    try {
      const invoicesRef = collection(db, 'users', userId, 'invoices');
      const q = query(invoicesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const invoices: Invoice[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        const createdAt = toDate(data.createdAt) || new Date();
        return {
          ...data,
          createdAt,
          updatedAt: toDate(data.updatedAt) || createdAt,
          issueDate: toDate(data.issueDate) || createdAt,
          dueDate: toDate(data.dueDate) || createdAt,
          paidDate: toDate(data.paidDate),
          xeroSyncedAt: toDate(data.xeroSyncedAt),
        } as Invoice;
      });

      return invoices;
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete an invoice from Firestore
   */
  async deleteInvoice(invoiceId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const invoiceRef = doc(db, 'users', userId, 'invoices', invoiceId);
      await deleteDoc(invoiceRef);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Listen to invoices changes in real-time
   */
  listenToInvoices(callback: (invoices: Invoice[]) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      this.invoicesUnsubscribe?.();
      const invoicesRef = collection(db, 'users', userId, 'invoices');
      const q = query(invoicesRef, orderBy('createdAt', 'desc'), limit(100));

      this.invoicesUnsubscribe = onSnapshot(q, (snapshot) => {
        const invoices: Invoice[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          const createdAt = toDate(data.createdAt) || new Date();
          return {
            ...data,
            createdAt,
            updatedAt: toDate(data.updatedAt) || createdAt,
            issueDate: toDate(data.issueDate) || createdAt,
            dueDate: toDate(data.dueDate) || createdAt,
            paidDate: toDate(data.paidDate),
            xeroSyncedAt: toDate(data.xeroSyncedAt),
          } as Invoice;
        });

        callback(invoices);
      }, (error) => {
      });

      return this.invoicesUnsubscribe;
    } catch (error) {
      return null;
    }
  }

  /**
   * Load referral info from Firestore
   */
  async loadReferralInfo(): Promise<ReferralInfo | null> {
    const userId = this.getUserId();
    if (!userId) {
      return null;
    }

    try {
      const referralRef = doc(db, 'users', userId, 'profile', 'referral');
      const snapshot = await getDoc(referralRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        return {
          referralCode: data.referralCode,
          referredBy: data.referredBy || null,
          totalReferrals: data.totalReferrals || 0,
          convertedReferrals: data.convertedReferrals || 0,
          // Affiliate fields
          isAffiliate: data.isAffiliate || false,
          commissionRate: data.commissionRate || 0.50,
          totalEarnings: data.totalEarnings || 0,
          pendingEarnings: data.pendingEarnings || 0,
          paidEarnings: data.paidEarnings || 0,
          lastPayoutAt: data.lastPayoutAt ? new Date(data.lastPayoutAt.toDate ? data.lastPayoutAt.toDate() : data.lastPayoutAt) : null,
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save FCM token for push notifications
   * Stores the token with device info for multi-device support
   */
  async saveFcmToken(token: string, deviceId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const tokenRef = doc(db, 'users', userId, 'fcmTokens', deviceId);
      await setDoc(tokenRef, {
        token,
        deviceId,
        platform: require('react-native').Platform.OS,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove FCM token when user logs out or disables notifications
   */
  async removeFcmToken(deviceId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const tokenRef = doc(db, 'users', userId, 'fcmTokens', deviceId);
      await deleteDoc(tokenRef);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Save a contact to Firestore
   */
  async saveContact(contact: Contact): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const contactRef = doc(db, 'users', userId, 'contacts', contact.id);
      await setDoc(contactRef, stripUndefined({
        ...contact,
        syncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Load all contacts from Firestore
   */
  async loadContacts(): Promise<Contact[]> {
    const userId = this.getUserId();
    if (!userId) {
      return [];
    }

    try {
      const contactsRef = collection(db, 'users', userId, 'contacts');
      const q = query(contactsRef, orderBy('name'));
      const snapshot = await getDocs(q);

      // Always use the Firestore document id as the contact id. The doc
      // data may carry its own `id` field (saveContact spreads ...contact)
      // but if those two ever drift — legacy migration, partial write,
      // server-side seed — every other read in the app (and Mate's
      // find_customer tool, which returns doc.id) breaks because the local
      // contact.id doesn't match anything on the server. doc.id is the
      // source of truth.
      const contacts: Contact[] = snapshot.docs.map((doc) => ({
        ...(doc.data() as Contact),
        id: doc.id,
      }));

      return contacts;
    } catch (error) {
      return [];
    }
  }

  /**
   * Fetch a single contact by doc id. Used by Mate's applyProposal as a
   * fallback when find_customer returned a contactId that isn't yet in the
   * local cache — without this, the chat would dead-end with a stale-contact
   * error even though the contact exists server-side.
   */
  async getContactById(contactId: string): Promise<Contact | null> {
    const userId = this.getUserId();
    if (!userId || !contactId) return null;
    try {
      const ref = doc(db, 'users', userId, 'contacts', contactId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { ...(snap.data() as Contact), id: snap.id };
    } catch {
      return null;
    }
  }

  /**
   * Delete a contact from Firestore
   */
  async deleteContact(contactId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      const contactRef = doc(db, 'users', userId, 'contacts', contactId);
      await deleteDoc(contactRef);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Batch save multiple contacts to Firestore
   */
  async saveContacts(contacts: Contact[]): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      return;
    }

    try {
      for (const contact of contacts) {
        const contactRef = doc(db, 'users', userId, 'contacts', contact.id);
        await setDoc(contactRef, stripUndefined({
          ...contact,
          syncedAt: new Date().toISOString(),
        }));
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Mirror a Mate conversation to Firestore for review/telemetry.
   *
   * Stored under the owning user (users/{uid}/assistantConversations/{id}) so
   * the existing owner rule already permits the write — no firestore.rules
   * change — while an admin `collectionGroup('assistantConversations')` query
   * can sweep every user's chats at once for tuning. merge:true overwrites the
   * latest full snapshot each flush (Firestore replaces the messages array
   * wholesale, which is what we want). Best-effort: a logging failure must
   * never surface to the user, so errors are swallowed.
   *
   * No-op when logging is disabled, when signed out, or before the first
   * message lands (an empty conversation isn't worth a doc).
   */
  async saveConversation(conversation: Conversation): Promise<void> {
    if (!ASSISTANT_LOGGING_ENABLED) return;
    const userId = this.getUserId();
    if (!userId) return;
    if (!conversation?.id || !conversation.messages?.length) return;

    try {
      const ref = doc(db, 'users', userId, 'assistantConversations', conversation.id);
      await setDoc(
        ref,
        stripUndefined({
          id: conversation.id,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          messages: conversation.messages,
          messageCount: conversation.messages.length,
          platform: require('react-native').Platform.OS,
          syncedAt: new Date().toISOString(),
        }),
        { merge: true },
      );
    } catch {
      // Telemetry is best-effort — swallow so logging never breaks the chat.
    }
  }

  /**
   * Atomically increment the quote count and report subscription state.
   * Every tier may create quotes (free is unlimited — the paid gate is on
   * sending); `allowed` stays in the shape for the callers' safety check.
   */
  async checkAndIncrementQuota(): Promise<{ allowed: boolean; quotesThisMonth: number; isPro: boolean; trialStartedAt?: string; trialExpired?: boolean; trialDaysRemaining?: number }> {
    const userId = this.getUserId();
    if (!userId) {
      throw new Error('No user signed in');
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const result = await runTransaction(db, async (transaction) => {
        const subscriptionDoc = await transaction.get(subscriptionRef);
        let data = subscriptionDoc.exists() ? subscriptionDoc.data()! : {
          isPro: false,
          quotesThisMonth: 0,
          currentPeriodStart: monthStart.toISOString(),
          currentPeriodEnd: monthEnd.toISOString(),
        };

        // Check if we need to reset monthly count (new month)
        const periodEnd = new Date(data.currentPeriodEnd);
        if (now > periodEnd) {
          data = {
            ...data,
            quotesThisMonth: 0,
            currentPeriodStart: monthStart.toISOString(),
            currentPeriodEnd: monthEnd.toISOString(),
          };
        }

        // Pro users always allowed
        if (data.isPro) {
          const newCount = (data.quotesThisMonth || 0) + 1;
          transaction.set(subscriptionRef, {
            ...data,
            quotesThisMonth: newCount,
            syncedAt: new Date().toISOString(),
          });
          return { allowed: true, quotesThisMonth: newCount, isPro: true, trialStartedAt: data.trialStartedAt, trialExpired: false, trialDaysRemaining: undefined };
        }

        // Free users: check trial
        const trialStartedAt = data.trialStartedAt
          ? new Date(data.trialStartedAt.toDate ? data.trialStartedAt.toDate() : data.trialStartedAt)
          : null;

        if (!trialStartedAt) {
          // First quote - start the trial
          const newCount = (data.quotesThisMonth || 0) + 1;
          transaction.set(subscriptionRef, {
            ...data,
            quotesThisMonth: newCount,
            trialStartedAt: now.toISOString(),
            syncedAt: new Date().toISOString(),
          });
          return { allowed: true, quotesThisMonth: newCount, isPro: false, trialStartedAt: now.toISOString(), trialExpired: false, trialDaysRemaining: TRIAL_DAYS };
        }

        // Trial expired → free tier. Creation stays unlimited on free (the
        // paid gate is on sending — see quoteDeliveryGuard), so count the
        // quote and flag trialExpired instead of blocking.
        const elapsed = now.getTime() - trialStartedAt.getTime();
        if (elapsed >= TRIAL_MS) {
          const newCount = (data.quotesThisMonth || 0) + 1;
          transaction.set(subscriptionRef, {
            ...data,
            quotesThisMonth: newCount,
            syncedAt: new Date().toISOString(),
          });
          return { allowed: true, quotesThisMonth: newCount, isPro: false, trialStartedAt: trialStartedAt.toISOString(), trialExpired: true, trialDaysRemaining: 0 };
        }

        // Trial still active - allow
        const newCount = (data.quotesThisMonth || 0) + 1;
        const daysRemaining = Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000));
        transaction.set(subscriptionRef, {
          ...data,
          quotesThisMonth: newCount,
          syncedAt: new Date().toISOString(),
        });

        return { allowed: true, quotesThisMonth: newCount, isPro: false, trialStartedAt: trialStartedAt.toISOString(), trialExpired: false, trialDaysRemaining: daysRemaining };
      });

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clean up all listeners
   */
  cleanup(): void {
    if (this.quotesUnsubscribe) {
      this.quotesUnsubscribe();
      this.quotesUnsubscribe = null;
    }
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }
    if (this.onboardingUnsubscribe) {
      this.onboardingUnsubscribe();
      this.onboardingUnsubscribe = null;
    }
    if (this.subscriptionUnsubscribe) {
      this.subscriptionUnsubscribe();
      this.subscriptionUnsubscribe = null;
    }
    if (this.invoicesUnsubscribe) {
      this.invoicesUnsubscribe();
      this.invoicesUnsubscribe = null;
    }
  }
}

export const firestoreService = new FirestoreService();
