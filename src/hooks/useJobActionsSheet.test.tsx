// @vitest-environment jsdom
/**
 * Regression tests for the useJobActionsSheet subscription behavior.
 *
 * The hook is mounted by DashboardScreen and JobsListScreen. It used to
 * subscribe with a bare `useJobStore()` destructure plus a broad
 * `s.documents` selector, so EVERY job/document store write re-rendered
 * both screens — including Firestore listener echoes landing right as the
 * user navigated back to the dashboard (the "flicker on return" bug).
 *
 * These tests mount a probe component around the hook and assert it only
 * re-renders when state it actually displays changes.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// The hook's element mounts four sheet components with heavy native/expo
// dependency graphs — none of which matter for subscription behavior.
vi.mock('../components/JobActionsSheet', () => ({ JobActionsSheet: () => null }));
vi.mock('../components/TakePaymentSheet', () => ({ TakePaymentSheet: () => null }));
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
vi.mock('./useAlertModal', () => ({
  useAlertModal: () => ({ showAlert: vi.fn(), alertNode: null }),
}));
vi.mock('react-native-paper', () => ({ Snackbar: () => null }));

// Real Zustand stores with just the slices the hook touches, so the test
// exercises the hook's actual subscription/selector behavior.
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

import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { useJobActionsSheet } from './useJobActionsSheet';

let renders = 0;
let hookResult: ReturnType<typeof useJobActionsSheet>;

function Host() {
  renders++;
  hookResult = useJobActionsSheet({ navigate: vi.fn() });
  return <>{hookResult.element}</>;
}

const makeJob = (id: string) => ({
  id,
  name: `Job ${id}`,
  customerName: 'Someone',
  stage: 'quoted',
  updatedAt: Date.now(),
});

describe('useJobActionsSheet subscriptions', () => {
  beforeEach(() => {
    renders = 0;
    act(() => {
      useJobStore.setState({ jobs: [], jobsLoaded: false });
      useStore.setState({ documents: [] });
    });
  });

  it('does not re-render the host when jobs change while no sheet is open', () => {
    render(<Host />);
    const before = renders;

    act(() => {
      useJobStore.setState({ jobs: [makeJob('a'), makeJob('b')] });
    });
    act(() => {
      useJobStore.setState({ jobsLoaded: true });
    });

    expect(renders).toBe(before);
  });

  it('does not re-render the host when documents change while no sheet is open', () => {
    render(<Host />);
    const before = renders;

    act(() => {
      useStore.setState({ documents: [{ id: 'd1', jobId: 'a', type: 'quote' }] });
    });

    expect(renders).toBe(before);
  });

  it('re-renders on document changes while the actions sheet is open (live primaryDoc)', () => {
    render(<Host />);

    act(() => {
      hookResult.open(makeJob('a') as any);
    });
    const before = renders;

    act(() => {
      useStore.setState({ documents: [{ id: 'd1', jobId: 'a', type: 'quote' }] });
    });

    expect(renders).toBeGreaterThan(before);
  });

  it('keeps a stable `open` identity across re-renders', () => {
    render(<Host />);
    const firstOpen = hookResult.open;

    act(() => {
      hookResult.open(makeJob('a') as any);
    });

    expect(hookResult.open).toBe(firstOpen);
  });
});
