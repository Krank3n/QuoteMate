/**
 * Stripe Configuration
 * Handles switching between test and live Stripe keys
 */

import Constants from 'expo-constants';

// Get Stripe mode from environment (default to 'test' for safety)
const STRIPE_MODE = process.env.STRIPE_MODE ||
  Constants.expoConfig?.extra?.stripeMode ||
  'test';

// Test/Sandbox keys and prices
const TEST_CONFIG = {
  publishableKey: process.env.STRIPE_TEST_PUBLISHABLE_KEY ||
    Constants.expoConfig?.extra?.stripeTestPublishableKey ||
    'pk_test_51SKDEO1K6tFQ1Wx6172zT4DOJKYHb1woFzWTtgaPTs36ToaUpdOQWqvICITtuBqe9r2ZwItSQvQ4cTAUnwKDmBYL00TmAQtOIV',
  secretKey: process.env.STRIPE_TEST_SECRET_KEY ||
    Constants.expoConfig?.extra?.stripeTestSecretKey || '',
  prices: {
    monthly: process.env.STRIPE_TEST_MONTHLY_PRICE ||
      Constants.expoConfig?.extra?.stripeTestMonthlyPrice ||
      'price_1SKONf1K6tFQ1Wx6epxCcaxS',
    yearly: process.env.STRIPE_TEST_YEARLY_PRICE ||
      Constants.expoConfig?.extra?.stripeTestYearlyPrice ||
      'price_1SKOOL1K6tFQ1Wx6WdLg9jTT',
  },
};

// Live/Production keys and prices
const LIVE_CONFIG = {
  publishableKey: process.env.STRIPE_LIVE_PUBLISHABLE_KEY ||
    Constants.expoConfig?.extra?.stripeLivePublishableKey || '',
  secretKey: process.env.STRIPE_LIVE_SECRET_KEY ||
    Constants.expoConfig?.extra?.stripeLiveSecretKey || '',
  prices: {
    monthly: process.env.STRIPE_LIVE_MONTHLY_PRICE ||
      Constants.expoConfig?.extra?.stripeLiveMonthlyPrice ||
      'price_1SKDMw0jHreJeRX32LBk9h9D',
    yearly: process.env.STRIPE_LIVE_YEARLY_PRICE ||
      Constants.expoConfig?.extra?.stripeLiveYearlyPrice ||
      'price_1SKO6u0jHreJeRX3J0Czmd77',
  },
};

// Select config based on mode
const isTestMode = STRIPE_MODE === 'test';
const activeConfig = isTestMode ? TEST_CONFIG : LIVE_CONFIG;

export const stripeConfig = {
  mode: STRIPE_MODE as 'test' | 'live',
  isTestMode,
  publishableKey: activeConfig.publishableKey,
  secretKey: activeConfig.secretKey,
  prices: {
    monthly: activeConfig.prices.monthly,
    yearly: activeConfig.prices.yearly,
  },
};

// Log current mode (useful for debugging)
console.log(`🔑 Stripe Mode: ${stripeConfig.mode.toUpperCase()}`);
console.log(`🔑 Using ${isTestMode ? 'TEST' : 'LIVE'} keys`);

// Export price IDs for backward compatibility
export const STRIPE_PRICES = {
  MONTHLY: stripeConfig.prices.monthly,
  YEARLY: stripeConfig.prices.yearly,
};
