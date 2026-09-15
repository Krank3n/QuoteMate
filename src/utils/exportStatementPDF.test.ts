/**
 * Share PDF, the no-server half of the statement. It has to render the same
 * document the emailed one does — the tradie's business on it, the invoices
 * in the period — and hand the phone a file named so a folder of statements
 * sorts itself.
 *
 * The expo native modules are mocked the way the print path is exercised
 * elsewhere; everything under shared/pdf is real, so the HTML asserted here
 * is the HTML that prints.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
  Alert: { alert: vi.fn() },
}));

const print = vi.hoisted(() => ({
  printToFileAsync: vi.fn(async () => ({ uri: 'file:///tmp/print-0.pdf' })),
  printAsync: vi.fn(async () => {}),
}));
vi.mock('expo-print', () => print);

const fs = vi.hoisted(() => ({
  cacheDirectory: 'file:///cache/',
  copyAsync: vi.fn(async () => {}),
  readAsStringAsync: vi.fn(async () => ''),
  downloadAsync: vi.fn(async () => ({ status: 200, uri: '' })),
  EncodingType: { Base64: 'base64' },
}));
vi.mock('expo-file-system', () => fs);

const sharing = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));
vi.mock('expo-sharing', () => sharing);
vi.mock('expo-mail-composer', () => ({ isAvailableAsync: vi.fn(async () => false), composeAsync: vi.fn() }));
vi.mock('../store/useStore', () => ({ useStore: { getState: () => ({}) } }));
vi.mock('../services/squareService', () => ({ checkSquareConnection: vi.fn(async () => false) }));

import { exportStatementPDF } from './pdfGenerator';
import { buildStatement } from '../../shared/statement/buildStatement';
import type { BusinessSettings } from '../types';

const FROM = Date.UTC(2025, 6, 1);
const TO = Date.UTC(2026, 6, 1);

const business = {
  businessName: 'Leo Wright Electrical',
  email: 'leo@example.com.au',
  phone: '0400 000 000',
  abn: '12 345 678 901',
  gstRegistered: false,
} as BusinessSettings;

const statement = buildStatement(
  [
    {
      id: 'doc-1',
      number: 'INV-1042',
      type: 'invoice',
      stage: 'partially_paid',
      customerName: 'Marcelle Fabre',
      documentDate: Date.UTC(2025, 8, 12),
      subtotal: 1000,
      gst: 0,
      total: 1000,
      payments: [{ amount: 400, paidAt: Date.UTC(2025, 9, 2), method: 'bank' }],
    },
  ],
  { fromMs: FROM, toMs: TO },
  { gstRegistered: false },
);

describe('exportStatementPDF', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the tradie business and the period invoices, then shares the file', async () => {
    await exportStatementPDF(statement, business, { fromMs: FROM, toMs: TO, timeZone: 'UTC' });

    expect(print.printToFileAsync).toHaveBeenCalledTimes(1);
    const html = (print.printToFileAsync.mock.calls[0][0] as any).html as string;
    expect(html).toContain('Leo Wright Electrical');
    expect(html).toContain('INV-1042');
    expect(html).toContain('Marcelle Fabre');
    // Not registered for GST: no GST column, and it says so.
    expect(html).toContain('Not registered for GST');

    expect(sharing.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('names the file by period so a folder of statements sorts itself', async () => {
    await exportStatementPDF(statement, business, { fromMs: FROM, toMs: TO, timeZone: 'UTC' });

    const { to } = (fs.copyAsync.mock.calls[0][0] as any) as { to: string };
    expect(to).toBe('file:///cache/Statement 2025-07-01 to 2026-06-30 Leo Wright Electrical.pdf');
  });

  it('carries no app branding — the statement is the tradie’s document', async () => {
    await exportStatementPDF(statement, business, { fromMs: FROM, toMs: TO, timeZone: 'UTC' });
    const html = (print.printToFileAsync.mock.calls[0][0] as any).html as string;
    expect(html).not.toContain('QuoteMate');
  });
});
