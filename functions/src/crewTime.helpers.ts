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

/** What the worker's page shows of one of their own entries. */
export function crewEntryView(e: Record<string, any>, jobNames: Map<string, string>) {
  return {
    id: String(e.id),
    jobId: String(e.jobId || ''),
    jobName: jobNames.get(String(e.jobId)) || 'A job',
    date: String(e.date),
    hours: Number(e.hours) || 0,
    ...(e.note ? { note: String(e.note) } : {}),
    status: e.status === 'pending' ? ('pending' as const) : ('approved' as const),
  };
}

/**
 * Whether a crew member may change or remove an entry: only their own, and
 * only while it's still waiting. Once the boss approves it, it may already be
 * on an invoice — it's theirs to change from then on.
 */
export function crewMayChange(
  entry: Record<string, any> | undefined,
  crewId: string,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!entry || entry.workerId !== `crew:${crewId}`) {
    return { ok: false, status: 404, error: "That entry isn't there any more." };
  }
  if (entry.status !== 'pending') {
    return { ok: false, status: 409, error: "That's been approved — ask your boss if it needs changing." };
  }
  return { ok: true };
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --card2:#162132; --text:#f1f5f9; --muted:#94a3b8; --line:#334155; --accent:#f97316; --ok:#22c55e; --warn:#f59e0b; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:20px 16px 56px; }
  h1 { font-size:24px; margin:2px 0 0; }
  .biz { font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; margin:0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
  .weekbar { display:flex; align-items:center; justify-content:space-between; margin:20px 0 10px; }
  .weekbar button { width:44px; height:44px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:20px; }
  .weekbar button:disabled { opacity:.35; }
  .weeklabel { text-align:center; } .weeklabel b { display:block; font-size:16px; } .weeklabel span { font-size:13px; color:var(--muted); }
  .days { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
  .day { border:1px solid var(--line); background:var(--card); color:var(--text); border-radius:12px; padding:8px 0 7px; min-height:68px; text-align:center; font:inherit; }
  .day .dn { font-size:12px; color:var(--muted); } .day .dd { font-size:17px; font-weight:700; } .day .dh { font-size:12px; color:var(--muted); margin-top:2px; }
  .day.has .dh { color:var(--text); font-weight:600; }
  .day.today { border-color:var(--accent); }
  .day.sel { background:var(--accent); border-color:var(--accent); } .day.sel .dn, .day.sel .dh { color:#fff; }
  .day.future { opacity:.45; }
  h2 { font-size:18px; margin:24px 0 10px; }
  .entry { display:flex; align-items:center; gap:12px; width:100%; text-align:left; font:inherit; color:var(--text); background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:8px; min-height:60px; }
  .entry .grow { flex:1; min-width:0; } .entry .job { font-weight:600; } .entry .note { font-size:13px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .entry .hrs { font-size:18px; font-weight:700; white-space:nowrap; }
  .chip { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:2px 8px; margin-top:4px; }
  .chip.wait { background:rgba(245,158,11,.16); color:var(--warn); } .chip.ok { background:rgba(34,197,94,.14); color:var(--ok); }
  .entry.locked { background:var(--card2); }
  .empty { color:var(--muted); font-size:14px; padding:4px 2px 12px; }
  button.go { width:100%; min-height:52px; border:0; border-radius:14px; background:var(--accent); color:#fff; font-size:17px; font-weight:700; font-family:inherit; }
  button.go:disabled { opacity:.5; }
  button.ghost { width:100%; min-height:48px; border:1px solid var(--line); border-radius:14px; background:transparent; color:var(--text); font-size:16px; font-weight:600; font-family:inherit; margin-top:8px; }
  button.danger { color:#f87171; border-color:rgba(248,113,113,.4); }
  .form { background:var(--card); border:1px solid var(--accent); border-radius:16px; padding:16px; margin-top:4px; }
  .form h3 { margin:0 0 2px; font-size:17px; } .form .for { font-size:13px; color:var(--muted); margin-bottom:12px; }
  label.f { display:block; font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); margin:14px 0 6px; }
  select, input[type=text], input[inputmode] { width:100%; min-height:48px; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--text); font-size:17px; font-family:inherit; }
  .row { display:flex; gap:8px; align-items:center; } .row input { flex:0 0 96px; }
  .q { min-height:44px; min-width:52px; padding:0 12px; border-radius:999px; border:1px solid var(--line); background:var(--bg); color:var(--text); font-size:15px; font-weight:600; font-family:inherit; }
  .q.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .actions { margin-top:18px; }
  .msg { margin-top:14px; padding:12px 14px; border-radius:12px; font-size:15px; display:none; }
  .msg.ok { display:block; background:rgba(34,197,94,.14); border:1px solid var(--ok); }
  .msg.err { display:block; background:rgba(245,158,11,.14); border:1px solid var(--warn); }
  .pin { margin-top:28px; display:flex; gap:12px; align-items:flex-start; }
  .pin .x { margin-left:auto; background:none; border:0; color:var(--muted); font-size:20px; min-width:32px; min-height:32px; }
  .center { text-align:center; padding:40px 0; }
</style>
</head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body>
</html>`;
}

/**
 * The crew member's page: their week, Monday to Sunday, opening on today.
 * Everything but the shell is filled in by the script from the page's own
 * actions (state / week / log / update / delete), so this HTML carries no
 * business data and a cached copy of it leaks nothing.
 */
export function crewTimePage(token: string): string {
  const body = `
  <div class="biz" id="biz">&nbsp;</div>
  <h1 id="hello">Your hours</h1>
  <p class="muted" id="sub">Loading…</p>

  <div id="app" style="display:none">
    <div class="weekbar">
      <button type="button" id="prev" aria-label="Previous week">‹</button>
      <div class="weeklabel"><b id="weeklabel"></b><span id="weektotal"></span></div>
      <button type="button" id="next" aria-label="Next week">›</button>
    </div>
    <div class="days" id="days" role="tablist" aria-label="Days of the week"></div>

    <h2 id="dayhead"></h2>
    <div id="list"></div>
    <button type="button" class="go" id="add"></button>

    <div class="form" id="form" style="display:none">
      <h3 id="formtitle">Add hours</h3>
      <div class="for" id="formfor"></div>
      <label class="f" for="job">Job</label>
      <select id="job"></select>
      <label class="f" for="hours">Hours</label>
      <div class="row">
        <input id="hours" inputmode="decimal" placeholder="7.5" autocomplete="off" aria-label="Hours worked">
        <button type="button" class="q" data-h="4">4</button>
        <button type="button" class="q" data-h="6">6</button>
        <button type="button" class="q" data-h="8">8</button>
      </div>
      <label class="f" for="note">What you did (optional)</label>
      <input type="text" id="note" maxlength="200" placeholder="e.g. rough-in, decking boards">
      <div class="actions">
        <button type="button" class="go" id="save">Save</button>
        <button type="button" class="ghost" id="cancel">Cancel</button>
        <button type="button" class="ghost danger" id="del" style="display:none">Delete</button>
      </div>
    </div>
    <div class="msg" id="msg" role="status"></div>

    <div class="card pin" id="pin" style="display:none">
      <div>📌</div>
      <div><b>Keep this on your phone</b><p class="muted" id="pintext" style="margin-top:4px"></p></div>
      <button type="button" class="x" id="pinx" aria-label="Hide">×</button>
    </div>
  </div>`;

  const script = `
(function(){
  var token = ${JSON.stringify(token)};
  var api = location.pathname + '?token=' + encodeURIComponent(token);
  var $ = function(id){ return document.getElementById(id); };
  var DN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var DLONG = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONLONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function key(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function parse(k){ var p = k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function addDays(k, n){ var d = parse(k); d.setDate(d.getDate() + n); return key(d); }
  function monday(k){ var d = parse(k); var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return key(d); }
  function hrs(n){ return (Math.round(n * 100) / 100) + ' h'; }
  function text(el, s){ el.textContent = s; }
  var today = key(new Date());
  var maxDay = today;
  var S = { jobs: [], start: monday(today), sel: today, entries: [], editing: null };

  function call(action, body){
    return fetch(api + '&action=' + action + (body ? '' : ''), body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
  }
  function show(kind, s){ var m = $('msg'); m.className = 'msg ' + kind; text(m, s); }
  function clearMsg(){ $('msg').className = 'msg'; }

  function loadWeek(){
    return fetch(api + '&action=week&start=' + S.start).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error); return j; }); })
      .then(function(j){ S.entries = j.entries || []; render(); });
  }

  function render(){
    var start = parse(S.start), end = parse(addDays(S.start, 6));
    text($('weeklabel'), S.start === monday(today) ? 'This week' : 'Week of ' + start.getDate() + ' ' + MON[start.getMonth()]);
    var total = S.entries.reduce(function(t, e){ return t + e.hours; }, 0);
    text($('weektotal'), start.getDate() + ' ' + MON[start.getMonth()] + ' – ' + end.getDate() + ' ' + MON[end.getMonth()] + ' · ' + hrs(total));
    $('next').disabled = addDays(S.start, 7) > maxDay;
    var days = $('days'); days.innerHTML = '';
    for (var i = 0; i < 7; i++) (function(i){
      var k = addDays(S.start, i), d = parse(k);
      var h = S.entries.filter(function(e){ return e.date === k; }).reduce(function(t, e){ return t + e.hours; }, 0);
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.className = 'day' + (k === S.sel ? ' sel' : '') + (k === today ? ' today' : '') + (k > maxDay ? ' future' : '') + (h ? ' has' : '');
      b.setAttribute('aria-selected', k === S.sel ? 'true' : 'false');
      b.setAttribute('aria-label', DLONG[i] + ' ' + d.getDate() + ' ' + MONLONG[d.getMonth()] + (h ? ', ' + hrs(h) : ''));
      var a = document.createElement('div'); a.className = 'dn'; text(a, DN[i]);
      var c = document.createElement('div'); c.className = 'dd'; text(c, d.getDate());
      var e = document.createElement('div'); e.className = 'dh'; text(e, h ? hrs(h) : '·');
      b.appendChild(a); b.appendChild(c); b.appendChild(e);
      b.addEventListener('click', function(){ S.sel = k; closeForm(); clearMsg(); render(); });
      days.appendChild(b);
    })(i);
    var sd = parse(S.sel), si = (sd.getDay() + 6) % 7;
    text($('dayhead'), (S.sel === today ? 'Today · ' : '') + DLONG[si] + ' ' + sd.getDate() + ' ' + MONLONG[sd.getMonth()]);
    var list = $('list'); list.innerHTML = '';
    var mine = S.entries.filter(function(e){ return e.date === S.sel; });
    if (!mine.length) { var p = document.createElement('div'); p.className = 'empty'; text(p, S.sel > maxDay ? "That day hasn't happened yet." : 'No hours in for this day.'); list.appendChild(p); }
    mine.forEach(function(e){
      var row = document.createElement('button'); row.type = 'button';
      row.className = 'entry' + (e.status === 'approved' ? ' locked' : '');
      var g = document.createElement('div'); g.className = 'grow';
      var j = document.createElement('div'); j.className = 'job'; text(j, e.jobName); g.appendChild(j);
      if (e.note) { var n = document.createElement('div'); n.className = 'note'; text(n, e.note); g.appendChild(n); }
      var ch = document.createElement('span'); ch.className = 'chip ' + (e.status === 'pending' ? 'wait' : 'ok');
      text(ch, e.status === 'pending' ? 'Waiting · tap to change' : 'Approved'); g.appendChild(ch);
      var hh = document.createElement('div'); hh.className = 'hrs'; text(hh, hrs(e.hours));
      row.appendChild(g); row.appendChild(hh);
      row.addEventListener('click', function(){
        if (e.status !== 'pending') { show('err', "That's been approved — ask your boss if it needs changing."); return; }
        openForm(e);
      });
      list.appendChild(row);
    });
    var add = $('add'); var short = DN[si];
    add.style.display = S.sel > maxDay || $('form').style.display === 'block' ? 'none' : '';
    text(add, '+ Add hours for ' + (S.sel === today ? 'today' : short + ' ' + sd.getDate()));
  }

  function fillJobs(selected){
    var sel = $('job'); sel.innerHTML = '';
    if (!S.jobs.length) { var o = document.createElement('option'); o.value = ''; text(o, 'No jobs open right now'); sel.appendChild(o); return; }
    if (!selected && S.jobs.length > 1) { var p = document.createElement('option'); p.value = ''; text(p, 'Pick the job…'); sel.appendChild(p); }
    S.jobs.forEach(function(j){ var o = document.createElement('option'); o.value = j.id; text(o, j.address ? j.name + ' — ' + j.address : j.name); sel.appendChild(o); });
    if (selected && !S.jobs.some(function(j){ return j.id === selected.id; })) { var x = document.createElement('option'); x.value = selected.id; text(x, selected.name); sel.insertBefore(x, sel.firstChild); }
    sel.value = selected ? selected.id : (S.jobs.length === 1 ? S.jobs[0].id : '');
  }
  function setQuick(v){ Array.prototype.forEach.call(document.querySelectorAll('.q'), function(b){ b.className = 'q' + (b.getAttribute('data-h') === String(v) ? ' on' : ''); }); }
  function openForm(e){
    S.editing = e || null; clearMsg();
    var sd = parse(S.sel);
    text($('formtitle'), e ? 'Change these hours' : 'Add hours');
    text($('formfor'), 'For ' + DLONG[(sd.getDay() + 6) % 7] + ' ' + sd.getDate() + ' ' + MONLONG[sd.getMonth()] + ' · pick another day above');
    fillJobs(e ? { id: e.jobId, name: e.jobName } : null);
    $('hours').value = e ? String(e.hours) : ''; setQuick(e ? e.hours : '');
    $('note').value = e && e.note ? e.note : '';
    $('del').style.display = e ? '' : 'none'; $('del').removeAttribute('data-armed'); text($('del'), 'Delete');
    $('form').style.display = 'block'; $('add').style.display = 'none';
    $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeForm(){ S.editing = null; $('form').style.display = 'none'; }

  Array.prototype.forEach.call(document.querySelectorAll('.q'), function(b){
    b.addEventListener('click', function(){ $('hours').value = b.getAttribute('data-h'); setQuick(b.getAttribute('data-h')); });
  });
  $('hours').addEventListener('input', function(){ setQuick($('hours').value.trim()); });
  $('add').addEventListener('click', function(){ openForm(null); });
  $('cancel').addEventListener('click', function(){ closeForm(); render(); });
  $('prev').addEventListener('click', function(){ S.start = addDays(S.start, -7); S.sel = S.start; closeForm(); clearMsg(); loadWeek(); });
  $('next').addEventListener('click', function(){ S.start = addDays(S.start, 7); S.sel = S.start === monday(today) ? today : S.start; closeForm(); clearMsg(); loadWeek(); });

  $('save').addEventListener('click', function(){
    var jobId = $('job').value, hours = $('hours').value.trim();
    if (!jobId) return show('err', 'Pick the job first.');
    if (!hours) return show('err', 'How many hours?');
    $('save').disabled = true;
    var body = { jobId: jobId, date: S.sel, hours: hours, note: $('note').value };
    var editing = S.editing;
    if (editing) body.id = editing.id;
    call(editing ? 'update' : 'log', body).then(function(){
      closeForm(); return loadWeek().then(function(){ show('ok', editing ? 'Changed. Your boss sees the new hours.' : 'Sent. Your boss will approve it.'); });
    }).catch(function(err){ show('err', err.message || "Couldn't save that — check your signal and try again."); })
      .then(function(){ $('save').disabled = false; });
  });
  $('del').addEventListener('click', function(){
    var e = S.editing; if (!e) return;
    // No confirm(): the /t frame is sandboxed without allow-modals, where it
    // silently returns false. Second tap deletes.
    var btn = $('del');
    if (btn.getAttribute('data-armed') !== '1') { btn.setAttribute('data-armed', '1'); text(btn, 'Tap again to delete ' + hrs(e.hours)); return; }
    btn.removeAttribute('data-armed');
    call('delete', { id: e.id }).then(function(){ closeForm(); return loadWeek().then(function(){ show('ok', 'Deleted.'); }); })
      .catch(function(err){ show('err', err.message || "Couldn't delete that."); });
  });

  // "Keep this on your phone" — how to put it on the home screen, once,
  // until they close it. Storage can be blocked in a framed page; no harm.
  var pinned = false; try { pinned = localStorage.getItem('qmCrewPinHidden') === '1'; } catch (e) {}
  var ua = navigator.userAgent || '';
  var standalone = (window.navigator.standalone === true) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (!pinned && !standalone) {
    text($('pintext'), /iPhone|iPad|iPod/.test(ua)
      ? 'This link is yours — it stays the same. Tap Share (the square with the arrow) at the bottom of Safari, then Add to Home Screen.'
      : /Android/.test(ua)
        ? 'This link is yours — it stays the same. Tap ⋮ at the top of Chrome, then Add to Home screen.'
        : 'This link is yours — it stays the same. Bookmark it, or add it to your phone\\'s home screen.');
    $('pin').style.display = '';
  }
  $('pinx').addEventListener('click', function(){ $('pin').style.display = 'none'; try { localStorage.setItem('qmCrewPinHidden', '1'); } catch (e) {} });

  Promise.all([
    fetch(api + '&action=state').then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }),
    fetch(api + '&action=week&start=' + S.start).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
  ]).then(function(rs){
    var st = rs[0], wk = rs[1];
    if (!st.ok) { text($('hello'), "This link isn't working"); text($('sub'), st.j.error || 'Ask your boss to send you a new one.'); return; }
    S.jobs = st.j.jobs || []; S.entries = wk.ok ? (wk.j.entries || []) : [];
    text($('biz'), st.j.businessName);
    text($('hello'), st.j.crewName.split(' ')[0] + "'s hours");
    text($('sub'), 'Put your hours in each day. ' + st.j.businessName + ' approves them — until then you can change them.');
    $('app').style.display = '';
    render();
  }).catch(function(){ text($('sub'), "Couldn't load — check your signal and refresh."); });
})();`;

  return pageShell('Your hours', body, script);
}
