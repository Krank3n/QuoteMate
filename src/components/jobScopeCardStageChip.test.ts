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
vi.mock('./document', () => ({}));
vi.mock('./StageSheet', () => ({
  STAGE_META: new Proxy({}, { get: () => ({ chipLabel: 'x', actionLabel: 'x', icon: 'x', color: '#000', bgColor: '#fff' }) }),
  StageSheet: () => null,
}));

import { shouldShowStageChip } from './JobScopeCard';

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
