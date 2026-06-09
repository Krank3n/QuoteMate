/**
 * Insulation Trade Starter Kit
 *
 * Pre-built library of line items for a residential insulation installer.
 * Modelled on Jesse Gorman's exact catalogue (#14 of the feedback) \u2014 the
 * descriptions are his verbatim customer-facing copy.
 *
 * Tradies who tick "insulation" during onboarding get this kit installed
 * in one tap: a SupplierGroup, 11 FavoriteProductMapping records under
 * it, and 11 SectionTemplate records so the items show up in the quote
 * flow's template picker.
 *
 * Same shape will power fencing, decking, painting starter kits later.
 */

import type { FavoriteProductMapping } from '../../types';

export interface StarterKitItem {
  /** Internal product name (slug source). Also the favorite's productName. */
  productName: string;
  /** Verbatim customer-facing description \u2014 lands in template body + notes. */
  customerDescription: string;
  unit: FavoriteProductMapping['unit'];
  /** Ex-GST price. Undefined when Jesse hasn't priced it yet \u2014 tradie fills in. */
  price?: number;
  coveragePerUnit?: number;
  coverageUnit?: 'm\u00b2' | 'm\u00b3' | 'm';
  /** Pack increment for area\u2192quantity calc (e.g. bags by the 10). */
  roundingIncrement?: number;
  /** LLM auto-generate hints. */
  keywords: string[];
}

export interface StarterKit {
  id: string;
  tradeNiche: string;
  supplierName: string;
  description: string;
  items: StarterKitItem[];
}

export const insulationStarterKit: StarterKit = {
  id: 'insulation-v1',
  tradeNiche: 'insulation',
  supplierName: 'J. Gorman Insulation',
  description:
    'Jesse Gorman\u2019s 11 most-quoted insulation line items with his verbatim customer-facing descriptions. Pricing for items where Jesse already has a rate is pre-filled; the rest are blank for you to set.',
  items: [
    {
      productName: 'R4.1 Ceiling Insulation \u2014 supply & fit',
      customerDescription: `R4.1 Supply and Fit R4.1  Ceiling Insulation.\nSite Clean and Rubbish Removal.`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r4.1', 'ceiling', 'insulation', 'batts', 'supply and fit'],
    },
    {
      productName: 'R3.5 Single layer ceiling \u2014 cross-weave over existing',
      customerDescription: `R3.5 Single layer.\nInstall R3.5 single layer. I will cross weave the second layer over the top of the existing Insulation.`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r3.5', 'single layer', 'ceiling', 'cross weave', 'top up'],
    },
    {
      productName: 'R7 Double Layer ceiling (R3.5 x 2 cross-weave)',
      customerDescription: `R7 Double Layer.\nSupply and Fit a Double Layer Of R 3.5 Giving you a Total R rating of 7.\nWhen working with a double Layer. The First Layer of batts is cut to suite in between the ceiling joists.\nThe Second Layer I will Cross Weave and run it in the opposite Direction.\nThis will seal the ceiling and will leave zero Gaps.`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r7', 'double layer', 'r3.5', 'cross weave', 'ceiling'],
    },
    {
      productName: 'R2.5 Polyester Floor Insulation (Autex Greenstuf)',
      customerDescription: `R2.5 Polyester floor Insulation.\nSupply and Fit R 2.5 Thermal Floor Polyester Autex Greenstuf Insulation. This Insulation will Be stapled in place to fit Between the floor Joists.\nNon-Allergic and non-Itch.\nSafe and user-friendly.\nNo dust or loose fibres.\nHandles moisture well.\nIncrease your Fire Rating\nVermin resistant.`,
      unit: 'each',
      price: 187.25,
      coverageUnit: 'm\u00b2',
      keywords: ['r2.5', 'polyester', 'floor', 'autex', 'greenstuf', 'underfloor'],
    },
    {
      productName: 'R2.5 HD Sub Floor',
      customerDescription: `R2.5 HD Sub Floor.\nSupply and fit of R 2.5 High Density sub floor insulation.\n\nall my sub floor work is strapped and the strapping is stapled to the floor joists to make sure the Insulation remains in place for the buildings life.\nall Batts are friction fitted and cut to suite.\n\n(refer to my website for pictures)`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r2.5', 'hd', 'high density', 'sub floor', 'underfloor', 'strapped'],
    },
    {
      productName: 'R2.5 HD Walls',
      customerDescription: `R2.5 HD WALLS\nTo be cut to suit in between the Studs. Then Secured with Strapping and Stapled to the Wall Studs.\nSimilar to my sub floor work, (refer to my website for pictures)`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r2.5', 'hd', 'walls', 'wall', 'stud', 'strapped'],
    },
    {
      productName: 'R2.7 Acoustic Soundbreak',
      customerDescription: `R2.7 Acoustic Sounbreak.\nPink Soundbreak Insulation. Acoustic Insulation.\n- Reduces sound transfer from  the external environment into your home or between adjacent rooms\n- Reduces the amount of reverb  (Echo) experienced in a confined space\n- Improved year round home comfort reducing energy consumption for additional savings`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r2.7', 'acoustic', 'soundbreak', 'sound', 'pink', 'noise'],
    },
    {
      productName: 'R3.1 Acoustic Soundbreak',
      customerDescription: `R3.1  Acoustic Soundbreak\nAcoustic Soundbreak Insulation is used for superior acoustic control in ceilings. It is a premium choice when Retro fitting existing buildings with high performance thermal and acoustic efficiency in mind.\n- Lifetime consumer warranty\n- Reduces sound transfer from the external environment into your home or adjacent rooms\n- Ideal sound absorption for theatre rooms, bathrooms and other noisy living rooms\n- designed for improved all year round comfort reducing energy consumption for additional savings`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r3.1', 'acoustic', 'soundbreak', 'theatre', 'ceiling', 'noise'],
    },
    {
      productName: 'R5 Ceiling Insulation',
      customerDescription: `R5 Ceiling Insulation.\nSupply and Fit R5 ceiling Insulation. site clean and rubbish removal.`,
      unit: 'each',
      coverageUnit: 'm\u00b2',
      keywords: ['r5', 'ceiling', 'supply and fit', 'rubbish removal'],
    },
    {
      productName: 'LED Electrician',
      customerDescription: `LED Electrician\nAn Electrician Must swap these halogens for new LED Downlights. These lights are hardwired with no Plugs.\nThe electrician will install new plugs and Lights and dispose of the Halogens.  Halogens are a fire risk to your home; New LEDs are rated to be covered with insulation and are 85% more energy efficient.`,
      unit: 'each',
      price: 65,
      keywords: ['led', 'electrician', 'downlight', 'halogen', 'swap'],
    },
    {
      productName: 'LED Lights',
      customerDescription: `LED Lights.\nSwap Your Old Halogen Lights For New LED Downlights.\nHalogen Lights are a fire Risk to your home and they need to be disposed of. They consume a large amount amount of Energy and get very hot.\nIt is illegal to cover them with insulation.\nLED Lights are 85% more Energy efficient than Halogens. They will save you money.`,
      unit: 'each',
      price: 65,
      keywords: ['led', 'lights', 'downlight', 'halogen', 'swap'],
    },
  ],
};
