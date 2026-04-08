/**
 * Dummy data for the unified guided tour
 * All fake data in one place — injected at each phase of the tour
 */

import { Image, Platform } from 'react-native';
import { Material, Quote, QuotePhoto } from '../../types';
import { generateId } from '../../utils/generateId';

/** Resolve a bundled asset to a URI string — works on both native and web */
function resolveAssetUri(asset: any): string {
  if (Platform.OS === 'web') {
    // On web, require() for images returns a string (the URL) or an object with uri/default
    if (typeof asset === 'string') return asset;
    if (typeof asset === 'object' && asset?.default) return asset.default;
    if (typeof asset === 'object' && asset?.uri) return asset.uri;
    return String(asset);
  }
  return Image.resolveAssetSource(asset).uri;
}

// ─── Photos ───
// Bundled assets for the tour — no network dependency
const tourPhotoDamage = require('../../../assets/tour/tour-door-damage.png');
const tourPhotoAnnotated = require('../../../assets/tour/tour-door-annotated.png');
const tourHingeProduct = require('../../../assets/tour/tour-hinge-product.png');

export const TOUR_PHOTO_ID = 'tour-photo-001';

export function getTourPhoto(): QuotePhoto {
  return {
    id: TOUR_PHOTO_ID,
    storageUrl: resolveAssetUri(tourPhotoDamage),
  };
}

export function getTourPhotoAnnotated(): QuotePhoto {
  return {
    id: TOUR_PHOTO_ID,
    storageUrl: resolveAssetUri(tourPhotoAnnotated),
    annotated: true,
  };
}

// ─── Customer ───
export const TOUR_CUSTOMER = {
  name: 'Davo Snagsworth',
  email: 'davo@snagsworth.com.au',
  phone: '0412 345 678',
  address: 'Sydney Opera House',
};

// ─── Job Description ───
export const TOUR_JOB_RAW =
  "yeah so the dunny door fell off again and the missus is losing it, " +
  "hinges are cooked reckon the frames a bit dodgy too from when bazza " +
  "reversed the mower into it last arvo. needs new hinges and maybe " +
  "replace the bottom bit of the frame cos its gone all soggy from the rain";

export const TOUR_JOB_CLEANED_TITLE = 'Bathroom Door Repair & Frame Replacement';

export const TOUR_JOB_CLEANED_DESCRIPTION =
  'Replace damaged bathroom door hinges and repair lower door frame section. ' +
  'The existing hinges have failed and the bottom portion of the timber frame ' +
  'has deteriorated due to moisture exposure. Work includes removing the old ' +
  'hardware, treating for moisture damage, installing new hinges, and replacing ' +
  'the affected frame section with treated timber.';

// ─── Materials (before prices) ───
function makeMaterial(overrides: Partial<Material> & { name: string }): Material {
  return {
    id: generateId(),
    quantity: 1,
    unit: 'each',
    price: 0,
    totalPrice: 0,
    manualPriceOverride: false,
    ...overrides,
  };
}

export function getTourMaterialsUnpriced(): Material[] {
  return [
    makeMaterial({
      name: '100mm Brass Butt Hinge',
      quantity: 3,
      unit: 'each',
      section: 'Door Hardware',
    }),
    makeMaterial({
      name: '30mm Timber Screws (Box 100)',
      quantity: 1,
      unit: 'box',
      section: 'Door Hardware',
    }),
    makeMaterial({
      name: 'Treated Pine 90x45mm 2.4m',
      quantity: 2,
      unit: 'each',
      section: 'Frame Repair',
    }),
    makeMaterial({
      name: 'Timber Weathershield Exterior',
      quantity: 1,
      unit: 'each',
      section: 'Frame Repair',
    }),
    makeMaterial({
      name: 'Liquid Nails Construction Adhesive',
      quantity: 1,
      unit: 'each',
      section: 'Frame Repair',
    }),
  ];
}

/** Price overlays keyed by material name — applied on top of the unpriced list so IDs are preserved */
const TOUR_PRICE_OVERLAYS: Record<string, Partial<Material>> = {
  '100mm Brass Butt Hinge': {
    price: 8.90,
    pricingSource: 'scraper',
    priceConfidence: 'high',
    brand: 'Zenith',
    description: 'Zenith 100mm Brass Plated Fixed Pin Butt Hinge - 2 Pack',
    productUrl: 'https://www.bunnings.com.au',
    imageUrl: resolveAssetUri(tourHingeProduct),
  },
  '30mm Timber Screws (Box 100)': {
    price: 12.50,
    pricingSource: 'scraper',
    priceConfidence: 'high',
    brand: 'Buildex',
    description: 'Buildex 8-10 x 30mm Zinc Plated Countersunk Head Timber Screws - 100 Pack',
    productUrl: 'https://www.bunnings.com.au',
  },
  'Treated Pine 90x45mm 2.4m': {
    price: 11.20,
    pricingSource: 'scraper',
    priceConfidence: 'high',
    brand: 'Treated Pine',
    description: 'Treated Pine 90 x 45mm 2.4m H3 Structural Framing',
    productUrl: 'https://www.bunnings.com.au',
  },
  'Timber Weathershield Exterior': {
    price: 42.00,
    pricingSource: 'scraper',
    priceConfidence: 'medium',
    brand: 'Dulux',
    description: 'Dulux 1L Weathershield Exterior Low Sheen Paint',
    productUrl: 'https://www.bunnings.com.au',
  },
  'Liquid Nails Construction Adhesive': {
    price: 9.80,
    pricingSource: 'scraper',
    priceConfidence: 'high',
    brand: 'Selleys',
    description: 'Selleys Liquid Nails Heavy Duty Construction Adhesive 350g',
    productUrl: 'https://www.bunnings.com.au',
  },
};

/** Overlay realistic prices onto the existing unpriced materials, preserving IDs */
export function getTourMaterialsPriced(unpriced: Material[]): Material[] {
  return unpriced.map((m) => {
    const overlay = TOUR_PRICE_OVERLAYS[m.name];
    if (!overlay) return m;
    const price = overlay.price ?? m.price;
    return {
      ...m,
      ...overlay,
      price,
      totalPrice: price * m.quantity,
    };
  });
}

/** Extra material added via the "Add Material" screen during tour */
export function getTourAddedMaterial(): Material {
  return makeMaterial({
    name: 'Sandpaper 120 Grit (5 Pack)',
    quantity: 1,
    unit: 'pack',
    price: 7.50,
    totalPrice: 7.50,
    section: 'Frame Repair',
    pricingSource: 'scraper',
    priceConfidence: 'high',
    brand: '3M',
    description: '3M 120 Grit Garnet Sandpaper Sheet - 5 Pack',
    productUrl: 'https://www.bunnings.com.au',
  });
}

// ─── Labor & Markup ───
export const TOUR_LABOR = {
  laborHours: 3,
  laborRate: 85,
  markup: 20,
  laborMarkup: 20,
  travelAdjustment: 5,
  estimatedDistance: 18,
  estimatedFuelCost: 12.60,
};
