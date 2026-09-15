/**
 * Email an accountant statement — the PDF and the CSV in one message, built
 * server-side so the figures come from every document the tradie has, not the
 * 500 the in-app listener carries.
 *
 * Same shape as serviceReportSender: id token in, `{ error }` out on a 4xx.
 * The time zone travels with the request because the period boundaries were
 * worked out on the device in local time (see utils/statementPeriods) and the
 * dates printed on the statement have to agree with them.
 */

import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export interface SendStatementInput {
  /** Inclusive start of the period, ms epoch. */
  fromMs: number;
  /** Exclusive end of the period, ms epoch. */
  toMs: number;
  recipientEmail: string;
  /** Optional note above the statement summary. */
  emailBody?: string;
  /** BCC the tradie so they keep the exact email the accountant received. */
  sendCopyToSelf?: boolean;
}

export async function sendAccountantStatement(input: SendStatementInput): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('You need to be signed in to send a statement.');

  const res = await fetch(`${FUNCTIONS_URL}/sendAccountantStatement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ...input,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });

  if (!res.ok) {
    // The rate limiter answers with the generic "Too many requests" every
    // endpoint shares; a tradie sending their accountant a statement deserves
    // to be told what they actually hit.
    if (res.status === 429) {
      throw new Error("You've sent a few statements already this hour. Try again later.");
    }
    // The endpoint answers with { error } on 4xx (including the 413 that asks
    // for a shorter period); fall back to status text so a gateway/HTML error
    // page doesn't surface as "[object Object]".
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
