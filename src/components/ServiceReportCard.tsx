/**
 * A saved service report on the job screen, in the same card the quote sits
 * in.
 *
 * Reports used to render as a bare row under a label while the quote beside
 * them had a card, a header and a Preview PDF button. Same job, same screen,
 * two different visual languages — and no way to see what a report actually
 * says without opening the editor. This gives a report the treatment the
 * quote already had: card, header, and a preview.
 *
 * Card metrics are copied from JobScopeCard deliberately rather than
 * approximated, so the two sit flush.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { ServiceReportRow } from './ServiceReportRow';
import type { ReportRowMeta } from '../screens/ServiceReport/reportDraft';
import { colors } from '../theme';
import { previewReportPDF } from '../utils/pdfGenerator';
import { selectionTap } from '../utils/haptics';
import type { BusinessSettings } from '../types';
import type { ServiceReport } from '../../shared/report/types';

export interface ServiceReportCardProps {
  report: ServiceReport;
  meta: ReportRowMeta;
  businessSettings: BusinessSettings | null;
  isPro?: boolean;
  /** For the PDF filename — the row meta is about the visit, not the client. */
  customerName?: string;
  onOpen: () => void;
  onPreviewError?: (message: string) => void;
}

export function ServiceReportCard({
  report,
  meta,
  businessSettings,
  isPro,
  customerName,
  onOpen,
  onPreviewError,
}: ServiceReportCardProps) {
  const [previewing, setPreviewing] = useState(false);

  const handlePreview = async () => {
    selectionTap();
    setPreviewing(true);
    try {
      await previewReportPDF(report, businessSettings, {
        isPro,
        customerName,
      });
    } catch (err: any) {
      onPreviewError?.(err?.message || "Couldn't open the PDF. Try again in a moment.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <View style={styles.card}>
      <ServiceReportRow meta={meta} onPress={onOpen} variant="nested" />

      <Pressable
        onPress={handlePreview}
        disabled={previewing}
        style={({ pressed }) => [
          styles.previewButton,
          pressed && styles.previewButtonPressed,
          previewing && styles.previewButtonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Preview report PDF"
      >
        {previewing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <MaterialCommunityIcons name={'file-eye-outline' as any} size={16} color={colors.primary} />
        )}
        <Text style={styles.previewLabel}>Preview PDF</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Mirrors JobScopeCard.card so a report and a quote line up on the screen.
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 8,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary + '33',
    marginTop: 4,
  },
  previewButtonPressed: {
    opacity: 0.7,
  },
  previewButtonDisabled: {
    opacity: 0.6,
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
});
