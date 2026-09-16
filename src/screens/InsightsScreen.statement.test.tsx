// @vitest-environment jsdom
/**
 * The statement card on the money page.
 *
 * What this pins. The figures are the ones buildStatement computes, through
 * formatCurrency — a statement a tradie hands an accountant cannot disagree
 * with the PDF. The GST line is absent for a business under the registration
 * threshold, which is the tradie who asked for this. The documents come from
 * an uncapped one-shot read, because the store's live listener stops at 500
 * and a financial year is bigger than that — and nothing about the period is
 * asserted on screen until that read has actually answered. The custom range
 * takes two picks before it counts as a range at all.
 *
 * The card sits behind the Reports segment of the switcher, so these render
 * with the route param the dashboard's statement link sends.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../components/MonthComparisonChart', () => ({
  MonthComparisonChart: () => <div data-testid="chart:months" />,
}));
vi.mock('../components/QuotePipelineChart', () => ({
  QuotePipelineChart: () => <div data-testid="chart:pipeline" />,
}));
vi.mock('../components/RevenueChart', () => ({ RevenueChart: () => <div data-testid="chart:revenue" /> }));
vi.mock('../components/CostBreakdownChart', () => ({
  CostBreakdownChart: () => <div data-testid="chart:costs" />,
}));
// The calendar itself is covered by its own suite; what matters here is the
// two-step conversation the screen has with it.
const sheets = vi.hoisted(() => ({ byTitle: {} as Record<string, any> }));
vi.mock('../components/DueDateSheet', () => ({
  DueDateSheet: (props: any) => {
    sheets.byTitle[props.title] = props;
    return props.visible ? <div data-testid={`sheet:${props.title}`} /> : null;
  },
}));
vi.mock('../components/ProBadge', () => ({ ProBadge: () => <span>PRO</span> }));

const sendSheet = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/SendStatementSheet', () => ({
  SendStatementSheet: (props: any) => {
    sendSheet.props = props;
    return props.visible ? <div data-testid="send-sheet" /> : null;
  },
}));

vi.mock('../components/PillToggle', () => ({
  PillToggle: ({ value, onChange, options }: any) => (
    <div>
      {options.map((opt: any) => (
        <button key={opt.value} aria-selected={value === opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  ),
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
const routeParams = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => nav,
  useRoute: () => ({ params: routeParams.current }),
}));

const pdf = vi.hoisted(() => ({
  exportStatementPDF: vi.fn(async () => {}),
  reservePrintWindow: vi.fn(() => null),
}));
vi.mock('../utils/pdfGenerator', () => pdf);

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../services/analyticsService', () => analytics);

const docService = vi.hoisted(() => ({
  documentService: { loadDocuments: vi.fn(async () => [] as any[]) },
}));
vi.mock('../services/documentService', () => docService);

// A small real store: the screen reads `getState()` when the uncapped read
// answers, and a write has to re-render the card — a payment recorded while
// Insights sits underneath in the stack lands in the store, not in the
// one-shot read.
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const api = {
    state: {} as any,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    write(next: any) {
      api.state = { ...api.state, ...next };
      listeners.forEach((listener) => listener());
    },
  };
  return api;
});
vi.mock('../store/useStore', () => ({
  useStore: Object.assign(
    (selector?: any) =>
      React.useSyncExternalStore(store.subscribe, () =>
        selector ? selector(store.state) : store.state,
      ),
    { getState: () => store.state },
  ),
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

/** A promise the test decides when to answer, to catch the card mid-read. */
function deferredDocuments() {
  let answer: (docs: any[]) => void = () => {};
  const promise = new Promise<any[]>((resolve) => {
    answer = resolve;
  });
  return { promise, answer: (docs: any[]) => answer(docs) };
}

/** aria-selected on the chip carrying this label. */
const chipSelected = (label: string) =>
  screen.getByText(label).closest('[aria-selected]')?.getAttribute('aria-selected');

const buttonFor = (label: string) =>
  screen.getByText(label).closest('button') as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  routeParams.current = { section: 'reports' };
  sendSheet.props = null;
  sheets.byTitle = {};
  store.state = {
    documents: [] as any[],
    businessSettings: { businessName: 'Leo Wright Electrical', gstRegistered: false } as any,
    subscriptionStatus: { isPro: true } as any,
  };
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
    store.write({ businessSettings: { businessName: 'Leo Wright Electrical', gstRegistered: true } });
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
      expect(screen.getByText(/^Nothing recorded between /)).toBeTruthy(),
    );
    const send = buttonFor('Send to accountant');
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByTestId('send-sheet')).toBeTruthy());
  });

  // "Nothing recorded" off a read that hasn't answered is a lie, and the one
  // a tradie would act on — they'd assume the app lost the year.
  it('holds a skeleton until the uncapped read answers', async () => {
    const gate = deferredDocuments();
    docService.documentService.loadDocuments.mockReturnValue(gate.promise);
    render(<InsightsScreen />);

    expect(screen.getByTestId('statement-skeleton')).toBeTruthy();
    expect(screen.queryByText(/^Nothing recorded between /)).toBeNull();

    await act(async () => {
      gate.answer([invoice()]);
    });
    await waitFor(() => expect(screen.getByText('Invoices issued (1)')).toBeTruthy());
    expect(screen.queryByTestId('statement-skeleton')).toBeNull();
  });

  it("says the figures are the phone's copy when the uncapped read fails", async () => {
    // loadDocuments answers [] for a failed read as well as an empty account;
    // with documents in the store it can only be the failure.
    store.write({ documents: [invoice()] });
    render(<InsightsScreen />);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Showing what's saved on this phone. Get back on signal and reopen to check every invoice.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByText('Invoices issued (1)')).toBeTruthy();
  });

  it('leaves the line off an account that genuinely has nothing', async () => {
    render(<InsightsScreen />);
    await waitFor(() => expect(screen.getByText(/^Nothing recorded between /)).toBeTruthy());
    expect(screen.queryByText(/Showing what's saved on this phone/)).toBeNull();
  });

  it('follows the store when a payment lands while Insights is open', async () => {
    docService.documentService.loadDocuments.mockResolvedValue([
      invoice({ stage: 'invoice_sent', payments: [] }),
    ]);
    render(<InsightsScreen />);
    await waitFor(() => expect(screen.getByText('Payments received (0)')).toBeTruthy());

    // Recorded on the job screen sitting on top of Insights: it reaches the
    // live listener, never the one-shot read taken on mount.
    act(() => store.write({ documents: [invoice()] }));

    await waitFor(() => expect(screen.getByText('Payments received (1)')).toBeTruthy());
    expect(screen.getByText('$400.00')).toBeTruthy();
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
    store.write({ subscriptionStatus: { isPro: false } });
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
    expect(analytics.trackEvent).toHaveBeenCalledWith('statement_shared', {
      preset: 'lastFinancialYear',
    });
  });

  it('names each period in full for a screen reader', () => {
    render(<InsightsScreen />);
    expect(screen.getByLabelText('Last financial year')).toBeTruthy();
    expect(screen.getByLabelText('This financial year so far')).toBeTruthy();
    expect(screen.getByLabelText('Custom dates')).toBeTruthy();
  });
});

describe('InsightsScreen — a custom range', () => {
  const START = new Date(2026, 0, 12).getTime();
  const END = new Date(2026, 2, 31).getTime();

  it('leaves the chip where it was when the calendar is dismissed halfway', () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Last quarter'));
    expect(chipSelected('Last quarter')).toBe('true');

    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getByTestId('sheet:Start date (1 of 2)')).toBeTruthy();
    act(() => sheets.byTitle['Start date (1 of 2)'].onDismiss());

    // One date is not a range, so nothing has changed but the tradie's mind.
    expect(chipSelected('Custom')).toBe('false');
    expect(chipSelected('Last quarter')).toBe('true');
  });

  it('takes the chip once both dates are in, with the end anchored on the start', () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Custom'));
    act(() => sheets.byTitle['Start date (1 of 2)'].onChange(START));

    expect(chipSelected('Custom')).toBe('false');
    const end = sheets.byTitle['End date (2 of 2)'];
    expect(end.visible).toBe(true);
    expect(end.value).toBe(START);
    expect(end.minDate).toBe(START);

    act(() => end.onChange(END));
    expect(chipSelected('Custom')).toBe('true');
    expect(screen.getByText('12 Jan 2026 – 31 Mar 2026')).toBeTruthy();
  });

  it('will not email more than 24 months, but still shares the PDF', () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Custom'));
    act(() => sheets.byTitle['Start date (1 of 2)'].onChange(new Date(2023, 0, 1).getTime()));
    act(() => sheets.byTitle['End date (2 of 2)'].onChange(new Date(2026, 0, 1).getTime()));

    expect(screen.getByText('Emailing covers at most 24 months. Pick a shorter range.')).toBeTruthy();
    expect(buttonFor('Send to accountant').disabled).toBe(true);
    expect(buttonFor('Share PDF').disabled).toBe(false);
  });

  it('emails a range that fits', () => {
    render(<InsightsScreen />);
    fireEvent.click(screen.getByText('Custom'));
    act(() => sheets.byTitle['Start date (1 of 2)'].onChange(new Date(2024, 6, 1).getTime()));
    act(() => sheets.byTitle['End date (2 of 2)'].onChange(new Date(2026, 5, 30).getTime()));

    expect(screen.queryByText(/at most 24 months/)).toBeNull();
    expect(buttonFor('Send to accountant').disabled).toBe(false);
  });
});

/**
 * Insights ("how am I going") and Reports (a document for someone else) are
 * two different jobs, so only one of them is on screen at a time and the
 * dashboard links land on the right one.
 */
describe('InsightsScreen — the Insights / Reports switcher', () => {
  it('opens on the charts, with the statement out of the way', () => {
    routeParams.current = undefined;
    render(<InsightsScreen />);

    expect(screen.getByTestId('chart:months')).toBeTruthy();
    expect(screen.getByTestId('chart:pipeline')).toBeTruthy();
    expect(screen.getByTestId('chart:revenue')).toBeTruthy();
    expect(screen.getByTestId('chart:costs')).toBeTruthy();
    expect(screen.queryByText('Statement for your accountant')).toBeNull();
  });

  it("opens on the statement when the dashboard's link asks for Reports", () => {
    routeParams.current = { section: 'reports' };
    render(<InsightsScreen />);

    expect(screen.getByText('Statement for your accountant')).toBeTruthy();
    expect(screen.queryByTestId('chart:months')).toBeNull();
  });

  it('swaps the halves when a segment is tapped', () => {
    routeParams.current = undefined;
    render(<InsightsScreen />);

    fireEvent.click(screen.getByText('Reports'));
    expect(screen.getByText('Statement for your accountant')).toBeTruthy();
    expect(screen.queryByTestId('chart:months')).toBeNull();

    fireEvent.click(screen.getByText('Insights'));
    expect(screen.getByTestId('chart:months')).toBeTruthy();
    expect(screen.queryByText('Statement for your accountant')).toBeNull();
  });

  // The screen sits in the stack under other cards: a later link has to move
  // the switcher, not just the one that mounted it.
  it('follows a param change while the screen stays mounted', () => {
    routeParams.current = { section: 'insights' };
    const { rerender } = render(<InsightsScreen />);
    expect(screen.getByTestId('chart:months')).toBeTruthy();

    routeParams.current = { section: 'reports' };
    rerender(<InsightsScreen />);

    expect(screen.getByText('Statement for your accountant')).toBeTruthy();
    expect(screen.queryByTestId('chart:months')).toBeNull();
  });
});
