// Service Report entity — a customer-facing leave-behind document a tradie
// produces after a service visit.
//
// Stored at users/{uid}/reports/{reportId}. Linked to a Job via `jobId`.
// A report is NOT a Document: it carries no money, no stage, and no line
// items — just what was found, what was done, and what's recommended next,
// plus optional signatures and photos. shared/ is symlinked into
// functions/src/shared so this same file serves client and server.

import { JobPhoto } from '../job/types';
import { SendMethod } from '../document/types';

export type ServiceReportStatus = 'draft' | 'sent';

export interface SignatureCapture {
  svgPath: string;
  name: string;
  signedAt: number;
  // Capture-space dimensions of the pad the signature was drawn on. The PDF
  // renderer uses these as its SVG viewBox — without them it has to guess,
  // and a wrong guess clips the ink. Optional for early captures; renderers
  // fall back to 300×150.
  width?: number;
  height?: number;
}

export interface ReportChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ServiceReport {
  id: string;
  jobId: string;
  userId: string;
  number: string; // "RP-001"
  visitDate: number;
  serviceType: string;
  riskAssessment?: string;
  equipment: string[];
  itemsChecked: ReportChecklistItem[];
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
  photos?: JobPhoto[];
  customerSignature?: SignatureCapture;
  technicianSignature?: SignatureCapture;
  status: ServiceReportStatus;
  sentAt?: number;
  sendMethod?: SendMethod;
  createdAt: number;
  updatedAt: number;
}
