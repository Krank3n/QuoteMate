/**
 * The projection behind the web acceptance page — what a customer is allowed
 * to see when they open the link in a quote email.
 *
 * It lived inline inside a 60-line `res.status(200).json({...})` in index.ts,
 * where it could not be tested, and it carried its OWN copy of the "per-doc
 * override > business default > show" expression. That is precisely how a
 * customer ended up seeing a breakdown on the web page that their PDF
 * deliberately hid: two mapping layers, one written twice.
 *
 * Pure and exported so the acceptance-page tests can assert on it directly.
 */

import {
  resolvePriceDetail,
  showsLineItems,
  showsPerLineMoney,
  type PriceDetail,
} from './shared/document/priceDetail';
import { travelAdjustmentAmountFor } from './travelSurcharge';

/** The markup-rolled figures from applyHideMarkupForDisplay. */
export interface AcceptanceDisplayFigures {
  materials: any[];
  materialsSubtotal: number;
  laborTotal: number;
  subtotal: number;
  markupAmount: number;
}

export interface AcceptanceQuotePayload {
  [key: string]: any;
  priceDetail: PriceDetail;
}

export function buildAcceptanceQuotePayload(
  quote: any,
  businessSettings: any,
  display: AcceptanceDisplayFigures,
): AcceptanceQuotePayload {
  const priceDetail = resolvePriceDetail(quote, businessSettings);
  const showLineItems = showsLineItems(priceDetail);
  const showPerLineMoney = showsPerLineMoney(priceDetail);

  const photoUrls = (quote.photos || [])
    .map((p: any) => p.storageUrl)
    .filter(Boolean);

  // The legacy trio stays on the payload for one release so a cached or
  // in-flight copy of the acceptance page (which reads them directly) keeps
  // rendering correctly. Remove alongside the legacy flags in
  // shared/document/priceDetail.ts.
  const legacyShowMaterialCosts = showPerLineMoney;
  const legacyShowLaborCosts = showPerLineMoney;
  const legacyShowSubtotal = showLineItems;

  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerName,
    jobName: quote.job?.name,
    jobDescription: quote.job?.description,
    ...(showLineItems
      ? {
          materials: display.materials.map((m: any) => ({
            name: m.name,
            // Withheld, not merely un-rendered. The customer holds the token
            // and this is a plain GET, so per-line money left on the payload
            // is one Network-tab click away — exactly the leak this module
            // exists to close. A work item keeps its line total because that
            // IS its section total, and the scope table prints it in every
            // mode (same rule as the PDF).
            ...(showPerLineMoney
              ? { quantity: m.quantity, unit: m.unit, totalPrice: m.totalPrice || 0 }
              : m.kind === 'work'
                ? { totalPrice: m.totalPrice || 0 }
                : {}),
            // A work item is a lump-sum scope line: a title, a paragraph and
            // one price. The page renders it as a numbered scope row, not as
            // a quantity against a unit.
            ...(m.kind === 'work' ? { kind: 'work' } : {}),
            ...(m.scope ? { scope: m.scope } : {}),
          })),
          materialsSubtotal: display.materialsSubtotal,
          laborTotal: display.laborTotal,
          subtotal: display.subtotal,
        }
      : {}),
    priceDetail,
    markupAmount: display.markupAmount,
    // Never persisted — documentCalculator derives it on the client for
    // display and nothing writes it back, so this read was always 0. The page
    // folds travel into the Subtotal it prints
    // (`subtotal + markupAmount + travelAdjustmentAmount`), so a zero here
    // understated that figure by the whole surcharge and left the customer the
    // same unexplained gap between Subtotal and Total that the email had.
    travelAdjustmentAmount:
      Number(quote.travelAdjustmentAmount) || travelAdjustmentAmountFor(quote),
    gst: quote.gst,
    pricesIncludeGst: quote.pricesIncludeGst === true,
    gstRegistered: quote.gstRegistered !== false,
    total: quote.total,
    notes: quote.notes,
    // Only expose the immutable send-time snapshot. Never fall back to live
    // settings here or an old SMS link could show revised terms.
    terms: quote.termsSnapshot || null,
    createdAt: quote.createdAt,
    aiEmailBody: quote.aiEmailBody || null,
    photoUrls,
    showMaterialCosts: legacyShowMaterialCosts,
    showLaborCosts: legacyShowLaborCosts,
    showSubtotal: legacyShowSubtotal,
  };
}
