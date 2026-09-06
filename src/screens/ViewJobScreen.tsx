/**
 * ViewJobScreen
 *
 * Detail view for a single Job. Shows customer + address + stage, aggregate
 * totals, scheduled dates, attached Documents (rendered as DocumentRows with
 * the Phase-11 two-chip split), notes, and archive/delete actions.
 * Stage chip → JobStageSheet.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, Linking, Platform, TouchableOpacity } from 'react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { Text, Card, Button, Snackbar } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { formatDistanceToNow } from 'date-fns';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Job, JobStage } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { WebContainer } from '../components/WebContainer';
import { DocumentRow } from '../components/DocumentRow';
import { JobScopeCard, type ScopeStep } from '../components/JobScopeCard';
import { JobDetailHeader } from '../components/JobDetailHeader';
import { JobActionsSheet, type JobAction } from '../components/JobActionsSheet';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import { canUseServiceReports } from '../utils/reportEntitlement';
import { reportService } from '../services/reportService';
import { resumableReportId, reportRowMeta } from './ServiceReport/reportDraft';
import { ServiceReportCard } from '../components/ServiceReportCard';
import type { ServiceReport } from '../../shared/report/types';
import { StageSheet } from '../components/StageSheet';
import { JobStageSheet, stageMetaFor } from '../components/JobStageSheet';
import {
  crossesContractLine,
  depositHasBeenPaid,
} from '../../shared/job/stage';
import { JobPhotoStrip } from '../components/JobPhotoStrip';
import { JobChecklist } from '../components/JobChecklist';
import { PaymentSheet } from '../components/PaymentSheet';
import { derivePaymentState } from '../components/PaymentChip';
import { ScheduleJobSheet } from '../components/ScheduleJobSheet';
import {
  StickyJobActionBar,
  pickPrimaryDoc,
  isUnfinishedDraftQuote,
  type JobActionId,
} from '../components/StickyJobActionBar';
import { TakePaymentSheet, type TakePaymentTarget } from '../components/TakePaymentSheet';
import { getReeceConnectionStatus } from '../services/reeceApi';
import { SendDocumentDialog } from '../components/SendDocumentDialog';
import { warmEmailDraft } from '../utils/emailDraft';
import { FollowUpSheet, type FollowUpTone } from '../components/FollowUpSheet';
import { JobWonSheet } from '../components/JobWonSheet';
import type { Document, DocumentStage } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { applyStageChange } from '../utils/applyStageChange';
import { maybeRequestReview } from '../services/storeReviewService';
import { maybeShowWonPrompt } from '../utils/wonPrompt';
import { ensureSquareConnectedForPayment } from '../utils/quoteDeliveryGuard';
import { applyJobStageChange } from '../utils/applyJobStageChange';
import { cascadeDeleteJob, pickPaidDocs } from '../utils/deleteJobWithDocs';
import { formatScheduledDateLong } from '../utils/formatSchedule';
import { selectionTap, lightTap } from '../utils/haptics';
import { useAlertModal } from '../hooks/useAlertModal';
import { paymentCopy } from '../constants/paymentCopy';
import { cardChargeSuccessAlert } from '../utils/cardChargeSuccessAlert';
import { TRIAL_MS } from '../utils/trialConfig';
import { GridBackground } from '../components/GridBackground';

export function ViewJobScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId: string = route.params?.jobId;

  const job = useJobStore((s) => s.jobs.find((j) => j.id === jobId));
  const saveJob = useJobStore((s) => s.saveJob);
  const deleteJob = useJobStore((s) => s.deleteJob);

  const documents = useStore((s) => s.documents);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const getEffectivePlan = useStore((s) => s.getEffectivePlan);
  const businessSettings = useStore((s) => s.businessSettings);
  const saveQuote = useStore((s) => s.saveQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);
  const createInvoiceFromQuote = useStore((s) => s.createInvoiceFromQuote);
  const convertDocumentToInvoice = useStore((s) => s.convertDocumentToInvoice);
  const duplicateDocumentForJob = useStore((s) => s.duplicateDocumentForJob);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const setCurrentInvoice = useStore((s) => s.setCurrentInvoice);
  const deleteQuote = useStore((s) => s.deleteQuote);
  const deleteInvoice = useStore((s) => s.deleteInvoice);
  const duplicateJob = useJobStore((s) => s.duplicateJob);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const pushInvoiceToXero = useStore((s) => s.pushInvoiceToXero);

  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // Whole days left in the trial (ceil), counted the same way the dashboard
  // and TrialBanner count it. Null when the tradie never started a trial.
  const trialDaysRemaining = subscriptionStatus?.trialStartedAt
    ? Math.max(
        0,
        Math.ceil(
          (TRIAL_MS - (Date.now() - new Date(subscriptionStatus.trialStartedAt).getTime())) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  const [stageSheetVisible, setStageSheetVisible] = useState(false);
  const [docStageSheetDoc, setDocStageSheetDoc] = useState<Document | null>(null);
  const [paymentSheetDoc, setPaymentSheetDoc] = useState<Document | null>(null);
  const [scheduleSheetVisible, setScheduleSheetVisible] = useState(false);
  const [actionsSheetVisible, setActionsSheetVisible] = useState(false);
  const [takePaymentTarget, setTakePaymentTarget] = useState<TakePaymentTarget | null>(null);
  const [sendDialogDoc, setSendDialogDoc] = useState<Document | null>(null);
  const [followUpState, setFollowUpState] = useState<{
    doc: Document;
    tone: FollowUpTone;
  } | null>(null);
  const [wonSheetState, setWonSheetState] = useState<{
    doc: Document;
    /** Days left when the offer was made, or null for a free user. */
    trialDaysRemaining: number | null;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<JobActionId | null>(null);
  const [reeceConnected, setReeceConnected] = useState<boolean | null>(null);
  const { showAlert, dismissAlert, alertNode } = useAlertModal();
  const [convertSnackbar, setConvertSnackbar] = useState(false);
  const [markedSentDocId, setMarkedSentDocId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState(job?.notes ?? '');

  useEffect(() => {
    let cancelled = false;
    getReeceConnectionStatus()
      .then((status) => { if (!cancelled) setReeceConnected(!!status.connected); })
      .catch(() => { if (!cancelled) setReeceConnected(false); });
    return () => { cancelled = true; };
  }, []);

  // Service reports attached to this job — reloaded on focus so a report
  // saved/sent on the ServiceReport screen shows up when the tradie backs
  // out to the job. Errors leave the list as-is (rows just don't appear).
  const [jobReports, setJobReports] = useState<ServiceReport[]>([]);
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const load = () => {
      reportService
        .listReports(jobId)
        .then((reports) => { if (!cancelled) setJobReports(reports); })
        .catch(() => {});
    };
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return () => { cancelled = true; unsubscribe(); };
  }, [jobId, navigation]);
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);

  React.useEffect(() => {
    if (job) {
      setNotesDraft(job.notes ?? '');
      setNotesDirty(false);
      // Existing notes → open the editor so they're visible. Empty →
      // keep the "Add notes" CTA collapsed.
      setNotesEditing((job.notes ?? '').trim().length > 0);
    }
  }, [job?.id, job?.notes]);

  // Mate's send proposal routes here with openSendDocId set. Auto-open the
  // send sheet for that specific doc once it's in the store, exactly once,
  // then clear the param so a back-nav or re-render doesn't reopen it.
  const openSendDocId: string | undefined = route.params?.openSendDocId;
  const handledSendParamRef = useRef(false);
  useEffect(() => {
    if (!openSendDocId || handledSendParamRef.current) return;
    const doc = documents.find((d) => d.id === openSendDocId);
    if (!doc) return; // wait for the store to sync the doc, then fire
    handledSendParamRef.current = true;
    setSendDialogDoc(doc);
    navigation.setParams({ openSendDocId: undefined });
  }, [openSendDocId, documents, navigation]);

  const attachedDocs = useMemo(
    () => documents.filter((d) => d.jobId === jobId),
    [documents, jobId],
  );
  // Pick the most actionable doc on the job for the sticky bar. Invoices
  // trump quotes once they exist; within a type the most recent wins.
  // Must sit above the `!job` guard so the hook count stays stable when
  // the job is deleted out from under us.
  const actionableDoc = useMemo(() => pickPrimaryDoc(attachedDocs), [attachedDocs]);

  // Duration comes from the primary attached doc's labour rather than
  // duplicate fields on the Job itself. Prefer the explicitly-linked
  // primaryDocumentId when it's still on the job; otherwise fall back to
  // the actionable doc.
  //
  // Sits above the `!job` guard for the same reason actionableDoc does: the
  // email warm-up effect below depends on it, and every hook has to run on
  // every render. Deleting a job from the Actions menu made `job` undefined,
  // the guard returned early, and that effect went missing mid-render —
  // "Rendered fewer hooks than expected" (ViewJobScreen.tsx:69), a red box on
  // dev and a crash in release, on the delete path of any job.
  const primaryDoc = job?.primaryDocumentId
    ? documents.find((d) => d.id === job.primaryDocumentId) ?? actionableDoc
    : actionableDoc;

  // Warm the customer email for the doc this screen is about. This screen's
  // sticky-bar Send drives the same SendDocumentDialog as the wizard, but had
  // no warm-up of its own — so sending from here always paid the full
  // generation wait. warmEmailDraft is fire-and-forget and self-guarding: it
  // no-ops off the free tier, on a doc that already carries a body, on
  // anything past draft, and on a doc already warm or in flight. Safe to call
  // on every doc change.
  useEffect(() => {
    if (!primaryDoc) return;
    void warmEmailDraft(primaryDoc, businessSettings, { isPro });
  }, [primaryDoc?.id, businessSettings, isPro]);

  if (!job) {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons
          name={'briefcase-off-outline' as any}
          size={48}
          color={themeColors.textMuted}
        />
        <Text style={styles.missingTitle}>Job not found</Text>
        <Text style={styles.missingText}>
          It may have been deleted or hasn’t synced yet.
        </Text>
        <Button mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent} style={{ marginTop: 20 }} onPress={() => navigation.goBack()}>
          Back
        </Button>
      </View>
    );
  }

  const meta = stageMetaFor(job.stage, themeColors);
  const completedAt = formatScheduledDateLong(job.completedDate);

  // "Order from Reece" entry — only when Reece is connected and the doc has
  // at least one Reece-priced material with order identifiers. Slots into
  // the ScopeBlock right under the JobScopeCard via the `extra` prop.
  // Saved service reports get their own labelled, compact block so the answer
  // to "where did Save/Share put it?" is obvious on return to the job. Tap a
  // row to resume a draft or open a sent report.
  const serviceReportRows = jobReports.length > 0 ? (
    <View style={styles.serviceReportsWrap}>
      {/* No section label — each card carries its own header, the way the
          quote card does, so the title sits with the thing it names. */}
      {jobReports.map((report) => (
        <ServiceReportCard
          key={report.id}
          report={report}
          meta={reportRowMeta(report)}
          businessSettings={businessSettings}
          isPro={isPro}
          customerName={job.customerName}
          onOpen={() =>
            navigation.navigate('ServiceReport', {
              jobId: job.id,
              reportId: report.id,
            })
          }
          onPreviewError={(message) =>
            showAlert({ type: 'error', title: 'Preview failed', message })
          }
        />
      ))}
    </View>
  ) : null;

  const reeceOrderEntry =
    reeceConnected === true &&
    primaryDoc?.materials?.some((m) => !!m.reeceItemNumber && !!m.reeceUnitOfMeasure) ? (
      <TouchableOpacity
        style={styles.reeceOrderButton}
        onPress={() => navigation.navigate('ReeceOrder', { docId: primaryDoc?.id })}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons name="cart-outline" size={20} color={themeColors.accentText} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.reeceOrderButtonTitle}>Order from Reece</Text>
          <Text style={styles.reeceOrderButtonSubtitle}>
            Place this list against your trade account — Reece bills you, no money through QuoteMate.
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={themeColors.textMuted} />
      </TouchableOpacity>
    ) : null;

  // The "job won" offer. Runs after a quote is accepted, never blocking it.
  // Who sees it (free, or a trial in its last days, on a priced quote) and how
  // often (once per doc, once per 7 days) lives in wonPrompt.ts, which also
  // persists the cap before reporting back. `reviewShown` stands the offer down
  // when the OS review prompt was asked for on this same win.
  const offerWonPrompt = async (doc: Document, reviewShown: boolean) => {
    const plan = getEffectivePlan();
    const show = await maybeShowWonPrompt({
      doc,
      plan,
      trialDaysRemaining,
      reviewShown,
      now: Date.now(),
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
    });
    if (show) {
      setWonSheetState({
        doc,
        trialDaysRemaining: plan === 'trial' ? trialDaysRemaining : null,
      });
    }
  };

  const applyStageTransition = async (target: JobStage) => {
    // Accepting from the job stage sheet drags the primary quote along to
    // 'quote_accepted' (applyJobStageChange), so the same win happens here.
    // Read the doc's stage before the change: re-picking a stage it already
    // holds isn't a win.
    const wonQuote =
      target === 'accepted' &&
      actionableDoc?.type === 'quote' &&
      actionableDoc.stage !== 'quote_accepted'
        ? actionableDoc
        : null;
    try {
      await applyJobStageChange({
        job,
        target,
        primaryDoc: actionableDoc,
        attachedDocs,
        saveJob,
        helpers: { saveQuote, saveInvoice, createInvoiceFromQuote, navigation },
      });
    } catch (err) {
      console.error('[ViewJob] applyStageTransition failed', err);
      showAlert({
        type: 'error',
        title: 'Stage update failed',
        message: 'Something went wrong updating the stage. Please try again.',
      });
      return;
    }
    // Same offer as markApproved. No store-review ask on this path.
    if (wonQuote) await offerWonPrompt(wonQuote, false);
  };

  const handleStageSelect = async (target: JobStage) => {
    setStageSheetVisible(false);
    // When reverting across the accept or cancel line, the primary doc's
    // state moves with the job. Prompt once so the tradie knows.
    if (crossesContractLine(job.stage, target)) {
      const message =
        target === 'quoted'
          ? 'This will also mark the quote as "sent" again so the customer-facing state matches. Continue?'
          : 'This will reactivate the job back to inquiry. Continue?';
      showAlert({
        type: 'warning',
        title: 'Heads up',
        message,
        primaryButtonText: 'Continue',
        primaryButtonAction: () => applyStageTransition(target),
        secondaryButtonText: 'Cancel',
        secondaryButtonAction: () => {},
      });
      return;
    }
    await applyStageTransition(target);
  };

  const handleNotesSave = async () => {
    if (!notesDirty) return;
    await saveJob({ ...job, notes: notesDraft });
    setNotesDirty(false);
    // If they saved an empty string, collapse back to the "Add notes" CTA
    // so the screen stays tidy.
    if (!notesDraft.trim()) setNotesEditing(false);
  };

  // Classify how stale a sent doc is, for the Follow Up sheet tone.
  const computeFollowUpTone = (doc: Document): FollowUpTone => {
    const baseline =
      doc.type === 'invoice' ? (doc.dueDate ?? doc.sentAt) : doc.sentAt;
    if (!baseline) return 'gentle';
    const days = (Date.now() - baseline) / (1000 * 60 * 60 * 24);
    if (doc.type === 'invoice' && doc.dueDate) {
      // Days past due
      if (days < 3) return 'gentle';
      if (days < 7) return 'firm';
      return 'overdue';
    }
    if (days < 4) return 'gentle';
    if (days < 7) return 'firm';
    return 'overdue';
  };

  // Chip tap routing. An unpaid INVOICE goes straight to Record Payment —
  // the same place the identical chip goes from a job card. It used to open
  // TakePaymentSheet here instead, so one control did two different things
  // depending on which screen you were standing on, and the fast path (two
  // taps) became a slow one (four) for no reason the tradie could see.
  // Collecting by card is still one tap away on the sticky bar.
  //
  // A quote with a deposit owing still needs the sheet: there is no manual
  // deposit path, and the Square rows are the only way to take one.
  const handlePaymentChipPress = async (doc: Document) => {
    const state = derivePaymentState(doc);
    const owed = state === 'unpaid' || state === 'partially_paid';
    if (owed && Number(doc.total) > 0) {
      if (doc.type === 'invoice') {
        navigation.navigate('RecordPayment', { invoiceId: doc.id });
        return;
      }
      // No Square gate here — the sheet's manual rows must work with zero
      // Square setup; the Square rows gate themselves.
      openTakePaymentForDoc(doc);
      return;
    }
    setPaymentSheetDoc(doc);
  };

  const handleConvertToInvoice = (doc: Document) => {
    showAlert({
      type: 'warning',
      title: 'Convert to invoice?',
      message: "This quote will become an invoice and can't be sent as a quote again.",
      primaryButtonText: 'Convert to invoice',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          await convertDocumentToInvoice(doc.id);
          dismissAlert();
          // Stay on the job screen — the card flips to an Unpaid invoice in
          // place and the snackbar confirms. Jumping into the materials
          // editor here (the old behaviour) read as being yanked off the
          // job mid-flow.
          setConvertSnackbar(true);
        } catch (err) {
          showAlert({
            type: 'error',
            title: 'Conversion failed',
            message: 'Something went wrong. Pull to refresh and try again.',
          });
        }
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: () => {},
    });
  };

  const openTakePaymentForDoc = (doc: Document) => {
    if (doc.type === 'invoice') {
      setTakePaymentTarget({
        kind: 'invoice',
        invoiceId: doc.id,
        total: Number(doc.total ?? 0),
        paidAmount: Number(doc.paidTotal ?? 0),
        jobName: job.name,
        invoiceNumber: doc.number,
        terms: doc.termsSnapshot ?? null,
      });
      return;
    }
    setTakePaymentTarget({
      kind: 'quote_deposit',
      quoteId: doc.id,
      depositAmount: Number(doc.depositAmount ?? 0),
      depositPaid: Number(doc.depositPaid ?? 0),
      total: Number(doc.total ?? 0),
      jobName: job.name,
      terms: doc.termsSnapshot ?? null,
    });
  };

  // Sticky-bar action dispatcher. One entry point so the bar's children
  // stay dumb — every CTA just reports its id, we resolve the side-effect
  // here against the store / nav / sheet state.
  const handleJobAction = async (id: JobActionId) => {
    try {
      setPendingAction(id);
      switch (id) {
        case 'createQuote':
          navigation.navigate('NewJob', { jobId: job.id });
          break;
        case 'continueQuote':
          if (actionableDoc) {
            if (isUnfinishedDraftQuote(actionableDoc)) {
              // Resume the wizard at the exact step the tradie left —
              // same behaviour as the dashboard's draft banner. No
              // `editing` param: this is a continuation, not an edit.
              setCurrentQuote(documentToQuote(actionableDoc));
              navigation.navigate('NewJob', { screen: actionableDoc.draftStep });
            } else {
              openEditorForDoc(actionableDoc, 'materials');
            }
          }
          break;
        case 'editQuote':
          if (actionableDoc) {
            // Jump straight into the scope editor (materials). For
            // drafts the user likely wants to tweak the price; for
            // accepted docs they may want to revise before resend.
            // Either way materials is the right landing step.
            openEditorForDoc(actionableDoc, 'materials');
          }
          break;
        case 'sendQuote':
        case 'resendQuote':
        case 'sendInvoice':
        case 'resendInvoice':
          // Open the shared send dialog as a modal stack *over* the Job
          // screen — no navigation away.
          if (actionableDoc) setSendDialogDoc(actionableDoc);
          break;
        case 'markApproved':
          if (actionableDoc && actionableDoc.type === 'quote') {
            await applyStageChange(actionableDoc, 'quote_accepted', {
              saveQuote,
              saveInvoice,
              createInvoiceFromQuote,
              navigation,
            });
          }
          await saveJob({ ...job, stage: 'accepted' });
          // Quote accepted (not via the tap-to-pay flow, which leads straight
          // into payment) — opportunistic store-review ask, rate-limited and
          // time-boxed so it can't hold the sticky bar's spinner offline. A
          // true means the OS prompt was REQUESTED (the OS decides whether it
          // draws it), which is enough to stand the job-won sheet down for this
          // win rather than risk stacking two sheets.
          {
            const reviewShown = await maybeRequestReview('quote_accepted').catch(() => false);
            if (actionableDoc && actionableDoc.type === 'quote') {
              await offerWonPrompt(actionableDoc, reviewShown);
            }
          }
          break;
        case 'takeDeposit':
          if (actionableDoc && actionableDoc.type === 'quote') {
            openTakePaymentForDoc(actionableDoc);
          }
          break;
        case 'tapToPayDraft':
          // In-person approval path: the customer is here, about to tap.
          // Flip the quote + job forward BEFORE opening the sheet so the
          // state is consistent regardless of whether the tap succeeds.
          // (If they back out, the tradie can revert via the stage sheet.)
          if (actionableDoc && actionableDoc.type === 'quote') {
            // Guard before the stage flip — if Square isn't connected,
            // route to settings instead of accepting a quote we can't
            // collect on.
            if (!(await ensureSquareConnectedForPayment(navigation))) break;
            await applyStageChange(actionableDoc, 'quote_accepted', {
              saveQuote,
              saveInvoice,
              createInvoiceFromQuote,
              navigation,
            });
            await saveJob({ ...job, stage: 'accepted' });
            openTakePaymentForDoc(actionableDoc);
          }
          break;
        case 'followUpQuote':
        case 'followUpInvoice':
          if (actionableDoc) {
            setFollowUpState({
              doc: actionableDoc,
              tone: computeFollowUpTone(actionableDoc),
            });
          }
          break;
        case 'recordPayment':
          if (actionableDoc && actionableDoc.type === 'invoice') {
            navigation.navigate('RecordPayment', { invoiceId: actionableDoc.id });
          }
          break;
        case 'schedule':
          setScheduleSheetVisible(true);
          break;
        case 'startJob':
          await saveJob({
            ...job,
            stage: 'in_progress',
            actualStartDate: job.actualStartDate ?? Date.now(),
          });
          break;
        case 'generateInvoice':
          if (actionableDoc && actionableDoc.type === 'quote') {
            await applyStageChange(actionableDoc, 'invoice_sent', {
              saveQuote,
              saveInvoice,
              createInvoiceFromQuote,
              navigation,
            });
          }
          break;
        case 'markComplete':
          await saveJob({
            ...job,
            stage: 'completed',
            completedDate: job.completedDate ?? Date.now(),
          });
          break;
        case 'takeFinalPayment':
          if (actionableDoc && actionableDoc.type === 'invoice') {
            openTakePaymentForDoc(actionableDoc);
          }
          break;
        case 'closeJob':
          await saveJob({
            ...job,
            stage: 'closed',
            archivedAt: job.archivedAt ?? Date.now(),
          });
          break;
      }
    } catch {
      showAlert({
        type: 'error',
        title: 'Something went wrong',
        message: "That didn't go through. Try again?",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleArchive = () => {
    showAlert({
      type: 'warning',
      title: 'Archive job?',
      message: 'Archived jobs move to the Archived filter.',
      primaryButtonText: 'Archive',
      primaryButtonAction: async () => {
        await saveJob({ ...job, archivedAt: Date.now() });
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: () => {},
    });
  };

  const handleDuplicate = () => {
    showAlert({
      type: 'info',
      title: 'Duplicate this job?',
      message:
        'Customer details, scope, and checklist get copied into a new Accepted job. Schedule, photos, and money state reset. Handy for recurring cleans or repeat fences.',
      primaryButtonText: 'Duplicate',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          // Create the cloned job first (without a primary doc), then
          // clone the doc into it, then patch the job with the new
          // doc id. Two-step so the trigger's aggregate recomputation
          // has a valid job to target.
          const clonedJob = await duplicateJob(job.id);
          if (primaryDoc) {
            const clonedDoc = await duplicateDocumentForJob(
              primaryDoc.id,
              clonedJob.id,
            );
            await saveJob({
              ...clonedJob,
              primaryDocumentId: clonedDoc.id,
              documentIds: [clonedDoc.id],
            });
          }
          navigation.replace('ViewJob', { jobId: clonedJob.id });
        } catch (e) {
          showAlert({
            type: 'error',
            title: 'Duplicate failed',
            message: 'Try again in a moment.',
          });
        }
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: () => {},
    });
  };

  const handleDelete = () => {
    // Money firewall: a paid / partially-paid invoice is an accounting
    // record. Refuse delete and steer the tradie to Archive.
    const paidDocs = pickPaidDocs(attachedDocs);
    if (paidDocs.length > 0) {
      showAlert({
        type: 'warning',
        title: 'Can’t delete — paid invoice attached',
        message:
          'This job has paid or partially-paid documents that belong in your records. Archive the job instead.',
      });
      return;
    }
    const docCount = attachedDocs.length;
    const message =
      docCount === 0
        ? 'This cannot be undone.'
        : `This will also delete ${docCount} attached ${docCount === 1 ? 'document' : 'documents'}. This cannot be undone.`;
    showAlert({
      type: 'error',
      title: 'Delete job?',
      message,
      primaryButtonText: 'Delete',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          await cascadeDeleteJob(job, attachedDocs, {
            deleteQuote,
            deleteInvoice,
            deleteJob,
          });
          navigation.goBack();
        } catch {
          showAlert({
            type: 'error',
            title: 'Delete failed',
            message: 'Try again in a moment.',
          });
        }
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: () => {},
    });
  };

  const handleDocRecordPayment = (doc: Document) => {
    navigation.navigate('RecordPayment', { invoiceId: doc.id });
  };

  // Dispatcher for the Actions sheet (the three-dot kebab in the nav
  // header). Reuses the same JobAction set as JobCard's kebab so the
  // mental model is identical from both entry points.
  const handleActionSelect = async (action: JobAction) => {
    setActionsSheetVisible(false);
    switch (action) {
      case 'recordPayment':
        if (primaryDoc) {
          navigation.navigate('RecordPayment', { invoiceId: primaryDoc.id });
        }
        break;
      case 'takePayment':
        if (primaryDoc) {
          openTakePaymentForDoc(primaryDoc);
        }
        break;
      case 'convertToInvoice':
        if (primaryDoc && primaryDoc.type === 'quote') {
          handleConvertToInvoice(primaryDoc);
        }
        break;
      case 'followUp':
        if (primaryDoc) {
          setFollowUpState({
            doc: primaryDoc,
            tone: computeFollowUpTone(primaryDoc),
          });
        }
        break;
      case 'edit':
        if (primaryDoc) openEditorForDoc(primaryDoc, 'materials');
        break;
      case 'send':
        if (primaryDoc) setSendDialogDoc(primaryDoc);
        break;
      case 'duplicate':
        handleDuplicate();
        break;
      case 'service_report':
        if (canUseServiceReports(getEffectivePlan())) {
          // Resume an unfinished draft instead of minting a duplicate report;
          // a sent (or absent) newest report means a genuinely new visit.
          const reportId = resumableReportId(
            await reportService.listReports(job.id),
          );
          navigation.navigate('ServiceReport', {
            jobId: job.id,
            ...(reportId ? { reportId } : {}),
          });
        } else {
          navigation.navigate('Paywall', { source: 'view_job' });
        }
        break;
      case 'exportPdf':
        if (primaryDoc) {
          try {
            await exportDocumentPDF(primaryDoc, businessSettings, 'export', {
              isPro,
            });
          } catch {
            showAlert({
              type: 'error',
              title: 'Export failed',
              message: 'Try again in a moment.',
            });
          }
        }
        break;
      case 'pushToXero':
        if (primaryDoc?.type === 'invoice') {
          try {
            await pushInvoiceToXero(documentToInvoice(primaryDoc));
            showAlert({
              type: 'success',
              title: 'Pushed to Xero',
              message: 'Invoice synced successfully.',
            });
          } catch (e: any) {
            showAlert({
              type: 'error',
              title: 'Xero sync failed',
              message: e?.message ?? 'Try again in a moment.',
            });
          }
        }
        break;
      case 'archive':
        handleArchive();
        break;
      case 'unarchive':
        await saveJob({ ...job, archivedAt: undefined });
        break;
      case 'delete':
        handleDelete();
        break;
    }
  };


  // The ONE way to enter the scope/materials/labor editor. Seeds the
  // wizard's `currentQuote` / `currentInvoice` with this doc (the
  // wizard screens read off those store slots, not route params), then
  // navigates into the nested NewJob / NewInvoice stack at the
  // chosen step. Called from: doc row tap, sticky-bar Edit button, and
  // the kebab's Edit row.
  type WizardStep = 'customer' | 'job' | 'materials' | 'labor';
  const QUOTE_STEP_MAP: Record<WizardStep, string> = {
    customer: 'CustomerDetails',
    job: 'Details',
    materials: 'MaterialsList',
    labor: 'LaborMarkup',
  };
  const INVOICE_STEP_MAP: Record<Exclude<WizardStep, 'customer' | 'job'>, string> = {
    materials: 'MaterialsList',
    labor: 'LaborMarkup',
  };
  const openEditorForDoc = (doc: Document, step: WizardStep = 'materials') => {
    if (doc.type === 'invoice') {
      const invoice = documentToInvoice(doc);
      setCurrentInvoice(invoice);
      const target =
        step === 'materials' || step === 'labor'
          ? INVOICE_STEP_MAP[step]
          : 'MaterialsList';
      navigation.navigate('NewInvoice', {
        screen: target,
        params: { editing: true },
      });
      return;
    }
    const quote = documentToQuote(doc);
    setCurrentQuote(quote);
    navigation.navigate('NewJob', {
      screen: QUOTE_STEP_MAP[step],
      params: { editing: true },
    });
  };

  // Customer edit lives in the wizard's CustomerDetails step — one
  // editor surface, not two. If there's a primary doc we seed it
  // with that doc's customer fields; otherwise we kick the tradie
  // into a fresh quote with the job's customer carried across.
  const openCustomerEditor = () => {
    selectionTap();
    if (primaryDoc) {
      openEditorForDoc(primaryDoc, 'customer');
      return;
    }
    navigation.navigate('NewJob', {
      screen: 'CustomerDetails',
      params: { jobId: job.id, editing: true },
    });
  };

  const handleDocStageSelect = async (target: DocumentStage) => {
    if (!docStageSheetDoc) return;
    const doc = docStageSheetDoc;
    setDocStageSheetDoc(null);
    if (target === 'invoice_sent' && doc.type === 'quote' && !isPro) {
      navigation.navigate('Paywall', { source: 'view_job' });
      return;
    }
    try {
      await applyStageChange(doc, target, {
        saveQuote,
        saveInvoice,
        createInvoiceFromQuote,
        navigation,
      });
    } catch {
      showAlert({
        type: 'error',
        title: 'Stage update failed',
        message: 'Something went wrong updating the stage. Please try again.',
      });
      return;
    }
    // Same win as markApproved, reached from the document's own stage sheet.
    if (target === 'quote_accepted' && doc.type === 'quote' && doc.stage !== 'quote_accepted') {
      await offerWonPrompt(doc, false);
    }
  };

  // A silent SMS / Share / Export send moved the doc to its sent stage.
  // Surface a Snackbar so the tradie sees the state change and can undo it
  // (covers Android share-cancel / SMS-composer abandon marking sent falsely).
  const handleMarkedSent = (doc: Document) => {
    setMarkedSentDocId(doc.id);
  };

  const handleUndoMarkedSent = async () => {
    const docId = markedSentDocId;
    setMarkedSentDocId(null);
    if (!docId) return;
    // Rewind via the same path the StageSheet uses for a sent→draft downgrade.
    // Look up the freshly-sent doc so its stamped sentAt/sendMethod ride along
    // (undo restores only the stage/status; the audit fields stay).
    const current = documents.find((d) => d.id === docId);
    if (!current) return;
    try {
      await applyStageChange(current, 'draft', {
        saveQuote,
        saveInvoice,
        createInvoiceFromQuote,
        navigation,
      });
    } catch {
      showAlert({
        type: 'error',
        title: 'Undo failed',
        message: 'Something went wrong. Please try again.',
      });
    }
  };

  const customerIsUnknown =
    !job.customerName || job.customerName.trim() === '' || job.customerName === 'Unknown customer';

  // Execution stages (post-approval) prioritise schedule + checklist up
  // top; admin stages (pre-approval or final) lead with the documents.
  const executionFocus =
    job.stage === 'scheduled' ||
    job.stage === 'in_progress' ||
    job.stage === 'completed';

  return (
    <View style={styles.container}>
      <GridBackground />
      {/* NestableScrollContainer lets the JobChecklist's DraggableFlatList
          sit inline without fighting the outer scroll on native. On web
          it behaves as a regular scroll view. */}
      <NestableScrollContainer contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <JobDetailHeader
            job={job}
            documents={attachedDocs}
            customerIsUnknown={customerIsUnknown}
            completedAt={completedAt}
            onCustomerEdit={openCustomerEditor}
            onMenu={() => setActionsSheetVisible(true)}
            onStagePress={() => setStageSheetVisible(true)}
            onJobEdit={() => {
              if (primaryDoc) {
                openEditorForDoc(primaryDoc, 'job');
                return;
              }
              navigation.navigate('NewJob', {
                screen: 'Details',
                params: { jobId: job.id, editing: true },
              });
            }}
          />
        </WebContainer>

        {/* Scope section — inline editor for the primary doc's guts.
            Tap a subsection → jump into that wizard step. Replaces the
            old DocumentRow + separate ViewQuote/ViewInvoice dance. */}
        {!executionFocus ? (
          <ScopeBlock
            primaryDoc={primaryDoc ?? null}
            secondaryDocs={attachedDocs.filter((d) => d.id !== primaryDoc?.id)}
            onEdit={openEditorForDoc}
            onStagePress={setDocStageSheetDoc}
            onPaymentPress={handlePaymentChipPress}
            onConvertToInvoice={handleConvertToInvoice}
            jobIsPaid={job.stage === 'paid'}
            extra={<>{serviceReportRows}{reeceOrderEntry}</>}
          />
        ) : null}

        {/* Schedule lives inside the JobDetailHeader chip strip now —
            no separate middle block. */}

        {/* Checklist hidden for now — feedback is that ViewJob is
            already dense. Bring back behind a tap-to-expand when we
            have a clearer signal that cleaners want it on this screen. */}

        {/* Scope dropped to below schedule + checklist when the job is
            in execution mode (scheduling / working / completing). */}
        {executionFocus ? (
          <ScopeBlock
            primaryDoc={primaryDoc ?? null}
            secondaryDocs={attachedDocs.filter((d) => d.id !== primaryDoc?.id)}
            onEdit={openEditorForDoc}
            onStagePress={setDocStageSheetDoc}
            onPaymentPress={handlePaymentChipPress}
            onConvertToInvoice={handleConvertToInvoice}
            jobIsPaid={job.stage === 'paid'}
            extra={<>{serviceReportRows}{reeceOrderEntry}</>}
          />
        ) : null}

        <WebContainer>
          <JobPhotoStrip job={job} documents={attachedDocs} />
        </WebContainer>

        {/* Notes hidden for now — same rationale as the checklist
            above. Data still persists on the Job; just no surface
            here until we have a better place for it. */}

        {/* Activity log lives inside the JobDetailHeader card now —
            tap the bottom stage stepper to expand it inline. */}

      </NestableScrollContainer>

      <JobActionsSheet
        visible={actionsSheetVisible}
        onDismiss={() => setActionsSheetVisible(false)}
        job={job}
        primaryDoc={primaryDoc ?? null}
        xeroConnected={!!xeroConnection}
        onSelect={handleActionSelect}
      />

      <StickyJobActionBar
        job={job}
        primaryDoc={primaryDoc ?? null}
        onAction={handleJobAction}
        pending={pendingAction}
      />

      <JobStageSheet
        visible={stageSheetVisible}
        onDismiss={() => setStageSheetVisible(false)}
        job={job}
        primaryDoc={primaryDoc}
        depositPaid={depositHasBeenPaid(primaryDoc)}
        onSelect={handleStageSelect}
        onSchedule={() => {
          setStageSheetVisible(false);
          setScheduleSheetVisible(true);
        }}
      />

      {docStageSheetDoc ? (
        <StageSheet
          visible={true}
          onDismiss={() => setDocStageSheetDoc(null)}
          doc={docStageSheetDoc}
          onSelect={handleDocStageSelect}
        />
      ) : null}

      {paymentSheetDoc ? (
        <PaymentSheet
          visible={true}
          onDismiss={() => setPaymentSheetDoc(null)}
          doc={paymentSheetDoc}
          onRecordPayment={handleDocRecordPayment}
          onEditPayment={(d, payment) => {
            setPaymentSheetDoc(null);
            navigation.navigate('RecordPayment', {
              invoiceId: d.id,
              paymentId: payment.id,
            });
          }}
        />
      ) : null}

      <ScheduleJobSheet
        visible={scheduleSheetVisible}
        onDismiss={() => setScheduleSheetVisible(false)}
        job={job}
      />

      <TakePaymentSheet
        visible={!!takePaymentTarget}
        target={takePaymentTarget}
        onDismiss={() => setTakePaymentTarget(null)}
        onError={(message) =>
          showAlert({ type: 'error', title: paymentCopy.paymentErrorTitle, message })
        }
        onSuccess={(info) => showAlert(cardChargeSuccessAlert(info))}
        onRecordManualPayment={(invoiceId) =>
          navigation.navigate('RecordPayment', { invoiceId })
        }
        ensureSquareConnected={() => ensureSquareConnectedForPayment(navigation)}
      />


      {sendDialogDoc ? (
        <SendDocumentDialog
          visible={!!sendDialogDoc}
          onDismiss={() => setSendDialogDoc(null)}
          doc={sendDialogDoc}
          businessSettings={businessSettings}
          onMarkedSent={handleMarkedSent}
        />
      ) : null}

      {followUpState ? (
        <FollowUpSheet
          visible={!!followUpState}
          onDismiss={() => setFollowUpState(null)}
          doc={followUpState.doc}
          tone={followUpState.tone}
          customerName={job.customerName || ''}
          customerPhone={job.customerPhone}
          customerEmail={job.customerEmail}
          businessName={businessSettings?.businessName || 'us'}
          jobName={job.name || 'the job'}
        />
      ) : null}

      {wonSheetState ? (
        <JobWonSheet
          visible={true}
          onDismiss={() => setWonSheetState(null)}
          name={job.customerName || job.name || 'the job'}
          total={Number(wonSheetState.doc.total)}
          trialDaysRemaining={wonSheetState.trialDaysRemaining}
        />
      ) : null}

      {alertNode}

      <Snackbar
        visible={convertSnackbar}
        onDismiss={() => setConvertSnackbar(false)}
        duration={3000}
      >
        Converted to invoice
      </Snackbar>

      <Snackbar
        visible={!!markedSentDocId}
        onDismiss={() => setMarkedSentDocId(null)}
        duration={6000}
        action={{ label: 'Undo', onPress: handleUndoMarkedSent }}
      >
        Marked as sent
      </Snackbar>

    </View>
  );
}


function SectionTitle({ label }: { label: string }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <Text style={styles.sectionTitle}>{label}</Text>
  );
}

interface ScopeBlockProps {
  primaryDoc: Document | null;
  secondaryDocs: Document[];
  onEdit: (doc: Document, step: ScopeStep) => void;
  onStagePress: (doc: Document) => void;
  onPaymentPress: (doc: Document) => void;
  onConvertToInvoice: (doc: Document) => void;
  /** Optional slot rendered between the primary doc card and the
   *  "Also on this job" section. Used for the Order-from-Reece entry. */
  extra?: React.ReactNode;
  /** The Job's stage reads `paid` — the only record a cash job has of it,
   *  now that the timeline rail speaks about work alone. */
  jobIsPaid?: boolean;
}

function ScopeBlock({
  primaryDoc,
  secondaryDocs,
  onEdit,
  onStagePress,
  onPaymentPress,
  onConvertToInvoice,
  extra,
  jobIsPaid,
}: ScopeBlockProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (!primaryDoc) {
    // No doc yet — the sticky bar already offers "Create Quote". Render
    // an empty-state stub so the section doesn't just vanish. `extra`
    // still renders: a service-visit job can carry reports without ever
    // having a quote, and those must stay reachable from the job.
    return (
      <WebContainer>
        <Card style={styles.emptyDocsCard}>
          <View style={styles.emptyDocs}>
            <MaterialCommunityIcons
              name={'file-plus-outline' as any}
              size={28}
              color={themeColors.textMuted}
            />
            <Text style={styles.emptyDocsText}>
              No quote yet. Create one to set scope and pricing.
            </Text>
          </View>
        </Card>
        {extra}
      </WebContainer>
    );
  }
  return (
    <WebContainer>
      <JobScopeCard
        doc={primaryDoc}
        onEdit={onEdit}
        onStagePress={onStagePress}
        onPaymentPress={onPaymentPress}
        paymentContext={{ jobIsPaid }}
      />
      {extra}
      {secondaryDocs.length > 0 ? (
        <View style={styles.secondaryDocsWrap}>
          <Text style={styles.secondaryDocsLabel}>Also on this job</Text>
          {secondaryDocs.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onView={(d) => onEdit(d, 'materials')}
              onStagePress={onStagePress}
              onPaymentPress={onPaymentPress}
              onConvertToInvoice={
                doc.type === 'quote' ? onConvertToInvoice : undefined
              }
            />
          ))}
        </View>
      ) : null}
    </WebContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg },
  // Extra bottom pad clears the pinned StickyJobActionBar so the last
  // section (danger zone) isn't hidden behind it.
  scrollContent: { paddingBottom: 160 },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  missingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
    marginTop: 12,
  },
  missingText: {
    fontSize: 14,
    color: t.colors.textMuted,
    textAlign: 'center',
  },
  notesAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.border,
  },
  notesAddLabel: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  emptyDocsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
  },
  emptyDocs: {
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyDocsText: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  secondaryDocsWrap: {
    marginTop: 4,
  },
  // Rows inside carry their own horizontal margin (they're DocumentRow-
  // shaped), so this wrapper only spaces the group vertically.
  serviceReportsWrap: {
    marginTop: 4,
  },
  reeceOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.colors.accent,
  },
  reeceOrderButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  reeceOrderButtonSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  secondaryDocsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 20,
    marginBottom: 6,
    marginTop: 4,
  },
  notesCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
    gap: 12,
  },
  notesInput: {
    backgroundColor: t.colors.surfaceRaised,
    minHeight: 80,
  },
  notesSave: {
    alignSelf: 'flex-end',
    borderRadius: 12,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  archiveButton: {
    flex: 1,
    borderRadius: 12,
  },
  deleteButton: {
    borderRadius: 12,
  },
}));
