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
import { StageSheet } from '../components/StageSheet';
import { JobStageSheet, JOB_STAGE_META } from '../components/JobStageSheet';
import {
  crossesContractLine,
  depositHasBeenPaid,
} from '../../shared/job/stage';
import { JobTimeline } from '../components/JobTimeline';
import { JobPhotoStrip } from '../components/JobPhotoStrip';
import { JobChecklist } from '../components/JobChecklist';
import { PaymentSheet } from '../components/PaymentSheet';
import { ScheduleJobSheet } from '../components/ScheduleJobSheet';
import { CustomerEditSheet } from '../components/CustomerEditSheet';
import {
  StickyJobActionBar,
  pickPrimaryDoc,
  type JobActionId,
} from '../components/StickyJobActionBar';
import { TakePaymentSheet, type TakePaymentTarget } from '../components/TakePaymentSheet';
import { SendDocumentDialog } from '../components/SendDocumentDialog';
import { FollowUpSheet, type FollowUpTone } from '../components/FollowUpSheet';
import type { Document, DocumentStage } from '../types/document';
import { applyStageChange } from '../utils/applyStageChange';
import {
  formatScheduledDateLong,
  formatScheduledDateTime,
  formatScheduledDuration,
} from '../utils/formatSchedule';
import { deriveDuration } from '../utils/deriveDuration';
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
  } = useStore();
  const duplicateJob = useJobStore((s) => s.duplicateJob);

  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [stageSheetVisible, setStageSheetVisible] = useState(false);
  const [docStageSheetDoc, setDocStageSheetDoc] = useState<Document | null>(null);
  const [paymentSheetDoc, setPaymentSheetDoc] = useState<Document | null>(null);
  const [scheduleSheetVisible, setScheduleSheetVisible] = useState(false);
  const [customerSheetVisible, setCustomerSheetVisible] = useState(false);
  const [takePaymentTarget, setTakePaymentTarget] = useState<TakePaymentTarget | null>(null);
  const [sendDialogDoc, setSendDialogDoc] = useState<Document | null>(null);
  const [followUpState, setFollowUpState] = useState<{
    doc: Document;
    tone: FollowUpTone;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<JobActionId | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
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
  const { durationDays, hoursPerDay } = deriveDuration(primaryDoc);
  const scheduled = formatScheduledDateTime(job.scheduledStartDate);
  const duration =
    scheduled && (durationDays > 1 || hoursPerDay !== 8)
      ? formatScheduledDuration(durationDays, hoursPerDay)
      : null;
  const scheduledFull =
    scheduled && duration ? `${scheduled} · ${duration}` : scheduled;
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
    } catch {
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
          navigation.navigate('NewQuote', { jobId: job.id });
          break;
        case 'continueQuote':
        case 'editQuote':
          if (actionableDoc) {
            // Jump straight into the editor — one hop, not via preview.
            navigation.navigate('NewQuote', {
              jobId: job.id,
              quoteId: actionableDoc.id,
            });
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

  // Document-row handlers — mirror DocumentsListScreen so the cards behave
  // the same as on the list.
  const handleDocView = (doc: Document) => {
    if (doc.type === 'invoice') {
      navigation.navigate('ViewInvoice', { invoiceId: doc.id });
    } else {
      navigation.navigate('ViewQuote', { quoteId: doc.id });
    }
  };

  const handleDocRecordPayment = (doc: Document) => {
    navigation.navigate('RecordPayment', { invoiceId: doc.id });
  };

  // Envelope quick-action on a doc row — open the shared send dialog
  // inline, same flow the sticky bar triggers. No navigation away.
  const handleDocSend = (doc: Document) => {
    setSendDialogDoc(doc);
  };

  // Card quick-action — open the shared Square sheet (tap-to-pay + share
  // pay-link). Quote docs flow through the deposit path, invoices
  // through the full-balance path.
  const handleDocTakePayment = (doc: Document) => {
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

  const openMaps = () => {
    const addr = (job.jobAddress || '').trim();
    if (!addr) return;
    selectionTap();
    // Apple Maps on iOS, generic Google Maps elsewhere. Both fall through
    // to the platform's native handler via Linking.
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${encodeURIComponent(addr)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Maps", 'Try copying the address instead.');
    });
  };

  const openTel = () => {
    const phone = (job.customerPhone || '').trim();
    if (!phone) return;
    selectionTap();
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() => {});
  };

  const openSms = () => {
    const phone = (job.customerPhone || '').trim();
    if (!phone) return;
    selectionTap();
    Linking.openURL(`sms:${phone.replace(/\s+/g, '')}`).catch(() => {});
  };

  const customerIsUnknown =
    !job.customerName || job.customerName.trim() === '' || job.customerName === 'Unknown customer';

  const stageBanner = deriveStageBanner(job, primaryDoc);
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
        {/* Stage banner: the single most-relevant status line. Lives at
            the very top so it reads before the tradie does anything
            else. Color-coded to the phase (info/warning/success/error). */}
        {stageBanner ? (
          <WebContainer>
            <View
              style={[styles.stageBanner, { backgroundColor: stageBanner.tint }]}
            >
              <MaterialCommunityIcons
                name={stageBanner.icon as any}
                size={18}
                color={stageBanner.accent}
              />
              <Text style={[styles.stageBannerText, { color: stageBanner.accent }]}>
                {stageBanner.label}
              </Text>
            </View>
          </WebContainer>
        ) : null}

        <WebContainer>
          <Card style={styles.headerCard}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobName}>{job.name || 'Untitled job'}</Text>

                {customerIsUnknown ? (
                  <Pressable
                    onPress={() => {
                      selectionTap();
                      setCustomerSheetVisible(true);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.assignCustomer,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={'account-plus-outline' as any}
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={styles.assignCustomerLabel}>Add customer details</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      selectionTap();
                      setCustomerSheetVisible(true);
                    }}
                    hitSlop={4}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.customerLine}>{job.customerName}</Text>
                  </Pressable>
                )}

                {job.jobAddress ? (
                  <Pressable
                    onPress={openMaps}
                    style={({ pressed }) => [styles.inlineRow, pressed && { opacity: 0.6 }]}
                  >
                    <MaterialCommunityIcons
                      name="map-marker-outline"
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={[styles.inlineText, styles.inlineLink]} numberOfLines={2}>
                      {job.jobAddress}
                    </Text>
                  </Pressable>
                ) : null}

                {job.customerPhone ? (
                  <View style={styles.contactRow}>
                    <Pressable
                      onPress={openTel}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.contactButton,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={'phone-outline' as any}
                        size={14}
                        color={colors.primary}
                      />
                      <Text style={styles.contactButtonLabel}>Call</Text>
                    </Pressable>
                    <Pressable
                      onPress={openSms}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.contactButton,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={'message-text-outline' as any}
                        size={14}
                        color={colors.primary}
                      />
                      <Text style={styles.contactButtonLabel}>Text</Text>
                    </Pressable>
                    <Text style={styles.contactNumber} numberOfLines={1}>
                      {job.customerPhone}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Pressable
                onPress={() => {
                  selectionTap();
                  setStageSheetVisible(true);
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.stageChip,
                  { backgroundColor: meta.bgColor, borderColor: meta.color + '55' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <MaterialCommunityIcons
                  name={meta.icon as any}
                  size={14}
                  color={meta.color}
                />
                <Text style={[styles.stageLabel, { color: meta.color }]}>
                  {meta.chipLabel}
                </Text>
              </Pressable>
            </View>

            {completedAt ? (
              <View style={styles.completedRow}>
                <MaterialCommunityIcons
                  name="flag-checkered"
                  size={14}
                  color={colors.success}
                />
                <Text style={styles.completedLabel}>Completed</Text>
                <Text style={styles.completedValue}>{completedAt}</Text>
              </View>
            ) : null}
          </Card>
        </WebContainer>

        {/* Money block — prominent, directly under the customer so the
            contractor sees where the dollars stand at a glance. */}
        <WebContainer>
          <Card style={styles.moneyCard}>
            <View style={styles.totalsRow}>
              <Totals label="Quoted" value={job.totalQuoted} />
              <Totals label="Invoiced" value={job.totalInvoiced} />
              <Totals label="Paid" value={job.totalPaid} />
              <Totals
                label="Balance"
                value={job.balanceDue}
                accent={job.balanceDue > 0}
              />
            </View>
          </Card>
        </WebContainer>

        {/* Documents section — rendered inline as DocumentRows with
            quick-action icons (envelope, card). */}
        {!executionFocus ? (
          <DocsSection
            attachedDocs={attachedDocs}
            onView={handleDocView}
            onStagePress={setDocStageSheetDoc}
            onPaymentPress={setPaymentSheetDoc}
            onSend={handleDocSend}
            onTakePayment={handleDocTakePayment}
          />
        ) : null}

        {/* Schedule card — hidden when there's no primary doc yet (no
            point scheduling work that isn't quoted); otherwise shown with
            active styling once a date is set. */}
        {primaryDoc ? (
          <WebContainer>
            <Pressable
              onPress={() => {
                selectionTap();
                setScheduleSheetVisible(true);
              }}
              style={({ pressed }) => [
                styles.scheduleCard,
                scheduled && styles.scheduleCardSet,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View
                style={[
                  styles.scheduleIconWrap,
                  scheduled ? styles.scheduleIconWrapSet : styles.scheduleIconWrapUnset,
                ]}
              >
                <MaterialCommunityIcons
                  name={scheduled ? ('calendar-clock' as any) : ('calendar-plus' as any)}
                  size={20}
                  color={scheduled ? colors.primary : colors.textMuted}
                />
              </View>
              <View style={styles.scheduleBody}>
                <Text style={styles.scheduleHeadline}>
                  {scheduled ? 'Scheduled' : 'Schedule this job'}
                </Text>
                <Text
                  style={[
                    styles.scheduleDetail,
                    !scheduled && { color: colors.textMuted },
                  ]}
                  numberOfLines={2}
                >
                  {scheduledFull || 'Pick a day and start time.'}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={'chevron-right' as any}
                size={22}
                color={colors.inactive}
              />
            </Pressable>
          </WebContainer>
        ) : null}

        {/* Checklist — only meaningful once there's approved work. Hidden
            for pre-approval stages to keep the screen focused. */}
        {executionFocus || job.stage === 'accepted' || job.stage === 'paid' ? (
          <WebContainer>
            <JobChecklist job={job} />
          </WebContainer>
        ) : null}

        {/* Docs dropped to below schedule + checklist when the job is in
            execution mode (scheduling / working / completing). */}
        {executionFocus ? (
          <DocsSection
            attachedDocs={attachedDocs}
            onView={handleDocView}
            onStagePress={setDocStageSheetDoc}
            onPaymentPress={setPaymentSheetDoc}
            onSend={handleDocSend}
            onTakePayment={handleDocTakePayment}
          />
        ) : null}

        <WebContainer>
          <JobPhotoStrip job={job} documents={attachedDocs} />
        </WebContainer>

        <WebContainer>
          <SectionTitle label="Notes" />
          {/* Collapsed state: just a tappable "Add notes" row. Once there's
              actual text on the job OR the tradie has explicitly tapped to
              edit, the full TextInput + Save button render. Keeps the
              detail view uncluttered for the common no-notes case. */}
          {!notesEditing && !notesDraft.trim() ? (
            <Pressable
              onPress={() => {
                selectionTap();
                setNotesEditing(true);
              }}
              style={({ pressed }) => [
                styles.notesAddButton,
                pressed && { opacity: 0.85 },
              ]}
            >
              <MaterialCommunityIcons
                name={'note-plus-outline' as any}
                size={18}
                color={colors.textMuted}
              />
              <Text style={styles.notesAddLabel}>Add notes</Text>
            </Pressable>
          ) : (
            <Card style={styles.notesCard}>
              <TextInput
                mode="outlined"
                multiline
                value={notesDraft}
                onChangeText={(text) => {
                  setNotesDraft(text);
                  setNotesDirty(true);
                }}
                placeholder="Internal notes about this job…"
                style={styles.notesInput}
                numberOfLines={4}
                autoFocus={notesEditing && !notesDraft.trim()}
                onBlur={() => {
                  if (!notesDraft.trim() && !notesDirty) setNotesEditing(false);
                }}
              />
              {notesDirty ? (
                <Button mode="contained" onPress={handleNotesSave} style={styles.notesSave}>
                  Save notes
                </Button>
              ) : null}
            </Card>
          )}
        </WebContainer>

        {/* Activity — collapsed by default and pushed near the bottom.
            Historical log, not an action surface, so it doesn't deserve
            top-of-screen real estate. */}
        <WebContainer>
          <Pressable
            onPress={() => {
              selectionTap();
              setTimelineOpen((v) => !v);
            }}
            style={({ pressed }) => [
              styles.activityToggle,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialCommunityIcons
              name={'history' as any}
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.activityToggleLabel}>Activity</Text>
            <MaterialCommunityIcons
              name={(timelineOpen ? 'chevron-up' : 'chevron-down') as any}
              size={18}
              color={colors.textMuted}
            />
          </Pressable>
          {timelineOpen ? <JobTimeline job={job} documents={attachedDocs} /> : null}
        </WebContainer>

        <WebContainer>
          <View style={styles.dangerRow}>
            <Button
              mode="outlined"
              icon={'content-duplicate' as any}
              onPress={() => {
                lightTap();
                handleDuplicate();
              }}
              style={styles.archiveButton}
            >
              Duplicate
            </Button>
            <Button
              mode="outlined"
              icon={'archive-outline' as any}
              onPress={() => {
                lightTap();
                handleArchive();
              }}
              style={styles.archiveButton}
            >
              Archive
            </Button>
            <Button
              mode="text"
              icon={'trash-can-outline' as any}
              onPress={() => {
                lightTap();
                handleDelete();
              }}
              textColor={colors.error}
              style={styles.deleteButton}
              compact
            >
              Delete
            </Button>
          </View>
        </WebContainer>
      </NestableScrollContainer>

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

      <CustomerEditSheet
        visible={customerSheetVisible}
        onDismiss={() => setCustomerSheetVisible(false)}
        job={job}
      />
    </View>
  );
}

interface StageBanner {
  label: string;
  icon: string;
  accent: string;
  tint: string;
}

function deriveStageBanner(job: any, primaryDoc: Document | null | undefined): StageBanner | null {
  const agoFromStamp = (ms?: number) => {
    if (!ms) return null;
    try {
      return formatDistanceToNow(new Date(ms), { addSuffix: true });
    } catch {
      return null;
    }
  };

  // Terminal states: short, final-sounding.
  if (job.stage === 'cancelled') {
    return {
      label: 'Cancelled',
      icon: 'close-octagon-outline',
      accent: colors.error,
      tint: colors.errorBg,
    };
  }
  if (job.stage === 'closed') {
    return {
      label: 'Closed',
      icon: 'archive-outline',
      accent: colors.inactive,
      tint: colors.surfaceGray3,
    };
  }
  if (job.stage === 'paid') {
    return {
      label: 'Paid in full',
      icon: 'cash-check',
      accent: colors.success,
      tint: colors.successBg,
    };
  }

  const depositOwed = !!(
    primaryDoc &&
    primaryDoc.type === 'quote' &&
    (primaryDoc.depositAmount ?? 0) > 0 &&
    (primaryDoc.depositPaid ?? 0) < (primaryDoc.depositAmount ?? 0)
  );

  if (primaryDoc?.type === 'invoice') {
    if (primaryDoc.stage === 'paid') {
      return {
        label: 'Invoice paid',
        icon: 'check-decagram-outline',
        accent: colors.success,
        tint: colors.successBg,
      };
    }
    if (
      primaryDoc.stage === 'invoice_sent' ||
      primaryDoc.stage === 'partially_paid'
    ) {
      const sent = agoFromStamp((primaryDoc as any).sentAt ?? primaryDoc.updatedAt);
      const paid = Number(primaryDoc.paidTotal ?? 0);
      const total = Number(primaryDoc.total ?? 0);
      const balance = Math.max(0, total - paid);
      const label =
        paid > 0
          ? `Partially paid · ${formatCurrency(balance)} outstanding`
          : sent
            ? `Invoice sent ${sent}`
            : 'Invoice awaiting payment';
      return {
        label,
        icon: 'receipt',
        accent: colors.warning,
        tint: colors.warningBg,
      };
    }
    if (primaryDoc.stage === 'draft') {
      return {
        label: 'Invoice draft — send to start getting paid',
        icon: 'file-document-edit-outline',
        accent: colors.info,
        tint: colors.infoBg,
      };
    }
  }

  if (primaryDoc?.type === 'quote') {
    if (primaryDoc.stage === 'quote_sent') {
      const sent = agoFromStamp((primaryDoc as any).sentAt ?? primaryDoc.updatedAt);
      return {
        label: sent ? `Quote sent ${sent}` : 'Quote sent — awaiting approval',
        icon: 'send-outline',
        accent: colors.info,
        tint: colors.infoBg,
      };
    }
    if (primaryDoc.stage === 'quote_accepted') {
      if (depositOwed) {
        return {
          label: 'Approved — take the deposit',
          icon: 'cash-plus',
          accent: colors.warning,
          tint: colors.warningBg,
        };
      }
      if (job.stage === 'scheduled') {
        const scheduled = formatScheduledDateLong(job.scheduledStartDate);
        return {
          label: scheduled ? `Scheduled · ${scheduled}` : 'Scheduled',
          icon: 'calendar-clock',
          accent: colors.success,
          tint: colors.successBg,
        };
      }
      if (job.stage === 'in_progress') {
        const started = agoFromStamp(job.actualStartDate ?? job.inProgressAt);
        return {
          label: started ? `In progress since ${started}` : 'In progress',
          icon: 'hammer-wrench',
          accent: colors.warning,
          tint: colors.warningBg,
        };
      }
      if (job.stage === 'completed') {
        return {
          label: 'Work completed — time to invoice',
          icon: 'flag-checkered',
          accent: colors.success,
          tint: colors.successBg,
        };
      }
      return {
        label: 'Quote approved — let’s schedule',
        icon: 'check-circle-outline',
        accent: colors.success,
        tint: colors.successBg,
      };
    }
    if (primaryDoc.stage === 'quote_rejected') {
      return {
        label: 'Quote rejected',
        icon: 'close-circle-outline',
        accent: colors.error,
        tint: colors.errorBg,
      };
    }
    if (primaryDoc.stage === 'draft') {
      return {
        label: 'Draft quote — finish and send',
        icon: 'file-document-edit-outline',
        accent: colors.info,
        tint: colors.infoBg,
      };
    }
  }

  if (!primaryDoc) {
    return {
      label: 'No quote yet — create one to get started',
      icon: 'file-document-plus-outline',
      accent: colors.primary,
      tint: colors.primaryBg,
    };
  }
  return null;
}

function Totals({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <View style={styles.totalsCell}>
      <Text style={styles.totalsLabel}>{label}</Text>
      <Text
        style={[
          styles.totalsValue,
          accent ? { color: colors.warning } : undefined,
        ]}
      >
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Text style={styles.sectionTitle}>{label}</Text>
  );
}

interface DocsSectionProps {
  attachedDocs: Document[];
  onView: (doc: Document) => void;
  onStagePress: (doc: Document) => void;
  onPaymentPress: (doc: Document) => void;
  onSend: (doc: Document) => void;
  onTakePayment: (doc: Document) => void;
}

function DocsSection({
  attachedDocs,
  onView,
  onStagePress,
  onPaymentPress,
  onSend,
  onTakePayment,
}: DocsSectionProps) {
  return (
    <WebContainer>
      <SectionTitle label={`Documents (${attachedDocs.length})`} />
      {attachedDocs.length === 0 ? (
        <Card style={styles.emptyDocsCard}>
          <View style={styles.emptyDocs}>
            <MaterialCommunityIcons
              name={'file-document-plus-outline' as any}
              size={28}
              color={colors.textMuted}
            />
            <Text style={styles.emptyDocsText}>
              No quotes or invoices attached yet.
            </Text>
          </View>
        </Card>
      ) : (
        attachedDocs.map((doc) => {
          const showCard =
            doc.type === 'invoice' ||
            (doc.type === 'quote' && (doc.depositAmount ?? 0) > 0);
          return (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onView={onView}
              onStagePress={onStagePress}
              onPaymentPress={onPaymentPress}
              onSend={onSend}
              onTakePayment={showCard ? onTakePayment : undefined}
            />
          );
        })
      )}
    </WebContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Extra bottom pad clears the pinned StickyJobActionBar so the last
  // section (danger zone) isn't hidden behind it.
  scrollContent: { paddingBottom: 160 },
  stageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  stageBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  moneyCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  activityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceGray3,
  },
  activityToggleLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
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
  headerCard: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  jobName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  customerLine: {
    fontSize: 14,
    color: colors.onSurface,
    marginTop: 2,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  inlineText: {
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  inlineLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary + '44',
  },
  contactButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  contactNumber: {
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
  },
  stageLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  totalsCell: {
    flex: 1,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  totalsLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalsValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  completedLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  completedValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  assignCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  assignCustomerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scheduleCardSet: {
    borderColor: colors.primary + '55',
    backgroundColor: colors.primaryBg + '22',
  },
  scheduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleIconWrapUnset: {
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  scheduleIconWrapSet: {
    backgroundColor: colors.primaryBg,
  },
  scheduleBody: {
    flex: 1,
    gap: 2,
  },
  scheduleHeadline: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  scheduleDetail: {
    fontSize: 12,
    color: colors.onSurface,
    lineHeight: 16,
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
