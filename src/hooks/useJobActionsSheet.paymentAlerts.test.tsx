// @vitest-environment jsdom
/**
 * Payment feedback routing (Aug 2026 consistency pass): errors and successes
 * from TakePaymentSheet must surface in the themed AlertModal, never the
 * native OS Alert — the OS dialog breaks the app's visual language (see the
 * useAlertModal docblock). This hook used to be one of the two call sites
 * still on Alert.alert('Payment error', …).
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Alert } from 'react-native';

// Same heavy-dependency shims as useJobActionsSheet.test.tsx — except
// TakePaymentSheet, whose props are captured so the test can fire the
// hook's onError/onSuccess wiring directly.
const captured = vi.hoisted(() => ({ props: null as any }));
vi.mock('../components/JobActionsSheet', () => ({ JobActionsSheet: () => null }));
vi.mock('../components/TakePaymentSheet', () => ({
  TakePaymentSheet: (props: any) => {
    captured.props = props;
    return null;
  },
}));
vi.mock('../components/SendDocumentDialog', () => ({ SendDocumentDialog: () => null }));
vi.mock('../components/FollowUpSheet', () => ({ FollowUpSheet: () => null }));
vi.mock('../components/StickyJobActionBar', () => ({
  pickPrimaryDoc: (docs: any[]) => docs[0] ?? null,
}));
vi.mock('../utils/pdfGenerator', () => ({ exportDocumentPDF: vi.fn() }));
vi.mock('../utils/quoteDeliveryGuard', () => ({
  ensureSquareConnectedForPayment: vi.fn(async () => true),
}));
vi.mock('../utils/deleteJobWithDocs', () => ({
  cascadeDeleteJob: vi.fn(),
  pickPaidDocs: () => [],
}));
vi.mock('../utils/applyStageChange', () => ({ applyStageChange: vi.fn() }));
vi.mock('../types/documentAdapter', () => ({
  documentToInvoice: (d: any) => d,
  documentToQuote: (d: any) => d,
}));
const alertSpy = vi.hoisted(() => ({ showAlert: vi.fn() }));
vi.mock('./useAlertModal', () => ({
  useAlertModal: () => ({ showAlert: alertSpy.showAlert, alertNode: null }),
}));
vi.mock('react-native-paper', () => ({ Snackbar: () => null }));

vi.mock('../store/useJobStore', async () => {
  const { create } = await vi.importActual<typeof import('zustand')>('zustand');
  const useJobStore = create(() => ({
    jobs: [] as any[],
    jobsLoaded: false,
    saveJob: async () => {},
    deleteJob: async () => {},
    duplicateJob: async () => ({ id: 'clone' }),
  }));
  return { useJobStore };
});
vi.mock('../store/useStore', async () => {
  const { create } = await vi.importActual<typeof import('zustand')>('zustand');
  const useStore = create(() => ({
    documents: [] as any[],
    businessSettings: null,
    xeroConnection: null,
    subscriptionStatus: null,
    lastSyncError: null,
    deleteQuote: async () => {},
    deleteInvoice: async () => {},
    pushInvoiceToXero: async () => {},
    pushQuoteToXero: async () => {},
    duplicateDocumentForJob: async () => ({ id: 'doc-clone' }),
    setCurrentQuote: () => {},
    setCurrentInvoice: () => {},
    saveQuote: async () => {},
    saveInvoice: async () => {},
    createInvoiceFromQuote: async () => ({ id: 'inv' }),
  }));
  return { useStore };
});

import { useJobActionsSheet } from './useJobActionsSheet';

function Host() {
  const { element } = useJobActionsSheet({ navigate: vi.fn() } as any);
  return <>{element}</>;
}

describe('useJobActionsSheet payment feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.props = null;
  });

  it('routes a payment error into the themed alert, not the native Alert', () => {
    const nativeAlert = vi.spyOn(Alert, 'alert');
    render(<Host />);

    captured.props.onError('Square declined the card.');

    expect(alertSpy.showAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Payment error',
        message: 'Square declined the card.',
      }),
    );
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('shows the themed success dialog when a card charge completes', () => {
    render(<Host />);

    captured.props.onSuccess({ kind: 'card_charge', amount: 250 });

    expect(alertSpy.showAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Payment received' }),
    );
    expect(String(alertSpy.showAlert.mock.calls[0][0].message)).toContain(
      'charged to card',
    );
  });
});
