/**
 * PDF Generator Utility
 * Shared utility for generating consistent PDF quotes across the app
 */

import * as FileSystem from 'expo-file-system';
import { format } from 'date-fns';
import { Quote, BusinessSettings } from '../types';
import { formatCurrency } from './quoteCalculator';
import { colors } from '../theme';
import { Platform } from 'react-native';

export async function generateQuotePDF(quote: Quote, businessSettings: BusinessSettings | null): Promise<string> {
  const business = businessSettings || {
    businessName: 'Your Business',
    email: '',
    phone: '',
    abn: '',
  };

  // Convert logo to base64 if it exists
  let logoBase64 = '';
  if (businessSettings?.logoUri && Platform.OS !== 'web') {
    try {
      const base64 = await FileSystem.readAsStringAsync(businessSettings.logoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      logoBase64 = `data:image/png;base64,${base64}`;
    } catch (error) {
      console.error('Failed to load logo:', error);
    }
  } else if (businessSettings?.logoUri && Platform.OS === 'web') {
    // On web, the logoUri is already a URL that can be used directly
    logoBase64 = businessSettings.logoUri;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          padding: 40px;
          color: #1a1a1a;
        }
        .header {
          border-bottom: 3px solid ${colors.primaryDark};
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .header-content {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .logo {
          width: 80px;
          height: 80px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .header-text {
          flex: 1;
        }
        .header h1 {
          color: ${colors.primaryDark};
          margin: 0 0 10px 0;
        }
        .header p {
          color: #333333;
          margin: 5px 0;
        }
        .info-section {
          margin-bottom: 30px;
        }
        .info-section h2 {
          color: #1a1a1a;
          margin-bottom: 15px;
        }
        .info-section h3 {
          color: ${colors.primaryDark};
          margin-bottom: 10px;
        }
        .info-section p {
          color: #333333;
          margin: 5px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th {
          background-color: ${colors.primaryDark};
          color: white;
          padding: 10px;
          text-align: left;
        }
        td {
          padding: 8px;
          border-bottom: 1px solid #e0e0e0;
          color: #333333;
        }
        .total-row {
          font-weight: bold;
          background-color: #f5f5f5;
        }
        .grand-total {
          font-size: 18px;
          color: ${colors.primaryDark};
          font-weight: bold;
        }
        .summary {
          margin-top: 30px;
          padding: 20px;
          background-color: #f9f9f9;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          color: #333333;
        }
        h3 {
          color: ${colors.primaryDark};
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-content">
          ${logoBase64 ? `<img src="${logoBase64}" alt="${business.businessName}" class="logo" />` : ''}
          <div class="header-text">
            <h1>${business.businessName}</h1>
            <p>
              ${business.abn ? `ABN: ${business.abn}<br>` : ''}
              ${business.email ? `Email: ${business.email}<br>` : ''}
              ${business.phone ? `Phone: ${business.phone}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div class="info-section">
        <h2>QUOTATION</h2>
        <p><strong>Quote Date:</strong> ${format(new Date(quote.updatedAt), 'dd MMMM yyyy')}</p>
        <p><strong>Customer:</strong> ${quote.customerName}</p>
        ${quote.customerEmail ? `<p><strong>Email:</strong> ${quote.customerEmail}</p>` : ''}
        ${quote.customerPhone ? `<p><strong>Phone:</strong> ${quote.customerPhone}</p>` : ''}
        ${quote.jobAddress ? `<p><strong>Job Address:</strong> ${quote.jobAddress}</p>` : ''}
      </div>

      <div class="info-section">
        <h3>Job Details</h3>
        <p><strong>${quote.job.name}</strong></p>
        <p>${quote.job.description}</p>
      </div>

      <h3>Materials</h3>
      ${quote.materials.length === 0 ? `
      <p style="color: #666666; font-style: italic; margin: 10px 0;">No materials required - Labor only</p>
      ` : `
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${quote.materials
            .map(
              (m) => `
            <tr>
              <td>${m.name}</td>
              <td>${m.quantity} ${m.unit}</td>
              <td>${formatCurrency(m.price)}</td>
              <td>${formatCurrency(m.totalPrice)}</td>
            </tr>
          `
            )
            .join('')}
          <tr class="total-row">
            <td colspan="3">Materials Subtotal</td>
            <td>${formatCurrency(quote.materialsSubtotal)}</td>
          </tr>
        </tbody>
      </table>
      `}

      <h3>Labor</h3>
      <table>
        <tbody>
          <tr>
            <td>Labor (${quote.laborHours} hours @ ${formatCurrency(quote.laborRate)}/hr)</td>
            <td>${formatCurrency(quote.laborTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>Materials Subtotal</span>
          <span>${formatCurrency(quote.materialsSubtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Labor</span>
          <span>${formatCurrency(quote.laborTotal)}</span>
        </div>
        <div class="summary-row">
          <span>Subtotal</span>
          <span>${formatCurrency(quote.subtotal)}</span>
        </div>
        <div class="summary-row">
          <span>Markup (${quote.markup}%)</span>
          <span>${formatCurrency(quote.markupAmount)}</span>
        </div>
        <div class="summary-row">
          <span>GST (10%)</span>
          <span>${formatCurrency(quote.gst)}</span>
        </div>
        <hr>
        <div class="summary-row grand-total">
          <span>TOTAL</span>
          <span>${formatCurrency(quote.total)}</span>
        </div>
      </div>

      ${quote.notes ? `<div class="info-section"><h3>Notes</h3><p>${quote.notes}</p></div>` : ''}

      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666666;">
        <p>This quote is valid for 30 days from the date of issue.</p>
        <p>Generated with QuoteMate - quoting tool for Australian tradies</p>
      </div>
    </body>
    </html>
    `;
}
