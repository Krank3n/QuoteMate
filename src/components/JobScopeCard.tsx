/**
 * JobScopeCard — inline scope editor on ViewJob.
 *
 * Replaces the compact "Documents" row that used to sit on ViewJob.
 * Surfaces the primary doc's guts (materials, labor,
 * markup) as tappable subsections — each jumps straight to the right
 * wizard step. The Job screen becomes the single place to *both*
 * understand the job AND edit its scope.
 *
 * Collapsed (default): compact summary — materials
 * (count + subtotal), labour (hours / markup).
 * Expanded: full quote-preview layout — Job, Materials, Pricing,
 * Totals — each section editable (matches the old quote preview).
 * Customer details remain editable from the customer header above.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDistanceToNowStrict } from 'date-fns';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { STAGE_META } from './StageSheet';
import { PaymentChip } from './PaymentChip';
import { selectionTap } from '../utils/haptics';
import { previewDocumentPDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import {
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
} from './document';

export type ScopeStep = 'job' | 'materials' | 'labor';

interface JobScopeCardProps {
  doc: Document;
  onEdit: (doc: Document, step: ScopeStep) => void;
  onStagePress?: (doc: Document) => void;
  onPaymentPress?: (doc: Document) => void;
}

// Android needs explicit opt-in for LayoutAnimation, otherwise the
// expand/collapse jumps with no transition.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function countLineItems(doc: Document): number {
  return Array.isArray(doc.materials) ? doc.materials.length : 0;
}

function sumMaterials(doc: Document): number {
  if (typeof doc.materialsSubtotal === 'number' && doc.materialsSubtotal > 0) {
    return doc.materialsSubtotal;
  }
  return (doc.materials ?? []).reduce(
    (acc, m) => acc + (Number(m.totalPrice) || 0),
    0,
  );
}

// Timestamp that best represents the current stage — drives the
// "· 3d ago" suffix on the stage chip, picked up from the top banner
// we retired (same logic, less visual noise).
function stageTimestamp(doc: Document): number | null {
  switch (doc.stage) {
    case 'quote_sent':
    case 'invoice_sent':
      return doc.sentAt ?? doc.updatedAt ?? null;
    case 'quote_accepted':
      return doc.acceptedAt ?? doc.updatedAt ?? null;
    case 'partially_paid':
      return doc.updatedAt ?? null;
    case 'paid':
      return doc.paidInFullAt ?? doc.updatedAt ?? null;
    default:
      return null;
  }
}

function stageAgoLabel(doc: Document): string | null {
  const ts = stageTimestamp(doc);
  if (!ts) return null;
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: false });
  } catch {
    return null;
  }
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
  // Doc stage chip is mostly redundant noise — payment state lives in
  // PaymentChip and the job-level timeline above tells the "where is
  // it" story. Keep the chip only for the terminal-paid state.
  const showStageChip = doc.stage === 'paid';
  const isInvoice = doc.type === 'invoice';
  const typeLabel = isInvoice ? 'Invoice' : 'Quote';
  const lineCount = countLineItems(doc);
  const materialsTotal = sumMaterials(doc);
  const laborTotal = Number(doc.laborTotal ?? 0);

  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const handleToggle = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  const handlePreview = async () => {
    selectionTap();
    setPreviewing(true);
    try {
      await previewDocumentPDF(doc, businessSettings, { isPro });
    } catch {
      Alert.alert(
        'Preview failed',
        "Couldn't open the PDF. Try again in a moment.",
      );
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.typeBadge}>
            <MaterialCommunityIcons
              name={(isInvoice ? 'receipt' : 'file-document-outline') as any}
              size={16}
              color={colors.primary}
            />
          </View>
          <View style={styles.headerTextBlock}>
            <Text style={styles.typeLabel}>{typeLabel}</Text>
            <Text style={styles.docNumber} numberOfLines={1}>
              {doc.number || 'Unnumbered'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {showStageChip && onStagePress ? (
            <Pressable
              onPress={() => {
                selectionTap();
                onStagePress(doc);
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.stageChip,
                {
                  backgroundColor: meta.bgColor,
                  borderColor: meta.color + '44',
                },
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={meta.icon as any}
                size={12}
                color={meta.color}
              />
              <Text style={[styles.stageLabel, { color: meta.color }]}>
                {meta.chipLabel}
                {stageAgoLabel(doc) ? ` · ${stageAgoLabel(doc)}` : ''}
              </Text>
            </Pressable>
          ) : null}
          <PaymentChip doc={doc} onPress={onPaymentPress} />
          <Pressable
            onPress={handleToggle}
            hitSlop={10}
            style={({ pressed }) => [
              styles.expandButton,
              pressed && styles.expandButtonPressed,
            ]}
            accessibilityLabel={expanded ? 'Hide details' : 'Show details'}
          >
            <MaterialCommunityIcons
              name={(expanded ? 'chevron-up' : 'chevron-down') as any}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        </View>
      </View>

      {expanded ? (
        <ExpandedSections doc={doc} onEdit={onEdit} />
      ) : (
        <>
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
        </>
      )}

      <Pressable
        onPress={handlePreview}
        disabled={previewing}
        style={({ pressed }) => [
          styles.previewButton,
          pressed && styles.actionButtonPressed,
          previewing && styles.actionButtonDisabled,
        ]}
      >
        {previewing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <MaterialCommunityIcons
            name={'file-eye-outline' as any}
            size={16}
            color={colors.primary}
          />
        )}
        <Text style={styles.actionLabel}>Preview PDF</Text>
      </Pressable>
    </View>
  );
}

function ExpandedSections({
  doc,
  onEdit,
}: {
  doc: Document;
  onEdit: (doc: Document, step: ScopeStep) => void;
}) {
  const businessSettings = useStore((s) => s.businessSettings);
  const showMarkupRow = doc.showMarkup === true;
  const laborMarkupPercent = doc.laborMarkup ?? doc.markup ?? 0;
  const travelAdjustmentPercent = doc.travelAdjustment ?? 0;
  const travelAdjustmentAmount =
    Number(doc.subtotal ?? 0) * (travelAdjustmentPercent / 100);

  // Match the collapsed scope rows so the card looks the same on
  // expand/collapse — same surface, same icon palette, same row bg.
  const sectionOverride = { backgroundColor: colors.surfaceGray3 };

  return (
    <View style={styles.expanded}>
      <JobSection
        job={doc.job}
        onEdit={() => onEdit(doc, 'job')}
        style={sectionOverride}
      />

      <MaterialsSection
        materials={doc.materials ?? []}
        materialsSubtotal={Number(doc.materialsSubtotal ?? 0)}
        onEdit={() => onEdit(doc, 'materials')}
        markupPercent={doc.markup ?? 0}
        rollMarkupIntoMaterials={!showMarkupRow && (doc.markup ?? 0) > 0}
        style={sectionOverride}
      />

      <LaborSection
        laborHours={Number(doc.laborHours ?? 0)}
        laborRate={Number(doc.laborRate ?? 0)}
        laborTotal={Number(doc.laborTotal ?? 0)}
        laborUnit={doc.laborUnit}
        sections={doc.sections}
        // Editor view — always surface hours × rate to the tradie even
        // when the customer-facing PDF setting hides them.
        showLaborHours
        onEdit={() => onEdit(doc, 'labor')}
        laborMarkupPercent={laborMarkupPercent}
        rollMarkupIntoLabor={!showMarkupRow && laborMarkupPercent > 0}
        alwaysShowMarkupNote
        laborExtraHours={doc.laborExtraHours ?? 0}
        style={sectionOverride}
      />

      <TotalsSection
        subtotal={Number(doc.subtotal ?? 0)}
        markup={Number(doc.markup ?? 0)}
        markupAmount={Number(doc.markupAmount ?? 0)}
        gst={Number(doc.gst ?? 0)}
        total={Number(doc.total ?? 0)}
        hideZeroMarkup
        hideMarkup={!showMarkupRow}
        travelAdjustmentAmount={travelAdjustmentAmount}
        travelAdjustmentPercent={travelAdjustmentPercent}
        style={sectionOverride}
      />
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
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
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
    gap: 10,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 12,
    minHeight: 56, // breathing room so the chip + kebab read at a
                   // standard touch-target size
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
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
  expandButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  expandButtonPressed: {
    backgroundColor: colors.surfaceGray3,
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    gap: 5,
  },
  stageLabel: {
    fontSize: 12,
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
  actionButtonPressed: {
    opacity: 0.8,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  expanded: {
    marginTop: 4,
    gap: 0,
  },
});
