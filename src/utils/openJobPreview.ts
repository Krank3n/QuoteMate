/**
 * Helper for jumping into the wizard's JobPreviewScreen on an existing
 * job (i.e. NOT at the end of a fresh quote/invoice flow).
 *
 * Triggered by tapping the green headline price on a JobCard or
 * JobDetailHeader. Seeds currentQuote / currentInvoice from the doc so
 * the screen has something to render, then navigates with `viewing:
 * true` so the screen suppresses its on-mount celebration + auto-save.
 */

import type { Document } from '../types/document';
import type { Quote, Invoice } from '../types';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';

interface OpenJobPreviewDeps {
  navigation: any;
  setCurrentQuote: (q: Quote | null) => void;
  setCurrentInvoice: (i: Invoice | null) => void;
}

export function openJobPreview(doc: Document, deps: OpenJobPreviewDeps): void {
  const { navigation, setCurrentQuote, setCurrentInvoice } = deps;
  if (doc.type === 'invoice') {
    setCurrentInvoice(documentToInvoice(doc));
    setCurrentQuote(null);
    navigation.navigate('NewInvoice', {
      screen: 'JobPreview',
      params: { mode: 'invoice', viewing: true },
    });
    return;
  }
  setCurrentQuote(documentToQuote(doc));
  setCurrentInvoice(null);
  navigation.navigate('NewJob', {
    screen: 'JobPreview',
    params: { mode: 'quote', viewing: true },
  });
}
