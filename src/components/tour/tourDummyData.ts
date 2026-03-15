/**
 * Dummy data for the unified guided tour
 * All fake data in one place — injected at each phase of the tour
 */

import { Image } from 'react-native';
import { Material, Quote, QuotePhoto } from '../../types';
import { generateId } from '../../utils/generateId';

// ─── Photos ───
// Bundled assets for the tour — no network dependency
const tourPhotoDamage = require('../../../assets/tour/tour-door-damage.png');
const tourPhotoAnnotated = require('../../../assets/tour/tour-door-annotated.png');
const tourHingeProduct = require('../../../assets/tour/tour-hinge-product.png');

export const TOUR_PHOTO_ID = 'tour-photo-001';

export function getTourPhoto(): QuotePhoto {
  return {
    id: TOUR_PHOTO_ID,
    storageUrl: Image.resolveAssetSource(tourPhotoDamage).uri,
  };
}

export function getTourPhotoAnnotated(): QuotePhoto {
  return {
    id: TOUR_PHOTO_ID,
    storageUrl: Image.resolveAssetSource(tourPhotoAnnotated).uri,
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

/** Same materials but with realistic prices filled in */
export function getTourMaterialsPriced(): Material[] {
  return [
    makeMaterial({
      name: '100mm Brass Butt Hinge',
      quantity: 3,
      unit: 'each',
      price: 8.90,
      totalPrice: 26.70,
      section: 'Door Hardware',
      pricingSource: 'scraper',
      priceConfidence: 'high',
      brand: 'Zenith',
      description: 'Zenith 100mm Brass Plated Fixed Pin Butt Hinge - 2 Pack',
      productUrl: 'https://www.bunnings.com.au',
      imageUrl: Image.resolveAssetSource(tourHingeProduct).uri,
    }),
    makeMaterial({
      name: '30mm Timber Screws (Box 100)',
      quantity: 1,
      unit: 'box',
      price: 12.50,
      totalPrice: 12.50,
      section: 'Door Hardware',
 pricingSource: 'scraper',
      priceConfidence: 'high',
      brand: 'Buildex',
      description: 'Buildex 8-10 x 30mm Zinc Plated Countersunk Head Timber Screws - 100 Pack',
      productUrl: 'https://www.bunnings.com.au',
    }),
    makeMaterial({
      name: 'Treated Pine 90x45mm 2.4m',
      quantity: 2,
      unit: 'each',
      price: 11.20,
      totalPrice: 22.40,
      section: 'Frame Repair',
      pricingSource: 'scraper',
      priceConfidence: 'high',
      brand: 'Treated Pine',
      description: 'Treated Pine 90 x 45mm 2.4m H3 Structural Framing',
      productUrl: 'https://www.bunnings.com.au',
    }),
    makeMaterial({
      name: 'Timber Weathershield Exterior',
      quantity: 1,
      unit: 'each',
      price: 42.00,
      totalPrice: 42.00,
      section: 'Frame Repair',
      pricingSource: 'scraper',
      priceConfidence: 'medium',
      brand: 'Dulux',
      description: 'Dulux 1L Weathershield Exterior Low Sheen Paint',
      productUrl: 'https://www.bunnings.com.au',
    }),
    makeMaterial({
      name: 'Liquid Nails Construction Adhesive',
      quantity: 1,
      unit: 'each',
      price: 9.80,
      totalPrice: 9.80,
      section: 'Frame Repair',
      pricingSource: 'scraper',
      priceConfidence: 'high',
      brand: 'Selleys',
      description: 'Selleys Liquid Nails Heavy Duty Construction Adhesive 350g',
      productUrl: 'https://www.bunnings.com.au',
    }),
  ];
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
  travelAdjustment: 5,
  estimatedDistance: 18,
  estimatedFuelCost: 12.60,
};
