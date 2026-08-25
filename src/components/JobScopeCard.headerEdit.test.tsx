// @vitest-environment jsdom
/**
 * The expanded JobScopeCard header, pinned.
 *
 * Two behaviours moved here from JobPreview's header card and must not
 * silently regress:
 *   1. The Document date row renders directly under the header + chips —
 *      BEFORE the Job/Materials sections — so it reads as part of the doc's
 *      identity, not an afterthought below the totals.
 *   2. The doc number is tap-to-edit (pencil) in the expanded view, and a
 *      committed edit persists through saveDocument — the same path the
 *      date change uses, because quote→invoice converts leave no same-id
 *      legacy record and the mirror maps number → quoteNumber/invoiceNumber.
 *
 * Under jsdom, react-native is aliased to react-native-web (see
 * vitest.config.ts), so the real component renders to DOM nodes.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

const store = vi.hoisted(() => ({
  saveDocument: vi.fn(async () => {}),
  saveQuote: vi.fn(async () => {}),
  saveInvoice: vi.fn(async () => {}),
}));

// Heavy native/expo dependency graphs that don't matter for the header
// behaviour under test — same approach as JobCard.ghost.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, TextInput, View } = await import('react-native');
  const Menu = Object.assign(
    ({ anchor, children }: { anchor?: React.ReactNode; children?: React.ReactNode }) => (
      <View>
        {anchor}
        {children}
      </View>
    ),
    { Item: () => null },
  );
  return {
    Text,
    ActivityIndicator: () => null,
    Menu,
    // Paper-only props stripped so RNW's TextInput doesn't choke on them.
    TextInput: ({ mode: _m, dense: _d, ...props }: Record<string, unknown>) => (
      <TextInput {...(props as object)} />
    ),
  };
});
vi.mock('../theme', () => {
  const tokens = new Proxy({}, { get: () => '#000000' });
  return {
    makeStyles: (build: (t: { colors: unknown }) => unknown) => () =>
      build({ colors: tokens }),
    useThemeColors: () => tokens,
  };
});
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      businessSettings: {},
      subscriptionStatus: undefined,
      quotes: [],
      invoices: [],
      saveQuote: store.saveQuote,
      saveInvoice: store.saveInvoice,
      saveDocument: store.saveDocument,
    }),
}));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn() }));
vi.mock('../utils/pdfGenerator', () => ({ previewDocumentPDF: vi.fn(async () => {}) }));
vi.mock('../services/documentService', () => ({
  documentService: { clearDocumentFields: vi.fn(async () => {}) },
}));
vi.mock('../hooks/useAlertModal', () => ({
  useAlertModal: () => ({ showAlert: vi.fn(), alertNode: null }),
}));
vi.mock('./DueDateSheet', () => ({ DueDateSheet: () => null }));
vi.mock('./InvoiceDisplaySettings', () => ({ InvoiceDisplaySettings: () => null }));
vi.mock('./PaymentChip', () => ({
  PaymentChip: () => null,
  shouldShowPaymentChip: () => false,
}));
vi.mock('./StageSheet', () => ({
  stageMetaFor: () =>
    new Proxy(
      {},
      {
        get: () => ({
          color: '#000000',
          bgColor: '#000000',
          icon: 'circle',
          chipLabel: 'Draft',
        }),
      },
    ),
}));
// Marker sections so DOM order against the date row is assertable without
// rendering the full document layout.
vi.mock('./document', async () => {
  const { Text } = await import('react-native');
  return {
    JobSection: () => <Text>JOB_SECTION</Text>,
    MaterialsSection: () => null,
    LaborSection: () => null,
    TotalsSection: () => null,
  };
});

import { JobScopeCard } from './JobScopeCard';
import type { Document } from '../types/document';

const quoteDoc = {
  id: 'doc-1',
  type: 'quote',
  stage: 'draft',
  number: 'QU-177837',
  materials: [],
  updatedAt: Date.now(),
} as unknown as Document;

function renderCard() {
  return render(<JobScopeCard doc={quoteDoc} onEdit={vi.fn()} />);
}

function expandCard() {
  fireEvent.click(screen.getByLabelText('Show details'));
}

beforeEach(() => {
  store.saveDocument.mockClear();
});

describe('JobScopeCard expanded header', () => {
  it('keeps the number read-only while collapsed', () => {
    renderCard();
    expect(screen.getByText('QU-177837')).toBeTruthy();
    expect(screen.queryByLabelText('Edit quote number')).toBeNull();
    expect(screen.queryByText('Document date')).toBeNull();
  });

  it('renders the document date row above the Job section when expanded', () => {
    renderCard();
    expandCard();
    const dateRow = screen.getByText('Document date');
    const jobSection = screen.getByText('JOB_SECTION');
    // DOCUMENT_POSITION_FOLLOWING: jobSection comes after dateRow in the DOM.
    expect(
      dateRow.compareDocumentPosition(jobSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('commits a tapped-in number edit through saveDocument', () => {
    renderCard();
    expandCard();
    fireEvent.click(screen.getByLabelText('Edit quote number'));
    const input = screen.getByPlaceholderText('e.g. Q-001');
    fireEvent.change(input, { target: { value: 'QU-900001' } });
    fireEvent.blur(input);
    expect(store.saveDocument).toHaveBeenCalledTimes(1);
    expect(store.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1', number: 'QU-900001' }),
    );
  });

  it('does not save when the number is unchanged or blank', () => {
    renderCard();
    expandCard();

    fireEvent.click(screen.getByLabelText('Edit quote number'));
    fireEvent.blur(screen.getByPlaceholderText('e.g. Q-001'));

    fireEvent.click(screen.getByLabelText('Edit quote number'));
    const input = screen.getByPlaceholderText('e.g. Q-001');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(store.saveDocument).not.toHaveBeenCalled();
  });
});
