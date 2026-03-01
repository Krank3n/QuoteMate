/**
 * Reece Plumbing API Service
 * Integration with Reece Group API for plumbing supplies pricing and inventory
 * API Docs: https://docs.api.reecegroup.com.au/latest/index.html#tag/Pricing
 */

import { Platform } from 'react-native';
import { auth } from '../config/firebase';

// Firebase Functions URL configuration
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export interface ReeceProduct {
  itemNumber: string;
  description: string;
  brand?: string;
  category?: string;
}

export interface ReecePrice {
  itemNumber: string;
  price: number;
  currency: string;
  priceIncGst?: number;
}

export interface ReeceInventory {
  itemNumber: string;
  branchCode: string;
  quantityAvailable: number;
}

interface PriceSearchResult {
  price: number | null;
  productName?: string;
  store?: string;
  itemNumber?: string;
}

/**
 * Search for a plumbing product by name
 * Note: This is a placeholder implementation
 * Actual implementation requires Reece API credentials and proper authentication
 */
export async function searchReeceProduct(
  productName: string
): Promise<ReeceProduct | null> {
  try {
    console.log('🔍 Searching Reece for:', productName);

    // For now, we'll use Firebase Functions to handle Reece API calls
    // This avoids exposing API keys in the client
    if (Platform.OS === 'web') {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/searchReeceProduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ productName }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      return data.product || null;
    }

    // Mobile implementation would go here
    // For now, return null to fall back to AI estimation
    console.warn('Reece API not yet implemented for mobile');
    return null;
  } catch (error) {
    console.error('❌ Error searching Reece product:', error);
    return null;
  }
}

/**
 * Get price for a Reece product
 */
export async function getReecePrice(
  itemNumber: string
): Promise<number | null> {
  try {
    console.log('💰 Getting Reece price for item:', itemNumber);

    if (Platform.OS === 'web') {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/getReecePrice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ itemNumber }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      return data.price || null;
    }

    console.warn('Reece API not yet implemented for mobile');
    return null;
  } catch (error) {
    console.error('❌ Error getting Reece price:', error);
    return null;
  }
}

/**
 * Search for material price using Reece API
 * Falls back to AI estimation if Reece API is unavailable
 */
export async function searchReeceMaterialPrice(
  materialName: string
): Promise<PriceSearchResult> {
  try {
    console.log('🔍 Searching Reece price for:', materialName);

    // Search for the product
    const product = await searchReeceProduct(materialName);

    if (!product) {
      console.log('⚠️  Product not found in Reece catalog');
      return { price: null };
    }

    // Get the price
    const price = await getReecePrice(product.itemNumber);

    if (price === null) {
      console.log('⚠️  Price not available from Reece');
      return { price: null };
    }

    console.log('✅ Found Reece price:', materialName, '→ $' + price);

    return {
      price,
      productName: product.description,
      store: 'Reece Plumbing',
      itemNumber: product.itemNumber,
    };
  } catch (error) {
    console.error('❌ Error searching Reece material price:', error);
    return { price: null };
  }
}

/**
 * Get inventory for a Reece product at a specific branch
 */
export async function getReeceInventory(
  itemNumber: string,
  branchCode?: string
): Promise<ReeceInventory | null> {
  try {
    console.log('📦 Getting Reece inventory for:', itemNumber, 'at branch:', branchCode);

    if (Platform.OS === 'web') {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/getReeceInventory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ itemNumber, branchCode }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      return data.inventory || null;
    }

    console.warn('Reece API not yet implemented for mobile');
    return null;
  } catch (error) {
    console.error('❌ Error getting Reece inventory:', error);
    return null;
  }
}

/**
 * Check if Reece API is properly configured and available
 */
export async function checkReeceApiStatus(): Promise<boolean> {
  try {
    // Try to make a simple API call to check if credentials are configured
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/checkReeceApi`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.available === true;
  } catch (error) {
    console.error('❌ Error checking Reece API status:', error);
    return false;
  }
}
