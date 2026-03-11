/**
 * Shared email utility functions for quotes
 * Eliminates duplication across DashboardScreen, QuotesListScreen, and QuoteCard
 */

import { Alert } from 'react-native';
import { Quote, BusinessSettings } from '../types';
import { formatCurrency } from './quoteCalculator';

export function buildQuoteEmailSubject(quote: Quote, businessSettings: BusinessSettings | null): string {
  return `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`;
}

export function buildQuoteEmailBody(quote: Quote, businessSettings: BusinessSettings | null): string {
  return (
    `Hi ${quote.customerName},\n\n` +
    `Please find your quotation for ${quote.job.name}.\n\n` +
    `Total: ${formatCurrency(quote.total)}\n\n` +
    `This quote is valid for 30 days from the date of issue.\n\n` +
    `If you have any questions, please don't hesitate to contact us.\n\n` +
    `Best regards,\n${businessSettings?.businessName || 'Your Business'}\n\n` +
    `---\n` +
    `Note: A print dialog has opened with the quote PDF. Please save it as PDF and attach it to this email.`
  );
}

type EmailProvider = 'gmail' | 'outlook' | 'yahoo';

const EMAIL_URLS: Record<EmailProvider, (recipient: string, subject: string, body: string) => string> = {
  gmail: (to, subject, body) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  outlook: (to, subject, body) =>
    `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  yahoo: (to, subject, body) =>
    `https://compose.mail.yahoo.com/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
};

export async function openWebEmailClient(
  provider: EmailProvider,
  quote: Quote,
  businessSettings: BusinessSettings | null,
  saveQuote: (quote: Quote) => Promise<void>,
): Promise<void> {
  const subject = buildQuoteEmailSubject(quote, businessSettings);
  const body = buildQuoteEmailBody(quote, businessSettings);
  const recipient = quote.customerEmail || '';

  const url = EMAIL_URLS[provider](recipient, subject, body);
  window.open(url, '_blank');

  const updatedQuote = { ...quote, status: 'sent' as const };
  await saveQuote(updatedQuote);
}

export async function copyQuoteEmailText(
  quote: Quote,
  businessSettings: BusinessSettings | null,
  saveQuote: (quote: Quote) => Promise<void>,
): Promise<void> {
  const subject = buildQuoteEmailSubject(quote, businessSettings);
  const body = buildQuoteEmailBody(quote, businessSettings);
  const recipient = quote.customerEmail || '';

  const emailText = `To: ${recipient}\nSubject: ${subject}\n\n${body}`;
  await navigator.clipboard.writeText(emailText);
  Alert.alert('Copied!', 'Email text copied to clipboard. You can paste it into your email client.');

  const updatedQuote = { ...quote, status: 'sent' as const };
  await saveQuote(updatedQuote);
}
