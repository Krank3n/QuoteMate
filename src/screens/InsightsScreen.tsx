/**
 * Insights & Reports Screen
 *
 * Two different jobs on one page, so a switcher at the top picks between them.
 * Insights is "how am I going" — revenue trends, pipeline, cost breakdown and
 * the month comparison. Reports is a document for someone else — the statement
 * a tradie hands their accountant.
 *
 * The statement lives here, not in Settings: this is already the money page,
 * and "what did I invoice and take last year" is a money question. Settings
 * keeps one field, the accountant's address.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import { PillToggle, type PillToggleOption } from '../components/PillToggle';
import { DueDateSheet } from '../components/DueDateSheet';
import { ProBadge } from '../components/ProBadge';
import { SendStatementSheet } from '../components/SendStatementSheet';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { useAlertModal } from '../hooks/useAlertModal';
import { documentService } from '../services/documentService';
import { trackEvent } from '../services/analyticsService';
import type { Document } from '../types/document';
import { formatCurrency } from '../utils/quoteCalculator';
import { mergeTruncatedSnapshot } from '../utils/mergeTruncatedSnapshot';
import { exportStatementPDF, reservePrintWindow } from '../utils/pdfGenerator';
import {
  STATEMENT_PRESET_LABELS,
  STATEMENT_PRESET_LONG_LABELS,
  customPeriod,
  statementPeriod,
  type StatementPeriod,
  type StatementPreset,
} from '../utils/statementPeriods';
import { buildStatement } from '../../shared/statement/buildStatement';
import type { StatementDocumentInput } from '../../shared/statement/buildStatement';

/** Which half of the page is showing: the charts, or the statement. */
type InsightsSection = 'insights' | 'reports';

const SECTION_OPTIONS: PillToggleOption<InsightsSection>[] = [
  { value: 'insights', label: 'Insights', icon: 'chart-line' },
  { value: 'reports', label: 'Reports', icon: 'file-document-outline' },
];

const PRESET_ORDER: StatementPreset[] = [
  'lastFinancialYear',
  'thisFinancialYearToDate',
  'lastQuarter',
  'custom',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two financial years, with the leap day. Past that the PDF and CSV pair goes
 * over what the email provider will carry and the send comes back a 413 —
 * better to say so before the tradie writes the message. Sharing the PDF has
 * no such limit.
 */
const MAX_EMAIL_DAYS = 731;

export function InsightsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { showAlert, alertNode } = useAlertModal();

  // The unified Document model, same as the dashboard tiles. These charts used
  // to read the legacy `quotes` collection, which lags on a fresh sign-in and
  // drops a job from "won" the moment it's invoiced. See insightsStats.
  const documents = useStore((s) => s.documents);
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // The dashboard links land on the half a tradie asked for: the stat tiles on
  // the charts, "Statement for your accountant" on the statement.
  const paramSection = route.params?.section as InsightsSection | undefined;
  const [section, setSection] = useState<InsightsSection>(paramSection ?? 'insights');
  // Insights sits in the stack underneath other cards, so a later link with a
  // different param has to move the switcher, not just the first one.
  useEffect(() => {
    if (paramSection) setSection(paramSection);
  }, [paramSection]);

  const [preset, setPreset] = useState<StatementPreset>('lastFinancialYear');
  const [period, setPeriod] = useState<StatementPeriod>(() => statementPeriod('lastFinancialYear'));
  const [customStartMs, setCustomStartMs] = useState<number | undefined>(undefined);
  const [startSheetVisible, setStartSheetVisible] = useState(false);
  const [endSheetVisible, setEndSheetVisible] = useState(false);
  const [sendVisible, setSendVisible] = useState(false);
  const [sharing, setSharing] = useState(false);

  // The store's listener stops at 500 documents, which is nowhere near a
  // financial year for a busy tradie — so read the collection once, uncapped,
  // and swap it in. Until that read settles the rows are a skeleton: figures
  // off the capped copy would be wrong, and "Nothing recorded" would be a lie
  // told to anyone who opens Insights on a slow connection.
  const [allDocuments, setAllDocuments] = useState<Document[] | null>(null);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void documentService
      .loadDocuments()
      .then((loaded) => {
        if (cancelled) return;
        // loadDocuments answers [] for a failed read as well as an empty
        // account. With documents in the store, [] can only be the failure:
        // keep the store's copy and say the figures are the phone's.
        if (loaded.length) setAllDocuments(loaded);
        else if (useStore.getState().documents.length) setReadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setReadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The uncapped read is a snapshot taken on mount; the store's listener is
  // live. Prefer the store's copy of any document it carries — a payment
  // recorded while Insights sat underneath in the stack lands there — and
  // carry the older tail the 500-document listener never reached.
  const statementDocuments = useMemo(
    () => (allDocuments ? mergeTruncatedSnapshot(allDocuments, documents, (d) => d.id, true) : documents),
    [allDocuments, documents],
  );

  const statement = useMemo(
    () =>
      buildStatement(
        statementDocuments as unknown as StatementDocumentInput[],
        { fromMs: period.fromMs, toMs: period.toMs },
        { gstRegistered: businessSettings?.gstRegistered },
      ),
    [statementDocuments, period.fromMs, period.toMs, businessSettings?.gstRegistered],
  );

  const summary = statement.summary;
  const isEmptyPeriod = summary.invoiceCount === 0 && summary.paymentCount === 0;
  const lastDay = format(new Date(period.toMs - 1), 'd MMM yyyy');
  const tooLongToEmail = Math.round((period.toMs - period.fromMs) / DAY_MS) > MAX_EMAIL_DAYS;

  const rows: { label: string; value: string }[] = [
    { label: `Invoices issued (${summary.invoiceCount})`, value: formatCurrency(summary.invoicedTotal) },
    ...(statement.gstRegistered
      ? [{ label: 'GST collected', value: formatCurrency(summary.gstCollected || 0) }]
      : []),
    { label: `Payments received (${summary.paymentCount})`, value: formatCurrency(summary.receivedTotal) },
    { label: `Outstanding at ${lastDay}`, value: formatCurrency(summary.outstandingTotal) },
  ];

  const choosePreset = (next: StatementPreset) => {
    if (next === 'custom') {
      // The chip only takes once both dates are in: a calendar dismissed
      // halfway leaves the tradie on the period they were already reading.
      setCustomStartMs(undefined);
      setStartSheetVisible(true);
      return;
    }
    setPreset(next);
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
      trackEvent('statement_shared', { preset });
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
          {/* The same pill every other mode switch in the app uses. */}
          <PillToggle<InsightsSection>
            value={section}
            onChange={setSection}
            options={SECTION_OPTIONS}
            fullWidth
            style={styles.switcher}
          />

          {section === 'insights' ? (
            <>
              <MonthComparisonChart documents={documents} />
              <QuotePipelineChart documents={documents} />
              <RevenueChart documents={documents} />
              <CostBreakdownChart documents={documents} />
            </>
          ) : (
            <Surface style={styles.statementCard}>
              <View style={styles.headingRow}>
                <Text style={styles.statementTitle}>Statement for your accountant</Text>
                {!isPro && <ProBadge size="small" />}
              </View>

              <Text style={styles.fieldLabel}>Period</Text>
              <View style={styles.chipRow}>
                {PRESET_ORDER.map((option) => (
                  <Chip
                    key={option}
                    label={STATEMENT_PRESET_LABELS[option]}
                    accessibilityLabel={STATEMENT_PRESET_LONG_LABELS[option]}
                    active={preset === option}
                    onPress={() => choosePreset(option)}
                  />
                ))}
              </View>
              <Text style={styles.periodLabel}>{period.label}</Text>
              {tooLongToEmail && (
                <Text style={styles.warningLine}>
                  Emailing covers at most 24 months. Pick a shorter range.
                </Text>
              )}

              <SkeletonCrossfade
                loaded={documentsLoaded}
                skeleton={
                  <View testID="statement-skeleton">
                    {rows.map((row) => (
                      <View key={row.label} style={styles.summaryRow}>
                        <View style={[styles.skeletonBar, styles.skeletonLabel]} />
                        <View style={[styles.skeletonBar, styles.skeletonValue]} />
                      </View>
                    ))}
                  </View>
                }
              >
                {isEmptyPeriod ? (
                  <Text style={styles.emptyLine}>
                    {`Nothing recorded between ${period.label}. Try another period.`}
                  </Text>
                ) : (
                  rows.map((row) => (
                    <View key={row.label} style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>{row.label}</Text>
                      <Text style={styles.summaryValue}>{row.value}</Text>
                    </View>
                  ))
                )}
              </SkeletonCrossfade>

              {readFailed && (
                <Text style={styles.degradedLine}>
                  {"Showing what's saved on this phone. Get back on signal and reopen to check every invoice."}
                </Text>
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
                  disabled={tooLongToEmail}
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
              </View>
              {!isPro && (
                <Text style={styles.proLine}>Sending and sharing the statement is part of Pro.</Text>
              )}
            </Surface>
          )}
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
      title="Start date (1 of 2)"
      clearLabel="Cancel"
    />
    <DueDateSheet
      visible={endSheetVisible}
      onDismiss={() => setEndSheetVisible(false)}
      // Opens on the start just picked, not on the end of the period being
      // replaced, and nothing before it can be chosen.
      value={customStartMs ?? period.toMs - 1}
      minDate={customStartMs}
      onChange={(next) => {
        if (!next || customStartMs === undefined) return;
        setPeriod(customPeriod(customStartMs, next));
        setPreset('custom');
      }}
      title="End date (2 of 2)"
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
  switcher: { marginBottom: 12 },
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statementTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textSecondary,
    marginTop: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
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
  warningLine: {
    fontSize: 12,
    color: t.colors.warning,
    marginBottom: 6,
    lineHeight: 17,
  },
  degradedLine: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 6,
    lineHeight: 17,
  },
  proLine: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 8,
  },
  skeletonBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: t.colors.border,
  },
  skeletonLabel: {
    flex: 1,
    maxWidth: 160,
  },
  skeletonValue: {
    width: 80,
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
