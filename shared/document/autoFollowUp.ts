/**
 * Is auto customer follow-up on for this account?
 *
 * One setting chases two kinds of silence on the tradie's behalf: a sent quote
 * nobody has answered, and an invoice past its due date. Both go out under the
 * tradie's own business name, so the account-level answer has to be identical
 * on the phone (the Business Defaults switch) and in the schedulers that
 * actually send. This is that single answer — never read the raw field.
 *
 * DEFAULT ON. `undefined` means the switch was never touched, and those
 * accounts follow up; only an explicit `false` opts out. It shipped opt-in and
 * almost nobody found the switch, while the funnel is blunt about what silence
 * costs: a quote nobody chases dies of it. The stored field keeps exactly the
 * same shape through the flip — an absent field is still "the default", it
 * just points the other way now, so no backfill is needed.
 */
export function resolveAutoCustomerFollowUp(value?: boolean | null): boolean {
  return value !== false;
}

/**
 * Is this account following up ONLY because the default says so — i.e. it has
 * never touched the switch either way?
 *
 * The schedulers need this on top of the yes/no above, because the flip to
 * default-on enrolled thousands of accounts that never asked for it, each with
 * a back catalogue of silent quotes and unpaid invoices. Chasing that history
 * is the one thing a changed default must not do, so a defaulted account only
 * gets chases opened on documents dated after the flip — see
 * DEFAULT_ON_FROM_MS and FollowUpOptions.openFromMs in customerFollowUp.ts.
 *
 * An explicit `true` is not defaulted, and is deliberately NOT held back: an
 * account that opted in before the flip has chases already running that the
 * floor would silently kill. It also means a tradie who saves Business
 * Defaults with the switch visibly on writes an explicit `true` and unlocks
 * their back catalogue — which is the right reading, because at that point it
 * is their setting doing the chasing and not our default.
 */
export function isAutoCustomerFollowUpDefaulted(value?: boolean | null): boolean {
  return value === undefined || value === null;
}
