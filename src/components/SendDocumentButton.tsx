/**
 * SendDocumentButton
 *
 * Renders a trigger Button + the shared SendDocumentDialog. Kept as a
 * thin wrapper so existing callers (ViewQuoteScreen, ViewInvoiceScreen,
 * QuotePreviewScreen) keep working unchanged, while new surfaces
 * (StickyJobActionBar) drive the dialog directly.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';

import { Quote, BusinessSettings } from '../types';
import { Document, SendMethod } from '../types/document';
import { documentToQuote } from '../types/documentAdapter';
import { SendDocumentDialog } from './SendDocumentDialog';

interface SendDocumentButtonProps {
  doc: Document;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
  /**
   * Forwarded straight to the dialog: fires when a silent SMS / Share /
   * Export send moves the doc out of draft. Hosts use it for the "Marked as
   * sent" Undo — without it those channels flip the stage with nothing on
   * screen to say so, or to take it back.
   */
  onMarkedSent?: (doc: Document, method: SendMethod) => void;
}

export function SendDocumentButton({
  doc,
  businessSettings,
  buttonMode = 'contained',
  buttonLabel,
  buttonIcon = 'send',
  buttonStyle,
  onMarkedSent,
}: SendDocumentButtonProps) {
  const isInvoice = doc.type === 'invoice';
  const quote: Quote = useMemo(() => documentToQuote(doc), [doc]);
  const [dialogVisible, setDialogVisible] = useState(false);

  const resolvedLabel =
    buttonLabel ??
    (isInvoice ? 'Send Invoice' : quote.status === 'sent' ? 'Resend' : 'Send');

  // Same content padding for both types — JobPreviewScreen pairs this
  // button with a Back button using the same paddingVertical, so the two
  // need to render at the same height. The old quote-side `height: 48`
  // was leftover from a screen that no longer uses this component.
  const buttonContentStyle = styles.buttonContent;

  return (
    <>
      <Button
        mode={buttonMode}
        onPress={() => setDialogVisible(true)}
        style={buttonStyle}
        icon={buttonIcon}
        contentStyle={buttonContentStyle}
        labelStyle={styles.buttonLabel}
      >
        {resolvedLabel}
      </Button>

      <SendDocumentDialog
        visible={dialogVisible}
        onDismiss={() => setDialogVisible(false)}
        doc={doc}
        businessSettings={businessSettings}
        onMarkedSent={onMarkedSent}
      />
    </>
  );
}

const styles = StyleSheet.create({
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
