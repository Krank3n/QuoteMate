/**
 * Quote Acceptance Service
 * Handles generation of secure acceptance links for email-based quote responses
 */

import { auth } from '../config/firebase';

// Firebase Function base URL
const FUNCTIONS_BASE_URL = 'https://us-central1-hansendev.cloudfunctions.net';

interface GenerateAcceptanceLinkResponse {
  success: boolean;
  acceptanceUrl?: string;
  token?: string;
  error?: string;
}

/**
 * Generate a secure acceptance link for a quote
 * This calls a Firebase Function that:
 * 1. Generates a 256-bit random token
 * 2. Stores the token on the quote document
 * 3. Returns the full acceptance URL
 *
 * @param quoteId - The quote ID to generate a link for
 * @returns The customer-facing URL to include in the SMS or email
 */
export async function generateAcceptanceLink(quoteId: string): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be signed in to create a quote link');

  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${FUNCTIONS_BASE_URL}/generateQuoteAcceptanceLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ quoteId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate acceptance link: ${errorText}`);
  }

  const data: GenerateAcceptanceLinkResponse = await response.json();
  if (!data.success || !data.acceptanceUrl) {
    throw new Error(data.error || 'Failed to generate acceptance link');
  }

  return data.acceptanceUrl;
}

/**
 * Get the acceptance page URL for a token (for testing/debugging)
 */
export function getAcceptancePageUrl(token: string): string {
  return `${FUNCTIONS_BASE_URL}/quoteAcceptancePage?token=${token}`;
}
