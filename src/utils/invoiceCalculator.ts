/**
 * Invoice Calculator Utility
 * Helper functions for invoice calculations and formatting
 */

import { Invoice, PaymentTerms } from '../types';

/**
 * Calculate due date based on issue date and payment terms
 */
export function calculateDueDate(
  issueDate: Date,
  terms: PaymentTerms,
  customDays?: number
): Date {
  const date = new Date(issueDate);

  switch (terms) {
    case 'due_on_receipt':
      return date;
    case 'net_7':
      date.setDate(date.getDate() + 7);
      return date;
    case 'net_14':
      date.setDate(date.getDate() + 14);
      return date;
    case 'net_30':
      date.setDate(date.getDate() + 30);
      return date;
    case 'custom':
      date.setDate(date.getDate() + (customDays || 0));
      return date;
    default:
      return date;
  }
}

/**
 * Check if an invoice is overdue
 */
export function isInvoiceOverdue(invoice: Invoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'cancelled') {
    return false;
  }

  const now = new Date();
  const dueDate = new Date(invoice.dueDate);

  // Reset time components for date comparison
  now.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  return now > dueDate;
}

/**
 * Get days until due (negative if overdue)
 */
export function getDaysUntilDue(invoice: Invoice): number {
  const now = new Date();
  const dueDate = new Date(invoice.dueDate);

  // Reset time components for accurate day calculation
  now.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  const diffTime = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Get the remaining amount due on an invoice
 */
export function getAmountDue(invoice: Invoice): number {
  const paidAmount = invoice.paidAmount || 0;
  return Math.max(0, invoice.total - paidAmount);
}

/**
 * Format payment terms for display
 */
export function formatPaymentTerms(terms: PaymentTerms, customDays?: number): string {
  switch (terms) {
    case 'due_on_receipt':
      return 'Due on Receipt';
    case 'net_7':
      return 'Net 7 Days';
    case 'net_14':
      return 'Net 14 Days';
    case 'net_30':
      return 'Net 30 Days';
    case 'custom':
      return customDays ? `Net ${customDays} Days` : 'Custom';
    default:
      return terms;
  }
}

/**
 * Get status display text
 */
export function getInvoiceStatusText(status: Invoice['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'sent':
      return 'Sent';
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    case 'overdue':
      return 'Overdue';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/**
 * Get overdue text for display
 */
export function getOverdueText(invoice: Invoice): string | null {
  if (!isInvoiceOverdue(invoice)) {
    return null;
  }

  const daysOverdue = Math.abs(getDaysUntilDue(invoice));

  if (daysOverdue === 1) {
    return 'Overdue by 1 day';
  }

  return `Overdue by ${daysOverdue} days`;
}

/**
 * Get due date text for display
 */
export function getDueDateText(invoice: Invoice): string {
  const daysUntil = getDaysUntilDue(invoice);

  if (daysUntil < 0) {
    const daysOverdue = Math.abs(daysUntil);
    return daysOverdue === 1 ? 'Overdue by 1 day' : `Overdue by ${daysOverdue} days`;
  }

  if (daysUntil === 0) {
    return 'Due today';
  }

  if (daysUntil === 1) {
    return 'Due tomorrow';
  }

  return `Due in ${daysUntil} days`;
}
