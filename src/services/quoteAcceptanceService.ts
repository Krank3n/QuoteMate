/**
 * Quote Acceptance Service
 * Handles generation of secure acceptance links for email-based quote responses
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

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
 * @param userId - The owner's user ID (for security verification)
 * @returns The acceptance URL to include in email
 */
export async function generateAcceptanceLink(
  quoteId: string,
  userId: string
): Promise<string> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/generateQuoteAcceptanceLink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quoteId, userId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to generate acceptance link: ${errorText}`);
    }

    const data: GenerateAcceptanceLinkResponse = await response.json();

    if (!data.success || !data.acceptanceUrl) {
      throw new Error(data.error || 'Failed to generate acceptance link');
    }

    console.log('Generated acceptance link for quote:', quoteId);
    return data.acceptanceUrl;
  } catch (error: any) {
    console.error('Error generating acceptance link:', error);
    throw error;
  }
}

/**
 * Get the acceptance page URL for a token (for testing/debugging)
 */
export function getAcceptancePageUrl(token: string): string {
  return `${FUNCTIONS_BASE_URL}/quoteAcceptancePage?token=${token}`;
}
