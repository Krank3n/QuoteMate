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

import { makeStyles, useThemeColors } from '../theme';
import { checkSquareConnection } from '../services/squareService';
import { formatCurrency } from '../utils/quoteCalculator';

export interface InvoiceDisplaySettingsChange {
  showMarkup?: boolean;
  showMaterialCosts?: boolean;
  showLaborCosts?: boolean;
  requireDeposit?: boolean;
  depositPercentage?: number;
  depositAmount?: number;
}

interface InvoiceDisplaySettingsProps {
  mode: 'quote' | 'invoice';
  total: number;
  showMarkup: boolean;
  showMaterialCosts: boolean;
  showLaborCosts: boolean;
  requireDeposit: boolean;
  depositPercentage: number;
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  const {
    mode,
    total,
    showMarkup,
    showMaterialCosts,
    showLaborCosts,
    requireDeposit,
    depositPercentage,
    onChange,
    variant = 'card',
    surfaceStyle,
    expanded,
    onToggleExpand,
  } = props;
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
      <ToggleRow
        title={`Show markup breakdown on ${docLabel}`}
        subtitle="When off, markup is included in the total but not shown as a separate line to the customer."
        value={showMarkup}
        onValueChange={(v) => onChange({ showMarkup: v })}
      />
      <Divider style={styles.rowDivider} />
      <ToggleRow
        title={`Show material breakdown on ${docLabel}`}
        subtitle="When off, the materials breakdown and subtotal are hidden. Turn both this and labour off to show only the grand total."
        value={showMaterialCosts}
        onValueChange={(v) => onChange({ showMaterialCosts: v })}
      />
      <Divider style={styles.rowDivider} />
      <ToggleRow
        title={`Show labour breakdown on ${docLabel}`}
        subtitle="When off, the labour breakdown and subtotal are hidden. Turn both this and materials off to show only the grand total."
        value={showLaborCosts}
        onValueChange={(v) => onChange({ showLaborCosts: v })}
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
              color={themeColors.onAccent}
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
              color={themeColors.accentText}
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
            color={themeColors.textDisabled}
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
            color={themeColors.accentText}
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <View style={[styles.toggleRow, dense && styles.toggleRowDense]}>
      <View style={styles.toggleText}>
        <Text
          style={[
            styles.toggleTitle,
            disabled ? { color: themeColors.textMuted } : null,
          ]}
        >
          {title}
        </Text>
        <Text style={styles.toggleSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#D1D5DB', true: themeColors.accentSubtle }}
        thumbColor={value ? themeColors.accent : '#F3F4F6'}
        disabled={disabled}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  surface: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
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
    backgroundColor: t.colors.accentSubtle,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
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
    color: t.colors.text,
    marginBottom: 4,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
  },
  rowDivider: {
    backgroundColor: t.colors.border,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  depositSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  depositHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.accent,
    marginTop: 10,
  },
  connectSquareLabel: {
    color: t.colors.onAccent,
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
    backgroundColor: t.colors.bg,
  },
  depositPreviewLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: t.colors.text,
  },
  depositPreviewValue: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.money,
  },
  // Collapsible variant — matches ScopeRow exactly so it slots into the
  // JobScopeCard list without breaking the visual rhythm.
  collapsibleRoot: {
    borderRadius: 12,
    backgroundColor: t.colors.surfacePressed,
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
    backgroundColor: t.colors.accentSubtle,
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
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  collapsibleRowBodyText: {
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },
  collapsibleBody: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
}));
