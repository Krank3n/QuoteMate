/**
 * Google Places API service (AU address autocomplete)
 *
 * Thin client over the placesAddressAutocomplete + placesAddressDetails
 * Firebase Functions. The Google Places API key lives server-side only;
 * the client passes a session token so a burst of keystrokes is billed as
 * a single autocomplete session.
 */

import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export interface PlacesAddressPrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlacesAddressDetails {
  addressLine1: string;
  suburb: string;
  state: string;
  postCode: string;
  formattedAddress: string;
}

async function authedFetch(endpoint: string, body: any): Promise<Response> {
  const idToken = await auth.currentUser?.getIdToken();
  return fetch(`${FIREBASE_FUNCTIONS_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * RFC4122-ish v4 token. Used to bundle a typing session into one billable
 * autocomplete + one details lookup.
 */
export function newPlacesSessionToken(): string {
  const rnd = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${rnd(8)}-${rnd(4)}-4${rnd(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${rnd(3)}-${rnd(12)}`;
}

export async function searchAddresses(
  input: string,
  sessionToken: string,
): Promise<PlacesAddressPrediction[]> {
  try {
    const response = await authedFetch('placesAddressAutocomplete', { input, sessionToken });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.predictions) ? data.predictions : [];
  } catch {
    return [];
  }
}

export async function fetchAddressDetails(
  placeId: string,
  sessionToken: string,
): Promise<PlacesAddressDetails | null> {
  try {
    const response = await authedFetch('placesAddressDetails', { placeId, sessionToken });
    if (!response.ok) return null;
    const data = await response.json();
    return data.address ?? null;
  } catch {
    return null;
  }
}
