import { Platform } from 'react-native';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { unifiedBillingService } from './unifiedBillingService';

/**
 * Subscription Sync Service
 * Syncs subscription status across all platforms
 * - Web: Syncs from Firestore (updated by Stripe webhooks)
 * - iOS/Android: Syncs from native IAP and optionally to Firestore
 */

class SubscriptionSyncService {
  private unsubscribeListener: Unsubscribe | null = null;

  /**
   * Initialize subscription sync
   * Sets up listeners and syncs current status
   */
  async initialize(): Promise<void> {
    try {
      console.log('🔄 Initializing subscription sync...');

      if (Platform.OS === 'web') {
        // For web, listen to Firestore changes
        await this.setupFirestoreListener();
      } else {
        // For native, check local purchases
        await this.syncNativeSubscription();
      }

      console.log('✅ Subscription sync initialized');
    } catch (error) {
      console.error('❌ Error initializing subscription sync:', error);
    }
  }

  /**
   * Set up Firestore listener for web
   * Listens to subscription changes in real-time
   */
  private async setupFirestoreListener(): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log('ℹ️ No user signed in, skipping Firestore listener');
      return;
    }

    const userId = currentUser.uid;
    const subscriptionRef = doc(db, 'users', userId, 'profile', 'subscription');

    // Listen to subscription changes
    this.unsubscribeListener = onSnapshot(
      subscriptionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const isPremium = data.isPro === true;
          const subscriptionId = data.subscriptionId || data.transactionId || null;
          const expiryDate = data.currentPeriodEnd || null;

          console.log('📡 Subscription updated from Firestore:', {
            isPremium,
            subscriptionId,
            expiryDate,
          });

          // Update local store
          useSubscriptionStore.getState().setPremium(isPremium, subscriptionId, expiryDate);
        } else {
          console.log('ℹ️ No subscription data in Firestore');
          useSubscriptionStore.getState().setPremium(false);
        }
      },
      (error) => {
        console.error('❌ Error in Firestore listener:', error);
      }
    );
  }

  /**
   * Sync native subscription (iOS/Android)
   * Checks local purchases and updates store
   */
  private async syncNativeSubscription(): Promise<void> {
    try {
      const status = await unifiedBillingService.getSubscriptionStatus();

      console.log('📱 Native subscription status:', status);

      if (status.isPremium) {
        await useSubscriptionStore.getState().setPremium(
          true,
          status.subscriptionId || undefined,
          status.expiryDate || undefined
        );
      } else {
        await useSubscriptionStore.getState().setPremium(false);
      }
    } catch (error) {
      console.error('❌ Error syncing native subscription:', error);
    }
  }

  /**
   * Manually sync subscription status
   * Call this after a purchase or when needed
   */
  async syncNow(): Promise<void> {
    try {
      console.log('🔄 Manually syncing subscription status...');

      if (Platform.OS === 'web') {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.log('ℹ️ No user signed in');
          return;
        }

        const status = await unifiedBillingService.getSubscriptionStatus(currentUser.uid);
        await useSubscriptionStore.getState().setPremium(
          status.isPremium,
          status.subscriptionId || undefined,
          status.expiryDate || undefined
        );
      } else {
        await this.syncNativeSubscription();
      }

      console.log('✅ Subscription synced');
    } catch (error) {
      console.error('❌ Error syncing subscription:', error);
    }
  }

  /**
   * Clean up listeners
   */
  cleanup(): void {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
      console.log('🧹 Subscription listener cleaned up');
    }
  }
}

export const subscriptionSyncService = new SubscriptionSyncService();
