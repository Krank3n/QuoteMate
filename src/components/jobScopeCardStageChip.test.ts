/**
 * Regression (Jul 2026): JobScopeCard hid the doc stage chip except on
 * paid docs ("redundant noise"), which orphaned "Convert to Invoice" —
 * the chip's stage sheet is the card's only door to it. Quotes must show
 * the chip at every stage; invoice lifecycle stays covered by PaymentChip.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ View: () => null, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, TouchableOpacity: () => null, Platform: { OS: 'web', select: (o: any) => o.web }, Linking: {}, Share: {} }));
vi.mock('react-native-paper', () => ({ DefaultTheme: { colors: {} }, MD3DarkTheme: { colors: {} }, Text: () => null, ActivityIndicator: () => null, Menu: () => null }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {} }));
vi.mock('../utils/pdfGenerator', () => ({ previewDocumentPDF: vi.fn() }));
vi.mock('./PaymentChip', () => ({ PaymentChip: () => null, derivePaymentState: () => 'unpaid' }));
vi.mock('../store/useStore', () => ({ useStore: () => null }));
vi.mock('../hooks/useAlertModal', () => ({ useAlertModal: () => ({ showAlert: vi.fn(), dismissAlert: vi.fn(), alertNode: null }) }));
vi.mock('./InvoiceDisplaySettings', () => ({ InvoiceDisplaySettings: () => null, DepositSettings: () => null, DisplayToggles: () => null }));
// DueDateSheet pulls in react-native-calendars, which ships untranspiled JSX
// vitest can't parse — and nothing here renders the sheet anyway.
vi.mock('./DueDateSheet', () => ({ DueDateSheet: () => null }));
vi.mock('../services/documentService', () => ({ documentService: { clearDocumentFields: vi.fn() } }));
vi.mock('./document', () => ({}));
vi.mock('./StageSheet', () => ({
  STAGE_META: new Proxy({}, { get: () => ({ chipLabel: 'x', actionLabel: 'x', icon: 'x', color: '#000', bgColor: '#fff' }) }),
  StageSheet: () => null,
}));

import { shouldShowStageChip, stageChipContent, stageChipAccessibilityLabel, compactAgo } from './JobScopeCard';

describe('shouldShowStageChip', () => {
  it('shows the chip for quotes at every stage (door to Convert to Invoice)', () => {
    expect(shouldShowStageChip({ type: 'quote', stage: 'draft' } as any)).toBe(true);
    expect(shouldShowStageChip({ type: 'quote', stage: 'quote_sent' } as any)).toBe(true);
    expect(shouldShowStageChip({ type: 'quote', stage: 'quote_accepted' } as any)).toBe(true);
  });

  it('keeps invoice lifecycle chips hidden (PaymentChip covers them)', () => {
    expect(shouldShowStageChip({ type: 'invoice', stage: 'draft' } as any)).toBe(false);
    expect(shouldShowStageChip({ type: 'invoice', stage: 'invoice_sent' } as any)).toBe(false);
    expect(shouldShowStageChip({ type: 'invoice', stage: 'partially_paid' } as any)).toBe(false);
  });

  it('still shows the terminal paid chip', () => {
    expect(shouldShowStageChip({ type: 'invoice', stage: 'paid' } as any)).toBe(true);
  });
});

describe('stageChipContent (sent quote the customer opened)', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = 1_760_000_000_000;
  const base = { chipLabel: 'Quote sent', icon: 'send-outline' };
  const sent = (over: Record<string, any> = {}): any => ({
    type: 'quote', stage: 'quote_sent', sentAt: NOW - 5 * HOUR, updatedAt: NOW, ...over,
  });

  it('unopened: "Quote sent" with a compact age and no eye', () => {
    expect(stageChipContent(sent(), base, NOW)).toEqual({ icon: 'send-outline', label: 'Quote sent', meta: '5h', viewed: false });
  });

  it('opened: stays "Quote sent", aged from the send, and gains the eye', () => {
    const doc = sent({ customerOpenedAt: NOW - 2 * HOUR, customerOpenSource: 'link' });
    expect(stageChipContent(doc, base, NOW)).toEqual({ icon: 'send-outline', label: 'Quote sent', meta: '5h', viewed: true });
  });

  it('an email open counts too', () => {
    const doc = sent({ customerOpenedAt: NOW - HOUR, customerOpenSource: 'email' });
    expect(stageChipContent(doc, base, NOW).viewed).toBe(true);
  });

  it('an open that predates the latest send: no eye, aged from the re-send', () => {
    const doc = sent({ lastSentAt: NOW - HOUR, customerOpenedAt: NOW - 3 * HOUR });
    expect(stageChipContent(doc, base, NOW)).toMatchObject({ meta: '1h', viewed: false });
  });

  it('other stages never show the eye', () => {
    const doc = sent({ stage: 'quote_accepted', acceptedAt: NOW - HOUR, customerOpenedAt: NOW - 2 * HOUR });
    expect(stageChipContent(doc, { chipLabel: 'Accepted', icon: 'check-circle-outline' }, NOW).viewed).toBe(false);
  });

  it('reads sensibly to a screen reader', () => {
    const doc = sent({ customerOpenedAt: NOW - 2 * HOUR, customerOpenSource: 'link' });
    expect(stageChipAccessibilityLabel(stageChipContent(doc, base, NOW))).toBe('Quote sent 5h, viewed');
    expect(stageChipAccessibilityLabel(stageChipContent(sent(), base, NOW))).toBe('Quote sent 5h');
  });
});

describe('compactAgo', () => {
  const NOW = 1_760_000_000_000;
  const MIN = 60_000;
  it.each([
    [30_000, 'just now'],
    [5 * MIN, '5m'],
    [2 * 60 * MIN, '2h'],
    [3 * 24 * 60 * MIN, '3d'],
    [20 * 24 * 60 * MIN, '2w'],
    [120 * 24 * 60 * MIN, '4mo'],
    [-5 * MIN, 'just now'],
  ])('%i ms ago → %s', (ago, label) => {
    expect(compactAgo(NOW - ago, NOW)).toBe(label);
  });
});
