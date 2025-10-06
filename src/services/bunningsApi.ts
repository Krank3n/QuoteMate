/**
 * Bunnings Sandbox API Service
 * Handles OAuth authentication and API calls to Bunnings services
 */

import Constants from 'expo-constants';
import { BunningsAuthResponse, BunningsItem, BunningsPrice, BunningsInventory } from '../types';

// Get credentials from expo-constants (works with .env files)
const expoExtra = Constants.expoConfig?.extra || {};
const CLIENT_ID = expoExtra.BUNNINGS_CLIENT_ID || '';
const CLIENT_SECRET = expoExtra.BUNNINGS_CLIENT_SECRET || '';

console.log('🔧 Bunnings API Config:', {
  hasClientId: !!CLIENT_ID,
  hasClientSecret: !!CLIENT_SECRET,
  clientIdLength: CLIENT_ID.length,
});

const AUTH_URL = 'https://connect.sandbox.api.bunnings.com.au';
const ITEM_API_URL = 'https://item.sandbox.api.bunnings.com.au';
const PRICING_API_URL = 'https://pricing.sandbox.api.bunnings.com.au';
const INVENTORY_API_URL = 'https://inventory.sandbox.api.bunnings.com.au';

class BunningsAPI {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  /**
   * Authenticate with Bunnings OAuth 2.0
   * Gets an access token using client credentials flow
   */
  async authenticate(): Promise<void> {
    try {
      const response = await fetch(`${AUTH_URL}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Auth response error:', response.status, errorText);
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
      }

      const data: BunningsAuthResponse = await response.json();
      this.accessToken = data.access_token;

      // Set expiry time (subtract 60 seconds for safety margin)
      const expirySeconds = data.expires_in - 60;
      this.tokenExpiry = new Date(Date.now() + expirySeconds * 1000);

      console.log('✅ Bunnings API authenticated successfully');
      console.log('Token expires in:', expirySeconds, 'seconds');
    } catch (error) {
      console.error('Bunnings authentication error:', error);
      throw error;
    }
  }

  /**
   * Check if we have a valid access token
   */
  private isTokenValid(): boolean {
    if (!this.accessToken || !this.tokenExpiry) {
      return false;
    }
    return new Date() < this.tokenExpiry;
  }

  /**
   * Ensure we have a valid token before making API calls
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.isTokenValid()) {
      await this.authenticate();
    }
  }

  /**
   * Search for items by keyword
   * NOTE: Bunnings Sandbox may not support full text search
   * It typically only returns data for specific test item numbers
   * @param searchTerm - The search term (e.g., "treated pine 90x45")
   * @param limit - Maximum number of results to return
   */
  async searchItem(searchTerm: string, limit: number = 10): Promise<BunningsItem[]> {
    await this.ensureAuthenticated();

    try {
      const encodedTerm = encodeURIComponent(searchTerm);
      const url = `${ITEM_API_URL}/item?q=${encodedTerm}&limit=${limit}`;

      console.log('🔍 Searching Bunnings for:', searchTerm);
      console.log('🔗 URL:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
      });

      const responseText = await response.text();

      console.log('📦 Search response status:', response.status);
      console.log('📦 Search response body:', responseText.substring(0, 200));

      if (!response.ok) {
        console.error('Search response error:', response.status, responseText);
        throw new Error(`Item search failed: ${response.status} ${response.statusText}`);
      }

      // Handle empty response (common in sandbox)
      if (!responseText || responseText.trim() === '') {
        console.log('⚠️  Empty response from search API (Sandbox may not have search data)');
        console.log('💡 Tip: Bunnings Sandbox typically only works with specific test item numbers');
        return [];
      }

      const data = JSON.parse(responseText);

      console.log('✅ Search successful, found', Array.isArray(data) ? data.length : (data.items?.length || 0), 'items');

      // Handle different response formats from sandbox
      if (Array.isArray(data)) {
        return data;
      } else if (data.items) {
        return data.items;
      } else if (data.data) {
        return data.data;
      }

      return [];
    } catch (error) {
      console.error('❌ Item search error:', error);
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Get pricing for a specific item
   * NOTE: Bunnings Sandbox typically requires exact test item numbers
   * @param itemNumber - The Bunnings item number
   */
  async getPrice(itemNumber: string): Promise<BunningsPrice | null> {
    await this.ensureAuthenticated();

    try {
      const url = `${PRICING_API_URL}/pricing/${itemNumber}`;

      console.log('💰 Fetching price for item:', itemNumber);
      console.log('🔗 URL:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
      });

      const responseText = await response.text();

      console.log('💰 Price response status:', response.status);
      console.log('💰 Price response body:', responseText.substring(0, 200));

      if (!response.ok) {
        if (response.status === 404) {
          console.log('⚠️  Item not found:', itemNumber);
          return null; // Item not found
        }
        console.error('Price response error:', response.status, responseText);
        throw new Error(`Price fetch failed: ${response.status} ${response.statusText}`);
      }

      // Handle empty response
      if (!responseText || responseText.trim() === '') {
        console.log('⚠️  Empty response from pricing API');
        return null;
      }

      const data: BunningsPrice = JSON.parse(responseText);
      console.log('✅ Price fetched for', itemNumber, ':', data);
      return data;
    } catch (error) {
      console.error('❌ Price fetch error:', error);
      return null; // Return null instead of throwing
    }
  }

  /**
   * Get pricing for multiple items (batch request)
   * @param itemNumbers - Array of item numbers
   */
  async getPrices(itemNumbers: string[]): Promise<Map<string, BunningsPrice>> {
    const priceMap = new Map<string, BunningsPrice>();

    // Batch requests with delay to avoid rate limiting
    for (const itemNumber of itemNumbers) {
      try {
        const price = await this.getPrice(itemNumber);
        if (price) {
          priceMap.set(itemNumber, price);
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to get price for ${itemNumber}:`, error);
      }
    }

    return priceMap;
  }

  /**
   * Check inventory for an item at a specific location
   * @param itemNumber - The Bunnings item number
   * @param locationCode - The store location code
   */
  async checkInventory(itemNumber: string, locationCode: string): Promise<BunningsInventory | null> {
    await this.ensureAuthenticated();

    try {
      const url = `${INVENTORY_API_URL}/inventory/${itemNumber}?location=${locationCode}`;

      console.log('Checking inventory for:', itemNumber, 'at', locationCode);

      const response = await fetch(url, {
        method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null; // Item or location not found
        }
        throw new Error(`Inventory check failed: ${response.status} ${response.statusText}`);
      }

      const data: BunningsInventory = await response.json();
      return data;
    } catch (error) {
      console.error('Inventory check error:', error);
      throw error;
    }
  }

  /**
   * Find and price a material by search term
   * Returns the first matching item with its price
   * @param searchTerm - What to search for
   */
  async findAndPriceMaterial(searchTerm: string): Promise<{ item: BunningsItem; price: BunningsPrice } | null> {
    try {
      // Search for the item
      const items = await this.searchItem(searchTerm, 1);

      if (items.length === 0) {
        console.warn(`No items found for: ${searchTerm}`);
        return null;
      }

      const item = items[0];

      // Get the price
      const price = await this.getPrice(item.itemNumber);

      if (!price) {
        console.warn(`No price found for item: ${item.itemNumber}`);
        return null;
      }

      return { item, price };
    } catch (error) {
      console.error(`Failed to find and price material: ${searchTerm}`, error);
      return null;
    }
  }
}

// Export singleton instance
export const bunningsApi = new BunningsAPI();
