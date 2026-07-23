/**
 * useJobActionsSheet — shared host for the Job "three-dot" menu + its
 * downstream sheets (Send dialog, Take Payment sheet, Follow Up sheet).
 *
 * Both JobsListScreen and DashboardScreen use this so the menu wiring
 * lives in one place and can't drift. Hook returns an `open(job)`
 * trigger plus an `element` you render anywhere in your tree — the
 * element mounts all four sheets as portals.
 */

import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Snackbar } from 'react-native-paper';

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import {
  JobActionsSheet,
  type JobAction,
} from '../components/JobActionsSheet';
import {
  TakePaymentSheet,
  type TakePaymentTarget,
} from '../components/TakePaymentSheet';
import { SendDocumentDialog } from '../components/SendDocumentDialog';
import {
  FollowUpSheet,
  type FollowUpTone,
} from '../components/FollowUpSheet';
import { pickPrimaryDoc } from '../components/StickyJobActionBar';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import {
  documentToInvoice,
  documentToQuote,
} from '../types/documentAdapter';
import { cascadeDeleteJob, pickPaidDocs } from '../utils/deleteJobWithDocs';
import { ensureSquareConnectedForPayment } from '../utils/quoteDeliveryGuard';
import { applyStageChange } from '../utils/applyStageChange';
import { useAlertModal } from './useAlertModal';

interface UseJobActionsSheetOptions {
  /** Optional callback fired after a job is duplicated, before navigating
   *  into the clone. Lets the caller decide whether to navigate. Default:
   *  navigate to ViewJob on the cloned job's id. */
  onDuplicated?: (cloneJobId: string) => void;
}

// Stable empty array so the gated selectors below return a constant while
// their sheet is closed — Zustand then bails on the re-render.
const NO_DOCS: Document[] = [];
const NO_JOBS: Job[] = [];

export function useJobActionsSheet(
  navigation: any,
  options: UseJobActionsSheetOptions = {},
) {
  const [actionsJob, setActionsJob] = useState<Job | null>(null);
  const [sendDialogDoc, setSendDialogDoc] = useState<Document | null>(null);
  const [markedSentDocId, setMarkedSentDocId] = useState<string | null>(null);
  const [takePaymentTarget, setTakePaymentTarget] =
    useState<TakePaymentTarget | null>(null);
  const [followUpState, setFollowUpState] = useState<{
    doc: Document;
    tone: FollowUpTone;
  } | null>(null);

  // Selector-form subscriptions only. This hook is mounted by Dashboard and
  // JobsList, so a bare `useJobStore()` / broad `documents` subscription here
  // re-rendered both screens on EVERY job/document store write — including
  // the Firestore listener echoes that land right as the user navigates back
  // (the "janky return to home" bug). Actions are stable fn refs; the two
  // data reads are gated on their sheet actually being open, and handlers
  // read fresh state via getState() at call time.
  const saveJob = useJobStore((s) => s.saveJob);
  const deleteJob = useJobStore((s) => s.deleteJob);
  const duplicateJob = useJobStore((s) => s.duplicateJob);
  // Only the FollowUpSheet needs jobs at render time (customer contact info).
  const jobs = useJobStore((s) => (followUpState ? s.jobs : NO_JOBS));
  // Only the actions sheet needs documents at render time (primaryDoc prop).
  const documents = useStore((s) => (actionsJob ? s.documents : NO_DOCS));
  const deleteQuote = useStore((s) => s.deleteQuote);
  const deleteInvoice = useStore((s) => s.deleteInvoice);
  const businessSettings = useStore((s) => s.businessSettings);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const pushInvoiceToXero = useStore((s) => s.pushInvoiceToXero);
  const pushQuoteToXero = useStore((s) => s.pushQuoteToXero);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const duplicateDocumentForJob = useStore((s) => s.duplicateDocumentForJob);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const setCurrentInvoice = useStore((s) => s.setCurrentInvoice);
  const saveQuote = useStore((s) => s.saveQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);
  const createInvoiceFromQuote = useStore((s) => s.createInvoiceFromQuote);

  const { showAlert, alertNode } = useAlertModal();

  const primaryDocForJob = (job: Job): Document | null => {
    if (job.primaryDocumentId) {
      const explicit = documents.find((d) => d.id === job.primaryDocumentId);
      if (explicit) return explicit;
    }
    return pickPrimaryDoc(documents.filter((d) => d.jobId === job.id));
  };

  const openFollowUpForDoc = (doc: Document) => {
    // Same aging thresholds as the sticky bar — tone firms up after
    // each window.
    const baseline =
      doc.type === 'invoice' ? (doc.dueDate ?? doc.sentAt) : doc.sentAt;
    const days = baseline
      ? (Date.now() - baseline) / (1000 * 60 * 60 * 24)
      : 0;
    const tone: FollowUpTone =
      days >= 7 ? 'overdue' : days >= 4 ? 'firm' : 'gentle';
    setFollowUpState({ doc, tone });
  };

  const handleActionSelect = async (action: JobAction, job: Job) => {
    setActionsJob(null);
    switch (action) {
      case 'edit': {
        const doc = primaryDocForJob(job);
        if (!doc) return;
        if (doc.type === 'invoice') {
          setCurrentInvoice(documentToInvoice(doc));
          navigation.navigate('NewInvoice', {
            screen: 'MaterialsList',
            params: { editing: true },
          });
        } else {
          setCurrentQuote(documentToQuote(doc));
          navigation.navigate('NewJob', {
            screen: 'MaterialsList',
            params: { editing: true },
          });
        }
        break;
      }
      case 'send': {
        const doc = primaryDocForJob(job);
        if (doc) setSendDialogDoc(doc);
        break;
      }
      case 'followUp': {
        const doc = primaryDocForJob(job);
        if (doc) openFollowUpForDoc(doc);
        break;
      }
      case 'takePayment': {
        const doc = primaryDocForJob(job);
        if (!doc) return;
        // No Square gate here — the sheet's manual "Record a payment" row
        // must work with zero Square setup; the Square rows gate themselves.
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
        } else {
          setTakePaymentTarget({
            kind: 'quote_deposit',
            quoteId: doc.id,
            depositAmount: Number(doc.depositAmount ?? 0),
            depositPaid: Number(doc.depositPaid ?? 0),
            total: Number(doc.total ?? 0),
            jobName: job.name,
            terms: doc.termsSnapshot ?? null,
          });
        }
        break;
      }
      case 'exportPdf': {
        const doc = primaryDocForJob(job);
        if (!doc) return;
        const isTrialActive = !!(
          subscriptionStatus?.trialStartedAt &&
          !subscriptionStatus?.trialExpired
        );
        const isPro = subscriptionStatus?.isPro || isTrialActive;
        try {
          await exportDocumentPDF(doc, businessSettings, 'export', { isPro });
        } catch {
          Alert.alert('Error', 'Failed to export PDF. Please try again.');
        }
        break;
      }
      case 'pushToXero': {
        const doc = primaryDocForJob(job);
        if (!doc) return;
        const noun = doc.type === 'invoice' ? 'Invoice' : 'Quote';
        try {
          if (doc.type === 'invoice') {
            await pushInvoiceToXero(documentToInvoice(doc));
          } else {
            await pushQuoteToXero(documentToQuote(doc));
          }
          showAlert({
            type: 'success',
            icon: 'cloud-check',
            title: 'Synced to Xero',
            message: `${noun} pushed successfully.`,
            primaryButtonText: 'OK',
          });
        } catch (e: any) {
          showAlert({
            type: 'error',
            icon: 'cloud-alert',
            title: 'Xero sync failed',
            message: e?.message || 'Try again in a moment.',
            primaryButtonText: 'OK',
          });
        }
        break;
      }
      case 'duplicate': {
        try {
          const cloned = await duplicateJob(job.id);
          // Fall back to the most recently updated attached doc if the job
          // never had primaryDocumentId stamped — many older jobs are in
          // that state but still have docs the JobCard renders by jobId.
          const sourceDocId =
            job.primaryDocumentId ??
            documents
              .filter((d) => d.jobId === job.id && d.stage !== 'cancelled')
              .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id;
          if (sourceDocId) {
            const clonedDoc = await duplicateDocumentForJob(
              sourceDocId,
              cloned.id,
            );
            await saveJob({
              ...cloned,
              primaryDocumentId: clonedDoc.id,
              documentIds: [clonedDoc.id],
            });
          }
          if (options.onDuplicated) {
            options.onDuplicated(cloned.id);
          } else {
            navigation.navigate('ViewJob', { jobId: cloned.id });
          }
        } catch {
          Alert.alert('Duplicate failed', 'Try again in a moment.');
        }
        break;
      }
      case 'archive':
        await saveJob({ ...job, archivedAt: Date.now() });
        break;
      case 'unarchive':
        await saveJob({ ...job, archivedAt: undefined });
        break;
      case 'delete': {
        const attached = documents.filter((d) => d.jobId === job.id);
        const paidDocs = pickPaidDocs(attached);
        if (paidDocs.length > 0) {
          showAlert({
            type: 'warning',
            icon: 'lock-outline',
            title: 'Can’t delete — paid invoice attached',
            message:
              'This job has paid or partially-paid documents that belong in your records. Archive the job instead.',
            primaryButtonText: 'OK',
          });
          return;
        }
        const docCount = attached.length;
        const message =
          docCount === 0
            ? 'This cannot be undone.'
            : `This will also delete ${docCount} attached ${docCount === 1 ? 'document' : 'documents'}. This cannot be undone.`;
        showAlert({
          type: 'error',
          icon: 'trash-can-outline',
          title: 'Delete job?',
          message,
          primaryButtonText: 'Delete',
          primaryButtonAction: async () => {
            try {
              await cascadeDeleteJob(job, attached, {
                deleteQuote,
                deleteInvoice,
                deleteJob,
              });
            } catch {
              showAlert({
                type: 'error',
                title: 'Delete failed',
                message: 'Try again in a moment.',
                primaryButtonText: 'OK',
              });
            }
          },
          secondaryButtonText: 'Cancel',
          secondaryButtonAction: () => {},
        });
        break;
      }
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
    // getState(), not the render-time `documents` — the actions sheet is
    // closed by the time Undo fires, so the gated subscription is empty.
    const current = useStore.getState().documents.find((d) => d.id === docId);
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

  // Look up the job the follow-up sheet's doc belongs to so we can
  // hand off customer contact info.
  const followUpJob = followUpState
    ? jobs.find((j) => j.id === followUpState.doc.jobId)
    : null;

  const element = (
    <>
      <JobActionsSheet
        visible={!!actionsJob}
        onDismiss={() => setActionsJob(null)}
        job={actionsJob}
        primaryDoc={actionsJob ? primaryDocForJob(actionsJob) : null}
        xeroConnected={!!xeroConnection}
        onSelect={handleActionSelect}
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

      <TakePaymentSheet
        visible={!!takePaymentTarget}
        target={takePaymentTarget}
        onDismiss={() => setTakePaymentTarget(null)}
        onError={(message) => Alert.alert('Payment error', message)}
        onRecordManualPayment={(invoiceId) =>
          navigation.navigate('RecordPayment', { invoiceId })
        }
        ensureSquareConnected={() => ensureSquareConnectedForPayment(navigation)}
      />

      {followUpState ? (
        <FollowUpSheet
          visible={!!followUpState}
          onDismiss={() => setFollowUpState(null)}
          doc={followUpState.doc}
          tone={followUpState.tone}
          customerName={followUpJob?.customerName ?? ''}
          customerPhone={followUpJob?.customerPhone}
          customerEmail={followUpJob?.customerEmail}
          businessName={businessSettings?.businessName || 'us'}
          jobName={followUpJob?.name ?? 'the job'}
        />
      ) : null}

      {alertNode}

      <Snackbar
        visible={!!markedSentDocId}
        onDismiss={() => setMarkedSentDocId(null)}
        duration={6000}
        action={{ label: 'Undo', onPress: handleUndoMarkedSent }}
      >
        Marked as sent
      </Snackbar>
    </>
  );

  // Stable identity — passed as a prop to memo'd JobCards, so a fresh
  // closure every render would defeat their React.memo.
  const open = useCallback((job: Job) => setActionsJob(job), []);

  return {
    open,
    element,
  };
}
