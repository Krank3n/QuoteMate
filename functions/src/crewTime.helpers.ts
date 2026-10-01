/**
 * Pure pieces of the crew time link (crewTime.ts): token hashing, what a
 * crew member may see, validating what they send in, and the page itself.
 * No Firestore here, so all of it is unit-tested.
 */

import { createHash, randomBytes } from 'crypto';
import { isDateKey, isValidEntryHours, parseHoursInput } from './shared/time/hours';
import type { CrewMember } from './shared/time/types';

/**
 * One "hours sent in" push per business per this window. A crew member who
 * puts in three days at once, or a whole crew at knock-off, is one buzz —
 * the job screen shows every entry waiting either way.
 */
export const CREW_PUSH_COOLDOWN_MS = 15 * 60 * 1000;

/** Whether a newly created time entry should tell the owner it arrived. */
export function decideCrewSendInPush(
  entry: Record<string, unknown> | undefined,
  lastCrewPushAtMs: number | undefined,
  nowMs: number,
): { push: boolean; reason: 'ok' | 'not_crew_send_in' | 'cooldown' } {
  if (!entry || entry.source !== 'crew_link' || entry.status !== 'pending') {
    return { push: false, reason: 'not_crew_send_in' };
  }
  if (typeof lastCrewPushAtMs === 'number' && nowMs - lastCrewPushAtMs < CREW_PUSH_COOLDOWN_MS) {
    return { push: false, reason: 'cooldown' };
  }
  return { push: true, reason: 'ok' };
}

/** Where a crew member's link lands — the branded /t page that frames crewTimePage. */
export const CREW_LINK_PAGE = 'https://quotemateapp.au/t';

export function crewLinkPageUrl(token: string): string {
  return `${CREW_LINK_PAGE}?token=${encodeURIComponent(token)}`;
}

/** Invite emails per business per rolling day — enough for a whole crew, useless for spam. */
export const CREW_INVITE_DAILY_LIMIT = 20;

/** A plausible single address — the app validates too; this is the server's own check. */
export function isCrewEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(value.trim());
}

/**
 * The words in a crew invite. It comes from the business, to someone who
 * works for them — so it says whose hours these are for, what the link does,
 * that nothing needs installing, and that the boss signs off before anything
 * counts. No app name: the crew member is dealing with their boss.
 */
export function crewInviteEmailCopy(crewName: string, businessName: string): {
  subject: string;
  preheader: string;
  greeting: string;
  paragraphs: string[];
  button: string;
  footnote: string;
} {
  const first = String(crewName || '').trim().split(/\s+/)[0] || 'there';
  const biz = String(businessName || '').trim() || 'Your boss';
  return {
    subject: `Your hours link for ${biz}`,
    preheader: `Put your hours in for ${biz} from your phone.`,
    greeting: `G'day ${first},`,
    paragraphs: [
      `${biz} wants your hours put in on the job. This is your own link — open it on your phone, pick the job, and put in the day and how many hours. No app to install, no account to set up.`,
      `${biz} checks your hours and approves them before they go anywhere.`,
    ],
    button: 'Put your hours in',
    footnote: `Keep this email — the link stays the same until ${biz} sends you a new one. Wasn't expecting it? You can ignore it.`,
  };
}

/** How far back a crew member can put hours in. The owner can go further. */
export const CREW_LOG_MAX_DAYS_BACK = 60;
export const CREW_NOTE_MAX = 200;

export function newCrewToken(): string {
  return randomBytes(24).toString('base64url');
}

/** The link doc id — only the hash is ever stored server-side. */
export function hashCrewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A token shape worth looking up (anything else is refused before a read). */
export function isPlausibleToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token);
}

/** The crew member a link belongs to, if they're still on the crew. */
export function liveCrewMember(crew: unknown, crewId: string): CrewMember | null {
  if (!Array.isArray(crew)) return null;
  const member = crew.find((c: any) => c && c.id === crewId) as CrewMember | undefined;
  return member && !member.archived ? member : null;
}

/** Jobs a crew member can put time against: won and not yet closed off. */
export const CREW_JOB_STAGES = ['accepted', 'scheduled', 'in_progress', 'completed'] as const;

/**
 * Whether a job goes on a crew member's list. Archiving stamps `archivedAt`
 * and leaves the stage alone, so the stage query alone would keep showing an
 * archived job — and its customer's address — to every crew link.
 */
export function isCrewVisibleJob(job: Record<string, unknown>): boolean {
  return (CREW_JOB_STAGES as readonly string[]).includes(String(job.stage)) && !job.archivedAt && !job.archived;
}

/**
 * The caller's address for rate limiting. The LEFTMOST x-forwarded-for value
 * is whatever the client sent; Google's front end appends the real one, so
 * the rightmost is the one to trust. Sanitised: a '/' in a Firestore doc id
 * throws before the limiter's own error handling.
 */
export function rateLimitIp(forwardedFor: unknown, fallback: string | undefined): string {
  const parts = typeof forwardedFor === 'string' ? forwardedFor.split(',').map((p) => p.trim()).filter(Boolean) : [];
  const ip = parts[parts.length - 1] || fallback || 'unknown';
  return ip.replace(/[^\w.:-]/g, '_').slice(0, 64);
}

/** Where the crew page may be framed — the branded /t page, nowhere else. */
export const CREW_PAGE_FRAME_ANCESTORS = "frame-ancestors 'self' https://quotemateapp.au https://www.quotemateapp.au";

export interface CrewJobView {
  id: string;
  name: string;
  address: string;
}

/**
 * What a crew member sees of a job: its name and where it is. Never the
 * customer's contact details, never a price.
 */
export function crewJobView(id: string, job: Record<string, unknown>): CrewJobView {
  return {
    id,
    name: String(job.name || 'Untitled job').slice(0, 120),
    address: String(job.jobAddress || '').slice(0, 160),
  };
}

export interface CrewLogInput {
  jobId: string;
  date: string;
  hours: number;
  note?: string;
}

/** YYYY-MM-DD for a UTC instant shifted by whole days (validation bounds only). */
function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Check what a crew member sent. The day is the phone's local day, so the
 * bounds are loose by a day either side of UTC — the point is to stop a
 * typo'd year or a far-future date, not to referee time zones.
 */
export function validateCrewLog(body: unknown, now: number = Date.now()): { input?: CrewLogInput; error?: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const jobId = typeof b.jobId === 'string' ? b.jobId.trim() : '';
  if (!jobId || jobId.length > 128 || jobId.includes('/')) return { error: 'Pick a job.' };
  const date = typeof b.date === 'string' ? b.date : '';
  if (!isDateKey(date)) return { error: "That date doesn't look right." };
  const DAY = 24 * 60 * 60 * 1000;
  if (date > dayKeyUtc(now + DAY)) return { error: "You can't put in hours for a day that hasn't happened yet." };
  if (date < dayKeyUtc(now - (CREW_LOG_MAX_DAYS_BACK + 1) * DAY)) {
    return { error: `That's more than ${CREW_LOG_MAX_DAYS_BACK} days back — ask your boss to put it in.` };
  }
  const hours = typeof b.hours === 'number' ? Math.round(b.hours * 100) / 100 : parseHoursInput(String(b.hours ?? ''));
  if (hours === null || !isValidEntryHours(hours)) return { error: 'Hours need to be more than 0 and no more than 24.' };
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, CREW_NOTE_MAX) : '';
  return { input: { jobId, date, hours, ...(note ? { note } : {}) } };
}

const esc = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Shown for a missing, revoked or stale link — says nothing about whose it was. */
export function crewLinkDeadPage(): string {
  return pageShell(
    'Link not working',
    `<div class="card"><h1>This link isn't working</h1><p class="muted">It may have been turned off. Ask your boss to send you a new one.</p></div>`,
  );
}

function pageShell(title: string, body: string, script = ''): string {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --text:#f1f5f9; --muted:#94a3b8; --line:#334155; --accent:#f97316; --ok:#22c55e; --warn:#f59e0b; }
  @media (prefers-color-scheme: light) { :root { --bg:#f8fafc; --card:#fff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:20px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:22px 0 8px; }
  .muted { color:var(--muted); font-size:14px; margin:0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
  .job { display:flex; gap:12px; align-items:flex-start; padding:12px 14px; min-height:52px; border:1px solid var(--line); border-radius:12px; background:var(--card); margin-bottom:8px; cursor:pointer; }
  .job input { margin-top:4px; width:20px; height:20px; accent-color:var(--accent); }
  .job b { display:block; } .job span { color:var(--muted); font-size:13px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { min-height:44px; padding:0 16px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:15px; font-weight:600; }
  .chip[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
  input[type=text], input[type=date], input[inputmode] { width:100%; min-height:48px; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:17px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .row input { flex:0 0 110px; }
  button.go { width:100%; min-height:52px; margin-top:22px; border:0; border-radius:14px; background:var(--accent); color:#fff; font-size:17px; font-weight:700; }
  button.go:disabled { opacity:.5; }
  .msg { margin-top:14px; padding:12px 14px; border-radius:12px; font-size:15px; display:none; }
  .msg.ok { display:block; background:rgba(34,197,94,.14); border:1px solid var(--ok); }
  .msg.err { display:block; background:rgba(245,158,11,.14); border:1px solid var(--warn); }
  .entry { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); font-size:14px; }
  .entry:last-child { border-bottom:0; }
  .tag { font-size:12px; color:var(--muted); }
</style>
</head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body>
</html>`;
}

/**
 * The crew member's page. Everything but the shell is filled in by the
 * script from `?action=state`, so this HTML carries no business data and a
 * cached copy of it leaks nothing.
 */
export function crewTimePage(token: string): string {
  const body = `
  <h1 id="hello">Put your hours in</h1>
  <p class="muted" id="biz">Loading…</p>

  <form id="f" novalidate style="display:none">
    <h2>Which job</h2>
    <div id="jobs"></div>
    <p class="muted" id="nojobs" style="display:none">No jobs open right now — check with your boss.</p>

    <h2>Which day</h2>
    <div class="chips">
      <button type="button" class="chip" data-day="0" aria-pressed="true">Today</button>
      <button type="button" class="chip" data-day="1" aria-pressed="false">Yesterday</button>
      <input type="date" id="date" aria-label="Another day" style="flex:1; min-width:150px">
    </div>

    <h2>Hours</h2>
    <div class="row">
      <input id="hours" inputmode="decimal" placeholder="e.g. 7.5" aria-label="Hours worked" autocomplete="off">
      <button type="button" class="chip" data-h="4">4h</button>
      <button type="button" class="chip" data-h="8">8h</button>
    </div>

    <h2>Note (optional)</h2>
    <input type="text" id="note" maxlength="200" placeholder="What you did — e.g. rough-in" aria-label="Note">

    <button class="go" id="go" type="submit">Send my hours</button>
    <div class="msg" id="msg" role="status"></div>
  </form>

  <div id="recentWrap" style="display:none">
    <h2>What you've sent</h2>
    <div class="card" id="recent"></div>
  </div>`;

  const script = `
(function(){
  var token = ${JSON.stringify(token)};
  var api = location.pathname + '?token=' + encodeURIComponent(token);
  var $ = function(id){ return document.getElementById(id); };
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function dayKey(back){ var d = new Date(); d.setDate(d.getDate() - back); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function text(el, s){ el.textContent = s; }
  var day = dayKey(0);
  $('date').max = dayKey(0);
  $('date').min = dayKey(${CREW_LOG_MAX_DAYS_BACK});
  function pickDay(key, btn){
    day = key;
    Array.prototype.forEach.call(document.querySelectorAll('[data-day]'), function(b){ b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-day]'), function(b){
    b.addEventListener('click', function(){ $('date').value = ''; pickDay(dayKey(+b.getAttribute('data-day')), b); });
  });
  $('date').addEventListener('change', function(){ if ($('date').value) pickDay($('date').value, null); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-h]'), function(b){
    b.addEventListener('click', function(){ $('hours').value = b.getAttribute('data-h'); });
  });
  function show(kind, s){ var m = $('msg'); m.className = 'msg ' + kind; text(m, s); }
  function niceDay(k){ var p = k.split('-'); var d = new Date(+p[0], +p[1]-1, +p[2]); return d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }); }
  function renderRecent(list){
    var box = $('recent'); box.innerHTML = '';
    if (!list || !list.length) { $('recentWrap').style.display = 'none'; return; }
    $('recentWrap').style.display = '';
    list.forEach(function(e){
      var row = document.createElement('div'); row.className = 'entry';
      var left = document.createElement('div');
      var t = document.createElement('div'); text(t, niceDay(e.date) + ' · ' + e.jobName);
      var tag = document.createElement('div'); tag.className = 'tag'; text(tag, e.status === 'pending' ? 'Waiting for approval' : 'Approved');
      left.appendChild(t); left.appendChild(tag);
      var h = document.createElement('b'); text(h, e.hours + ' h');
      row.appendChild(left); row.appendChild(h); box.appendChild(row);
    });
  }
  function load(){
    fetch(api + '&action=state').then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }).then(function(res){
      if (!res.ok) { text($('hello'), "This link isn't working"); text($('biz'), res.j.error || 'Ask your boss to send you a new one.'); return; }
      var s = res.j;
      text($('hello'), "G'day " + s.crewName.split(' ')[0]);
      text($('biz'), 'Put your hours in for ' + s.businessName + '. They approve them before anything goes on a job.');
      var jobs = $('jobs'); jobs.innerHTML = '';
      s.jobs.forEach(function(job, i){
        var l = document.createElement('label'); l.className = 'job';
        var r = document.createElement('input'); r.type = 'radio'; r.name = 'job'; r.value = job.id; if (s.jobs.length === 1) r.checked = true;
        var d = document.createElement('div'); var b = document.createElement('b'); text(b, job.name);
        d.appendChild(b); if (job.address) { var sp = document.createElement('span'); text(sp, job.address); d.appendChild(sp); }
        l.appendChild(r); l.appendChild(d); jobs.appendChild(l);
      });
      $('nojobs').style.display = s.jobs.length ? 'none' : '';
      $('f').style.display = '';
      renderRecent(s.recent);
    }).catch(function(){ text($('biz'), "Couldn't load — check your signal and refresh."); });
  }
  $('f').addEventListener('submit', function(ev){
    ev.preventDefault();
    var job = document.querySelector('input[name=job]:checked');
    if (!job) return show('err', 'Pick a job first.');
    var hours = $('hours').value.trim();
    if (!hours) return show('err', 'How many hours?');
    $('go').disabled = true;
    fetch(api + '&action=log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.value, date: day, hours: hours, note: $('note').value })
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }).then(function(res){
      if (!res.ok) return show('err', res.j.error || "Couldn't send that — try again.");
      show('ok', 'Sent: ' + res.j.entry.hours + ' h on ' + niceDay(res.j.entry.date) + '. Your boss will approve it.');
      $('hours').value = ''; $('note').value = '';
      renderRecent(res.j.recent);
    }).catch(function(){ show('err', "Couldn't tell if that went through — check your signal, then refresh and look under What you've sent before sending it again."); })
      .then(function(){ $('go').disabled = false; });
  });
  load();
})();`;

  return pageShell('Put your hours in', body, script);
}
