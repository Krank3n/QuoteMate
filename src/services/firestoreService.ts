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
  runTransaction,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Quote, BusinessSettings, SubscriptionStatus, Invoice, ReferralInfo } from '../types';

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
      console.log('No user signed in, skipping cloud sync');
      return;
    }

    try {
      const quoteRef = doc(db, 'users', userId, 'quotes', quote.id);
      await setDoc(quoteRef, stripUndefined({
        ...quote,
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
        // Handle new quote acceptance fields
        acceptanceToken: quote.acceptanceToken || null,
        acceptanceTokenCreatedAt: quote.acceptanceTokenCreatedAt?.toISOString() || null,
        respondedAt: quote.respondedAt?.toISOString() || null,
        respondedBy: quote.respondedBy || null,
        clientNotes: quote.clientNotes || null,
        syncedAt: new Date().toISOString(),
      }));
      console.log('✅ Quote saved to Firestore:', quote.id);
    } catch (error) {
      console.error('❌ Error saving quote to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load all quotes from Firestore
   */
  async loadQuotes(): Promise<Quote[]> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning empty quotes');
      return [];
    }

    try {
      const quotesRef = collection(db, 'users', userId, 'quotes');
      const q = query(quotesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const quotes: Quote[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          createdAt: new Date(data.createdAt),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(data.createdAt),
          // Handle new quote acceptance fields
          acceptanceTokenCreatedAt: data.acceptanceTokenCreatedAt ? new Date(data.acceptanceTokenCreatedAt) : undefined,
          respondedAt: data.respondedAt ? new Date(data.respondedAt) : undefined,
        } as Quote;
      });

      console.log(`✅ Loaded ${quotes.length} quotes from Firestore`);
      return quotes;
    } catch (error) {
      console.error('❌ Error loading quotes from Firestore:', error);
      return [];
    }
  }

  /**
   * Delete a quote from Firestore
   */
  async deleteQuote(quoteId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud delete');
      return;
    }

    try {
      const quoteRef = doc(db, 'users', userId, 'quotes', quoteId);
      await deleteDoc(quoteRef);
      console.log('✅ Quote deleted from Firestore:', quoteId);
    } catch (error) {
      console.error('❌ Error deleting quote from Firestore:', error);
      throw error;
    }
  }

  /**
   * Save business settings to Firestore
   */
  async saveBusinessSettings(settings: BusinessSettings): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud sync');
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
      console.log('✅ Business settings saved to Firestore');
    } catch (error) {
      console.error('❌ Error saving business settings to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load business settings from Firestore
   */
  async loadBusinessSettings(): Promise<BusinessSettings | null> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning null settings');
      return null;
    }

    try {
      const settingsRef = doc(db, 'users', userId, 'settings', 'business');
      const snapshot = await getDoc(settingsRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ Business settings loaded from Firestore');
        return data as BusinessSettings;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading business settings from Firestore:', error);
      return null;
    }
  }

  /**
   * Save onboarding status to Firestore
   */
  async saveOnboardingStatus(isOnboarded: boolean): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud sync');
      return;
    }

    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');
      await setDoc(profileRef, {
        isOnboarded,
        syncedAt: new Date().toISOString(),
      });
      console.log('✅ Onboarding status saved to Firestore');
    } catch (error) {
      console.error('❌ Error saving onboarding status to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load onboarding status from Firestore
   */
  async loadOnboardingStatus(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning false');
      return false;
    }

    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');
      const snapshot = await getDoc(profileRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ Onboarding status loaded from Firestore');
        return data.isOnboarded || false;
      }

      return false;
    } catch (error) {
      console.error('❌ Error loading onboarding status from Firestore:', error);
      return false;
    }
  }

  /**
   * Save tour status to Firestore
   */
  async saveTourStatus(hasSeenTour: boolean): Promise<void> {
    const userId = this.getUserId();
    if (!userId) return;

    try {
      const tourRef = doc(db, 'users', userId, 'profile', 'tour');
      await setDoc(tourRef, {
        hasSeenTour,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error saving tour status to Firestore:', error);
    }
  }

  /**
   * Load tour status from Firestore
   */
  async loadTourStatus(): Promise<boolean | null> {
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const tourRef = doc(db, 'users', userId, 'profile', 'tour');
      const snapshot = await getDoc(tourRef);

      if (snapshot.exists()) {
        return snapshot.data().hasSeenTour || false;
      }
      return null;
    } catch (error) {
      console.error('Error loading tour status from Firestore:', error);
      return null;
    }
  }

  /**
   * Save subscription status to Firestore
   */
  async saveSubscriptionStatus(subscriptionStatus: SubscriptionStatus): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud sync');
      return;
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');
      await setDoc(subscriptionRef, {
        isPro: subscriptionStatus.isPro,
        quotesThisMonth: subscriptionStatus.quotesThisMonth,
        currentPeriodStart: subscriptionStatus.currentPeriodStart.toISOString(),
        currentPeriodEnd: subscriptionStatus.currentPeriodEnd.toISOString(),
        freeQuotesLimit: subscriptionStatus.freeQuotesLimit,
        trialStartedAt: subscriptionStatus.trialStartedAt ? new Date(subscriptionStatus.trialStartedAt).toISOString() : null,
        trialExpired: subscriptionStatus.trialExpired || false,
        syncedAt: new Date().toISOString(),
      });
      console.log('✅ Subscription status saved to Firestore');
    } catch (error) {
      console.error('❌ Error saving subscription status to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load subscription status from Firestore
   */
  async loadSubscriptionStatus(): Promise<SubscriptionStatus | null> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning null subscription status');
      return null;
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');
      const snapshot = await getDoc(subscriptionRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ Subscription status loaded from Firestore');
        return {
          isPro: data.isPro,
          quotesThisMonth: data.quotesThisMonth,
          currentPeriodStart: new Date(data.currentPeriodStart),
          currentPeriodEnd: new Date(data.currentPeriodEnd),
          freeQuotesLimit: data.freeQuotesLimit,
          trialStartedAt: data.trialStartedAt ? new Date(data.trialStartedAt.toDate ? data.trialStartedAt.toDate() : data.trialStartedAt) : undefined,
          trialExpired: data.trialExpired || false,
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading subscription status from Firestore:', error);
      return null;
    }
  }

  /**
   * Listen to quotes changes in real-time
   */
  listenToQuotes(callback: (quotes: Quote[]) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping quotes listener');
      return null;
    }

    try {
      const quotesRef = collection(db, 'users', userId, 'quotes');
      const q = query(quotesRef, orderBy('createdAt', 'desc'));

      this.quotesUnsubscribe = onSnapshot(q, (snapshot) => {
        const quotes: Quote[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(data.createdAt),
            // Handle new quote acceptance fields
            acceptanceTokenCreatedAt: data.acceptanceTokenCreatedAt ? new Date(data.acceptanceTokenCreatedAt) : undefined,
            respondedAt: data.respondedAt ? new Date(data.respondedAt) : undefined,
          } as Quote;
        });

        console.log(`📡 Quotes updated from Firestore: ${quotes.length} quotes`);
        callback(quotes);
      }, (error) => {
        console.error('❌ Error in quotes listener:', error);
      });

      return this.quotesUnsubscribe;
    } catch (error) {
      console.error('❌ Error setting up quotes listener:', error);
      return null;
    }
  }

  /**
   * Listen to business settings changes in real-time
   */
  listenToBusinessSettings(callback: (settings: BusinessSettings | null) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping settings listener');
      return null;
    }

    try {
      const settingsRef = doc(db, 'users', userId, 'settings', 'business');

      this.settingsUnsubscribe = onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          console.log('📡 Business settings updated from Firestore');
          callback(data as BusinessSettings);
        } else {
          callback(null);
        }
      }, (error) => {
        console.error('❌ Error in settings listener:', error);
      });

      return this.settingsUnsubscribe;
    } catch (error) {
      console.error('❌ Error setting up settings listener:', error);
      return null;
    }
  }

  /**
   * Listen to onboarding status changes in real-time
   */
  listenToOnboardingStatus(callback: (isOnboarded: boolean) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping onboarding listener');
      return null;
    }

    try {
      const profileRef = doc(db, 'users', userId, 'profile', 'onboarding');

      this.onboardingUnsubscribe = onSnapshot(profileRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          console.log('📡 Onboarding status updated from Firestore');
          callback(data.isOnboarded || false);
        } else {
          callback(false);
        }
      }, (error) => {
        console.error('❌ Error in onboarding listener:', error);
      });

      return this.onboardingUnsubscribe;
    } catch (error) {
      console.error('❌ Error setting up onboarding listener:', error);
      return null;
    }
  }

  /**
   * Listen to subscription status changes in real-time
   */
  listenToSubscriptionStatus(callback: (subscriptionStatus: SubscriptionStatus | null) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping subscription listener');
      return null;
    }

    try {
      const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');

      this.subscriptionUnsubscribe = onSnapshot(subscriptionRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          console.log('📡 Subscription status updated from Firestore');
          callback({
            isPro: data.isPro,
            quotesThisMonth: data.quotesThisMonth,
            currentPeriodStart: new Date(data.currentPeriodStart),
            currentPeriodEnd: new Date(data.currentPeriodEnd),
            freeQuotesLimit: data.freeQuotesLimit,
            trialStartedAt: data.trialStartedAt ? new Date(data.trialStartedAt.toDate ? data.trialStartedAt.toDate() : data.trialStartedAt) : undefined,
            trialExpired: data.trialExpired || false,
          });
        } else {
          callback(null);
        }
      }, (error) => {
        console.error('❌ Error in subscription listener:', error);
      });

      return this.subscriptionUnsubscribe;
    } catch (error) {
      console.error('❌ Error setting up subscription listener:', error);
      return null;
    }
  }

  /**
   * Save an invoice to Firestore
   */
  async saveInvoice(invoice: Invoice): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud sync');
      return;
    }

    try {
      const invoiceRef = doc(db, 'users', userId, 'invoices', invoice.id);
      // Convert undefined values to null for Firestore compatibility
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
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        paidDate: invoice.paidDate?.toISOString() || null,
        // Xero integration fields
        xeroInvoiceId: invoice.xeroInvoiceId || null,
        xeroContactId: invoice.xeroContactId || null,
        xeroSyncStatus: invoice.xeroSyncStatus || null,
        xeroSyncedAt: invoice.xeroSyncedAt instanceof Date ? invoice.xeroSyncedAt.toISOString() : (invoice.xeroSyncedAt || null),
        xeroSyncError: invoice.xeroSyncError || null,
        syncedAt: new Date().toISOString(),
      }));
      console.log('✅ Invoice saved to Firestore:', invoice.id);
    } catch (error) {
      console.error('❌ Error saving invoice to Firestore:', error);
      throw error;
    }
  }

  /**
   * Load all invoices from Firestore
   */
  async loadInvoices(): Promise<Invoice[]> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning empty invoices');
      return [];
    }

    try {
      const invoicesRef = collection(db, 'users', userId, 'invoices');
      const q = query(invoicesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const invoices: Invoice[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
          issueDate: new Date(data.issueDate),
          dueDate: new Date(data.dueDate),
          paidDate: data.paidDate ? new Date(data.paidDate) : undefined,
          xeroSyncedAt: data.xeroSyncedAt ? new Date(data.xeroSyncedAt) : undefined,
        } as Invoice;
      });

      console.log(`✅ Loaded ${invoices.length} invoices from Firestore`);
      return invoices;
    } catch (error) {
      console.error('❌ Error loading invoices from Firestore:', error);
      return [];
    }
  }

  /**
   * Delete an invoice from Firestore
   */
  async deleteInvoice(invoiceId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping cloud delete');
      return;
    }

    try {
      const invoiceRef = doc(db, 'users', userId, 'invoices', invoiceId);
      await deleteDoc(invoiceRef);
      console.log('✅ Invoice deleted from Firestore:', invoiceId);
    } catch (error) {
      console.error('❌ Error deleting invoice from Firestore:', error);
      throw error;
    }
  }

  /**
   * Listen to invoices changes in real-time
   */
  listenToInvoices(callback: (invoices: Invoice[]) => void): Unsubscribe | null {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping invoices listener');
      return null;
    }

    try {
      const invoicesRef = collection(db, 'users', userId, 'invoices');
      const q = query(invoicesRef, orderBy('createdAt', 'desc'));

      this.invoicesUnsubscribe = onSnapshot(q, (snapshot) => {
        const invoices: Invoice[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
            issueDate: new Date(data.issueDate),
            dueDate: new Date(data.dueDate),
            paidDate: data.paidDate ? new Date(data.paidDate) : undefined,
            xeroSyncedAt: data.xeroSyncedAt ? new Date(data.xeroSyncedAt) : undefined,
          } as Invoice;
        });

        console.log(`📡 Invoices updated from Firestore: ${invoices.length} invoices`);
        callback(invoices);
      }, (error) => {
        console.error('❌ Error in invoices listener:', error);
      });

      return this.invoicesUnsubscribe;
    } catch (error) {
      console.error('❌ Error setting up invoices listener:', error);
      return null;
    }
  }

  /**
   * Load referral info from Firestore
   */
  async loadReferralInfo(): Promise<ReferralInfo | null> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, returning null referral info');
      return null;
    }

    try {
      const referralRef = doc(db, 'users', userId, 'profile', 'referral');
      const snapshot = await getDoc(referralRef);

      if (snapshot.exists()) {
        const data = snapshot.data();
        console.log('✅ Referral info loaded from Firestore');
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
      console.error('❌ Error loading referral info from Firestore:', error);
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
      console.log('No user signed in, skipping FCM token save');
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
      console.log('✅ FCM token saved to Firestore');
    } catch (error) {
      console.error('❌ Error saving FCM token:', error);
      throw error;
    }
  }

  /**
   * Remove FCM token when user logs out or disables notifications
   */
  async removeFcmToken(deviceId: string): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      console.log('No user signed in, skipping FCM token removal');
      return;
    }

    try {
      const tokenRef = doc(db, 'users', userId, 'fcmTokens', deviceId);
      await deleteDoc(tokenRef);
      console.log('✅ FCM token removed from Firestore');
    } catch (error) {
      console.error('❌ Error removing FCM token:', error);
      throw error;
    }
  }

  /**
   * Atomically check and increment the quote quota (server-side enforcement).
   * Returns the updated quota info, or throws if quota exceeded.
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
      const TRIAL_DAYS = 7;
      const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

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

        // Check if trial has expired
        const elapsed = now.getTime() - trialStartedAt.getTime();
        if (elapsed >= TRIAL_MS) {
          return { allowed: false, quotesThisMonth: data.quotesThisMonth || 0, isPro: false, trialStartedAt: trialStartedAt.toISOString(), trialExpired: true, trialDaysRemaining: 0 };
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
      console.error('❌ Error checking quota:', error);
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
    console.log('🧹 Firestore listeners cleaned up');
  }
}

export const firestoreService = new FirestoreService();
