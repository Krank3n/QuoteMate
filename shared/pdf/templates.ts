/**
 * PDF Template Registry
 * CSS-only template variants for quotes and invoices
 */

import { PdfTemplateId, PdfTemplateInfo } from './types';

export const PDF_TEMPLATES: PdfTemplateInfo[] = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Corporate style with green accents and rounded summary box',
    accentColor: '#059669',
  },
  {
    id: 'clean',
    name: 'Clean & Simple',
    description: 'Editorial minimalism with generous whitespace and refined typography',
    accentColor: '#6B7280',
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Full-width dark header, uppercase type and a strong bordered summary card',
    accentColor: '#1F2937',
  },
  {
    id: 'accredited',
    name: 'Accredited',
    description: 'Licence or accreditation badge shown large in the top corner, beside the document title',
    accentColor: '#059669',
  },
  {
    id: 'tradesman',
    name: 'Tradesman',
    description: 'Premium letterpress feel with serif small caps and double rules',
    accentColor: '#374151',
  },
];

/** Print media CSS shared across all templates */
export const printMediaCSS = `
  /* No external font imports: Android's print bridge renders this HTML in a
     WebView and can stall indefinitely fetching remote resources — a hung
     font request froze Preview PDF. Every template's font stack falls back
     to Helvetica/Arial, which is visually near-identical on A4. */
  html, body {
    margin: 0;
  }
  /* The footer is a sign-off, not a bottom-pinned strip. The old flex
     margin-top:auto trick never worked in paged media (body min-height
     resolves against the viewport, not the printed page), so the footer
     rendered mid-page pretending to be pinned. In-flow with a fixed gap it
     reads as intentional. */
  .pdf-footer {
    margin-top: 28px;
    padding-top: 16px;
    font-size: 8px;
    font-weight: 600;
    color: #c8ccd1;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    text-align: center;
  }
  .pdf-footer p {
    margin: 0;
  }
  /* Money columns. Right-aligned as on any ledger, so the units digits line
     up down the page — the single strongest "this is a real document" cue a
     table can give. Builders put it on every cell AND header that holds a
     quantity-priced figure. */
  .num {
    text-align: right;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 30px;
  }
  .header-business {
    flex: 1;
    min-width: 0;
  }
  .header-meta {
    flex-shrink: 0;
    min-width: 240px;
    max-width: 45%;
    text-align: right;
  }
  .header-meta h2 {
    margin: 0 0 10px 0;
    font-size: 22px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    border: none;
    padding: 0;
    line-height: 1.1;
  }
  .header-meta p {
    margin: 1px 0;
    font-size: 12px;
    line-height: 1.3;
  }
  /* Compact document header. Business identity stays quiet on the left;
     customer/job context sits as plain recipient copy under the document
     metadata rather than in a full-width form-like banner. !important is
     deliberate where templates forced square logos / oversized names. */
  .document-header {
    margin-bottom: 12px !important;
  }
  .business-identity {
    display: block !important;
  }
  /* Logos are trimmed of their surrounding whitespace at upload (see
     utils/logoTrim.ts), so this box sizes the artwork itself rather than a
     mostly-empty export canvas. That makes it safe to allot real space: a
     wide wordmark now lands ~300px across instead of the ~110px the old
     240x84 box gave it once the canvas padding had eaten the height. */
  .business-identity .logo {
    display: block;
    width: auto !important;
    max-width: 300px !important;
    height: auto !important;
    max-height: 110px !important;
    margin: 0 0 12px 0 !important;
    object-fit: contain;
  }
  .business-identity.has-logo .header-text h1 {
    margin: 0 0 4px 0 !important;
    color: inherit;
    font-size: 13px !important;
    font-weight: 700 !important;
    letter-spacing: 0 !important;
    line-height: 1.2 !important;
    text-transform: none !important;
    font-variant: normal !important;
  }
  .business-contact-details {
    color: inherit;
    font-size: 9.5px;
    line-height: 1.35;
    opacity: .88;
  }
  .business-contact-details strong {
    font-weight: 700;
  }
  .business-credentials {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px 14px;
    margin-top: 8px;
  }
  .business-credential {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 46px;
  }
  /* Accreditation badges usually bake their own text into the artwork (the ARC
     badge carries "AUTHORISED" plus the licence number), so a 64x38 hard box
     rendered that text unreadable. Cap on height only and let width follow the
     source ratio — no squashing, no stretching. Beats the inline width/height
     the callers emit for older clients. */
  .business-credential .credential-logo {
    width: auto !important;
    height: auto !important;
    max-width: 132px !important;
    max-height: 46px !important;
    object-fit: contain;
  }
  .business-credential-copy {
    color: inherit;
    font-size: 9px;
    font-weight: 600;
    line-height: 1.25;
  }
  .header-meta h2 {
    margin-bottom: 8px !important;
    font-size: 20px !important;
    letter-spacing: 1.8px !important;
  }
  .header-meta p {
    font-size: 10px !important;
    line-height: 1.35 !important;
  }
  .header-meta p strong {
    font-weight: 600;
  }
  .document-subtitle {
    margin: -2px 0 5px 0;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }
  .document-reference {
    font-size: 10px;
    font-weight: 700;
    line-height: 1.35;
  }
  .document-date,
  .document-terms {
    font-size: 9px;
    line-height: 1.35;
    opacity: .78;
  }
  .header-recipient {
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid rgba(107, 114, 128, .3);
    font-size: 9px;
    line-height: 1.35;
  }
  .header-recipient-label {
    margin-bottom: 3px;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    opacity: .62;
  }
  .header-recipient-name {
    font-size: 10.5px;
    font-weight: 700;
  }
  .header-recipient-contact {
    margin-top: 2px;
    opacity: .72;
    overflow-wrap: anywhere;
  }
  /* The section band is a <caption>, not a header row: a caption renders once
     at the top of its table, while anything in <thead> repeats after every
     page break — which printed a duplicate "section" band with no rows under
     it whenever a table split. */
  caption.section-label {
    caption-side: top;
    text-align: left;
  }
  /* A section's own scope text, printed under its heading. Inherits the
     section-label colour so it reads as part of the same band — but NOT its
     letterform styling: templates that set the band in tracked uppercase
     (clean, tradesman) were shouting whole scope paragraphs. */
  .section-scope {
    margin-top: 3px;
    font-size: 10px;
    font-weight: 400;
    line-height: 1.4;
    opacity: .9;
    text-transform: none;
    letter-spacing: normal;
    font-variant: normal;
  }
  /* Fallback line when a document has no materials at all. Inherits the
     template's text colour rather than hardcoding a grey. */
  .materials-empty {
    font-style: italic;
    opacity: .7;
    margin: 10px 0;
  }
  /* Muted disclosure lines in the summary block: the "No GST has been
     charged" note and the inclusive-GST disclosure under the total. The
     compound selectors out-rank the templates' own .summary-row rules, which
     are concatenated after this sheet and would otherwise win on order. */
  .summary-note,
  .summary-row.summary-note {
    font-size: 0.85em;
    font-weight: 400;
    opacity: .75;
  }
  /* Credits on an invoice (deposit already paid, amount paid). One green for
     every template — it reads "money off", not "brand". */
  .summary-row.credit-row {
    color: #15803D;
  }
  /* Amount due / due date lines inside the merged invoice payment box. */
  .payment-info {
    margin-bottom: 12px;
  }
  .payment-info p {
    margin: 2px 0;
  }
  /* Terms & Conditions. Colour comes from the template's body text via
     opacity, so the block stays palette-correct on every template. */
  .terms-section {
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid rgba(107, 114, 128, .35);
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .terms-section h3 {
    margin: 0 0 10px 0;
  }
  .terms-body {
    font-size: 11px;
    line-height: 1.5;
    opacity: .85;
  }
  .terms-body p {
    margin: 0 0 8px 0;
  }
  /* Project Scope table — rendered when every line on the document is a
     lump-sum scope line (see isScopeQuote in htmlBuilders). Declared once,
     here, rather than in all five template stylesheets: printMediaCSS is
     concatenated ahead of getTemplateCSS and these class selectors don't
     collide with the bare table/th/td rules, so the scope table picks up each
     template's colours and borders for free. Explicit column widths stop a
     four-line scope paragraph squeezing the money column off the page. */
  .scope-num {
    width: 6%;
    vertical-align: top;
    white-space: nowrap;
  }
  .scope-title {
    vertical-align: top;
  }
  .scope-body {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    opacity: .85;
  }
  .scope-total {
    width: 22%;
    text-align: right;
    vertical-align: top;
    white-space: nowrap;
  }
  /* A scope row is a title plus a paragraph — splitting it across a page
     break separates the work from its price. Same reasoning as
     .terms-section. */
  .scope-table tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  @page {
    size: A4;
    margin: 40px;
  }
  @media print {
    @page {
      size: A4;
      margin: 40px;
    }
    .header, .info-section, .summary, .payment-methods-section, .payment-method {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    h2, h3 {
      page-break-after: avoid;
      break-after: avoid;
      orphans: 3;
      widows: 3;
    }
    .info-section, .summary, .section-wrapper {
      page-break-before: auto;
      break-before: auto;
      margin-top: 12px;
    }
    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    /* Keep a subtotal glued to at least one of the rows it sums. Without
       this, the subtotal alone could spill onto the next page under a
       freshly repeated column header — which reads as a broken empty
       section. (Verified in Chromium print; engines that ignore it just
       fall back to the old break.) */
    .total-row {
      page-break-before: avoid;
      break-before: avoid;
    }
    table {
      page-break-before: auto;
      break-before: auto;
      page-break-inside: auto;
      break-inside: auto;
      margin-top: 8px;
    }
    table thead {
      display: table-header-group;
    }
    .section-wrapper {
      padding-top: 4px;
      padding-bottom: 4px;
    }
    .section-wrapper::after {
      content: "";
      display: block;
      margin-bottom: 8px;
    }
  }
`;

/*
 * Brand colour is a CSS custom property, not a find-and-replace.
 *
 * The old mechanism string-replaced every occurrence of the template's accent
 * hex with the brand colour — but in Bold that hex was ALSO the body text
 * colour, so an amber brand turned every item name and price amber, and in
 * Clean it doubled as the muted contact-line grey. Each stylesheet now
 * declares `--accent` on body and uses var(--accent) ONLY where the brand
 * colour is meant to reach; text colours are literal hexes the override can
 * never touch. (The in-app preview already worked this way — see
 * PDFTemplateScreen — so preview and PDF finally agree.)
 */

const professionalCSS = `
  body {
    --accent: #059669;
    font-family: 'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding: 24px;
    color: #1a1a1a;
    font-size: 12px;
  }
  .section-label {
    background-color: var(--accent);
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 10px 10px 5px 10px;
  }
  .header {
    border-bottom: 3px solid var(--accent);
    padding-bottom: 16px;
    margin-bottom: 22px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .logo {
    width: auto;
    max-width: 220px;
    height: auto;
    max-height: 80px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: var(--accent);
    margin: 0 0 8px 0;
    font-size: 24px;
    line-height: 1.1;
  }
  .header p {
    color: #333333;
    margin: 3px 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .info-section {
    margin-bottom: 22px;
  }
  .info-section h2 {
    color: #1a1a1a;
    margin-bottom: 12px;
    font-size: 16px;
  }
  .info-section h3 {
    color: var(--accent);
    margin-bottom: 8px;
    font-size: 14px;
  }
  .info-section p {
    color: #333333;
    margin: 4px 0;
    font-size: 12px;
  }
  .invoice-details {
    margin-bottom: 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th {
    background-color: var(--accent);
    color: white;
    padding: 8px 10px;
    text-align: left;
    font-size: 12px;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid #e0e0e0;
    color: #333333;
    font-size: 12px;
  }
  .total-row {
    font-weight: bold;
    background-color: #f5f5f5;
  }
  /* Compound with .summary-row: these rows carry both classes, and the
     template's own .summary-row rule (same specificity, declared later)
     silently won on source order — the TOTAL line had never actually
     rendered its intended styling on any template. */
  .summary-row.grand-total {
    font-size: 16px;
    color: var(--accent);
    font-weight: bold;
  }
  .summary-row.balance-due {
    font-size: 14px;
    color: #dc3545;
    font-weight: bold;
    border-top: 2px solid #dc3545;
    padding-top: 7px;
    margin-top: 7px;
  }
  .summary {
    margin-top: 22px;
    padding: 16px 18px;
    background-color: #f9f9f9;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    color: #333333;
    font-size: 12px;
  }
  h3 {
    color: var(--accent);
    margin-bottom: 8px;
    font-size: 14px;
  }
  .section-wrapper {
    margin-bottom: 18px;
  }
  .payment-box {
    margin-top: 22px;
    padding: 16px 18px;
    background-color: #f0f9ff;
    border: 2px solid var(--accent);
    border-radius: 8px;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin-top: 22px;
    padding: 16px 18px;
    background-color: #f0f9ff;
    border: 2px solid var(--accent);
    border-radius: 8px;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 12px;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .payment-method {
    flex: 1;
    min-width: 180px;
    padding: 10px 12px;
    background-color: white;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
  }
  .payment-method strong {
    color: var(--accent);
  }
`;

const cleanCSS = `
  .section-label {
    background-color: transparent;
    color: var(--accent);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    padding: 14px 10px 8px 10px;
    border-bottom: 1px solid #111827;
  }
  body {
    --accent: #6B7280;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, sans-serif;
    padding: 36px 32px;
    color: #111827;
    line-height: 1.6;
    background-color: #FFFFFF;
    font-size: 12px;
  }
  .header {
    border-bottom: 1px solid #E5E7EB;
    padding-bottom: 26px;
    margin-bottom: 32px;
  }
  .header-content {
    display: flex;
    align-items: flex-start;
    gap: 22px;
  }
  .logo {
    width: auto;
    max-width: 220px;
    height: auto;
    max-height: 76px;
    object-fit: contain;
    flex-shrink: 0;
    margin-top: 6px;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #111827;
    margin: 0 0 10px 0;
    font-weight: 200;
    font-size: 30px;
    letter-spacing: -0.5px;
    line-height: 1.05;
  }
  .header p {
    color: #6B7280;
    margin: 2px 0;
    font-size: 11px;
    letter-spacing: 0.2px;
  }
  .info-section {
    margin-bottom: 26px;
  }
  .info-section h2 {
    color: #9CA3AF;
    margin-bottom: 14px;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    border-bottom: 1px solid #E5E7EB;
    padding-bottom: 10px;
  }
  .info-section h3 {
    color: #111827;
    margin-bottom: 8px;
    padding-left: 0;
    border-left: none;
    font-weight: 600;
    font-size: 15px;
    letter-spacing: -0.2px;
  }
  .info-section p {
    color: #4B5563;
    margin: 3px 0;
    font-size: 12px;
  }
  .invoice-details {
    margin-bottom: 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }
  th {
    background-color: transparent;
    color: #9CA3AF;
    padding: 12px 10px 10px 10px;
    text-align: left;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-bottom: 1px solid #111827;
  }
  td {
    padding: 10px;
    border-bottom: 1px solid #F3F4F6;
    color: #1F2937;
    font-size: 12px;
  }
  .total-row {
    font-weight: 600;
    background-color: transparent;
    border-top: 1px solid #111827;
  }
  .total-row td {
    border-bottom: none;
    padding-top: 14px;
  }
  .summary-row.grand-total {
    font-size: 20px;
    color: #111827;
    font-weight: 300;
    letter-spacing: -0.3px;
  }
  .summary-row.balance-due {
    font-size: 14px;
    color: #B91C1C;
    font-weight: 600;
    border-top: 1px solid #B91C1C;
    padding-top: 8px;
    margin-top: 8px;
  }
  .summary {
    margin-top: 28px;
    padding: 22px 0 0 0;
    background-color: transparent;
    border-radius: 0;
    border: none;
    border-top: 1px solid #111827;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    color: #4B5563;
    font-size: 12px;
  }
  h3 {
    color: #111827;
    margin-bottom: 10px;
    padding-left: 0;
    border-left: none;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.2px;
  }
  .section-wrapper {
    margin-bottom: 24px;
  }
  .payment-box {
    margin-top: 28px;
    padding: 20px 22px;
    background-color: #FAFAF9;
    border: none;
    border-left: 2px solid var(--accent);
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
    border-left: none;
    padding-left: 0;
  }
  .payment-methods-section {
    margin-top: 28px;
    padding: 20px 22px;
    background-color: #FAFAF9;
    border: none;
    border-left: 2px solid var(--accent);
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 14px;
    border-left: none;
    padding-left: 0;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .payment-method {
    flex: 1;
    min-width: 180px;
    padding: 14px 16px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 12px;
    line-height: 1.55;
    border: 1px solid #E5E7EB;
  }
  .payment-method strong {
    color: #111827;
    font-weight: 600;
  }
`;

const boldCSS = `
  .section-label {
    background-color: var(--accent);
    color: white;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.8px;
    padding: 10px 12px 7px 12px;
  }
  body {
    --accent: #1F2937;
    font-family: 'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding: 0;
    color: #111827;
    background-color: #FFFFFF;
    font-size: 12px;
  }
  .header {
    background-color: var(--accent);
    color: #FFFFFF;
    padding: 24px 28px 26px 28px;
    margin-bottom: 28px;
    border-bottom: none;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  /* Solid white plate: most tradie logos are drawn for white paper, and dark
     artwork disappeared entirely against the near-black header behind the old
     translucent wash. */
  .logo {
    width: auto;
    max-width: 220px;
    height: auto;
    max-height: 80px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 8px;
    background-color: #FFFFFF;
    padding: 6px;
    box-sizing: border-box;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #FFFFFF;
    margin: 0 0 8px 0;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: -0.3px;
    text-transform: uppercase;
    line-height: 1;
  }
  .header p {
    color: #D1D5DB;
    margin: 2px 0;
    font-size: 11px;
    letter-spacing: 0.2px;
  }
  .info-section {
    margin-bottom: 24px;
    padding: 0 28px;
  }
  .info-section h2 {
    color: #111827;
    margin-bottom: 14px;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--accent);
  }
  .info-section h3 {
    color: #1F2937;
    margin-bottom: 8px;
    font-weight: 800;
    font-size: 14px;
  }
  .info-section p {
    color: #4B5563;
    margin: 4px 0;
    font-size: 12px;
  }
  .invoice-details {
    margin-bottom: 16px;
  }
  table {
    width: calc(100% - 56px);
    margin-left: 28px;
    margin-right: 28px;
    border-collapse: collapse;
    margin-bottom: 20px;
    background-color: #FFFFFF;
  }
  th {
    background-color: var(--accent);
    color: white;
    padding: 10px;
    text-align: left;
    font-weight: 800;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
  }
  td {
    padding: 9px 10px;
    border-bottom: 1px solid #E5E7EB;
    color: #1F2937;
    font-size: 12px;
  }
  tr:nth-child(even) td {
    background-color: #F9FAFB;
  }
  .total-row {
    font-weight: 800;
    background-color: #111827 !important;
  }
  .total-row td {
    color: #FFFFFF !important;
    background-color: #111827 !important;
    border-bottom: none;
    padding: 12px 10px;
  }
  /* Dark, not white: this row renders inside the white summary card. The
     old #FFFFFF was written for the dark total-row table cells and only
     survived because the cascade bug kept the rule from ever applying. */
  .summary-row.grand-total {
    font-size: 18px;
    color: #111827;
    font-weight: 900;
    letter-spacing: -0.2px;
  }
  .summary-row.balance-due {
    font-size: 14px;
    color: #B91C1C;
    font-weight: 800;
    border-top: 2px solid #B91C1C;
    padding-top: 8px;
    margin-top: 8px;
  }
  .summary {
    margin: 28px 28px 0 28px;
    padding: 20px 24px;
    background-color: #FFFFFF;
    border-radius: 0;
    border: 2px solid var(--accent);
    box-shadow: 0 4px 12px rgba(17, 24, 39, 0.06);
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 7px 0;
    color: #1F2937;
    font-weight: 600;
    font-size: 12px;
    border-bottom: 1px solid #F3F4F6;
  }
  h3 {
    color: #1F2937;
    margin-bottom: 10px;
    font-weight: 800;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
  }
  .section-wrapper {
    margin-bottom: 22px;
    padding: 0 28px;
  }
  .section-wrapper table {
    width: 100%;
    margin-left: 0;
    margin-right: 0;
  }
  .payment-box {
    margin: 28px 28px 0 28px;
    padding: 20px 24px;
    background-color: #F9FAFB;
    border: none;
    border-top: 5px solid var(--accent);
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
  }
  .payment-methods-section {
    margin: 28px 28px 0 28px;
    padding: 20px 24px;
    background-color: #F9FAFB;
    border: none;
    border-top: 5px solid var(--accent);
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 14px;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .payment-method {
    flex: 1;
    min-width: 180px;
    padding: 14px 16px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 12px;
    line-height: 1.55;
    border-left: 3px solid var(--accent);
  }
  .payment-method strong {
    color: #1F2937;
    font-weight: 800;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 1.2px;
  }
`;

const tradesmanCSS = `
  .section-label {
    background-color: transparent;
    color: #1C1917;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    padding: 12px 8px 6px 8px;
    border-top: 3px double var(--accent);
    border-bottom: 1px solid #A8A29E;
    font-variant: small-caps;
  }
  /* White paper, not a tinted page: the old #FDFCF8 body tint could never
     reach the printed page's margins, so every page carried a visible cream
     rectangle floating in a white frame. The warmth now lives in the summary
     and payment plates, which sit inside the content area by design. */
  body {
    --accent: #374151;
    font-family: Georgia, 'Times New Roman', Times, serif;
    padding: 32px 28px;
    color: #1C1917;
    background-color: #FFFFFF;
    line-height: 1.55;
    font-size: 12px;
  }
  .header {
    border-bottom: 3px double var(--accent);
    padding-bottom: 18px;
    margin-bottom: 24px;
  }
  .header-content {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  /* No frame around the logo. The header is already on light paper, so the
     border + white fill added nothing but a visible box — on a
     background-removed PNG it reads as a generic "logo block" dropped in the
     corner instead of the business's own branding. Bold keeps its plate
     because its header is dark and a dark logo would otherwise disappear. */
  .logo {
    width: auto;
    max-width: 220px;
    height: auto;
    max-height: 76px;
    object-fit: contain;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .header-text {
    flex: 1;
  }
  .header h1 {
    color: #1C1917;
    margin: 0 0 8px 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 1.2px;
    font-variant: small-caps;
    line-height: 1.1;
  }
  .header p {
    color: #44403C;
    margin: 2px 0;
    font-size: 12px;
    font-style: italic;
  }
  .info-section {
    margin-bottom: 22px;
  }
  .info-section h2 {
    color: #1C1917;
    margin-bottom: 12px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    font-weight: 700;
    border-bottom: 1px solid #A8A29E;
    padding-bottom: 8px;
    font-variant: small-caps;
  }
  .info-section h3 {
    color: #1C1917;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 700;
    font-style: italic;
  }
  .info-section p {
    color: #44403C;
    margin: 3px 0;
    font-size: 12px;
  }
  .invoice-details {
    margin-bottom: 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
  }
  th {
    background-color: transparent;
    color: #1C1917;
    padding: 10px 8px;
    text-align: left;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.6px;
    border-top: 3px double var(--accent);
    border-bottom: 3px double var(--accent);
    font-variant: small-caps;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid #D6D3D1;
    color: #1C1917;
    font-size: 12px;
  }
  .total-row {
    font-weight: 700;
    background-color: transparent;
    border-top: 3px double var(--accent);
  }
  .total-row td {
    color: #1C1917;
    border-bottom: none;
    padding-top: 11px;
  }
  .summary-row.grand-total {
    font-size: 18px;
    color: #1C1917;
    font-weight: 700;
    font-variant: small-caps;
    letter-spacing: 1.2px;
  }
  .summary-row.balance-due {
    font-size: 14px;
    color: #991B1B;
    font-weight: 700;
    border-top: 3px double #991B1B;
    padding-top: 8px;
    margin-top: 8px;
    font-variant: small-caps;
    letter-spacing: 1.2px;
  }
  .summary {
    margin-top: 24px;
    padding: 18px 22px;
    background-color: #FAF7EE;
    border-radius: 0;
    border: none;
    border-top: 3px double var(--accent);
    border-bottom: 3px double var(--accent);
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    color: #44403C;
    font-size: 12px;
  }
  h3 {
    color: #1C1917;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 700;
    font-style: italic;
  }
  .section-wrapper {
    margin-bottom: 20px;
  }
  .payment-box {
    margin-top: 24px;
    padding: 18px 22px;
    background-color: #FAF7EE;
    border: none;
    border-top: 3px double var(--accent);
    border-bottom: 3px double var(--accent);
    border-radius: 0;
  }
  .payment-box h3 {
    margin-top: 0;
    font-variant: small-caps;
    letter-spacing: 1.6px;
    font-style: normal;
    font-size: 12px;
    text-transform: uppercase;
  }
  .payment-methods-section {
    margin-top: 24px;
    padding: 18px 22px;
    background-color: #FAF7EE;
    border: none;
    border-top: 3px double var(--accent);
    border-bottom: 3px double var(--accent);
    border-radius: 0;
  }
  .payment-methods-section h3 {
    margin-top: 0;
    margin-bottom: 12px;
    font-variant: small-caps;
    letter-spacing: 1.6px;
    font-style: normal;
    font-size: 12px;
    text-transform: uppercase;
  }
  .payment-methods-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .payment-method {
    flex: 1;
    min-width: 180px;
    padding: 12px 14px;
    background-color: #FFFFFF;
    border-radius: 0;
    font-size: 12px;
    line-height: 1.55;
    border: 1px solid #D6D3D1;
  }
  .payment-method strong {
    color: #1C1917;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 1.6px;
  }
`;

/**
 * Accredited — for licensed trades whose authorisation is the selling point.
 *
 * Jake at Coastal HVAC put it plainly: his ARC badge is what tells a customer
 * he is allowed to touch refrigerant, and his own invoices carry it large in
 * the top corner. Every other template tucks credentials under the business
 * address at roughly 76x46px, where the "Australian Refrigeration Council /
 * AUTHORISED / AU 065871" baked into the artwork is unreadable.
 *
 * Deliberately professional + overrides rather than a fifth full stylesheet.
 * The padded-logo bug had to be fixed in four places at once; there is no
 * reason to make that five.
 */
const accreditedCSS =
  professionalCSS +
  `
  /* The badge rides at the top of the right-hand column, above the document
     title, which is where a trade customer's eye already goes. */
  .header-meta .business-credentials {
    justify-content: flex-end;
    gap: 10px 18px;
    margin: 0 0 14px 0;
  }
  .header-meta .business-credential {
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    min-height: 0;
  }
  /* ~2.5x the inline size — enough that the accrediting body and the licence
     number printed inside the artwork are legible at A4. */
  .header-meta .business-credential .credential-logo {
    max-width: 190px !important;
    max-height: 96px !important;
  }
  .header-meta .business-credential-copy {
    font-size: 11px;
    font-weight: 700;
    text-align: right;
  }
`;

const templateCSSMap: Record<PdfTemplateId, string> = {
  professional: professionalCSS,
  clean: cleanCSS,
  bold: boldCSS,
  tradesman: tradesmanCSS,
  accredited: accreditedCSS,
};

/** Map of template ID to its default accent color */
const templateAccentMap: Record<PdfTemplateId, string> = {
  professional: '#059669',
  clean: '#6B7280',
  bold: '#1F2937',
  tradesman: '#374151',
  accredited: '#059669',
};

/** Hex colours only (3/4/6/8 digits) — brandColor is interpolated into a stylesheet. */
const SAFE_CSS_COLOR = /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function getTemplateCSS(templateId: PdfTemplateId, brandColor?: string): string {
  const css = templateCSSMap[templateId] || professionalCSS;
  // Trimmed first — the email path (safeBrandColor) trims too, and an
  // untrimmed stored value must not silently unbrand the PDF alone.
  const brand = brandColor?.trim();
  if (brand && SAFE_CSS_COLOR.test(brand)) {
    // Override the accent custom property only. Appended, so it wins the
    // cascade over the template's own --accent declaration — and can never
    // touch a text colour, which are all literal hexes.
    return `${css}\n  body { --accent: ${brand}; }\n`;
  }
  return css;
}

export function getTemplateAccentColor(templateId: PdfTemplateId): string {
  return templateAccentMap[templateId];
}
