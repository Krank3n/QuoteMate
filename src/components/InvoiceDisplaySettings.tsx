/**
 * InvoiceDisplaySettings — controlled card section for the three
 * "Show X on invoice/quote" toggles plus the deposit configuration.
 *
 * Lives on JobPreviewScreen (the wizard header card) and on JobScopeCard
 * (ViewJob inline editor), so tradies can flip these without diving into
 * the labour & markup screen.
 *
 * Stateless / controlled: parent owns the underlying Quote/Invoice and
 * persists via `onChange`. The component only manages the Square
 * connection check + the local text input for the deposit %.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Switch, TouchableOpacity, Pressable } from 'react-native';
import { Text, TextInput, Surface, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { colors } from '../theme';
import { checkSquareConnection } from '../services/squareService';
import { formatCurrency } from '../utils/quoteCalculator';

export interface InvoiceDisplaySettingsChange {
  showMarkup?: boolean;
  showMaterialCosts?: boolean;
  showLaborCosts?: boolean;
  requireDeposit?: boolean;
  depositPercentage?: number;
  depositAmount?: number;
  presentationMode?: 'itemised' | 'flatRate';
  flatRateInclusions?: string[];
  flatRateLineLabel?: string;
  // Sales pitch — fed through the same change channel from QuotePitchPicker
  // so JobPreviewScreen only has to wire one persistence path.
  pitchId?: string;
  pitchVariableValues?: Record<string, string>;
}

interface InvoiceDisplaySettingsProps {
  mode: 'quote' | 'invoice';
  total: number;
  showMarkup: boolean;
  showMaterialCosts: boolean;
  showLaborCosts: boolean;
  requireDeposit: boolean;
  depositPercentage: number;
  /** Customer-facing presentation — 'itemised' or 'flatRate'. */
  presentationMode?: 'itemised' | 'flatRate';
  /** Optional bullet list shown under the flat-rate line. */
  flatRateInclusions?: string[];
  /** Label shown as the single flat-rate line. Falls back to job title. */
  flatRateLineLabel?: string;
  /** Suggested default for the flat-rate label (job title). */
  defaultFlatRateLabel?: string;
  onChange: (partial: InvoiceDisplaySettingsChange) => void;
  /**
   * Layout variant.
   * - `embedded`: plain content (no Surface, no title) — for cards that
   *   already provide their own chrome.
   * - `card`: wraps in a Surface with a section header (icon + title).
   * - `collapsible`: always-visible row with a chevron + summary; body
   *   expands inline. Pair with `expanded` + `onToggleExpand` to drive it
   *   from the parent (e.g. sync with the JobScopeCard top chevron).
   */
  variant?: 'embedded' | 'card' | 'collapsible';
  /** Style override applied to the outer Surface in `card` variant. */
  surfaceStyle?: any;
  /** Controlled expand state for `collapsible` variant. */
  expanded?: boolean;
  /** Called when the collapsible header is tapped. */
  onToggleExpand?: () => void;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function computeDeposit(total: number, pct: number): number {
  const safe = clampPct(pct);
  if (safe <= 0) return 0;
  return Math.round(total * (safe / 100) * 100) / 100;
}

function buildSummary({
  showMarkup,
  showMaterialCosts,
  showLaborCosts,
  requireDeposit,
  depositPercentage,
  depositAmount,
}: {
  showMarkup: boolean;
  showMaterialCosts: boolean;
  showLaborCosts: boolean;
  requireDeposit: boolean;
  depositPercentage: number;
  depositAmount: number;
}): string {
  const hidden: string[] = [];
  if (!showMarkup) hidden.push('markup');
  if (!showMaterialCosts) hidden.push('materials');
  if (!showLaborCosts) hidden.push('labour');

  const parts: string[] = [];
  parts.push(hidden.length === 0 ? 'All breakdowns shown' : `Hidden: ${hidden.join(', ')}`);

  if (requireDeposit && depositPercentage > 0) {
    parts.push(
      depositAmount > 0
        ? `Deposit ${clampPct(depositPercentage)}% · ${formatCurrency(depositAmount)}`
        : `Deposit ${clampPct(depositPercentage)}%`,
    );
  }
  return parts.join(' · ');
}

export function InvoiceDisplaySettings(props: InvoiceDisplaySettingsProps) {
  const {
    mode,
    total,
    showMarkup,
    showMaterialCosts,
    showLaborCosts,
    requireDeposit,
    depositPercentage,
    presentationMode = 'itemised',
    flatRateInclusions,
    flatRateLineLabel,
    defaultFlatRateLabel,
    onChange,
    variant = 'card',
    surfaceStyle,
    expanded,
    onToggleExpand,
  } = props;
  const isFlatRate = presentationMode === 'flatRate';
  // Local editing state for inclusions — we render them as a single
  // multi-line textarea (one bullet per line) for now. Cheaper to ship
  // than a row-by-row editor and matches how tradies copy/paste scope.
  const [inclusionsText, setInclusionsText] = useState((flatRateInclusions || []).join('\n'));
  const [lineLabelText, setLineLabelText] = useState(flatRateLineLabel || '');
  useEffect(() => {
    setInclusionsText((flatRateInclusions || []).join('\n'));
  }, [flatRateInclusions]);
  useEffect(() => {
    setLineLabelText(flatRateLineLabel || '');
  }, [flatRateLineLabel]);
  const commitInclusions = () => {
    const parsed = inclusionsText
      .split(/\r?\n/)
      .map((s) => s.replace(/^[-•]\s*/, '').trim())
      .filter((s) => s.length > 0);
    onChange({ flatRateInclusions: parsed.length > 0 ? parsed : undefined });
  };
  const commitLineLabel = () => {
    const trimmed = lineLabelText.trim();
    onChange({ flatRateLineLabel: trimmed.length > 0 ? trimmed : undefined });
  };
  const navigation = useNavigation<any>();
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [depositInput, setDepositInput] = useState(
    depositPercentage > 0 ? depositPercentage.toString() : '30',
  );
  // Internal fallback when the parent doesn't control expansion.
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expanded ?? internalExpanded;

  // Keep the local text input in sync if the prop changes from elsewhere
  // (e.g. the other card edits it). Avoid clobbering while the user is
  // mid-edit by only syncing when the numeric value differs.
  useEffect(() => {
    const parsed = parseFloat(depositInput) || 0;
    if (parsed !== depositPercentage) {
      setDepositInput(
        depositPercentage > 0 ? depositPercentage.toString() : '30',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositPercentage]);

  // Re-check Square on focus — returning from the Connect Square CTA
  // should immediately flip the toggle's availability.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      checkSquareConnection()
        .then((res) => {
          if (cancelled) return;
          setSquareConnected(!!res.connected);
          if (!res.connected && requireDeposit) {
            onChange({ requireDeposit: false, depositAmount: 0 });
          }
        })
        .catch(() => {
          if (!cancelled) setSquareConnected(false);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const docLabel = mode === 'invoice' ? 'invoice' : 'quote';

  const handleRequireDeposit = (v: boolean) => {
    const pct = clampPct(parseFloat(depositInput) || 0);
    onChange({
      requireDeposit: v && squareConnected === true,
      depositPercentage: pct,
      depositAmount: v ? computeDeposit(total, pct) : 0,
    });
  };

  const handleDepositInputBlur = () => {
    const pct = clampPct(parseFloat(depositInput) || 0);
    setDepositInput(pct ? pct.toString() : '30');
    onChange({
      depositPercentage: pct,
      depositAmount: requireDeposit ? computeDeposit(total, pct) : 0,
    });
  };

  const depositPreview = requireDeposit
    ? computeDeposit(total, parseFloat(depositInput) || 0)
    : 0;

  const body = (
    <View style={styles.body}>
      {/* Customer-facing presentation. Flat rate hides everything below
          (materials/labour breakdown toggles dim) and replaces the line
          items with a single labelled line + optional inclusions list. */}
      <View style={styles.presentationBlock}>
        <Text style={styles.depositHeaderLabel}>Customer sees</Text>
        <View style={styles.segmented}>
          {([
            { value: 'itemised', label: 'Itemised' },
            { value: 'flatRate', label: 'Flat rate' },
          ] as { value: 'itemised' | 'flatRate'; label: string }[]).map((opt) => {
            const active = presentationMode === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => onChange({ presentationMode: opt.value })}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.toggleSubtitle}>
          {isFlatRate
            ? 'One labelled line + total. No materials, no labour, no quantities. Your internal copy keeps every line for supplier ordering.'
            : 'Materials and labour shown as line items. Use the toggles below to hide individual sections.'}
        </Text>

        {isFlatRate && (
          <View style={styles.flatRateEditor}>
            <TextInput
              label="Line label"
              value={lineLabelText}
              onChangeText={setLineLabelText}
              onBlur={commitLineLabel}
              mode="outlined"
              placeholder={defaultFlatRateLabel || 'e.g. R4.1 Ceiling Insulation — supply & fit'}
              dense
              style={styles.flatRateInput}
            />
            <TextInput
              label={`What's included (one per line, optional)`}
              value={inclusionsText}
              onChangeText={setInclusionsText}
              onBlur={commitInclusions}
              mode="outlined"
              multiline
              numberOfLines={4}
              placeholder={'Supply and fit R4.1 ceiling insulation\nSite clean & rubbish removal\nFully accredited installer'}
              style={styles.flatRateInput}
            />
          </View>
        )}
      </View>
      <Divider style={styles.rowDivider} />

      <ToggleRow
        title={`Show markup breakdown on ${docLabel}`}
        subtitle="When off, markup is included in the total but not shown as a separate line to the customer."
        value={showMarkup}
        onValueChange={(v) => onChange({ showMarkup: v })}
      />
      <Divider style={styles.rowDivider} />
      <ToggleRow
        title={`Show material breakdown on ${docLabel}`}
        subtitle={
          isFlatRate
            ? 'Flat rate hides this automatically.'
            : 'When off, the materials breakdown and subtotal are hidden. Turn both this and labour off to show only the grand total.'
        }
        value={!isFlatRate && showMaterialCosts}
        onValueChange={(v) => onChange({ showMaterialCosts: v })}
        disabled={isFlatRate}
      />
      <Divider style={styles.rowDivider} />
      <ToggleRow
        title={`Show labour breakdown on ${docLabel}`}
        subtitle={
          isFlatRate
            ? 'Flat rate hides this automatically.'
            : 'When off, the labour breakdown and subtotal are hidden. Turn both this and materials off to show only the grand total.'
        }
        value={!isFlatRate && showLaborCosts}
        onValueChange={(v) => onChange({ showLaborCosts: v })}
        disabled={isFlatRate}
      />

      <View style={styles.depositSection}>
        <Text style={styles.depositHeaderLabel}>DEPOSIT</Text>

        <ToggleRow
          title="Require deposit on acceptance"
          subtitle={
            squareConnected === false
              ? 'Connect Square to collect deposits from customers when they accept.'
              : "Customer pays a deposit via Square to lock in the job. Remainder is invoiced when work's done."
          }
          value={requireDeposit && squareConnected !== false}
          onValueChange={handleRequireDeposit}
          disabled={squareConnected !== true}
          dense
        />

        {squareConnected === false ? (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('SquareIntegration' as never)
            }
            style={styles.connectSquareBtn}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name={'connection' as any}
              size={14}
              color={'#FFFFFF'}
            />
            <Text style={styles.connectSquareLabel}>Connect Square</Text>
          </TouchableOpacity>
        ) : null}

        {requireDeposit && squareConnected === true ? (
          <View style={styles.depositInputBlock}>
            <TextInput
              label="Deposit"
              value={depositInput}
              onChangeText={setDepositInput}
              onBlur={handleDepositInputBlur}
              mode="outlined"
              keyboardType="decimal-pad"
              placeholder="30"
              right={<TextInput.Affix text="%" />}
              style={styles.depositInput}
              dense
            />
            {depositPreview > 0 ? (
              <View style={styles.depositPreviewRow}>
                <Text style={styles.depositPreviewLabel}>
                  Deposit due on acceptance
                </Text>
                <Text style={styles.depositPreviewValue}>
                  {formatCurrency(depositPreview)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  if (variant === 'embedded') {
    return <View style={styles.embeddedRoot}>{body}</View>;
  }

  if (variant === 'collapsible') {
    const summary = buildSummary({
      showMarkup,
      showMaterialCosts,
      showLaborCosts,
      requireDeposit,
      depositPercentage,
      depositAmount: requireDeposit
        ? computeDeposit(total, parseFloat(depositInput) || 0)
        : 0,
    });
    const handleHeaderPress = () => {
      if (onToggleExpand) onToggleExpand();
      else setInternalExpanded((v) => !v);
    };
    return (
      <View style={[styles.collapsibleRoot, surfaceStyle]}>
        <Pressable
          onPress={handleHeaderPress}
          style={({ pressed }) => [
            styles.collapsibleRow,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isExpanded ? 'Hide display & deposit' : 'Show display & deposit'
          }
        >
          <View style={styles.collapsibleRowIcon}>
            <MaterialCommunityIcons
              name={'tune-variant' as any}
              size={18}
              color={colors.primary}
            />
          </View>
          <View style={styles.collapsibleRowBody}>
            <Text style={styles.collapsibleRowLabel}>Display & deposit</Text>
            <Text style={styles.collapsibleRowBodyText} numberOfLines={2}>
              {summary}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={(isExpanded ? 'chevron-up' : 'chevron-down') as any}
            size={18}
            color={colors.inactive}
          />
        </Pressable>
        {isExpanded ? <View style={styles.collapsibleBody}>{body}</View> : null}
      </View>
    );
  }

  return (
    <Surface style={[styles.surface, surfaceStyle]}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <MaterialCommunityIcons
            name={'tune-variant' as any}
            size={18}
            color={colors.primary}
          />
        </View>
        <Text style={styles.title}>Display & deposit</Text>
      </View>
      {body}
    </Surface>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
  dense,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  dense?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, dense && styles.toggleRowDense]}>
      <View style={styles.toggleText}>
        <Text
          style={[
            styles.toggleTitle,
            disabled ? { color: colors.textSecondary } : null,
          ]}
        >
          {title}
        </Text>
        <Text style={styles.toggleSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
        thumbColor={value ? colors.primary : '#F3F4F6'}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  embeddedRoot: {
    paddingTop: 4,
  },
  body: {
    paddingTop: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  titleIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryBg,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  // Toggles — generous vertical rhythm so the row stays scannable on small
  // phones, and the subtitle never crowds the switch.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 16,
  },
  toggleRowDense: {
    paddingVertical: 10,
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  rowDivider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  depositSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  depositHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  connectSquareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.primary,
    marginTop: 10,
  },
  connectSquareLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  depositInputBlock: {
    marginTop: 12,
  },
  depositInput: {
    marginBottom: 10,
  },
  depositPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  depositPreviewLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  depositPreviewValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  presentationBlock: {
    paddingVertical: 8,
    gap: 8,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  segmentActive: {
    backgroundColor: colors.primary + '12',
    borderColor: colors.primary,
  },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.primary },
  flatRateEditor: {
    gap: 8,
    marginTop: 4,
  },
  flatRateInput: {
    backgroundColor: colors.surface,
  },
  // Collapsible variant — matches ScopeRow exactly so it slots into the
  // JobScopeCard list without breaking the visual rhythm.
  collapsibleRoot: {
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
    overflow: 'hidden',
  },
  collapsibleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
  },
  collapsibleRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleRowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  collapsibleRowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  collapsibleRowBodyText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  collapsibleBody: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
