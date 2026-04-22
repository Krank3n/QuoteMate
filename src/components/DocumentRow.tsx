/**
 * DocumentRow
 * Slimmer than DocumentCard — used inside ViewJobScreen to list attached
 * documents without the per-card swipe/menu/send buttons. Shows the doc
 * number, type, total, and the Phase-11 two-chip split (stage + payment).
 *
 * Tap row → view detail. Tap stage chip → StageSheet. Tap payment chip →
 * PaymentSheet.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { PaymentChip } from './PaymentChip';
import { STAGE_META } from './StageSheet';
import { selectionTap } from '../utils/haptics';

interface DocumentRowProps {
  doc: Document;
  onView: (doc: Document) => void;
  onStagePress?: (doc: Document) => void;
  onPaymentPress?: (doc: Document) => void;
}

function stageShortLabel(stage: Document['stage']): string {
  const meta = STAGE_META[stage];
  return meta ? meta.label.replace(/^Mark as /, '').replace(/^Convert to /, '') : stage;
}

export function DocumentRow({
  doc,
  onView,
  onStagePress,
  onPaymentPress,
}: DocumentRowProps) {
  const meta = STAGE_META[doc.stage];
  const label = stageShortLabel(doc.stage);

  return (
    <Pressable
      onPress={() => {
        selectionTap();
        onView(doc);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.iconCircle}>
        <MaterialCommunityIcons
          name={(doc.type === 'invoice' ? 'receipt' : 'file-document-outline') as any}
          size={18}
          color={colors.primary}
        />
      </View>

      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={styles.docNumber} numberOfLines={1}>
            {doc.number || (doc.type === 'invoice' ? 'Invoice' : 'Quote')}
          </Text>
          <Text style={styles.amount}>{formatCurrency(Number(doc.total) || 0)}</Text>
        </View>

        <View style={styles.chipRow}>
          {onStagePress ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                selectionTap();
                onStagePress(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <View
                style={[
                  styles.stageChip,
                  { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
                ]}
              >
                <MaterialCommunityIcons name={meta.icon as any} size={12} color={meta.color} />
                <Text style={[styles.stageLabel, { color: meta.color }]}>{label}</Text>
              </View>
            </Pressable>
          ) : (
            <View
              style={[
                styles.stageChip,
                { backgroundColor: meta.bgColor, borderColor: meta.color + '44' },
              ]}
            >
              <MaterialCommunityIcons name={meta.icon as any} size={12} color={meta.color} />
              <Text style={[styles.stageLabel, { color: meta.color }]}>{label}</Text>
            </View>
          )}

          <PaymentChip doc={doc} onPress={onPaymentPress} />
        </View>
      </View>

      <MaterialCommunityIcons
        name={'chevron-right' as any}
        size={20}
        color={colors.inactive}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  rowPressed: {
    backgroundColor: colors.surfaceGray3,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  docNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  stageLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
