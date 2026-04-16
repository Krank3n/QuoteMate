/**
 * Analytics Service
 * Logs conversion funnel events to Firestore for tracking user journey:
 * signup → onboarding → tour → quote creation → paywall → purchase → Square.
 *
 * Uses Firestore (not firebase/analytics) because the app runs on the Firebase
 * JS SDK which doesn't support analytics on React Native. Firestore works on
 * all platforms immediately.
 *
 * All writes are fire-and-forget — analytics must never block the UI.
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Platform } from 'react-native';
import { db, auth } from '../config/firebase';

const ANALYTICS_COLLECTION = 'analytics_events';

function trackEvent(event: string, properties?: Record<string, any>): void {
  try {
    const userId = auth.currentUser?.uid ?? null;
    addDoc(collection(db, ANALYTICS_COLLECTION), {
      userId,
      event,
      properties: properties ?? {},
      platform: Platform.OS,
      timestamp: serverTimestamp(),
    });
  } catch {
    // Swallow — analytics should never crash the app
  }
}

// ── Auth ──
export function trackSignup(method: string): void {
  trackEvent('signup_complete', { method });
}

// ── Onboarding ──
export function trackOnboardingComplete(stepsCompleted: number): void {
  trackEvent('onboarding_complete', { stepsCompleted });
}

// ── Tour ──
export function trackTourComplete(skipped: boolean): void {
  trackEvent(skipped ? 'tour_skipped' : 'tour_complete');
}

// ── Paywall ──
export function trackPaywallShown(): void {
  trackEvent('paywall_shown');
}

export function trackPaywallDismissed(): void {
  trackEvent('paywall_dismissed');
}

export function trackPurchaseStarted(plan: string): void {
  trackEvent('pro_purchase_started', { plan });
}

export function trackPurchaseComplete(plan: string): void {
  trackEvent('pro_purchase_complete', { plan });
}

// ── Square ──
export function trackSquareConnected(): void {
  trackEvent('square_connected');
}

// ── Quotes ──
export function trackFirstQuoteCreated(): void {
  trackEvent('first_quote_created');
}

export function trackFirstQuoteSent(): void {
  trackEvent('first_quote_sent');
}
