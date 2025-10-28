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
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Quote, BusinessSettings, SubscriptionStatus } from '../types';

class FirestoreService {
  private quotesUnsubscribe: Unsubscribe | null = null;
  private settingsUnsubscribe: Unsubscribe | null = null;
  private onboardingUnsubscribe: Unsubscribe | null = null;
  private subscriptionUnsubscribe: Unsubscribe | null = null;

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
      await setDoc(quoteRef, {
        ...quote,
        createdAt: quote.createdAt.toISOString(),
        updatedAt: quote.updatedAt.toISOString(),
        syncedAt: new Date().toISOString(),
      });
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
          updatedAt: new Date(data.updatedAt),
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
            updatedAt: new Date(data.updatedAt),
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
    console.log('🧹 Firestore listeners cleaned up');
  }
}

export const firestoreService = new FirestoreService();
