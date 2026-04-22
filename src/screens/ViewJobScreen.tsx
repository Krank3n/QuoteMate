/**
 * ViewJobScreen
 *
 * Detail view for a single Job. Shows customer + address + stage, aggregate
 * totals, scheduled dates, attached Documents (rendered as DocumentRows with
 * the Phase-11 two-chip split), notes, and archive/delete actions.
 * Stage chip → JobStageSheet.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable, Linking, Platform } from 'react-native';
import { Text, Card, Button, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';

import type { JobStage } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { WebContainer } from '../components/WebContainer';
import { DocumentRow } from '../components/DocumentRow';
import { StageSheet } from '../components/StageSheet';
import { JobStageSheet, JOB_STAGE_META } from '../components/JobStageSheet';
import { JobTimeline } from '../components/JobTimeline';
import { JobPhotoStrip } from '../components/JobPhotoStrip';
import { JobChecklist } from '../components/JobChecklist';
import { PaymentSheet } from '../components/PaymentSheet';
import { ScheduleJobSheet } from '../components/ScheduleJobSheet';
import { CustomerEditSheet } from '../components/CustomerEditSheet';
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
  } = useStore();

  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [stageSheetVisible, setStageSheetVisible] = useState(false);
  const [docStageSheetDoc, setDocStageSheetDoc] = useState<Document | null>(null);
  const [paymentSheetDoc, setPaymentSheetDoc] = useState<Document | null>(null);
  const [scheduleSheetVisible, setScheduleSheetVisible] = useState(false);
  const [customerSheetVisible, setCustomerSheetVisible] = useState(false);
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
  // Duration comes from the primary attached doc's labour rather than
  // duplicate fields on the Job itself.
  const primaryDoc = job.primaryDocumentId
    ? documents.find((d) => d.id === job.primaryDocumentId)
    : documents.find((d) => d.jobId === job.id);
  const { durationDays, hoursPerDay } = deriveDuration(primaryDoc);
  const scheduled = formatScheduledDateTime(job.scheduledStartDate);
  const duration =
    scheduled && (durationDays > 1 || hoursPerDay !== 8)
      ? formatScheduledDuration(durationDays, hoursPerDay)
      : null;
  const scheduledFull =
    scheduled && duration ? `${scheduled} · ${duration}` : scheduled;
  const completedAt = formatScheduledDateLong(job.completedDate);

  const handleStageSelect = async (target: JobStage) => {
    setStageSheetVisible(false);
    // UI is flexible — any stage jump is allowed. The shared state machine
    // is enforced server-side for correctness (future phase), not here.
    try {
      await saveJob({ ...job, stage: target });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
  };

  const handleNotesSave = async () => {
    if (!notesDirty) return;
    await saveJob({ ...job, notes: notesDraft });
    setNotesDirty(false);
    // If they saved an empty string, collapse back to the "Add notes" CTA
    // so the screen stays tidy.
    if (!notesDraft.trim()) setNotesEditing(false);
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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

        {/* Standalone Schedule card — full-width tappable block with clear
            affordance. Tap anywhere to open the schedule sheet. */}
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
                {scheduledFull || 'Pick a day, a start time, and we’ll size the GCal event for you.'}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={'chevron-right' as any}
              size={22}
              color={colors.inactive}
            />
          </Pressable>
        </WebContainer>

        <WebContainer>
          <JobTimeline job={job} documents={attachedDocs} />
        </WebContainer>

        <WebContainer>
          <JobPhotoStrip job={job} documents={attachedDocs} />
        </WebContainer>

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
            attachedDocs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onView={handleDocView}
                onStagePress={setDocStageSheetDoc}
                onPaymentPress={setPaymentSheetDoc}
              />
            ))
          )}
        </WebContainer>

        <WebContainer>
          <JobChecklist job={job} />
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

        <WebContainer>
          <View style={styles.dangerRow}>
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
      </ScrollView>

      <JobStageSheet
        visible={stageSheetVisible}
        onDismiss={() => setStageSheetVisible(false)}
        job={job}
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

      <CustomerEditSheet
        visible={customerSheetVisible}
        onDismiss={() => setCustomerSheetVisible(false)}
        job={job}
      />
    </View>
  );
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 96 },
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
