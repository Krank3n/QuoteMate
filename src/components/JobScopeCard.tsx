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
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text, ActivityIndicator, Menu } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDistanceToNowStrict } from 'date-fns';

import type { Document } from '../types/document';
import type { Invoice, PaymentTerms } from '../types';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { hoursForDisplay, rateForDisplay, valueToHours, rateToHourly } from '../../shared/document/labourUnits';
import { calculateDueDate, formatPaymentTerms } from '../utils/invoiceCalculator';
import { stageMetaFor } from './StageSheet';
import { PaymentChip, shouldShowPaymentChip } from './PaymentChip';
import { selectionTap } from '../utils/haptics';
import { previewDocumentPDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { useAlertModal } from '../hooks/useAlertModal';
import {
  InvoiceDisplaySettings,
  type InvoiceDisplaySettingsChange,
} from './InvoiceDisplaySettings';
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
  // Stored labour is canonical hours; days is a presentation choice.
  const displayUnit = doc.labourDisplayUnit === 'days' ? 'days' : 'hours';
  const hours = Math.round(hoursForDisplay(valueToHours(doc.laborHours ?? 0, doc.laborUnit), displayUnit) * 100) / 100;
  const rate = Math.round(rateForDisplay(rateToHourly(doc.laborRate ?? 0, doc.laborUnit), displayUnit) * 100) / 100;
  const unit = displayUnit === 'days' ? 'd' : 'h';
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}${unit}`);
  if (rate > 0) parts.push(`$${rate}/${unit}`);
  if (doc.markup && doc.markup > 0) parts.push(`${doc.markup}% markup`);
  return parts.join(' · ') || 'Not set';
}

/**
 * The doc stage chip earns its spot on QUOTES and the terminal paid state.
 * For quotes, the chip's stage sheet is this card's only door to
 * "Convert to Invoice" — hiding it (the old `stage === 'paid'` gate)
 * orphaned conversion until the job reached in_progress. Invoice
 * lifecycle in between stays hidden: payment state lives in PaymentChip
 * and the job timeline above tells the rest.
 */
export function shouldShowStageChip(doc: Pick<Document, 'type' | 'stage'>): boolean {
  return doc.type === 'quote' || doc.stage === 'paid';
}

export function JobScopeCard({
  doc,
  onEdit,
  onStagePress,
  onPaymentPress,
}: JobScopeCardProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const meta = stageMetaFor(themeColors)[doc.stage];
  const showStageChip = shouldShowStageChip(doc);
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
  // Display/deposit toggles persist back through the legacy quote/invoice
  // collections. Look the underlying record up by id and dispatch through
  // saveQuote/saveInvoice so the mirror + Firestore stay in sync. Selector
  // returns the matching record so the card re-renders when it changes.
  const persistedRecord = useStore((s) => {
    if (isInvoice) return s.invoices.find((i) => i.id === doc.id) || null;
    return s.quotes.find((q) => q.id === doc.id) || null;
  });
  const saveQuote = useStore((s) => s.saveQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);

  const [expanded, setExpanded] = useState(false);
  // Display & deposit has its own expand state so tapping its chevron
  // doesn't drag the Materials/Labour sections open with it. The parent
  // chevron still controls everything (see handleToggle).
  const [displayExpanded, setDisplayExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const { showAlert, alertNode } = useAlertModal();

  const handleDisplaySettingsChange = React.useCallback(
    (partial: InvoiceDisplaySettingsChange) => {
      if (!persistedRecord) return;
      const next = { ...persistedRecord, ...partial, updatedAt: new Date() } as any;
      if (isInvoice) {
        saveInvoice(next).catch(() => {});
      } else {
        saveQuote(next).catch(() => {});
      }
    },
    [persistedRecord, isInvoice, saveInvoice, saveQuote],
  );

  const handleToggle = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !expanded;
    setExpanded(next);
    // Parent chevron is "expand/collapse all" — sync the child sections
    // so the card reads as a single unit when fully open or fully closed.
    setDisplayExpanded(next);
  };

  const handleDisplayToggle = () => {
    selectionTap();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDisplayExpanded((v) => !v);
  };

  const handlePreview = async () => {
    selectionTap();
    setPreviewing(true);
    try {
      await previewDocumentPDF(doc, businessSettings, { isPro });
    } catch (err) {
      console.error('[PDF preview] failed:', err);
      showAlert({
        type: 'error',
        title: 'Preview failed',
        message: "Couldn't open the PDF. Try again in a moment.",
      });
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
              color={themeColors.accentText}
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
          {shouldShowPaymentChip(doc) ? (
            <PaymentChip doc={doc} onPress={onPaymentPress} />
          ) : null}
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
              color={themeColors.textMuted}
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

      {isInvoice && persistedRecord ? (
        <PaymentTermsRow
          invoice={persistedRecord as Invoice}
          onChange={(next) => {
            saveInvoice(next).catch(() => {});
          }}
        />
      ) : null}

      {persistedRecord ? (
        <View style={styles.settingsBlock}>
          <InvoiceDisplaySettings
            mode={isInvoice ? 'invoice' : 'quote'}
            total={Number(doc.total ?? 0)}
            showMarkup={
              doc.showMarkup !== undefined
                ? doc.showMarkup === true
                : businessSettings?.showMarkup === true
            }
            showMaterialCosts={
              doc.showMaterialCosts !== undefined
                ? doc.showMaterialCosts
                : businessSettings?.showMaterialCostsByDefault !== false
            }
            showLaborCosts={
              doc.showLaborCosts !== undefined
                ? doc.showLaborCosts
                : businessSettings?.showLaborCostsByDefault !== false
            }
            requireDeposit={doc.requireDeposit === true}
            depositPercentage={Number(doc.depositPercentage ?? 0)}
            onChange={handleDisplaySettingsChange}
            variant="collapsible"
            expanded={displayExpanded}
            onToggleExpand={handleDisplayToggle}
          />
        </View>
      ) : null}

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
          <ActivityIndicator size="small" color={themeColors.accentText} />
        ) : (
          <MaterialCommunityIcons
            name={'file-eye-outline' as any}
            size={16}
            color={themeColors.accentText}
          />
        )}
        <Text style={styles.actionLabel}>Preview PDF</Text>
      </Pressable>

      {alertNode}
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  const businessSettings = useStore((s) => s.businessSettings);
  const showMarkupRow = doc.showMarkup === true;
  const laborMarkupPercent = doc.laborMarkup ?? doc.markup ?? 0;
  const travelAdjustmentPercent = doc.travelAdjustment ?? 0;
  const travelAdjustmentAmount =
    Number(doc.subtotal ?? 0) * (travelAdjustmentPercent / 100);

  // Match the collapsed scope rows so the card looks the same on
  // expand/collapse — same surface, same icon palette, same row bg.
  const sectionOverride = { backgroundColor: themeColors.surfacePressed };

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
        labourDisplayUnit={doc.labourDisplayUnit}
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
        pricesIncludeGst={(doc as any).pricesIncludeGst === true}
        gstRegistered={(doc as any).gstRegistered}
        style={sectionOverride}
      />
    </View>
  );
}

function PaymentTermsRow({
  invoice,
  onChange,
}: {
  invoice: Invoice;
  onChange: (next: Invoice) => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [menuVisible, setMenuVisible] = useState(false);
  const currentTerms: PaymentTerms = invoice.paymentTerms || 'net_14';
  const customDays = invoice.customPaymentDays;
  const issueDate = invoice.issueDate
    ? new Date(invoice.issueDate)
    : new Date();
  const dueDate = invoice.dueDate
    ? new Date(invoice.dueDate)
    : calculateDueDate(issueDate, currentTerms, customDays);

  const applyTerms = (terms: PaymentTerms) => {
    setMenuVisible(false);
    const days = terms === 'custom' ? customDays ?? 7 : undefined;
    const newDueDate = calculateDueDate(issueDate, terms, days);
    onChange({
      ...invoice,
      paymentTerms: terms,
      customPaymentDays: days,
      dueDate: newDueDate,
      updatedAt: new Date(),
    });
  };

  const dueDateText = dueDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Paper Menu anchors don't recover cleanly from a backdrop dismiss when
  // the anchor is a Pressable — the next press gets swallowed and the
  // menu won't re-open. TouchableOpacity sidesteps that.
  return (
    <Menu
      visible={menuVisible}
      onDismiss={() => setMenuVisible(false)}
      anchor={
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            selectionTap();
            setMenuVisible(true);
          }}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel="Edit payment terms"
        >
          <View style={styles.rowIcon}>
            <MaterialCommunityIcons
              name={'clock-outline' as any}
              size={18}
              color={themeColors.accentText}
            />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>Payment terms</Text>
            <Text style={styles.rowBodyText} numberOfLines={1}>
              {formatPaymentTerms(currentTerms, customDays)} · Due {dueDateText}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={'chevron-down' as any}
            size={18}
            color={themeColors.textDisabled}
          />
        </TouchableOpacity>
      }
    >
      <Menu.Item onPress={() => applyTerms('due_on_receipt')} title="Due on Receipt" />
      <Menu.Item onPress={() => applyTerms('net_7')} title="Net 7 (7 days)" />
      <Menu.Item onPress={() => applyTerms('net_14')} title="Net 14 (14 days)" />
      <Menu.Item onPress={() => applyTerms('net_30')} title="Net 30 (30 days)" />
    </Menu>
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
  const styles = useStyles();
  const themeColors = useThemeColors();
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
          color={themeColors.accentText}
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
        color={themeColors.textDisabled}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
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
    borderBottomColor: t.colors.border,
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
    backgroundColor: t.colors.accentSubtle,
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
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  docNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  expandButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  expandButtonPressed: {
    backgroundColor: t.colors.surfacePressed,
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
    backgroundColor: t.colors.surfacePressed,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.colors.accentSubtle,
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
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowBodyText: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },
  rowBodyMuted: {
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  rowRight: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.text,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: t.colors.accentSubtle,
    borderWidth: 1,
    borderColor: t.colors.accentSubtle,
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
    color: t.colors.accentText,
  },
  expanded: {
    marginTop: 4,
    gap: 0,
  },
  settingsBlock: {
    // Sits in the card's `gap: 8` flow — no extra margin needed so the
    // row spaces the same as Materials / Labour above it.
  },
}));
