/**
 * ServiceReportScreen
 *
 * Capture screen for a Service Report — the customer-facing leave-behind a
 * tradie fills in after a service visit. Route params: { jobId, reportId? }.
 *
 * Pulls the customer + address off the linked Job (read-only here), then lets
 * the tradie set the visit date, service type and risk assessment; manage a
 * short equipment list and a tick-box checklist (Mate NEVER pre-ticks — every
 * tick is a manual tap); jot rough notes into the three narrative fields and
 * tap "Write it up" to have Mate tidy them into customer-ready prose; attach
 * photos; and capture technician + customer signatures. Save persists via
 * reportService; "Export / Share" renders the PDF via exportReportPDF.
 *
 * Copy here is Australian English, gender-neutral, and never says the two-letter
 * word for the assistant — it is "Mate". Nothing on this screen or the exported
 * PDF shows app branding; the customer sees only the tradie's business name.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text, TextInput, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Calendar } from 'react-native-calendars';
import { useNavigation, useRoute } from '@react-navigation/native';
import { format } from 'date-fns';

import { useJobStore } from '../../store/useJobStore';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { JobPhotos } from '../../components/JobPhotos';
import { SignaturePad, type SignaturePadSize } from '../../components/SignaturePad';
import { useAlertModal } from '../../hooks/useAlertModal';
import { generateId } from '../../utils/generateId';
import { getTradeCategoryById } from '../../constants/tradeCategories';
import { reportService } from '../../services/reportService';
import { composeServiceReport } from '../../services/reportComposeService';
import { exportReportPDF } from '../../utils/pdfGenerator';
import type { QuotePhoto } from '../../types';
import type { JobPhoto } from '../../../shared/job/types';
import type { ServiceReport, SignatureCapture } from '../../../shared/report/types';
import {
  buildInitialReportForm,
  buildReportInput,
  deriveReportContext,
  formFromReport,
  latestTechnicianSignature,
  type ReportFormState,
} from './reportDraft';

export function ServiceReportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId: string = route.params?.jobId;
  const routeReportId: string | undefined = route.params?.reportId;

  const job = useJobStore((s) => s.jobs.find((j) => j.id === jobId));
  const jobsLoaded = useJobStore((s) => s.jobsLoaded);
  const businessSettings = useStore((s) => s.businessSettings);
  const { showAlert, alertNode } = useAlertModal();

  // Editable form state. Seeded empty from the job; hydrated from an existing
  // report in edit mode once it loads.
  const [form, setForm] = useState<ReportFormState | null>(null);
  // Persisted identity — set once the report is created or loaded. Carries the
  // number / createdAt the PDF needs so re-saves don't remint them.
  const [meta, setMeta] = useState<Pick<
    ServiceReport,
    'id' | 'number' | 'status' | 'createdAt'
  > | null>(null);

  const [showCalendar, setShowCalendar] = useState(false);
  const [techSigName, setTechSigName] = useState('');
  const [techSigPath, setTechSigPath] = useState('');
  const [techSigSize, setTechSigSize] = useState<SignaturePadSize | null>(null);
  const [custSigName, setCustSigName] = useState('');
  const [custSigPath, setCustSigPath] = useState('');
  const [custSigSize, setCustSigSize] = useState<SignaturePadSize | null>(null);

  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Signing locks the ScrollView so pen strokes don't fight the scroll.
  const [signing, setSigning] = useState(false);

  // Focus the input of a just-added equipment/checklist row so "Add" flows
  // straight into typing (autoFocus applies on mount only; cleared on blur).
  const [autoFocusKey, setAutoFocusKey] = useState<string | null>(null);

  // Anything the tradie changed since seed/load/last save. Drives the
  // beforeRemove auto-save so backing out never silently bins a report.
  const dirtyRef = useRef(false);
  // Suppresses navigation.setParams once the screen is on its way out.
  const leavingRef = useRef(false);

  // Seed the form from the job (new report).
  useEffect(() => {
    if (form || !job) return;
    if (routeReportId) return; // edit mode hydrates below instead
    setForm(buildInitialReportForm(job));
  }, [job, form, routeReportId]);

  // New report: pre-fill the technician pad with the tradie's most recent
  // real signature — their squiggle never changes, so re-drawing it on
  // every docket is pure friction. Visible in the pad, one tap to Clear.
  // Functional setters keep any ink the tradie laid down before this fetch
  // resolved; the CUSTOMER pad is never pre-filled — fresh ink every visit.
  useEffect(() => {
    if (routeReportId) return;
    let cancelled = false;
    reportService.listReports().then((reports) => {
      if (cancelled) return;
      const sig = latestTechnicianSignature(reports);
      if (!sig) return;
      setTechSigPath((prev) => prev || sig.svgPath);
      setTechSigName((prev) => prev || sig.name);
      setTechSigSize((prev) =>
        prev ?? (sig.width && sig.height ? { width: sig.width, height: sig.height } : prev),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [routeReportId]);

  // Edit mode: load the existing report once.
  useEffect(() => {
    if (!routeReportId || form) return;
    let cancelled = false;
    reportService.getReport(routeReportId).then((report) => {
      if (cancelled || !report) return;
      setForm(formFromReport(report));
      setMeta({
        id: report.id,
        number: report.number,
        status: report.status,
        createdAt: report.createdAt,
      });
      setTechSigName(report.technicianSignature?.name ?? '');
      setTechSigPath(report.technicianSignature?.svgPath ?? '');
      if (report.technicianSignature?.width && report.technicianSignature?.height) {
        setTechSigSize({
          width: report.technicianSignature.width,
          height: report.technicianSignature.height,
        });
      }
      setCustSigName(report.customerSignature?.name ?? '');
      setCustSigPath(report.customerSignature?.svgPath ?? '');
      if (report.customerSignature?.width && report.customerSignature?.height) {
        setCustSigSize({
          width: report.customerSignature.width,
          height: report.customerSignature.height,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [routeReportId, form]);

  const patch = (next: Partial<ReportFormState>) => {
    dirtyRef.current = true;
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  };

  const context = useMemo(() => (job ? deriveReportContext(job) : null), [job]);

  // Latest persist + content snapshot for the beforeRemove listener. Refs,
  // because the listener registers once (before the loading early-return)
  // while persist and the form only exist on full renders.
  const persistRef = useRef<null | (() => Promise<unknown>)>(null);
  const hasContentRef = useRef(false);

  // Backing out must never silently bin a filled-in (possibly signed)
  // report — auto-save on the way out, same pattern as JobDetailsScreen.
  // Skipped when nothing meaningful was entered, so an open-and-back
  // doesn't mint an empty RP number.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      leavingRef.current = true;
      if (!dirtyRef.current || !hasContentRef.current) return;
      // Fire-and-forget: the screen is going away, the write completes in
      // the background.
      persistRef.current?.().catch(() => {});
    });
    return unsubscribe;
  }, [navigation]);

  if (!job || !form) {
    // Only declare the job missing once the jobs listener has actually
    // loaded — before that it's just not here YET. Applies to edit mode
    // too: an existing report whose job was deleted must not spin forever.
    const jobMissing = jobsLoaded && !job;
    return (
      <View style={[styles.container, styles.centered]}>
        {jobMissing ? (
          <>
            <MaterialCommunityIcons
              name={'file-alert-outline' as any}
              size={44}
              color={colors.textMuted}
            />
            <Text style={styles.missingText}>This job could not be found.</Text>
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  // --- Equipment ------------------------------------------------------------
  const addEquipment = () => {
    // Focus the new row so "Add" flows straight into typing.
    setAutoFocusKey(`eq-${form.equipment.length}`);
    patch({ equipment: [...form.equipment, ''] });
  };
  const setEquipmentAt = (i: number, value: string) => {
    const next = [...form.equipment];
    next[i] = value;
    patch({ equipment: next });
  };
  const removeEquipmentAt = (i: number) =>
    patch({ equipment: form.equipment.filter((_, idx) => idx !== i) });

  // --- Checklist ------------------------------------------------------------
  const addChecklistItem = () => {
    const id = generateId();
    setAutoFocusKey(id);
    patch({
      itemsChecked: [...form.itemsChecked, { id, text: '', checked: false }],
    });
  };
  const setChecklistText = (id: string, text: string) =>
    patch({
      itemsChecked: form.itemsChecked.map((it) =>
        it.id === id ? { ...it, text } : it,
      ),
    });
  // Manual tap only — the sole place `checked` is ever flipped.
  const toggleChecklist = (id: string) =>
    patch({
      itemsChecked: form.itemsChecked.map((it) =>
        it.id === id ? { ...it, checked: !it.checked } : it,
      ),
    });
  const removeChecklistItem = (id: string) =>
    patch({ itemsChecked: form.itemsChecked.filter((it) => it.id !== id) });

  // --- Write it up (compose) ------------------------------------------------
  const handleWriteItUp = async () => {
    const notes = {
      natureOfProblem: form.natureOfProblem,
      workCarriedOut: form.workCarriedOut,
      recommendedWork: form.recommendedWork,
    };
    if (
      !notes.natureOfProblem.trim() &&
      !notes.workCarriedOut.trim() &&
      !notes.recommendedWork.trim()
    ) {
      showAlert({
        type: 'info',
        title: 'Nothing to write up yet',
        message: 'Jot down what you found, did, or recommend and Mate will tidy it up.',
      });
      return;
    }
    setComposing(true);
    try {
      const categoryId =
        businessSettings?.tradeCategories?.[0] || businessSettings?.tradeCategory;
      const tradeCategory = categoryId
        ? getTradeCategoryById(categoryId)?.name
        : undefined;
      const composed = await composeServiceReport(notes, {
        businessName: businessSettings?.businessName || undefined,
        tradeCategory,
      });
      // Only overwrite a field when the tidy-up returned something for it —
      // never blank out text the tradie had typed.
      patch({
        natureOfProblem: composed.natureOfProblem || form.natureOfProblem,
        workCarriedOut: composed.workCarriedOut || form.workCarriedOut,
        recommendedWork: composed.recommendedWork || form.recommendedWork,
      });
    } catch (err: any) {
      showAlert({
        type: 'error',
        title: 'Could not write it up',
        message: err?.message || 'Please try again in a moment.',
      });
    } finally {
      setComposing(false);
    }
  };

  // --- Save / export --------------------------------------------------------
  const currentSignatures = (): {
    technicianSignature?: SignatureCapture;
    customerSignature?: SignatureCapture;
  } => {
    const now = Date.now();
    return {
      technicianSignature: techSigPath
        ? {
            svgPath: techSigPath,
            name: techSigName.trim(),
            signedAt: now,
            width: techSigSize?.width,
            height: techSigSize?.height,
          }
        : undefined,
      customerSignature: custSigPath
        ? {
            svgPath: custSigPath,
            name: custSigName.trim(),
            signedAt: now,
            width: custSigSize?.width,
            height: custSigSize?.height,
          }
        : undefined,
    };
  };

  // Anything worth keeping? Gates the beforeRemove auto-save (an untouched
  // open-and-back must not mint an empty report) and the Export button.
  const hasMeaningfulContent =
    !!meta ||
    form.equipment.some((e) => e.trim()) ||
    form.itemsChecked.some((it) => it.text.trim()) ||
    !!form.natureOfProblem.trim() ||
    !!form.workCarriedOut.trim() ||
    !!form.recommendedWork.trim() ||
    !!form.riskAssessment.trim() ||
    (form.photos?.length ?? 0) > 0 ||
    !!techSigPath ||
    !!custSigPath;
  hasContentRef.current = hasMeaningfulContent;

  // Firestore has no local persistence in this app, so on a dead-signal
  // site an awaited write can hang forever with the button spinning. Cap
  // the wait and tell the tradie the truth: nothing was lost, try again in
  // range. (The write may still land in the background once signal
  // returns — the meta guard prevents a duplicate create on re-save.)
  const PERSIST_TIMEOUT_MS = 12000;
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Couldn't reach the server — check your signal and try again. Your report is still on this screen.",
              ),
            ),
          PERSIST_TIMEOUT_MS,
        ),
      ),
    ]);

  // Persist and return a fully-formed ServiceReport (for the PDF export).
  const persist = async (): Promise<ServiceReport | null> => {
    const sigs = currentSignatures();
    const input = {
      ...buildReportInput({
        ...form,
        photos: form.photos,
      }),
      ...sigs,
    };
    if (!meta) {
      const created = await withTimeout(reportService.createReport(input));
      setMeta({
        id: created.id,
        number: created.number,
        status: created.status,
        createdAt: created.createdAt,
      });
      // Re-key the route so a later save updates instead of creating a
      // second — unless we're already on the way out.
      if (!leavingRef.current) {
        navigation.setParams({ reportId: created.id });
      }
      dirtyRef.current = false;
      return created;
    }
    await withTimeout(reportService.updateReport(meta.id, input));
    dirtyRef.current = false;
    return {
      ...input,
      id: meta.id,
      userId: job.userId,
      number: meta.number,
      status: meta.status,
      createdAt: meta.createdAt,
      updatedAt: Date.now(),
    } as ServiceReport;
  };
  persistRef.current = persist;

  const handleSave = async () => {
    setSaving(true);
    try {
      await persist();
      navigation.goBack();
    } catch (err: any) {
      showAlert({
        type: 'error',
        title: 'Could not save',
        message: err?.message || 'Please try again in a moment.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!hasMeaningfulContent) {
      showAlert({
        type: 'info',
        title: 'Nothing to share yet',
        message: 'Fill in what you did on the visit before sharing the report.',
      });
      return;
    }
    setExporting(true);
    try {
      const report = await persist();
      if (!report) return;
      await exportReportPDF(report, businessSettings, 'share', {
        customerName: context?.customerName,
        customerEmail: context?.customerEmail,
        customerPhone: context?.customerPhone,
        jobAddress: context?.jobAddress,
      });
    } catch (err: any) {
      showAlert({
        type: 'error',
        title: 'Could not export',
        message: err?.message || 'Please try again in a moment.',
      });
    } finally {
      setExporting(false);
    }
  };

  const visitDateLabel = format(new Date(form.visitDate), 'EEEE d MMMM yyyy');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? -48 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!signing}
      >
        <WebContainer>
          {/* Who + where — read straight off the job. */}
          <View style={styles.headerCard}>
            <Text style={styles.customerName}>
              {context?.customerName || 'Customer'}
            </Text>
            {context?.jobAddress ? (
              <Text style={styles.customerMeta}>{context.jobAddress}</Text>
            ) : null}
            <Text style={styles.reportNumber}>
              {meta ? `Report ${meta.number}` : 'New service report'}
            </Text>
          </View>

          {/* Visit date */}
          <SectionLabel text="Visit date" />
          <TouchableOpacity
            style={styles.dateRow}
            onPress={() => setShowCalendar((v) => !v)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="calendar"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.dateText}>{visitDateLabel}</Text>
            <MaterialCommunityIcons
              name={showCalendar ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={colors.textMuted}
            />
          </TouchableOpacity>
          {showCalendar && (
            <Calendar
              current={format(new Date(form.visitDate), 'yyyy-MM-dd')}
              onDayPress={(day: { timestamp: number; dateString: string }) => {
                // Use midday local to dodge timezone day-shift on the epoch.
                const picked = new Date(`${day.dateString}T12:00:00`).getTime();
                patch({ visitDate: picked });
                setShowCalendar(false);
              }}
              markedDates={{
                [format(new Date(form.visitDate), 'yyyy-MM-dd')]: {
                  selected: true,
                  selectedColor: colors.primary,
                },
              }}
              theme={{
                calendarBackground: colors.surface,
                dayTextColor: colors.text,
                monthTextColor: colors.text,
                textDisabledColor: colors.textMuted,
                arrowColor: colors.primary,
                todayTextColor: colors.primary,
              }}
              style={styles.calendar}
            />
          )}

          {/* Service type */}
          <SectionLabel text="Service type" />
          <TextInput
            mode="outlined"
            value={form.serviceType}
            onChangeText={(t) => patch({ serviceType: t })}
            placeholder="e.g. Annual gas heater service"
            style={styles.input}
          />

          {/* Risk assessment */}
          <SectionLabel text="Risk assessment" optional />
          <TextInput
            mode="outlined"
            value={form.riskAssessment}
            onChangeText={(t) => patch({ riskAssessment: t })}
            placeholder="Any site hazards or safety notes"
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          {/* Equipment */}
          <SectionLabel text="Equipment on site" optional />
          {form.equipment.map((value, i) => (
            <View key={`eq-${i}`} style={styles.listRow}>
              <TextInput
                mode="outlined"
                value={value}
                onChangeText={(t) => setEquipmentAt(i, t)}
                placeholder="Item"
                style={styles.listInput}
                dense
                autoFocus={autoFocusKey === `eq-${i}`}
                onBlur={() => setAutoFocusKey(null)}
              />
              <TouchableOpacity
                onPress={() => removeEquipmentAt(i)}
                style={styles.rowRemove}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Remove equipment"
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={22}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>
          ))}
          <AddRow label="Add equipment" onPress={addEquipment} />

          {/* Checklist — heading matches the PDF's "Items checked" */}
          <SectionLabel text="Items checked" optional />
          {form.itemsChecked.map((item) => (
            <View key={item.id} style={styles.listRow}>
              <TouchableOpacity
                onPress={() => toggleChecklist(item.id)}
                style={styles.checkbox}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
                accessibilityLabel={item.text || 'Checklist item'}
              >
                <MaterialCommunityIcons
                  name={item.checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={item.checked ? colors.primary : colors.textMuted}
                />
              </TouchableOpacity>
              <TextInput
                mode="outlined"
                value={item.text}
                onChangeText={(t) => setChecklistText(item.id, t)}
                placeholder="What was checked"
                style={styles.listInput}
                dense
                autoFocus={autoFocusKey === item.id}
                onBlur={() => setAutoFocusKey(null)}
              />
              <TouchableOpacity
                onPress={() => removeChecklistItem(item.id)}
                style={styles.rowRemove}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Remove checklist item"
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={22}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>
          ))}
          <AddRow label="Add checklist item" onPress={addChecklistItem} />

          {/* Narrative */}
          <SectionLabel text="Nature of the problem" optional />
          <TextInput
            mode="outlined"
            value={form.natureOfProblem}
            onChangeText={(t) => patch({ natureOfProblem: t })}
            placeholder="What the customer reported or what you found"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
          <SectionLabel text="Work carried out" optional />
          <TextInput
            mode="outlined"
            value={form.workCarriedOut}
            onChangeText={(t) => patch({ workCarriedOut: t })}
            placeholder="What you did on this visit"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
          <SectionLabel text="Recommended work" optional />
          <TextInput
            mode="outlined"
            value={form.recommendedWork}
            onChangeText={(t) => patch({ recommendedWork: t })}
            placeholder="Anything to sort on a future visit"
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          <TouchableOpacity
            onPress={handleWriteItUp}
            disabled={composing}
            style={styles.writeUpButton}
            activeOpacity={0.8}
          >
            {composing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <MaterialCommunityIcons
                name="auto-fix"
                size={18}
                color={colors.primary}
              />
            )}
            <Text style={styles.writeUpText}>
              {composing ? 'Writing it up…' : 'Write it up with Mate'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.writeUpHint}>
            Tidies your rough notes into clear wording for the customer. Sticks to
            the facts you entered.
          </Text>

          {/* Photos — reuses the standard job photo capture path; header
              hidden because this screen renders its own section label. */}
          <SectionLabel text="Photos" optional />
          <JobPhotos
            photos={form.photos as QuotePhoto[]}
            onPhotosChange={(photos) => patch({ photos: photos as JobPhoto[] })}
            hideHeader
          />

          {/* Signatures */}
          <SectionLabel text="Technician signature" optional />
          <TextInput
            mode="outlined"
            value={techSigName}
            onChangeText={(t) => {
              dirtyRef.current = true;
              setTechSigName(t);
            }}
            placeholder="Technician name"
            style={styles.input}
            dense
          />
          <SignaturePad
            value={techSigPath}
            onChange={(path, size) => {
              dirtyRef.current = true;
              setTechSigPath(path);
              setTechSigSize(size);
            }}
            onStrokeStart={() => setSigning(true)}
            onStrokeEnd={() => setSigning(false)}
          />

          <View style={{ height: 16 }} />
          <SectionLabel text="Customer signature" optional />
          <TextInput
            mode="outlined"
            value={custSigName}
            onChangeText={(t) => {
              dirtyRef.current = true;
              setCustSigName(t);
            }}
            placeholder="Customer name"
            style={styles.input}
            dense
          />
          <SignaturePad
            value={custSigPath}
            onChange={(path, size) => {
              dirtyRef.current = true;
              setCustSigPath(path);
              setCustSigSize(size);
            }}
            onStrokeStart={() => setSigning(true)}
            onStrokeEnd={() => setSigning(false)}
          />
        </WebContainer>
      </ScrollView>

      {/* Share is the deliverable — it lives in the fixed bar next to Save,
          not buried at the bottom of the scroll. */}
      <FixedBottomButton
        label="Save report"
        onPress={handleSave}
        loading={saving}
        disabled={saving || exporting}
        secondaryLabel="Share PDF"
        secondaryOnPress={handleExport}
        secondaryLoading={exporting}
        secondaryDisabled={saving}
        disableKeyboardSticky
      />

      {alertNode}
    </KeyboardAvoidingView>
  );
}

function SectionLabel({ text, optional }: { text: string; optional?: boolean }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{text}</Text>
      {optional ? <Text style={styles.optional}>optional</Text> : null}
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.addRow} onPress={onPress} activeOpacity={0.7}>
      <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.primary} />
      <Text style={styles.addRowText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 160 },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  missingText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customerName: { fontSize: 18, fontWeight: '700', color: colors.text },
  customerMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  reportNumber: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontWeight: '600',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 18,
    marginBottom: 6,
  },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  optional: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  input: { backgroundColor: colors.surface, marginBottom: 4 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  calendar: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listInput: { flex: 1, backgroundColor: colors.surface },
  rowRemove: { padding: 2 },
  checkbox: { padding: 2 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: 2,
  },
  addRowText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  writeUpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  writeUpText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  writeUpHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
    lineHeight: 16,
  },
});
