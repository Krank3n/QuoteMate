/**
 * Email a service report to the customer, PDF attached.
 *
 * The backend for this (functions sendServiceReport) has been deployed and
 * working the whole time — it renders the PDF, attaches it, sets reply-to to
 * the tradie's business email and logs the send. Nothing in the app ever
 * called it, so "Share PDF" (a browser print dialog) was the only way a report
 * left the screen, and tradies reasonably read that as "I can't send this".
 */

import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export interface SendReportEmailInput {
  reportId: string;
  recipientEmail: string;
  /** Optional cover note above the report summary. */
  emailBody?: string;
  subject?: string;
  includePhotos?: boolean;
}

export async function sendServiceReportEmail(input: SendReportEmailInput): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('You need to be signed in to send a report.');

  const res = await fetch(`${FUNCTIONS_URL}/sendServiceReport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    // The endpoint answers with { error } on 4xx; fall back to status text so a
    // gateway/HTML error page doesn't surface as "[object Object]".
    let message = `Send failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* non-JSON body — keep the status message */
    }
    throw new Error(message);
  }
}
