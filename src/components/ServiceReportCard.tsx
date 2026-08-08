/**
 * A saved service report on the job screen, in the same card the quote sits in.
 *
 * Reports used to render as a bare row under a section label while the quote
 * beside them had a card, a header and a Preview PDF button. Same job, same
 * screen, two visual languages — and no way to see what a report actually says
 * without opening the editor, even though quotes have had previewDocumentPDF
 * all along.
 *
 * Structure mirrors JobScopeCard rather than approximating it, so the two sit
 * flush: card → header (badge, label, number, status chip) → a separated
 * minimised row that opens the report → Preview PDF.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { statusChipColors } from './ServiceReportRow';
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
  const status = statusChipColors(meta.status);

  const handlePreview = async () => {
    selectionTap();
    setPreviewing(true);
    try {
      await previewReportPDF(report, businessSettings, { isPro, customerName });
    } catch (err: any) {
      onPreviewError?.(err?.message || "Couldn't open the PDF. Try again in a moment.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <View style={styles.card}>
      {/* Reads the same way the quote's header does: what it is, then which one. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.typeBadge}>
            <MaterialCommunityIcons
              name={'clipboard-check-outline' as any}
              size={16}
              color={colors.primary}
            />
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.typeLabel}>Service report</Text>
            <Text style={styles.docNumber} numberOfLines={1}>
              {meta.number || 'Unnumbered'}
            </Text>
          </View>
        </View>
        <View
          style={[styles.chip, { backgroundColor: status.bg, borderColor: status.color + '44' }]}
        >
          <MaterialCommunityIcons name={status.icon as any} size={12} color={status.color} />
          <Text style={[styles.chipLabel, { color: status.color }]}>{meta.statusLabel}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => {
          selectionTap();
          onOpen();
        }}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${meta.title}, ${meta.statusLabel}`}
      >
        <View style={styles.rowIcon}>
          <MaterialCommunityIcons
            name={'text-box-outline' as any}
            size={16}
            color={colors.primary}
          />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {meta.title}
          </Text>
          {(meta.visitLabel || meta.detail) && (
            <Text style={styles.rowDetail} numberOfLines={1}>
              {[meta.visitLabel, meta.detail].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
      </Pressable>

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

// Metrics copied from JobScopeCard so a report and a quote line up exactly.
const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 12,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  typeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: {
    flex: 1,
    gap: 1,
  },
  typeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  docNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  rowDetail: {
    fontSize: 12,
    color: colors.textMuted,
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
