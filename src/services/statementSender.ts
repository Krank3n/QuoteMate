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
import { deviceTimeZone } from '../utils/statementPeriods';

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

export interface SendStatementResult {
  /** What the server actually put in the email. Absent if it didn't say. */
  invoiceCount?: number;
  paymentCount?: number;
}

/**
 * Well past a slow render of a busy financial year (the function itself gives
 * up at 120 s), but short of holding a socket open forever on a dead signal.
 */
const SEND_TIMEOUT_MS = 60_000;

export async function sendAccountantStatement(
  input: SendStatementInput,
): Promise<SendStatementResult> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('You need to be signed in to send a statement.');

  const controller = new AbortController();
  const backstop = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/sendAccountantStatement`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...input,
        timeZone: deviceTimeZone(),
      }),
    });
  } catch (err: any) {
    // The send may well have gone through — the server finishes what it
    // started — so neither message tells the tradie to send it again.
    if (err?.name === 'AbortError') {
      throw new Error(
        "That's taking longer than usual. Check your email in a minute before sending it again.",
      );
    }
    // A dropped socket surfaces as a bare TypeError on web and "Network
    // request failed" on a phone; neither means anything to a tradie.
    throw new Error("Couldn't reach the server. Check your signal and try again.");
  } finally {
    clearTimeout(backstop);
  }

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

  // The counts come back so the confirmation can say what went across. A body
  // that isn't the JSON we expect just means the sheet stays vague.
  const body: any = await res.json().catch(() => ({}));
  return {
    invoiceCount: typeof body?.invoiceCount === 'number' ? body.invoiceCount : undefined,
    paymentCount: typeof body?.paymentCount === 'number' ? body.paymentCount : undefined,
  };
}
