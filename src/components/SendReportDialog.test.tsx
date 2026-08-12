// @vitest-environment jsdom
/**
 * The report send flow. Reports had no send at all — the deployed endpoint
 * that emails the PDF was never called from the app — so these pin the parts
 * that make it a send rather than a print: a written covering note, a
 * prefilled recipient, and an actual call to the endpoint.
 *
 * Heavy native/expo graphs are mocked, same approach as
 * SendDocumentDialog.test.tsx.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('react-native', () => ({
  View: 'div',
  StyleSheet: { create: (s: any) => s, absoluteFill: {} },
  ScrollView: 'div',
  Platform: { OS: 'web', select: (o: any) => o.web ?? o.default },
}));

vi.mock('react-native-paper', () => ({
  Portal: ({ children }: any) => <>{children}</>,
  Modal: ({ visible, children }: any) => (visible ? <div data-testid="modal">{children}</div> : null),
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ value, onChangeText, label, placeholder }: any) => (
    <input
      aria-label={label || placeholder}
      value={value}
      onChange={(e) => onChangeText?.(e.target.value)}
    />
  ),
  Button: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Switch: ({ value, onValueChange }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!value}
      onChange={(e) => onValueChange?.(e.target.checked)}
    />
  ),
}));

vi.mock('./ActionSheet', () => ({
  ActionSheet: ({ visible, options }: any) =>
    visible ? (
      <div>
        {options.map((o: any) => (
          <button key={o.label} onClick={o.onPress}>
            {o.label}
          </button>
        ))}
      </div>
    ) : null,
}));

vi.mock('../theme', async () => await import('../test/stubs/theme'));
vi.mock('../services/analyticsService', () => ({ trackEvent: vi.fn() }));

const sender = vi.hoisted(() => ({ sendServiceReportEmail: vi.fn(async () => {}) }));
vi.mock('../services/serviceReportSender', () => sender);

const llm = vi.hoisted(() => ({
  generateReportEmail: vi.fn(async () => 'Written summary of the visit.'),
  getDefaultReportEmailBody: vi.fn(() => 'Fallback body.'),
}));
vi.mock('../services/llmService', () => llm);

import { SendReportDialog } from './SendReportDialog';

const baseProps = {
  visible: true,
  onDismiss: vi.fn(),
  reportId: 'report-1',
  reportNumber: 'RP-007',
  customerName: 'Nathan Gorry',
  customerEmail: 'nathan@example.com',
  businessName: 'Coastal HVAC',
  serviceType: 'Preventative Maintenance',
  workCarriedOut: 'Cleaned filters, checked gas levels.',
  ownerEmail: 'tradie@coastalhvac.com.au',
  onShare: vi.fn(),
};

async function openCompose() {
  render(<SendReportDialog {...baseProps} />);
  fireEvent.click(screen.getByText('Email to customer'));
  await waitFor(() => expect(screen.getByTestId('modal')).toBeTruthy());
}

describe('SendReportDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers email first, then share', () => {
    render(<SendReportDialog {...baseProps} />);
    expect(screen.getByText('Email to customer')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
  });

  it('renders the compose step without crashing', async () => {
    await openCompose();
    expect(screen.getByText('Email report')).toBeTruthy();
  });

  it('prefills the customer address off the job', async () => {
    await openCompose();
    expect(screen.getByDisplayValue('nathan@example.com')).toBeTruthy();
  });

  it('writes the covering note from the visit', async () => {
    await openCompose();
    await waitFor(() => expect(screen.getByDisplayValue('Written summary of the visit.')).toBeTruthy());
    expect(llm.generateReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ serviceType: 'Preventative Maintenance' }),
    );
  });

  it('falls back to the plain template when writing fails', async () => {
    llm.generateReportEmail.mockRejectedValueOnce(new Error('offline'));
    await openCompose();
    await waitFor(() => expect(screen.getByDisplayValue('Fallback body.')).toBeTruthy());
  });

  it('sends via the endpoint and confirms', async () => {
    await openCompose();
    await waitFor(() => expect(screen.getByDisplayValue('Written summary of the visit.')).toBeTruthy());
    fireEvent.click(screen.getByText('Send report'));
    await waitFor(() =>
      expect(sender.sendServiceReportEmail).toHaveBeenCalledWith(
        expect.objectContaining({ reportId: 'report-1', recipientEmail: 'nathan@example.com' }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Report sent')).toBeTruthy());
  });

  it('offers an email-me-a-copy toggle, off by default', async () => {
    await openCompose();
    const toggle = screen.getByRole('switch') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await waitFor(() => expect(screen.getByDisplayValue('Written summary of the visit.')).toBeTruthy());
    fireEvent.click(screen.getByText('Send report'));
    await waitFor(() =>
      expect(sender.sendServiceReportEmail).toHaveBeenCalledWith(
        expect.objectContaining({ sendCopyToSelf: false }),
      ),
    );
  });

  it('bccs the tradie when the copy toggle is on', async () => {
    await openCompose();
    await waitFor(() => expect(screen.getByDisplayValue('Written summary of the visit.')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByText('Send report'));
    await waitFor(() =>
      expect(sender.sendServiceReportEmail).toHaveBeenCalledWith(
        expect.objectContaining({ sendCopyToSelf: true }),
      ),
    );
  });

  it('hides the copy toggle when there is no address to copy to', async () => {
    render(<SendReportDialog {...baseProps} ownerEmail={undefined} />);
    fireEvent.click(screen.getByText('Email to customer'));
    await waitFor(() => expect(screen.getByTestId('modal')).toBeTruthy());
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('refuses an invalid address without calling the endpoint', async () => {
    render(<SendReportDialog {...baseProps} customerEmail="not-an-email" />);
    fireEvent.click(screen.getByText('Email to customer'));
    await waitFor(() => expect(screen.getByTestId('modal')).toBeTruthy());
    fireEvent.click(screen.getByText('Send report'));
    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeTruthy());
    expect(sender.sendServiceReportEmail).not.toHaveBeenCalled();
  });
});
