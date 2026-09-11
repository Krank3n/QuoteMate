/**
 * What the business still has to put on a document before it goes out.
 *
 * Onboarding used to demand a phone, an email and an ABN on step 3, before
 * the tradie had written a single quote. It doesn't any more — those details
 * belong at the moment they matter, which is the first time a document with
 * the business's name on it is about to reach a customer.
 *
 * Two things are worth interrupting a send for:
 *
 *   ABN, on an invoice. An invoice without an ABN is not a valid tax invoice
 *   (shared/pdf/htmlBuilders.ts titles it "TAX INVOICE" regardless), the
 *   customer can't claim the GST credit, and a payer is technically obliged
 *   to withhold 47% of the payment. A quote asks for money later, so it is
 *   left alone.
 *
 *   A way to reply. buildBusinessHeaderHTML drops the contact line entirely
 *   when there's no phone and no email, so the document reaches the customer
 *   with no way of getting back to the tradie and nothing anywhere says so.
 *
 * Nothing here blocks a send. Plenty of sole traders are mid-ABN-application,
 * and the send is the activation event — "Send anyway" stays the primary
 * button, and taking it records the gap so the same prompt never nags again.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** A detail the document needs and the business hasn't got. */
export type MissingSendDetail = 'businessName' | 'abn' | 'contact';

/** Just the fields this decision reads — callers pass their settings object. */
export interface SendBusinessDetails {
  businessName?: string;
  abn?: string;
  phone?: string;
  email?: string;
}

export interface SendDetailsPrompt {
  title: string;
  message: string;
  /**
   * The exact gap being reported. A dismissal is remembered against this, so
   * a tradie who waved away "no ABN" still hears about it the day their phone
   * number goes missing too.
   */
  signature: string;
}

const has = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

/**
 * What's missing, in the order it should be read out. Empty means the send
 * has everything it needs.
 */
export function missingBusinessDetailsForSend(
  business: SendBusinessDetails | null | undefined,
  kind: 'quote' | 'invoice',
): MissingSendDetail[] {
  const missing: MissingSendDetail[] = [];
  if (!has(business?.businessName)) missing.push('businessName');
  // Only an invoice is a tax document. Nagging about an ABN on a quote would
  // train people to dismiss this before it ever says anything that matters.
  if (kind === 'invoice' && !has(business?.abn)) missing.push('abn');
  if (!has(business?.phone) && !has(business?.email)) missing.push('contact');
  return missing;
}

const LINES: Record<MissingSendDetail, (kind: 'quote' | 'invoice') => string> = {
  businessName: (kind) =>
    `This ${kind} goes out with no business name on it.`,
  abn: () =>
    "Without your ABN this isn't a valid tax invoice, so your customer can't claim the GST back — and whoever pays it is meant to hold back 47%.",
  contact: (kind) =>
    `There's no phone number or email on it, so nobody reading this ${kind} has a way to get back to you.`,
};

const TITLES: Record<MissingSendDetail, string> = {
  businessName: 'Add your business name?',
  abn: 'Add your ABN?',
  contact: 'Add your contact details?',
};

/**
 * The prompt to show before this send, or null when there's nothing to say.
 * Pure — the screen decides whether it has already been dismissed.
 */
export function buildSendDetailsPrompt(
  missing: MissingSendDetail[],
  kind: 'quote' | 'invoice',
): SendDetailsPrompt | null {
  if (missing.length === 0) return null;
  return {
    title: missing.length === 1 ? TITLES[missing[0]] : 'Add your business details?',
    message: `${missing.map((m) => LINES[m](kind)).join('\n\n')}\n\nAdd it once and it's on every quote and invoice from here on.`,
    signature: missing.join(','),
  };
}

/**
 * Whether to interrupt this send. `dismissed` is the signature the tradie last
 * chose to send past; an identical gap stays quiet, a different one asks.
 */
export function shouldAskForSendDetails(
  prompt: SendDetailsPrompt | null,
  dismissed: string | null,
): boolean {
  if (!prompt) return false;
  return prompt.signature !== dismissed;
}

/** Device-local memory of the last gap the tradie deliberately sent past. */
const DISMISSED_KEY = '@quotemate:send_details_dismissed';

/** The signature last waved away, or null. Never throws. */
export async function readDismissedSendDetails(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Remember that this exact gap was sent past. Never throws. */
export async function rememberDismissedSendDetails(signature: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, signature);
  } catch {
    // A prompt that asks twice is better than a send that fails on storage.
  }
}
