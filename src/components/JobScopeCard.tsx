/**
 * JobScopeCard — inline scope editor on ViewJob.
 *
 * Replaces the compact "Documents" row that used to sit on ViewJob.
 * Surfaces the primary doc's guts (description, materials, labor,
 * markup) as tappable subsections — each jumps straight to the right
 * wizard step. The Job screen becomes the single place to *both*
 * understand the job AND edit its scope.
 *
 * Collapsed (default): compact summary — description, materials
 * (count + subtotal), labour (hours / markup), total.
 * Expanded: full line-item list + labour box + totals + terms + dates
 * — same read-only detail the old ViewQuote/ViewInvoice screens used
 * to show before scope editing lived on the same page.
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
import { format, formatDistanceToNowStrict } from 'date-fns';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { STAGE_META } from './StageSheet';
import { PaymentChip } from './PaymentChip';
import { selectionTap } from '../utils/haptics';
import { previewDocumentPDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';

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
  const isInvoice = doc.type === 'invoice';
  const typeLabel = isInvoice ? 'Invoice' : 'Quote';
  const lineCount = countLineItems(doc);
  const materialsTotal = sumMaterials(doc);
  const laborTotal = Number(doc.laborTotal ?? 0);
  const total = Number(doc.total ?? 0);
  const description = doc.job?.description?.trim() ?? '';

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
          {onStagePress ? (
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

      {expanded ? <ExpandedBreakdown doc={doc} /> : null}

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

function ExpandedBreakdown({ doc }: { doc: Document }) {
  const materials = doc.materials ?? [];
  const sections = doc.sections ?? [];
  const subtotal = Number(doc.subtotal ?? 0);
  const gst = Number(doc.gst ?? 0);
  const markupAmount = Number(doc.markupAmount ?? 0);
  const terms = doc.termsSnapshot?.trim() ?? '';
  const isInvoice = doc.type === 'invoice';

  return (
    <View style={styles.expanded}>
      {materials.length > 0 ? (
        <View style={styles.expandedSection}>
          <Text style={styles.expandedSectionLabel}>Materials</Text>
          {materials.map((m) => (
            <View key={m.id} style={styles.lineItem}>
              <View style={styles.lineItemBody}>
                <Text style={styles.lineItemName} numberOfLines={2}>
                  {m.name || 'Unnamed item'}
                </Text>
                <Text style={styles.lineItemMeta}>
                  {m.quantity} {m.unit} · {formatCurrency(Number(m.price) || 0)}
                </Text>
              </View>
              <Text style={styles.lineItemTotal}>
                {formatCurrency(Number(m.totalPrice) || 0)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {sections.length > 0 ? (
        <View style={styles.expandedSection}>
          <Text style={styles.expandedSectionLabel}>Sections</Text>
          {sections.map((s) => (
            <View key={s.id} style={styles.lineItem}>
              <View style={styles.lineItemBody}>
                <Text style={styles.lineItemName}>{s.name}</Text>
                <Text style={styles.lineItemMeta}>
                  ×{s.multiplier} · {s.laborHours}
                  {s.laborUnit === 'days' ? 'd' : 'h'} @ ${s.laborRate}
                </Text>
              </View>
              <Text style={styles.lineItemTotal}>
                {formatCurrency(Number(s.laborTotal) || 0)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.totalsBox}>
        {markupAmount > 0 ? (
          <BreakdownRow label="Markup" value={formatCurrency(markupAmount)} />
        ) : null}
        <BreakdownRow label="Subtotal" value={formatCurrency(subtotal)} />
        {gst > 0 ? (
          <BreakdownRow label="GST" value={formatCurrency(gst)} />
        ) : null}
        <BreakdownRow
          label="Total"
          value={formatCurrency(Number(doc.total ?? 0))}
          bold
        />
      </View>

      {isInvoice && doc.dueDate ? (
        <View style={styles.datesRow}>
          {doc.issueDate ? (
            <View style={styles.dateBox}>
              <Text style={styles.dateLabel}>Issued</Text>
              <Text style={styles.dateValue}>
                {format(new Date(doc.issueDate), 'd MMM yyyy')}
              </Text>
            </View>
          ) : null}
          <View style={styles.dateBox}>
            <Text style={styles.dateLabel}>Due</Text>
            <Text style={styles.dateValue}>
              {format(new Date(doc.dueDate), 'd MMM yyyy')}
            </Text>
          </View>
        </View>
      ) : null}

      {terms ? (
        <View style={styles.termsBox}>
          <Text style={styles.expandedSectionLabel}>Terms</Text>
          <Text style={styles.termsText}>{terms}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, bold && styles.breakdownBold]}>
        {label}
      </Text>
      <Text style={[styles.breakdownValue, bold && styles.breakdownBold]}>
        {value}
      </Text>
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
    paddingBottom: 8,
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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  expandButtonPressed: {
    backgroundColor: colors.surfaceGray3,
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
    gap: 12,
    paddingHorizontal: 2,
  },
  expandedSection: {
    gap: 6,
  },
  expandedSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceGray3,
  },
  lineItemBody: {
    flex: 1,
    gap: 2,
  },
  lineItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  lineItemMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  lineItemTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    minWidth: 70,
    textAlign: 'right',
  },
  totalsBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    gap: 6,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  breakdownValue: {
    fontSize: 13,
    color: colors.text,
  },
  breakdownBold: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  datesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dateBox: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceGray3,
    gap: 2,
  },
  dateLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dateValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  termsBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceGray3,
    gap: 4,
  },
  termsText: {
    fontSize: 12,
    color: colors.onSurface,
    lineHeight: 18,
  },
});
