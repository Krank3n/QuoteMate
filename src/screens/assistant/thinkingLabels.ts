// What Mate says it's doing while a turn is in flight.
//
// Deliberately driven by the TOOL CALLS the model actually makes, not by its
// reasoning. Surfacing raw model thinking would leak prompt internals, tool
// names and half-formed guesses about the tradie's customers — and we have
// already had a raw "Thought:" line reach a tradie as a greeting. A tool call
// is a fact about what the app is doing right now, so it can be shown plainly.
//
// Pure so the copy can be unit tested without a session.

export const DEFAULT_THINKING_LABEL = 'Thinking…';

function firstString(args: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const k of keys) {
    const v = args?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * A short line describing a tool call in the tradie's terms. Never echoes the
 * tool name, and only quotes an argument when it is something they typed
 * themselves (a customer name), never an id.
 */
export function labelForToolCall(name: string, args?: Record<string, unknown>): string {
  switch (name) {
    case 'find_customer': {
      const who = firstString(args, 'name', 'query');
      return who ? `Looking up ${who}…` : 'Looking up the customer…';
    }
    case 'list_recent_quotes': return 'Going through your recent quotes…';
    case 'get_quote': return 'Pulling up that quote…';
    case 'show_quote': return 'Putting it on screen…';
    case 'get_business_defaults': return 'Checking your rates…';
    case 'get_job_requirements': return 'Working out what this job needs…';
    case 'search_supplier_book': return 'Checking your supplier book…';
    case 'review_quote': return 'Checking the prices…';
    case 'list_service_reports': return 'Looking for service reports…';
    case 'propose_draft_quote': return 'Writing up the scope…';
    case 'propose_add_line_item': return 'Adding that line…';
    case 'propose_send_quote': return 'Getting the send ready…';
    case 'propose_import_supplier_list': return 'Getting the reader ready…';
    case 'propose_reprice': return 'Setting up a re-price…';
    case 'propose_remember_preference': return 'Noting how you quote…';
    case 'propose_save_rate': return 'Saving that rate…';
    default:
      // Every other propose_* is Mate drafting a card. Anything genuinely
      // unknown falls back to the neutral line rather than naming the tool.
      return name.startsWith('propose_') ? 'Writing it up…' : DEFAULT_THINKING_LABEL;
  }
}

/**
 * One line for a whole turn's worth of calls. Gemini can ask for several at
 * once; naming the first is more useful than "doing 3 things", and stringing
 * them together would outrun the width of the bubble.
 */
export function labelForToolCalls(
  calls: Array<{ name: string; args?: Record<string, unknown> }>,
): string {
  if (!calls.length) return DEFAULT_THINKING_LABEL;
  return labelForToolCall(calls[0].name, calls[0].args);
}
