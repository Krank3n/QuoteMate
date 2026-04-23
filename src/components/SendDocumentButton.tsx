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
import { Document } from '../types/document';
import { documentToQuote } from '../types/documentAdapter';
import { SendDocumentDialog } from './SendDocumentDialog';

interface SendDocumentButtonProps {
  doc: Document;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
}

export function SendDocumentButton({
  doc,
  businessSettings,
  buttonMode = 'contained',
  buttonLabel,
  buttonIcon = 'send',
  buttonStyle,
}: SendDocumentButtonProps) {
  const isInvoice = doc.type === 'invoice';
  const quote: Quote = useMemo(() => documentToQuote(doc), [doc]);
  const [dialogVisible, setDialogVisible] = useState(false);

  const resolvedLabel =
    buttonLabel ??
    (isInvoice ? 'Send Invoice' : quote.status === 'sent' ? 'Resend' : 'Send');

  const buttonContentStyle = isInvoice
    ? styles.buttonContentInvoice
    : styles.buttonContent;

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
      />
    </>
  );
}

const styles = StyleSheet.create({
  buttonContent: {
    height: 48,
  },
  buttonContentInvoice: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
