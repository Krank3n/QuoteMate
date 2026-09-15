/**
 * Insights Screen
 * Revenue trends, pipeline, cost breakdown, and month comparison — plus the
 * statement a tradie hands their accountant.
 *
 * The statement lives here, not in Settings: this is already the money page,
 * and "what did I invoice and take last year" is a money question. Settings
 * keeps one field, the accountant's address.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';
import { MonthComparisonChart } from '../components/MonthComparisonChart';
import { QuotePipelineChart } from '../components/QuotePipelineChart';
import { RevenueChart } from '../components/RevenueChart';
import { CostBreakdownChart } from '../components/CostBreakdownChart';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';
import { Chip } from '../components/Chip';
import { DueDateSheet } from '../components/DueDateSheet';
import { ProBadge } from '../components/ProBadge';
import { SendStatementSheet } from '../components/SendStatementSheet';
import { useAlertModal } from '../hooks/useAlertModal';
import { documentService } from '../services/documentService';
import type { Document } from '../types/document';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportStatementPDF, reservePrintWindow } from '../utils/pdfGenerator';
import {
  STATEMENT_PRESET_LABELS,
  customPeriod,
  statementPeriod,
  type StatementPeriod,
  type StatementPreset,
} from '../utils/statementPeriods';
import { buildStatement } from '../../shared/statement/buildStatement';
import type { StatementDocumentInput } from '../../shared/statement/buildStatement';

const PRESET_ORDER: StatementPreset[] = [
  'lastFinancialYear',
  'thisFinancialYearToDate',
  'lastQuarter',
  'custom',
];

export function InsightsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { showAlert, alertNode } = useAlertModal();

  // The unified Document model, same as the dashboard tiles. These charts used
  // to read the legacy `quotes` collection, which lags on a fresh sign-in and
  // drops a job from "won" the moment it's invoiced. See insightsStats.
  const documents = useStore((s) => s.documents);
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [preset, setPreset] = useState<StatementPreset>('lastFinancialYear');
  const [period, setPeriod] = useState<StatementPeriod>(() => statementPeriod('lastFinancialYear'));
  const [customStartMs, setCustomStartMs] = useState<number | undefined>(undefined);
  const [startSheetVisible, setStartSheetVisible] = useState(false);
  const [endSheetVisible, setEndSheetVisible] = useState(false);
  const [sendVisible, setSendVisible] = useState(false);
  const [sharing, setSharing] = useState(false);

  // The store's listener stops at 500 documents, which is nowhere near a
  // financial year for a busy tradie — so read the collection once, uncapped,
  // and swap it in. The first paint still comes off the store, so the card is
  // never blank while that read is in flight.
  const [allDocuments, setAllDocuments] = useState<Document[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void documentService.loadDocuments().then((loaded) => {
      // loadDocuments answers [] for a failed read as well as an empty
      // account; in both cases the store's copy is the better answer.
      if (!cancelled && loaded.length) setAllDocuments(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const statement = useMemo(
    () =>
      buildStatement(
        (allDocuments ?? documents) as unknown as StatementDocumentInput[],
        { fromMs: period.fromMs, toMs: period.toMs },
        { gstRegistered: businessSettings?.gstRegistered },
      ),
    [allDocuments, documents, period.fromMs, period.toMs, businessSettings?.gstRegistered],
  );

  const summary = statement.summary;
  const isEmptyPeriod = summary.invoiceCount === 0 && summary.paymentCount === 0;
  const lastDay = format(new Date(period.toMs - 1), 'd MMM yyyy');

  const rows: { label: string; value: string }[] = [
    { label: `Invoices issued (${summary.invoiceCount})`, value: formatCurrency(summary.invoicedTotal) },
    ...(statement.gstRegistered
      ? [{ label: 'GST collected', value: formatCurrency(summary.gstCollected || 0) }]
      : []),
    { label: `Payments received (${summary.paymentCount})`, value: formatCurrency(summary.receivedTotal) },
    { label: `Outstanding at ${lastDay}`, value: formatCurrency(summary.outstandingTotal) },
  ];

  const choosePreset = (next: StatementPreset) => {
    setPreset(next);
    if (next === 'custom') {
      setCustomStartMs(undefined);
      setStartSheetVisible(true);
      return;
    }
    setPeriod(statementPeriod(next));
  };

  /** Pro/trial gate, same as the Xero integration. */
  const requirePro = (): boolean => {
    if (isPro) return true;
    navigation.navigate('Paywall' as never, { source: 'insights_statement' } as never);
    return false;
  };

  const handleSharePdf = async () => {
    if (!requirePro()) return;
    // Reserve the tab on the tap — the export is async and a popup blocker
    // refuses window.open once the gesture is spent.
    const printWindow = reservePrintWindow();
    setSharing(true);
    try {
      await exportStatementPDF(statement, businessSettings, {
        fromMs: period.fromMs,
        toMs: period.toMs,
        isPro,
        printWindow,
      });
    } catch (error: any) {
      showAlert({
        type: 'error',
        title: 'Could not share the statement',
        message: error?.message || 'Something went wrong making the PDF. Please try again.',
      });
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.gridHost}>
    <GridBackground />
    <ScrollView style={styles.scroller}>
      <WebContainer>
        <View style={styles.content}>
          <Surface style={styles.statementCard}>
            <Text style={styles.statementTitle}>Statement for your accountant</Text>

            <View style={styles.chipRow}>
              {PRESET_ORDER.map((option) => (
                <Chip
                  key={option}
                  label={STATEMENT_PRESET_LABELS[option]}
                  active={preset === option}
                  onPress={() => choosePreset(option)}
                />
              ))}
            </View>
            <Text style={styles.periodLabel}>{period.label}</Text>

            {isEmptyPeriod ? (
              <Text style={styles.emptyLine}>Nothing recorded in this period</Text>
            ) : (
              rows.map((row) => (
                <View key={row.label} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{row.label}</Text>
                  <Text style={styles.summaryValue}>{row.value}</Text>
                </View>
              ))
            )}

            <View style={styles.actions}>
              <Button
                mode="contained"
                buttonColor={themeColors.accent}
                textColor={themeColors.onAccent}
                icon="email-outline"
                onPress={() => {
                  if (requirePro()) setSendVisible(true);
                }}
                style={styles.primaryAction}
              >
                Send to accountant
              </Button>
              <Button
                mode="outlined"
                icon="file-pdf-box"
                onPress={handleSharePdf}
                loading={sharing}
                disabled={sharing}
              >
                Share PDF
              </Button>
              {!isPro && <ProBadge size="small" />}
            </View>
          </Surface>

          <MonthComparisonChart documents={documents} />
          <QuotePipelineChart documents={documents} />
          <RevenueChart documents={documents} />
          <CostBreakdownChart documents={documents} />
        </View>
      </WebContainer>
    </ScrollView>

    {/* Two picks, start then end — the same calendar sheet the payment date
        and checklist due dates use. */}
    <DueDateSheet
      visible={startSheetVisible}
      onDismiss={() => setStartSheetVisible(false)}
      value={customStartMs ?? period.fromMs}
      onChange={(next) => {
        if (!next) return;
        setCustomStartMs(next);
        setEndSheetVisible(true);
      }}
      title="Statement starts"
      clearLabel="Cancel"
    />
    <DueDateSheet
      visible={endSheetVisible}
      onDismiss={() => setEndSheetVisible(false)}
      value={period.toMs - 1}
      onChange={(next) => {
        if (!next || customStartMs === undefined) return;
        setPeriod(customPeriod(customStartMs, next));
      }}
      title="Statement ends"
      clearLabel="Cancel"
    />

    <SendStatementSheet
      visible={sendVisible}
      onDismiss={() => setSendVisible(false)}
      period={period}
      preset={preset}
      summary={summary}
    />
    {alertNode}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  gridHost: { flex: 1, backgroundColor: t.colors.bg },
  scroller: { flex: 1, backgroundColor: 'transparent' },
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  statementCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
    marginBottom: 12,
  },
  statementTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  periodLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 10,
    marginBottom: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  summaryLabel: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  emptyLine: {
    fontSize: 13,
    color: t.colors.textMuted,
    paddingVertical: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  primaryAction: {
    borderRadius: 24,
  },
}));
