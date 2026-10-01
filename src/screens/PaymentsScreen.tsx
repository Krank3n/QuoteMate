/**
 * Payments — the invoice's payment history as a sheet-screen route, so any
 * surface can open it with navigate('Payments', { docId }). Same pattern as
 * RecordPaymentScreen: a `transparentModal` route rendering the shared
 * BottomSheet, with goBack() fired only once the close animation finishes.
 *
 * It exists so the Jobs list, the dashboard and the customer screen can open
 * the history the job screen shows — a part-paid invoice's chip lands here,
 * where each payment can be corrected, instead of on a blank form.
 *
 * Reads the document live from the store, so a payment edited or removed on
 * the Record Payment sheet is reflected if the tradie comes back here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { PaymentSheet } from '../components/PaymentSheet';

export function PaymentsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const docId: string | undefined = route.params?.docId;
  const doc = useStore((s) =>
    s.documents.find((d) => d.id === docId || d.legacyInvoiceId === docId),
  );

  const [visible, setVisible] = useState(true);
  // What to do once the sheet has slid away: nothing (plain dismiss → back),
  // or swap this route for Record Payment. Replacing rather than pushing
  // keeps the stack one sheet deep, so Record Payment's own goBack() returns
  // to the screen underneath.
  const nextRef = useRef<(() => void) | null>(null);
  const closingRef = useRef(false);

  const closeThen = useCallback((next?: () => void) => {
    nextRef.current = next ?? null;
    setVisible(false);
  }, []);

  const handleClosed = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // A hardware back that already popped this screen leaves us unfocused —
    // acting again would pop (or replace) the screen underneath.
    if (!navigation.isFocused()) return;
    if (nextRef.current) nextRef.current();
    else navigation.goBack();
  }, [navigation]);

  // The doc can vanish (deleted elsewhere) or never resolve (stale link).
  // Nothing to show — leave quietly.
  useEffect(() => {
    if (!doc && navigation.isFocused()) navigation.goBack();
  }, [doc, navigation]);

  if (!doc) return null;

  return (
    <PaymentSheet
      visible={visible}
      doc={doc}
      onDismiss={() => closeThen()}
      onClosed={handleClosed}
      onRecordPayment={(d) =>
        closeThen(() => navigation.replace('RecordPayment', { invoiceId: d.id }))
      }
      onEditPayment={(d, payment) =>
        closeThen(() =>
          navigation.replace('RecordPayment', { invoiceId: d.id, paymentId: payment.id }),
        )
      }
    />
  );
}
