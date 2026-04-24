/**
 * LegacyDocRedirect — one-way bridge from the old ViewQuote/ViewInvoice
 * routes to ViewJob.
 *
 * When a tradie opens an old bookmark, an email deep-link, or a
 * pre-refactor notification, the route still lands on ViewQuote/
 * ViewInvoice. Rather than keep those screens around, this component:
 *
 *   1. Looks up the doc by id (supports both unified Document.id and
 *      legacy quote/invoice ids via legacyQuoteId/legacyInvoiceId).
 *   2. Ensures a Job exists for it (ensureJobForDocument creates one
 *      from the doc's customer/address/job name if the doc predates
 *      Phase 8 and has no jobId).
 *   3. Replaces the current screen with ViewJob({ jobId }).
 *
 * Keeps existing links working without pulling ViewQuoteScreen /
 * ViewInvoiceScreen into the tree.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';

import { colors } from '../theme';
import { useStore } from '../store/useStore';
import { useJobStore, ensureJobForDocument } from '../store/useJobStore';

export function LegacyDocRedirect() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const docIdFromRoute: string | undefined =
    route.params?.quoteId ?? route.params?.invoiceId ?? route.params?.docId;

  const documents = useStore((s) => s.documents);
  const jobs = useJobStore((s) => s.jobs);
  const [error, setError] = useState<string | null>(null);
  // Guard against double-fire in strict-mode dev or navigation
  // re-mounts — we only want one ensure+navigate pass per mount.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!docIdFromRoute) {
      setError("Couldn't find that record — it may have been deleted.");
      return;
    }

    // The doc may have arrived by unified id OR legacy id depending on
    // what navigated here. Accept both.
    const doc =
      documents.find((d) => d.id === docIdFromRoute) ??
      documents.find(
        (d) => d.legacyQuoteId === docIdFromRoute || d.legacyInvoiceId === docIdFromRoute,
      );
    if (!doc) {
      // Documents may still be loading on cold start. Bail and try
      // again on the next render (useEffect re-runs when documents
      // changes).
      return;
    }

    ranRef.current = true;

    // Fast path: doc already has a job that we know about.
    if (doc.jobId) {
      const existing = jobs.find((j) => j.id === doc.jobId);
      if (existing) {
        navigation.replace('ViewJob', { jobId: doc.jobId });
        return;
      }
    }

    // Slow path: ensure a job for the doc, then navigate. This
    // auto-creates a Job for pre–Phase-8 legacy docs on first view.
    (async () => {
      try {
        const updatedDoc = await ensureJobForDocument(doc);
        if (!updatedDoc.jobId) {
          throw new Error('ensureJobForDocument returned no jobId');
        }
        navigation.replace('ViewJob', { jobId: updatedDoc.jobId });
      } catch (e) {
        ranRef.current = false;
        setError("Couldn't open that record. Try again from the Jobs tab.");
      }
    })();
  }, [docIdFromRoute, documents, jobs, navigation]);

  useEffect(() => {
    if (error) {
      Alert.alert('Not available', error, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  }, [error, navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.label}>Opening job…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.background,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
