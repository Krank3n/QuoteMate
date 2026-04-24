/**
 * JobScopeCard — inline scope editor on ViewJob.
 *
 * Replaces the compact "Documents" row that used to sit on ViewJob.
 * Surfaces the primary doc's guts (description, materials, labor,
 * markup) as tappable subsections — each jumps straight to the right
 * wizard step. The Job screen becomes the single place to *both*
 * understand the job AND edit its scope.
 *
 * No viewing/editing split. Tap a subsection = edit it. Tap the doc
 * number header = show a stage / payment chip row that opens the
 * existing sheets.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { STAGE_META } from './StageSheet';
import { PaymentChip } from './PaymentChip';
import { selectionTap } from '../utils/haptics';

export type ScopeStep = 'job' | 'materials' | 'labor';

interface JobScopeCardProps {
  doc: Document;
  onEdit: (doc: Document, step: ScopeStep) => void;
  onStagePress?: (doc: Document) => void;
  onPaymentPress?: (doc: Document) => void;
}

function countLineItems(doc: Document): number {
  return Array.isArray(doc.materials) ? doc.materials.length : 0;
}

function sumMaterials(doc: Document): number {
  // Prefer the snapshot total the wizard already computed; fall back to
  // summing pre-computed line totals from top-level materials (sections
  // are labour-only aggregators, they don't carry materials).
  if (typeof doc.materialsSubtotal === 'number' && doc.materialsSubtotal > 0) {
    return doc.materialsSubtotal;
  }
  return (doc.materials ?? []).reduce(
    (acc, m) => acc + (Number(m.totalPrice) || 0),
    0,
  );
}

function laborSummary(doc: Document): string {
  const hours = Number(doc.laborHours ?? 0);
  const rate = Number(doc.laborRate ?? 0);
  const unit = doc.laborUnit === 'days' ? 'd' : 'h';
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}${unit}`);
  if (rate > 0) parts.push(`$${rate}/${unit}`);
  if (doc.markup && doc.markup > 0) parts.push(`${doc.markup}% markup`);
  return parts.join(' · ') || 'Not set';
}

export function JobScopeCard({
  doc,
  onEdit,
  onStagePress,
  onPaymentPress,
}: JobScopeCardProps) {
  const meta = STAGE_META[doc.stage];
  const isInvoice = doc.type === 'invoice';
  const lineCount = countLineItems(doc);
  const materialsTotal = sumMaterials(doc);
  const laborTotal = Number(doc.laborTotal ?? 0);
  const total = Number(doc.total ?? 0);
  const description = doc.job?.description?.trim() ?? '';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons
            name={(isInvoice ? 'receipt' : 'file-document-outline') as any}
            size={18}
            color={colors.primary}
          />
          <Text style={styles.docNumber} numberOfLines={1}>
            {doc.number || (isInvoice ? 'Invoice' : 'Quote')}
          </Text>
        </View>
        <View style={styles.headerChips}>
          {onStagePress ? (
            <Pressable
              onPress={() => {
                selectionTap();
                onStagePress(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.stageChip,
                { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons name={meta.icon as any} size={12} color={meta.color} />
              <Text style={[styles.stageLabel, { color: meta.color }]}>
                {meta.chipLabel}
              </Text>
            </Pressable>
          ) : null}
          <PaymentChip doc={doc} onPress={onPaymentPress} />
        </View>
      </View>

      <ScopeRow
        icon="text-long"
        label="Job description"
        body={description || 'Tap to add a description for the customer'}
        muted={!description}
        onPress={() => onEdit(doc, 'job')}
      />

      <ScopeRow
        icon="package-variant"
        label="Materials"
        body={
          lineCount > 0
            ? `${lineCount} ${lineCount === 1 ? 'item' : 'items'} · ${formatCurrency(materialsTotal)}`
            : 'Tap to add materials'
        }
        muted={lineCount === 0}
        onPress={() => onEdit(doc, 'materials')}
      />

      <ScopeRow
        icon="hammer-wrench"
        label="Labour & markup"
        body={laborSummary(doc)}
        muted={(doc.laborHours ?? 0) === 0}
        rightLabel={laborTotal > 0 ? formatCurrency(laborTotal) : undefined}
        onPress={() => onEdit(doc, 'labor')}
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
      </View>
    </View>
  );
}

function ScopeRow({
  icon,
  label,
  body,
  rightLabel,
  muted,
  onPress,
}: {
  icon: string;
  label: string;
  body: string;
  rightLabel?: string;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        selectionTap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons
          name={icon as any}
          size={18}
          color={colors.primary}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text
          style={[styles.rowBodyText, muted && styles.rowBodyMuted]}
          numberOfLines={2}
        >
          {body}
        </Text>
      </View>
      {rightLabel ? (
        <Text style={styles.rowRight}>{rightLabel}</Text>
      ) : null}
      <MaterialCommunityIcons
        name={'chevron-right' as any}
        size={18}
        color={colors.inactive}
      />
    </Pressable>
  );
}

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
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  docNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  headerChips: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  stageLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
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
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowBodyText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  rowBodyMuted: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  rowRight: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
});
