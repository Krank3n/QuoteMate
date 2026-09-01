// Turn whatever was thrown into something a bug report can act on.
//
// The voice-open catch used to render `err?.message || 'unknown error'`, and
// a real session failure came back as literally "Voice mode is offline:
// unknown error" — which says only that something with no `.message` was
// thrown. That is the one case where the fallback text mattered, and it threw
// the evidence away: not every rejection is an Error. React Native bridges
// reject with plain objects carrying `code`, promises can reject with
// undefined, and code can throw a bare string.
//
// The output still lands in front of a tradie, so it stays short and never
// dumps a stack — but it must never again be a dead end for whoever reads the
// conversation log.

export function describeThrown(err: unknown): string {
  if (err === null) return 'null thrown';
  if (err === undefined) return 'nothing thrown (undefined)';

  if (typeof err === 'string') return err.trim() || 'empty string thrown';
  if (typeof err !== 'object') return `${String(err)} (${typeof err})`;

  const e = err as { message?: unknown; name?: unknown; code?: unknown };
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  const code = e.code === undefined || e.code === null ? '' : String(e.code).trim();

  if (message && code) return `${message} (${code})`;
  if (message) return message;
  // No message: a name or a native error code is all the identity there is,
  // and either is worth far more than "unknown error".
  if (name && code) return `${name} (${code})`;
  if (code) return `error code ${code}`;
  if (name) return name;

  return 'unknown error';
}
