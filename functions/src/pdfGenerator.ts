/**
 * Server-side PDF Generator
 * Uses shared HTML templates, renders to PDF buffer via Puppeteer
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Re-export shared builders and types for use by index.ts
export { buildQuotePdfHtml, buildInvoicePdfHtml } from './shared/pdf';
export type { QuotePdfData, InvoicePdfData, BusinessPdfData } from './shared/pdf';

// ---- Render HTML to PDF buffer via Puppeteer ----

export async function generateQuotePdfBuffer(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
