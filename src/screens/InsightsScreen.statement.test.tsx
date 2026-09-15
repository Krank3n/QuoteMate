// @vitest-environment jsdom
/**
 * The statement card on the money page.
 *
 * Three things this pins. The figures are the ones buildStatement computes,
 * through formatCurrency — a statement a tradie hands an accountant cannot
 * disagree with the PDF. The GST line is absent for a business under the
 * registration threshold, which is the tradie who asked for this. And the
 * documents come from an uncapped one-shot read, because the store's live
 * listener stops at 500 and a financial year is bigger than that.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../components/MonthComparisonChart', () => ({ MonthComparisonChart: () => null }));
vi.mock('../components/QuotePipelineChart', () => ({ QuotePipelineChart: () => null }));
vi.mock('../components/RevenueChart', () => ({ RevenueChart: () => null }));
vi.mock('../components/CostBreakdownChart', () => ({ CostBreakdownChart: () => null }));
vi.mock('../components/DueDateSheet', () => ({ DueDateSheet: () => null }));
vi.mock('../components/ProBadge', () => ({ ProBadge: () => <span>PRO</span> }));

const sendSheet = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/SendStatementSheet', () => ({
  SendStatementSheet: (props: any) => {
    sendSheet.props = props;
    return props.visible ? <div data-testid="send-sheet" /> : null;
  },
}));

vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    Text,
    Surface: ({ children }: any) => React.createElement(View, null, children),
    Button: ({ children, onPress, disabled }: any) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

vi.mock('../hooks/useAlertModal', () => ({
  useAlertModal: () => ({ showAlert: vi.fn(), dismissAlert: vi.fn(), alertNode: null }),
}));

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => nav }));

const pdf = vi.hoisted(() => ({
  exportStatementPDF: vi.fn(async () => {}),
  reservePrintWindow: vi.fn(() => null),
}));
vi.mock('../utils/pdfGenerator', () => pdf);

const docService = vi.hoisted(() => ({
  documentService: { loadDocuments: vi.fn(async () => [] as any[]) },
}));
vi.mock('../services/documentService', () => docService);

const store = vi.hoisted(() => ({
  state: {
    documents: [] as any[],
    businessSettings: { businessName: 'Leo Wright Electrical', gstRegistered: false } as any,
    subscriptionStatus: { isPro: true } as any,
  },
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector?: any) => (selector ? selector(store.state) : store.state),
}));

import { InsightsScreen } from './InsightsScreen';
import { statementPeriod } from '../utils/statementPeriods';

const LAST_FY = statementPeriod('lastFinancialYear');
const DAY = 24 * 60 * 60 * 1000;

/** An issued invoice inside last financial year, part paid in the same year. */
const invoice = (over: Record<string, any> = {}) => ({
  id: 'doc-1',
  number: 'INV-1042',
  type: 'invoice',
  stage: 'partially_paid',
  customerName: 'Marcelle Fabre',
  documentDate: LAST_FY.fromMs + 30 * DAY,
  subtotal: 1000,
  gst: 0,
  total: 1000,
  payments: [{ amount: 400, paidAt: LAST_FY.fromMs + 45 * DAY, method: 'bank' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sendSheet.props = null;
  store.state.documents = [];
  store.state.businessSettings = { businessName: 'Leo Wright Electrical', gstRegistered: false };
  store.state.subscriptionStatus = { isPro: true };
  docService.documentService.loadDocuments.mockResolvedValue([]);
});

describe('InsightsScreen — statement card', () => {
  it('shows the period rows as currency, from the uncapped read', async () => {
    docService.documentService.loadDocuments.mockResolvedValue([invoice()]);
    render(<InsightsScreen />);

    await waitFor(() => expect(screen.getByText('Invoices issued (1)')).toBeTruthy());
    expect(screen.getByText('$1,000.00')).toBeTruthy();
    expect(screen.getByText('Payments received (1)')).toBeTruthy();
    expect(screen.getByText('$400.00')).toBeTruthy();
    expect(screen.getByText(/^Outstanding at /)).toBeTruthy();
    expect(screen.getByText('$600.00')).toBeTruthy();
  });

  it('reads the documents once, uncapped, on mount', async () => {
    render(<InsightsScreen />);
    await waitFor(() =>
      expect(docService.documentService.loadDocuments).toHaveBeenCalledTimes(1),
    );
  });

  it('leaves GST out for a business under the registration threshold', async () => {
    docService.documentService.loadDocuments.mockResolvedValue([invoice()]);
    render(<InsightsScreen />);
    await waitFor(() => expect(screen.getByText('Invoices issued (1)')).toBeTruthy());
    expect(screen.queryByText('GST collected')).toBeNull();
  });

  it('shows GST collected when the business is registered', async () => {
    store.state.businessSettings = { businessName: 'Leo Wright Electrical', gstRegistered: true };
    docService.documentService.loadDocuments.mockResolvedValue([
      invoice({ subtotal: 1000, gst: 100, total: 1100 }),
    ]);
    render(<InsightsScreen />);
    await waitFor(() => expect(screen.getByText('GST collected')).toBeTruthy());
    expect(screen.getByText('$100.00')).toBeTruthy();
  });

  it('says so plainly when the period is empty, and still lets the statement go', async () => {
    render(<InsightsScreen />);
    await waitFor(() =>
      expect(docService.documentService.loadDocuments).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText('Nothing recorded in this period')).toBeTruthy();
    const send = screen.getByText('Send to accountant').closest('button') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByTestId('send-sheet')).toBeTruthy());
  });

  it('hands the sheet the chosen period', async () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Last quarter'));
    fireEvent.click(screen.getByText('Send to accountant'));
    await waitFor(() => expect(sendSheet.props?.visible).toBe(true));
    expect(sendSheet.props.preset).toBe('lastQuarter');
    expect(sendSheet.props.period).toEqual(
      expect.objectContaining({ fromMs: expect.any(Number), toMs: expect.any(Number) }),
    );
  });

  it('sends a free account to the paywall instead of the composer', async () => {
    store.state.subscriptionStatus = { isPro: false };
    render(<InsightsScreen />);
    expect(screen.getByText('PRO')).toBeTruthy();

    fireEvent.click(screen.getByText('Send to accountant'));
    expect(nav.navigate).toHaveBeenCalledWith('Paywall', { source: 'insights_statement' });
    expect(screen.queryByTestId('send-sheet')).toBeNull();

    fireEvent.click(screen.getByText('Share PDF'));
    expect(pdf.exportStatementPDF).not.toHaveBeenCalled();
  });

  it('shares the PDF for the period on Pro', async () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Share PDF'));
    await waitFor(() => expect(pdf.exportStatementPDF).toHaveBeenCalledTimes(1));
    const [, business, options] = pdf.exportStatementPDF.mock.calls[0] as any[];
    expect(business.businessName).toBe('Leo Wright Electrical');
    expect(options).toMatchObject({ fromMs: LAST_FY.fromMs, toMs: LAST_FY.toMs });
  });
});
