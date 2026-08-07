/**
 * ServiceReportScreen
 *
 * Capture screen for a Service Report — the customer-facing leave-behind a
 * tradie fills in after a service visit. Route params: { jobId, reportId? }.
 *
 * Pulls the customer + address off the linked Job (read-only here), then lets
 * the tradie set the visit date, service type and risk assessment; manage a
 * short equipment list and a tick-box checklist (Mate NEVER pre-ticks — every
 * tick is a manual tap); jot rough notes into the three narrative fields
 * (typed or dictated via DictationButton) and tap "Clean it up" to have Mate
 * tidy them into customer-ready prose — the write-up may redistribute facts
 * between the three fields, and any extra equipment/checklist items Mate
 * spots come back as tap-to-add suggestion chips (never auto-added, checklist
 * rows always land unticked); attach photos; capture technician + customer
 * signatures; and, when Recommended work has content and the job has a
 * customer, spin the follow-up into a new draft quote ("Quote this work").
 * Save persists via reportService; "Export / Share" renders the PDF via
 * exportReportPDF.
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
import { DictationButton } from '../../components/DictationButton';
import { useAlertModal } from '../../hooks/useAlertModal';
import { generateId } from '../../utils/generateId';
import { getTradeCategoryById } from '../../constants/tradeCategories';
import { reportService } from '../../services/reportService';
import {
  composeServiceReport,
  type ComposeAddition,
} from '../../services/reportComposeService';
import { trackEvent } from '../../services/analyticsService';
import { reservePrintWindow, exportReportPDF } from '../../utils/pdfGenerator';
import { createQuoteFromRecommendedWork } from '../../utils/quoteFromReport';
import type { QuotePhoto } from '../../types';
import type { JobPhoto } from '../../../shared/job/types';
import type { ServiceReport, SignatureCapture } from '../../../shared/report/types';
import { pathHasInk } from '../../../shared/pdf/signatureInk';
import {
  applyComposedWriteUp,
  buildInitialReportForm,
  buildReportInput,
  carryForwardSiteMemory,
  deriveReportContext,
  formFromReport,
  latestSiteReport,
  latestSiteWriteUp,
  latestTechnicianSignature,
  pruneAdditions,
  pruneSuggestions,
  removeCarriedRows,
  setAllChecked,
  tickAllState,
  writeUpSnapshot,
  type ReportFormState,
  type WriteUpFields,
  type SiteMemory,
} from './reportDraft';

export function ServiceReportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const jobId: string = route.params?.jobId;
  const routeReportId: string | undefined = route.params?.reportId;

  const job = useJobStore((s) => s.jobs.find((j) => j.id === jobId));
  const jobs = useJobStore((s) => s.jobs);
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
  const [quoting, setQuoting] = useState(false);

  // Mate's tap-to-add suggestions from the last write-up. Review-only:
  // nothing lands on the report until the tradie taps a chip, and checklist
  // rows always land unticked. Not persisted — dismissing loses nothing.
  const [suggestedEquipment, setSuggestedEquipment] = useState<string[]>([]);
  const [suggestedChecklist, setSuggestedChecklist] = useState<string[]>([]);
  // Closing statements the write-up refused to assert (it was tested, it was
  // left running correctly) — offered as confirmable sentences, never prose.
  const [suggestedAdditions, setSuggestedAdditions] = useState<ComposeAddition[]>([]);

  // The tradie's own words, snapshotted right before a clean-up so they can
  // be put back. The whole promise of the feature is "these are your words,
  // Mate only tidies them" — that's only true if the tidy is reversible.
  // Same affordance as the description clean-up on NewQuote/JobDetailsScreen.
  const [preCleanupSnapshot, setPreCleanupSnapshot] = useState<WriteUpFields | null>(null);

  // Site memory: what the previous visit to this address contributed, and
  // the banner that says so. Held in state so "Undo" can take back exactly
  // those rows; null once undone or when there was no previous visit.
  const [carried, setCarried] = useState<SiteMemory | null>(null);
  const [carriedFrom, setCarriedFrom] = useState<{
    number: string;
    visitDate: number;
  } | null>(null);
  // The previous visit's write-up, passed to compose as a VOCABULARY
  // reference only — the server prompt forbids taking any fact from it.
  const previousWriteUpRef = useRef<string | undefined>(undefined);

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

  // Analytics one-shots. "Signed" means fresh measured ink saved for the
  // first time this visit — the baselines flag ink that arrived via edit-mode
  // load or the technician pre-fill, so a carried-forward squiggle never
  // counts as a new signing.
  const signedEventFiredRef = useRef(false);
  const baselineTechInkRef = useRef(false);
  const baselineCustInkRef = useRef(false);

  // Seed the form from the job (new report).
  useEffect(() => {
    if (form || !job) return;
    if (routeReportId) return; // edit mode hydrates below instead
    setForm(buildInitialReportForm(job));
  }, [job, form, routeReportId]);

  // New report: pre-fill from what's already known, in ONE pass over the
  // tradie's reports.
  //
  //  - The technician pad gets their most recent real signature — their
  //    squiggle never changes, so re-drawing it every docket is pure
  //    friction. The CUSTOMER pad is never pre-filled: fresh ink each visit.
  //  - Equipment and checklist rows come from the last visit to this SITE,
  //    always unticked (see reportDraft's site-memory block).
  //
  // Runs once, only after the form is seeded, so the writes below can never
  // race the seed and be overwritten by it. Deliberately does NOT set
  // dirtyRef: a pre-filled report the tradie backs straight out of must not
  // auto-save and mint an RP number, exactly as before.
  const prefillRef = useRef(false);
  // Deps are deliberately the IDENTITY of what gates the run, not the
  // objects the body reads. `jobs` gets a new array on every store tick and
  // `form` a new object on every keystroke — as deps, either would re-run
  // the effect mid-fetch, and React fires the previous cleanup first, which
  // would flip `cancelled` and silently bin the prefill in flight. The body
  // only ever runs once (prefillRef), so reading current values off the
  // closure is safe.
  const formReady = !!form;
  // Latest form for the async body to read — same pattern as hasContentRef
  // below. Lets the decision to carry, the write, and the banner all agree
  // on one snapshot instead of deciding inside a state updater (which
  // StrictMode may run twice).
  const formRef = useRef(form);
  formRef.current = form;
  useEffect(() => {
    if (routeReportId || !job || !form || prefillRef.current) return;
    prefillRef.current = true;
    let cancelled = false;
    reportService.listReports().then((reports) => {
      if (cancelled) return;

      const sig = latestTechnicianSignature(reports);
      if (sig) {
        setTechSigPath((prev) => {
          if (prev) return prev;
          // Carried-forward ink is not a fresh signing (ref set is
          // idempotent, so a double updater run under StrictMode is
          // harmless).
          baselineTechInkRef.current = true;
          return sig.svgPath;
        });
        setTechSigName((prev) => prev || sig.name);
        setTechSigSize((prev) =>
          prev ?? (sig.width && sig.height ? { width: sig.width, height: sig.height } : prev),
        );
      }

      // Vocabulary reference is its own lookup — a previous visit can be
      // worth quoting for its wording even with no equipment listed.
      previousWriteUpRef.current = latestSiteWriteUp(reports, jobs, job);

      const prior = latestSiteReport(reports, jobs, job);
      if (!prior) return;
      const memory = carryForwardSiteMemory(prior);
      if (!memory.equipment.length && !memory.itemsChecked.length) return;
      // Only ever fills blanks — anything the tradie typed while this fetch
      // was in flight wins outright, and in that case no banner appears,
      // because nothing was carried.
      const live = formRef.current;
      if (!live || live.equipment.length || live.itemsChecked.length) return;
      setForm((prev) =>
        prev
          ? { ...prev, equipment: memory.equipment, itemsChecked: memory.itemsChecked }
          : prev,
      );
      setCarried(memory);
      setCarriedFrom({ number: prior.number, visitDate: prior.visitDate });
      trackEvent('report_site_memory_applied', {
        equipment: memory.equipment.length,
        checklist: memory.itemsChecked.length,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeReportId, job?.id, formReady]);

  // Wrong site, or a job that's moved on — take back exactly the rows site
  // memory added and retire the banner. Rows the tradie has since reworded
  // are theirs and survive (see removeCarriedRows).
  const undoCarriedRows = () => {
    if (!carried) return;
    setForm((prev) => (prev ? { ...prev, ...removeCarriedRows(prev, carried) } : prev));
    setCarried(null);
    setCarriedFrom(null);
    trackEvent('report_site_memory_undone');
  };

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
      // Ink already on the loaded report is not a fresh signing.
      baselineTechInkRef.current = pathHasInk(report.technicianSignature?.svgPath ?? '');
      baselineCustInkRef.current = pathHasInk(report.customerSignature?.svgPath ?? '');
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
  // The whole-list version of the same tap. Still manual, still the tradie —
  // it just spares them ticking a list they tick on every visit, which is
  // exactly what site memory hands them.
  const tickAll = tickAllState(form.itemsChecked);
  const toggleAllChecklist = () =>
    patch({ itemsChecked: setAllChecked(form.itemsChecked, !tickAll.allTicked) });
  const removeChecklistItem = (id: string) =>
    patch({ itemsChecked: form.itemsChecked.filter((it) => it.id !== id) });

  // --- Suggestion chips (from the write-up) ----------------------------------
  // Chips only OFFER a row — a tap adds it and retires the chip. Re-pruned
  // against the live rows every render so a row the tradie typed themselves
  // hides its duplicate chip.
  const equipmentChips = pruneSuggestions(suggestedEquipment, form.equipment);
  const checklistChips = pruneSuggestions(
    suggestedChecklist,
    form.itemsChecked.map((it) => it.text),
  );
  // Same live pruning for the write-up additions: a sentence the field
  // already carries — confirmed on an earlier pass, or typed by hand —
  // retires its chip instead of offering to append itself twice.
  const additionChips = pruneAdditions(suggestedAdditions, form);

  const addSuggestedEquipment = (text: string) => {
    setSuggestedEquipment((prev) => prev.filter((s) => s !== text));
    patch({ equipment: [...form.equipment, text] });
  };
  const addSuggestedChecklist = (text: string) => {
    setSuggestedChecklist((prev) => prev.filter((s) => s !== text));
    // Always unticked — ticking is the tradie's tap, never Mate's.
    patch({
      itemsChecked: [
        ...form.itemsChecked,
        { id: generateId(), text, checked: false },
      ],
    });
  };

  // Confirming an addition appends its sentence to the field it belongs to
  // and retires the chip. This is the ONLY way an unsupported closing
  // statement reaches the report — the write-up itself never asserts one.
  const addSuggestedAddition = (addition: ComposeAddition) => {
    setSuggestedAdditions((prev) => prev.filter((a) => a.text !== addition.text));
    // Functional update, not patch(): two chips tapped before a re-render
    // commits would both append to the SAME stale snapshot, and the second
    // would silently drop the first one's sentence.
    dirtyRef.current = true;
    setForm((prev) => {
      if (!prev) return prev;
      const existing = prev[addition.field].trim();
      return {
        ...prev,
        [addition.field]: existing ? `${existing} ${addition.text}` : addition.text,
      };
    });
  };

  // Typing in a narrative field retires the undo offer. Diverges from
  // JobDetailsScreen deliberately: there the snapshot survives edits, so
  // undo can bin work typed after the clean-up. Restoring a snapshot is
  // destructive, and it must only ever destroy Mate's rewrite — never the
  // tradie's own words. Tapping a suggestion chip is part of the clean-up,
  // not a manual edit, so it leaves the offer standing.
  const patchNarrative = (next: Partial<ReportFormState>) => {
    if (preCleanupSnapshot) setPreCleanupSnapshot(null);
    patch(next);
  };

  const handleUndoCleanup = () => {
    if (!preCleanupSnapshot) return;
    patch(preCleanupSnapshot);
    setPreCleanupSnapshot(null);
    // The offers came out of the clean-up being undone, and were pruned
    // against text that no longer exists — they go with it.
    setSuggestedAdditions([]);
    setSuggestedEquipment([]);
    setSuggestedChecklist([]);
    trackEvent('report_cleanup_undone');
  };

  // --- Clean it up (compose) ------------------------------------------------
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
        title: 'Nothing to clean up yet',
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
        // Last visit's write-up teaches Mate this tradie's own words for
        // their plant ("package unit", "high wall split"). Vocabulary only —
        // the server prompt fences it off from this visit's facts.
        previousWriteUp: previousWriteUpRef.current,
      });
      // Apply the returned trio wholesale: the write-up may REDISTRIBUTE a
      // fact into the field where it belongs, so a field can legitimately
      // come back empty (its fact moved) or filled (a fact moved in). The
      // helper's only guard is all-blank — Mate never wipes the lot.
      patch(applyComposedWriteUp(notes, composed));
      // Anything extra Mate spotted in the notes lands as tap-to-add chips,
      // pruned against rows already on the report. Never auto-added.
      setSuggestedEquipment(
        pruneSuggestions(composed.suggestedEquipment, form.equipment),
      );
      setSuggestedChecklist(
        pruneSuggestions(
          composed.suggestedChecklist,
          form.itemsChecked.map((it) => it.text),
        ),
      );
      // Claims Mate would not assert on the tradie's behalf. Offered, never
      // written — one tap each puts them in.
      setSuggestedAdditions(composed.suggestedAdditions);
      // Only now the rewrite has landed: the words it replaced are worth
      // keeping, and the undo chip appears.
      setPreCleanupSnapshot(writeUpSnapshot(notes));
      trackEvent('report_written_up', {
        equipment_suggested: composed.suggestedEquipment.length,
        checklist_suggested: composed.suggestedChecklist.length,
        additions_offered: composed.suggestedAdditions.length,
      });
    } catch (err: any) {
      showAlert({
        type: 'error',
        title: 'Could not clean it up',
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

  // Fire-and-forget "report signed" the first time a save carries fresh
  // measured ink (pathHasInk — ghost taps don't count; loaded / pre-filled
  // ink is baselined out above). Never blocks or fails the save.
  const trackFirstSignature = () => {
    if (signedEventFiredRef.current) return;
    const freshTech =
      !baselineTechInkRef.current && !!techSigPath && pathHasInk(techSigPath);
    const freshCust =
      !baselineCustInkRef.current && !!custSigPath && pathHasInk(custSigPath);
    if (!freshTech && !freshCust) return;
    signedEventFiredRef.current = true;
    trackEvent('report_signed', { technician: freshTech, customer: freshCust });
  };

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
      trackEvent('report_created');
      trackFirstSignature();
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
    trackFirstSignature();
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
    // Reserve the tab NOW, while the tap is still a user gesture. persist()
    // below is async, and after it iOS Safari refuses window.open outright —
    // which is why this silently did nothing on mobile web.
    const printWindow = reservePrintWindow();
    setExporting(true);
    try {
      const report = await persist();
      if (!report) {
        printWindow?.close();
        return;
      }
      await exportReportPDF(report, businessSettings, 'share', {
        printWindow,
        customerName: context?.customerName,
        customerEmail: context?.customerEmail,
        customerPhone: context?.customerPhone,
        jobAddress: context?.jobAddress,
      });
      trackEvent('report_shared', { method: 'share' });
      showAlert({
        type: 'success',
        title: 'Report saved to job',
        message: 'You can reopen it anytime under Service reports on this job.',
      });
    } catch (err: any) {
      printWindow?.close();
      showAlert({
        type: 'error',
        title: 'Could not export',
        message: err?.message || 'Please try again in a moment.',
      });
    } finally {
      setExporting(false);
    }
  };

  // --- Quote this work --------------------------------------------------
  // Recommended work → a fresh draft quote for the same customer, then the
  // wizard's MaterialsList with the pipeline running. Only offered when the
  // job actually has a customer to quote. The report is persisted FIRST so
  // navigating away never bins unsaved edits.
  const canQuoteRecommended =
    !!(job.customerName || '').trim() && !!form.recommendedWork.trim();

  const handleQuoteRecommendedWork = async () => {
    if (quoting) return;
    setQuoting(true);
    try {
      await persist();
      const s = useStore.getState();
      const result = await createQuoteFromRecommendedWork(
        {
          job,
          recommendedWork: form.recommendedWork,
          serviceTypeLabel: form.serviceType,
        },
        {
          createNewQuote: s.createNewQuote,
          getCurrentQuote: () => useStore.getState().currentQuote,
          updateQuote: s.updateQuote,
          saveDraft: s.saveDraft,
        },
      );
      if (!result) return; // Blank recommended work — button shouldn't show
      navigation.navigate(result.navigate.navigator, {
        screen: result.navigate.screen,
        params: result.navigate.params,
      });
    } catch (err: any) {
      showAlert({
        type: 'error',
        title: 'Could not start the quote',
        message: err?.message || 'Please try again in a moment.',
      });
    } finally {
      setQuoting(false);
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

          {/* Site memory — says where the pre-filled rows came from and
              takes them back in one tap. Sits above BOTH sections it
              filled, so one banner explains the lot. */}
          {carriedFrom && (
            <View style={styles.carriedBanner}>
              <MaterialCommunityIcons
                name="history"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.carriedText}>
                Filled in from your last visit here —{' '}
                {[carriedFrom.number, carriedFrom.visitDate
                  ? format(new Date(carriedFrom.visitDate), 'd MMM yyyy')
                  : '']
                  .filter(Boolean)
                  .join(', ')}
                {/* An instruction, not a status. "Nothing is ticked" went
                    stale the moment the tradie ticked something — this stays
                    true for the life of the banner. */}
                . Tick what you did today.
              </Text>
              <TouchableOpacity
                onPress={undoCarriedRows}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Undo — remove the rows carried over from the last visit"
              >
                <Text style={styles.carriedUndo}>Undo</Text>
              </TouchableOpacity>
            </View>
          )}

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
          {equipmentChips.length > 0 && (
            <SuggestionChips
              label="Mate reckons these came up — tap to add"
              items={equipmentChips}
              onAdd={addSuggestedEquipment}
              onClear={() => setSuggestedEquipment([])}
            />
          )}

          {/* Checklist — heading matches the PDF's "Items checked" */}
          <SectionLabel
            text="Items checked"
            optional
            action={
              tickAll.visible
                ? {
                    label: tickAll.allTicked ? 'Untick all' : 'Tick all',
                    onPress: toggleAllChecklist,
                  }
                : undefined
            }
          />
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
          {checklistChips.length > 0 && (
            <SuggestionChips
              label="Mate reckons these came up — tap to add"
              items={checklistChips}
              onAdd={addSuggestedChecklist}
              onClear={() => setSuggestedChecklist([])}
            />
          )}

          {/* Narrative.
              One mic for the whole write-up: everything lands in Work
              carried out, and "Clean it up" sorts the facts into the right
              sections. Four stacked mics read as clutter; one reads as a
              feature.
              It OPENS the block rather than trailing it. Sitting below
              Recommended work, it read as that field's mic while actually
              dictating into Work carried out two fields up; and "Talk
              through the visit" is an invitation to start, which belongs
              before the boxes it fills, not after them. */}
          <View style={styles.dictationRow}>
            <DictationButton
              variant="hero"
              value={form.workCarriedOut}
              onText={(next) => patch({ workCarriedOut: next })}
              label="Tap to talk through the visit"
              hint="Mate sorts it into the right sections when you clean it up."
            />
          </View>

          <SectionLabel text="Nature of the problem" optional />
          <TextInput
            mode="outlined"
            value={form.natureOfProblem}
            onChangeText={(t) => patchNarrative({ natureOfProblem: t })}
            placeholder="What the customer reported or what you found"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
          <SectionLabel text="Work carried out" optional />
          <TextInput
            mode="outlined"
            value={form.workCarriedOut}
            onChangeText={(t) => patchNarrative({ workCarriedOut: t })}
            placeholder="What you did on this visit"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
          <SectionLabel text="Recommended work" optional />
          <TextInput
            mode="outlined"
            value={form.recommendedWork}
            onChangeText={(t) => patchNarrative({ recommendedWork: t })}
            placeholder="Anything to sort on a future visit"
            multiline
            numberOfLines={3}
            style={styles.input}
          />

          {/* Confirmable additions — the closing statements a service report
              normally carries that the notes didn't support. Mate won't put
              words in the tradie's mouth, so it offers them instead: one tap
              drops the sentence into the field it belongs to. Sits directly
              under the three fields it edits. */}
          {additionChips.length > 0 && (
            <SuggestionChips
              label="Mate won't claim these for you — tap any that are true"
              items={additionChips.map((a) => a.text)}
              onAdd={(text) => {
                const addition = additionChips.find((a) => a.text === text);
                if (addition) addSuggestedAddition(addition);
              }}
              onClear={() => setSuggestedAdditions([])}
            />
          )}

          {canQuoteRecommended && (
            <TouchableOpacity
              onPress={handleQuoteRecommendedWork}
              disabled={quoting || saving || exporting}
              style={styles.quoteWorkButton}
              activeOpacity={0.8}
            >
              {quoting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={18}
                  color={colors.primary}
                />
              )}
              <Text style={styles.quoteWorkText}>
                {quoting ? 'Setting up the quote…' : 'Quote this work'}
              </Text>
            </TouchableOpacity>
          )}

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
              {composing ? 'Cleaning it up…' : 'Clean it up with Mate'}
            </Text>
          </TouchableOpacity>
          {/* Once a clean-up has landed, the offer to undo it matters more
              than the description of what the button will do — so the chip
              takes the hint's place rather than stacking under it. */}
          {preCleanupSnapshot && !composing ? (
            <TouchableOpacity
              onPress={handleUndoCleanup}
              style={styles.undoCleanupChip}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Undo the clean-up and put your own wording back"
            >
              <MaterialCommunityIcons
                name="undo-variant"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.undoCleanupChipText}>
                Cleaned up — undo and put my wording back
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.writeUpHint}>
              Tidies your rough notes into clear wording for the customer. Sticks to
              the facts you entered.
            </Text>
          )}

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
        disabled={saving || exporting || quoting}
        secondaryLabel="Share PDF"
        secondaryOnPress={handleExport}
        secondaryLoading={exporting}
        // Without this the shared button falls back to its materials-flow
        // default copy, "Fetching prices..." — nonsense on a report.
        secondaryLoadingText="Preparing PDF..."
        secondaryDisabled={saving || quoting}
        disableKeyboardSticky
      />

      {alertNode}
    </KeyboardAvoidingView>
  );
}

function SectionLabel({
  text,
  optional,
  action,
}: {
  text: string;
  optional?: boolean;
  // Optional right-aligned action for the section. Lives in the heading row
  // rather than as another button in the body — the screen is long enough.
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{text}</Text>
      {optional ? <Text style={styles.optional}>optional</Text> : null}
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          style={styles.sectionActionButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.sectionAction}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/**
 * Tap-to-add suggestions from Mate's write-up. Review-only by design: a tap
 * adds the row (checklist rows land unticked) and retires the chip; "Clear"
 * bins the lot. Mate never adds anything itself.
 *
 * `label` says which kind of offer this is — spotted rows for the equipment
 * and checklist lists, unassertable claims for the write-up additions. Same
 * mechanic, so the same component; different promise, so different words.
 */
function SuggestionChips({
  label,
  items,
  onAdd,
  onClear,
}: {
  label: string;
  items: string[];
  onAdd: (text: string) => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.suggestionBlock}>
      <View style={styles.suggestionHeader}>
        <Text style={styles.suggestionLabel}>{label}</Text>
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear suggestions"
        >
          <Text style={styles.suggestionClear}>Clear</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.chipWrap}>
        {items.map((text) => (
          <TouchableOpacity
            key={text}
            style={styles.chip}
            onPress={() => onAdd(text)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Add ${text}`}
          >
            <MaterialCommunityIcons name="plus" size={14} color={colors.primary} />
            <Text style={styles.chipText}>{text}</Text>
          </TouchableOpacity>
        ))}
      </View>
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
  // Pushes a section action to the right-hand end of the heading row.
  sectionActionButton: { marginLeft: 'auto' },
  sectionAction: { fontSize: 12, color: colors.primary, fontWeight: '600' },
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
  undoCleanupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 6,
    paddingVertical: 4,
  },
  undoCleanupChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Only a nudge — the hero variant carries its own vertical rhythm, and
  // its size and centred label are what mark it as heading the block below
  // rather than trailing the checklist above.
  dictationRow: { marginTop: 6 },
  quoteWorkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  quoteWorkText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  suggestionBlock: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 4,
  },
  carriedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  carriedText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  carriedUndo: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  suggestionLabel: { flex: 1, fontSize: 12, color: colors.textMuted },
  suggestionClear: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.background,
    // flexWrap on the row wraps BETWEEN chips, not inside one. Write-up
    // additions are whole sentences, so without these a long chip runs off
    // the side of the card instead of wrapping within it.
    maxWidth: '100%',
    flexShrink: 1,
  },
  chipText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
});
