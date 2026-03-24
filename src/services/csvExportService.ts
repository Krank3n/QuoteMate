/**
 * CSV Export Service
 * Generates Xero-compatible CSV files for invoice import
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { format } from 'date-fns';
import { Invoice } from '../types';

/**
 * Escape a CSV field value (handle commas, quotes, newlines)
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate Xero-compatible CSV content from invoices.
 * Follows Xero's "Invoices - Accounts Receivable" import format.
 * Each line item gets its own row; Xero groups by InvoiceNumber.
 * Invoice-level fields (Total, TaxTotal) only on the first row per invoice.
 */
export function generateXeroCSV(invoices: Invoice[]): string {
  const headers = [
    'ContactName',
    'EmailAddress',
    'POAddressLine1',
    'InvoiceNumber',
    'Reference',
    'InvoiceDate',
    'DueDate',
    'Total',
    'TaxTotal',
    'Description',
    'Quantity',
    'UnitAmount',
    'AccountCode',
    'TaxType',
  ];

  const rows: string[][] = [];

  for (const invoice of invoices) {
    const contactName = invoice.customerName || 'Unknown Customer';
    const email = invoice.customerEmail || '';
    const address = invoice.jobAddress || '';
    const invNumber = invoice.invoiceNumber || invoice.id.slice(0, 8);
    const reference = invoice.job?.name || '';
    const invDate = format(new Date(invoice.issueDate), 'dd/MM/yyyy');
    const dueDate = format(new Date(invoice.dueDate), 'dd/MM/yyyy');
    let isFirstRow = true;

    const addRow = (description: string, quantity: string, unitAmount: string) => {
      rows.push([
        contactName,
        email,
        address,
        invNumber,
        reference,
        invDate,
        dueDate,
        isFirstRow ? invoice.total.toFixed(2) : '',
        isFirstRow ? invoice.gst.toFixed(2) : '',
        description,
        quantity,
        unitAmount,
        '200', // Xero AU Sales account
        'OUTPUT', // GST on Income
      ]);
      isFirstRow = false;
    };

    // Material line items
    for (const material of invoice.materials) {
      addRow(material.name, material.quantity.toString(), material.price.toFixed(2));
    }

    // Labour line item
    if (invoice.laborHours > 0 && invoice.laborRate > 0) {
      addRow(
        `Labour - ${invoice.job?.name || 'General'}`,
        invoice.laborHours.toString(),
        invoice.laborRate.toFixed(2),
      );
    }

    // Markup line item
    if (invoice.markupAmount > 0) {
      addRow('Markup', '1', invoice.markupAmount.toFixed(2));
    }

    // If invoice has no line items at all, add a single summary row
    if (invoice.materials.length === 0 && invoice.laborHours === 0 && invoice.markupAmount === 0) {
      addRow(invoice.job?.name || 'Services', '1', invoice.subtotal.toFixed(2));
    }
  }

  const csvLines = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
  ];

  return csvLines.join('\n');
}

/**
 * Export invoices to a Xero-compatible CSV file and open the share dialog.
 */
export async function exportInvoicesToCSV(invoices: Invoice[]): Promise<void> {
  const csv = generateXeroCSV(invoices);
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const fileName = `QuoteMate-Invoices-${dateStr}.csv`;
  const filePath = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(filePath, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'Export Invoices to CSV',
    });
  }
}
