/**
 * ViewJobScreen
 *
 * Detail view for a single Job. Shows customer + address + stage, aggregate
 * totals, scheduled dates, attached Documents (rendered as DocumentRows with
 * the Phase-11 two-chip split), notes, and archive/delete actions.
 * Stage chip → JobStageSheet.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Alert, Pressable, Linking, Platform } from 'react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { Text, Card, Button, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { formatDistanceToNow } from 'date-fns';

import type { Job, JobStage } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { WebContainer } from '../components/WebContainer';
import { DocumentRow } from '../components/DocumentRow';
import { JobScopeCard, type ScopeStep } from '../components/JobScopeCard';
import { JobDetailHeader } from '../components/JobDetailHeader';
import { JobActionsSheet, type JobAction } from '../components/JobActionsSheet';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import { StageSheet } from '../components/StageSheet';
import { JobStageSheet, JOB_STAGE_META } from '../components/JobStageSheet';
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
  type JobActionId,
} from '../components/StickyJobActionBar';
import { TakePaymentSheet, type TakePaymentTarget } from '../components/TakePaymentSheet';
import { SendDocumentDialog } from '../components/SendDocumentDialog';
import { FollowUpSheet, type FollowUpTone } from '../components/FollowUpSheet';
import type { Document, DocumentStage } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { applyStageChange } from '../utils/applyStageChange';
import { formatScheduledDateLong } from '../utils/formatSchedule';
import { selectionTap, lightTap } from '../utils/haptics';

export function ViewJobScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId: string = route.params?.jobId;

  const job = useJobStore((s) => s.jobs.find((j) => j.id === jobId));
  const saveJob = useJobStore((s) => s.saveJob);
  const deleteJob = useJobStore((s) => s.deleteJob);

  const {
    documents,
    saveQuote,
    saveInvoice,
    createInvoiceFromQuote,
    subscriptionStatus,
    businessSettings,
    duplicateDocumentForJob,
    setCurrentQuote,
    setCurrentInvoice,
  } = useStore();
  const duplicateJob = useJobStore((s) => s.duplicateJob);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const pushInvoiceToXero = useStore((s) => s.pushInvoiceToXero);

  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

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
  const [pendingAction, setPendingAction] = useState<JobActionId | null>(null);
  const [notesDraft, setNotesDraft] = useState(job?.notes ?? '');
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

  const attachedDocs = useMemo(
    () => documents.filter((d) => d.jobId === jobId),
    [documents, jobId],
  );

  if (!job) {
    return (
      <View style={[styles.container, styles.centered]}>
        <MaterialCommunityIcons
          name={'briefcase-off-outline' as any}
          size={48}
          color={colors.textMuted}
        />
        <Text style={styles.missingTitle}>Job not found</Text>
        <Text style={styles.missingText}>
          It may have been deleted or hasn’t synced yet.
        </Text>
        <Button mode="contained" style={{ marginTop: 20 }} onPress={() => navigation.goBack()}>
          Back
        </Button>
      </View>
    );
  }

  const meta = JOB_STAGE_META[job.stage];
  // Pick the most actionable doc on the job for the sticky bar. Invoices
  // trump quotes once they exist; within a type the most recent wins.
  const actionableDoc = useMemo(() => pickPrimaryDoc(attachedDocs), [attachedDocs]);
  // Duration comes from the primary attached doc's labour rather than
  // duplicate fields on the Job itself. Prefer the explicitly-linked
  // primaryDocumentId when it's still on the job; otherwise fall back to
  // the actionable doc.
  const primaryDoc = job.primaryDocumentId
    ? documents.find((d) => d.id === job.primaryDocumentId) ?? actionableDoc
    : actionableDoc;
  const completedAt = formatScheduledDateLong(job.completedDate);

  const applyStageTransition = async (target: JobStage) => {
    try {
      const patch: Partial<Job> = { stage: target };
      // Coupling: stage backward to 'quoted' should revert the primary
      // doc too so the customer-facing state matches.
      if (
        target === 'quoted' &&
        actionableDoc &&
        actionableDoc.type === 'quote' &&
        actionableDoc.stage === 'quote_accepted'
      ) {
        await applyStageChange(actionableDoc, 'quote_sent', {
          saveQuote,
          saveInvoice,
          createInvoiceFromQuote,
          navigation,
        });
      }
      await saveJob({ ...job, ...patch });
    } catch (err) {
      console.error('[ViewJob] applyStageTransition failed', err);
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
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
      Alert.alert('Heads up', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => applyStageTransition(target) },
      ]);
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

  // Chip tap routing: an unpaid doc with a real total has nothing useful to
  // show in the history sheet, so jump straight to TakePaymentSheet. Anything
  // already paid (or a $0 draft) falls through to the history view.
  const handlePaymentChipPress = (doc: Document) => {
    const state = derivePaymentState(doc);
    if (state === 'unpaid' && Number(doc.total) > 0) {
      openTakePaymentForDoc(doc);
      return;
    }
    setPaymentSheetDoc(doc);
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
      Alert.alert('Error', "That didn't go through. Try again?");
    } finally {
      setPendingAction(null);
    }
  };

  const handleArchive = () => {
    Alert.alert('Archive job?', 'Archived jobs move to the Archived filter.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await saveJob({ ...job, archivedAt: Date.now() });
        },
      },
    ]);
  };

  const handleDuplicate = () => {
    Alert.alert(
      'Duplicate this job?',
      'Customer details, scope, and checklist get copied into a new Accepted job. Schedule, photos, and money state reset. Handy for recurring cleans or repeat fences.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
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
              Alert.alert('Duplicate failed', 'Try again in a moment.');
            }
          },
        },
      ],
    );
  };

  const handleDelete = () => {
    if (attachedDocs.length > 0) {
      Alert.alert(
        'Can’t delete — docs attached',
        'Delete or reassign the attached quotes and invoices first.',
      );
      return;
    }
    Alert.alert('Delete job?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteJob(job.id);
          navigation.goBack();
        },
      },
    ]);
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
      case 'takePayment':
        if (primaryDoc) openTakePaymentForDoc(primaryDoc);
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
      case 'exportPdf':
        if (primaryDoc) {
          try {
            await exportDocumentPDF(primaryDoc, businessSettings, 'export', {
              isPro,
            });
          } catch {
            Alert.alert('Export failed', 'Try again in a moment.');
          }
        }
        break;
      case 'pushToXero':
        if (primaryDoc?.type === 'invoice') {
          try {
            await pushInvoiceToXero(documentToInvoice(primaryDoc));
            Alert.alert('Pushed to Xero', 'Invoice synced successfully.');
          } catch (e: any) {
            Alert.alert('Xero sync failed', e?.message ?? 'Try again in a moment.');
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
      navigation.navigate('Paywall');
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
      Alert.alert('Error', 'Failed to update stage. Please try again.');
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
        onError={(message) => Alert.alert('Payment error', message)}
      />

      {sendDialogDoc ? (
        <SendDocumentDialog
          visible={!!sendDialogDoc}
          onDismiss={() => setSendDialogDoc(null)}
          doc={sendDialogDoc}
          businessSettings={businessSettings}
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

    </View>
  );
}


function SectionTitle({ label }: { label: string }) {
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
}

function ScopeBlock({
  primaryDoc,
  secondaryDocs,
  onEdit,
  onStagePress,
  onPaymentPress,
}: ScopeBlockProps) {
  if (!primaryDoc) {
    // No doc yet — the sticky bar already offers "Create Quote". Render
    // an empty-state stub so the section doesn't just vanish.
    return (
      <WebContainer>
        <Card style={styles.emptyDocsCard}>
          <View style={styles.emptyDocs}>
            <MaterialCommunityIcons
              name={'file-document-plus-outline' as any}
              size={28}
              color={colors.textMuted}
            />
            <Text style={styles.emptyDocsText}>
              No quote yet. Create one to set scope and pricing.
            </Text>
          </View>
        </Card>
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
      />
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
            />
          ))}
        </View>
      ) : null}
    </WebContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
    color: colors.text,
    marginTop: 12,
  },
  missingText: {
    fontSize: 14,
    color: colors.textMuted,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  notesAddLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  emptyDocsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
  },
  emptyDocs: {
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyDocsText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  secondaryDocsWrap: {
    marginTop: 4,
  },
  secondaryDocsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
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
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: 12,
  },
  notesInput: {
    backgroundColor: colors.surface,
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
});
