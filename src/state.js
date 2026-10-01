/* B.R.A.I.N. persisted state: schema, migration, sanitisation, drafts.
 *
 * Public API:
 *   loadState(LIB)   → { S, event }   event: 'ok' | 'corrupt' | 'blank'
 *   save(S)
 *   blank()
 *   sanitizeState(raw, LIB) → state (throws on invalid root)
 *   migrateV1toV2(S)         → { S, backedUp: bool }
 *   loadDraft/saveDraft/clearDraft/pruneDrafts
 *   backupCurrent(reason)
 *   restoreLatestBackup(reason) → state | null
 */
import { KEY, DRAFT_KEY, DAY, todayKey, toast } from './util.js';
import { localMidnight, EASE_START, DAY_MS } from './scheduler.js';

const IMPORT_KEY_RE = /^[A-Za-z0-9_-]{5,40}$/;
const LANGS = ['hi', 'en'];

export function blank(){
  return { v:2, xp:0, done:{}, log:[], notes:[], custom:[], order:[],
           streak:{cur:0,best:0,last:null}, sessionDate:null, extra:0 };
}

/* Storage can be full (QuotaExceededError) or blocked (Safari with site data off,
 * some in-app webviews). A rep must never throw mid-flow because of it: the app
 * keeps running in memory and tells the user once. Returns false on failure. */
let saveWarned = false;
export function save(S){
  try { localStorage.setItem(KEY, JSON.stringify(S)); saveWarned = false; return true; }
  catch {
    if (!saveWarned) toast('Could not save — storage is full or blocked. Export a backup.');
    saveWarned = true;
    return false;
  }
}

export function loadState(){
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return { S: blank(), event: 'blank' }; }
  if (!raw) return { S: blank(), event: 'blank' };
  try {
    const S = JSON.parse(raw);
    if (!S || typeof S !== 'object' || Array.isArray(S)) throw new Error('root not object');
    return { S: coerceDefaults(S), event: 'ok' };
  } catch {
    // Quarantine unreadable blob so nothing is lost (keep the newest 3 copies).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      localStorage.setItem(`braingym.corrupt.${stamp}`, raw);
      trimKeys('braingym.corrupt.', 3);
      localStorage.removeItem(KEY);
    } catch {}
    return { S: blank(), event: 'corrupt' };
  }
}

function trimKeys(prefix, keep){
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort();
  while (keys.length > keep) localStorage.removeItem(keys.shift());
}

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

/* The playlist order: an array of unique lesson keys. Anything else means "no saved order". */
export function cleanOrder(o){
  if (!Array.isArray(o)) return [];
  return [...new Set(o.filter(k => typeof k === 'string' && k && k.length <= 60))];
}

/* Shape-check every collection so one bad entry cannot crash a render. Used on
 * load and on import; entries that cannot be repaired are dropped. */
function coerceDefaults(S){
  const st = isObj(S.streak) ? S.streak : {};
  S.streak = {
    cur:  Number.isFinite(st.cur)  ? st.cur  : 0,
    best: Number.isFinite(st.best) ? st.best : 0,
    last: typeof st.last === 'string' ? st.last : null,
  };
  S.custom = Array.isArray(S.custom) ? S.custom.filter(isObj) : [];
  S.order  = cleanOrder(S.order);
  S.log    = Array.isArray(S.log) ? S.log.filter(e => isObj(e) && typeof e.id === 'string') : [];
  S.notes  = Array.isArray(S.notes)
    ? S.notes.filter(n => isObj(n) && typeof n.id === 'string').map(n => ({
        ...n, title: String(n.title ?? ''), text: String(n.text ?? '') }))
    : [];
  const done = isObj(S.done) ? S.done : {};
  S.done = {};
  for (const [k, d] of Object.entries(done)) if (isObj(d)) {
    for (const f of ['reps','lapses','sum','avg']) if (!Number.isFinite(d[f])) d[f] = 0;
    S.done[k] = d;
  }
  if (!Number.isFinite(S.extra)) S.extra = 0;
  if (!Number.isFinite(S.xp))    S.xp = 0;
  if (typeof S.sessionDate !== 'string') S.sessionDate = null;
  return S;
}

/* ── drafts ─────────────────────────────────────────────── */
export function loadDrafts(){
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}
function saveDrafts(d){ try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {} }

/* Debounced per keystroke. The pending write is tracked by lesson so that
 * clearDraft (rep finished) cancels it instead of being overwritten 400 ms
 * later, and switching lessons flushes the previous lesson's text. */
let draftTimer = null, pending = null;
function writeDraft({ id, text }){
  const d = loadDrafts();
  if (text && text.trim()) d[id] = { text, at: new Date().toISOString() };
  else delete d[id];
  saveDrafts(d);
}
function flushDraft(){
  clearTimeout(draftTimer);
  if (pending) writeDraft(pending);
  pending = null;
}
export function saveDraft(id, text){
  if (!id) return;
  if (pending && pending.id !== id) flushDraft();
  clearTimeout(draftTimer);
  pending = { id, text };
  draftTimer = setTimeout(flushDraft, 400);
}
export function loadDraft(id){ if (pending?.id === id) flushDraft(); return loadDrafts()[id]?.text || ''; }
export function clearDraft(id){
  if (pending?.id === id) { clearTimeout(draftTimer); pending = null; }
  const d = loadDrafts(); delete d[id]; saveDrafts(d);
}
export function pruneDrafts(){
  const d = loadDrafts(); const cutoff = Date.now() - 7 * DAY; let changed = false;
  for (const k of Object.keys(d)) if (!d[k]?.at || Date.parse(d[k].at) < cutoff) {
    delete d[k]; changed = true;
  }
  if (changed) saveDrafts(d);
}

/* ── backups ────────────────────────────────────────────── */
export function backupCurrent(reason){
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    localStorage.setItem(`braingym.backup.${reason}.${stamp}`, raw);
    trimKeys(`braingym.backup.${reason}.`, 3);
  } catch {}
}
export function restoreLatestBackup(reason){
  const prefix = `braingym.backup.${reason}.`;
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort();
    if (!keys.length) return null;
    const S = JSON.parse(localStorage.getItem(keys[keys.length - 1]));
    return isObj(S) ? coerceDefaults(S) : null;
  } catch { return null; }
}

/* ── sanitisation for import ────────────────────────────── */
export function sanitizeState(raw, LIB){
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('root must be an object');
  const out = { ...blank(), ...parsed };
  out.v          = Number(parsed.v) || 1;
  out.xp         = Number.isFinite(parsed.xp) ? parsed.xp : 0;
  out.done       = (parsed.done && typeof parsed.done === 'object') ? parsed.done : {};
  out.log        = Array.isArray(parsed.log) ? parsed.log : [];
  out.notes      = Array.isArray(parsed.notes) ? parsed.notes : [];
  out.extra      = Number.isFinite(parsed.extra) ? parsed.extra : 0;
  out.sessionDate = typeof parsed.sessionDate === 'string' ? parsed.sessionDate : null;
  const st = parsed.streak || {};
  out.streak = {
    cur:  Number.isFinite(st.cur)  ? st.cur  : 0,
    best: Number.isFinite(st.best) ? st.best : 0,
    last: typeof st.last === 'string' ? st.last : null,
  };
  const rawCustom = Array.isArray(parsed.custom) ? parsed.custom : [];
  const kept = [], dropped = [];
  for (const c of rawCustom) {
    if (c && typeof c === 'object' && typeof c.id === 'string' && IMPORT_KEY_RE.test(c.id)
        && typeof c.module === 'string' && LIB.modules[c.module]
        && LANGS.includes(c.lang) && (c.src === undefined || c.src === 'ig'
          || (c.src === 'yt' && /^[A-Za-z0-9_-]{11}$/.test(c.id))))
      kept.push({ id:c.id, module:c.module, lang:c.lang,
        ...(c.src === 'yt' ? { src:'yt', ...(c.shorts === true ? { shorts:true } : {}) } : {}),
        ...(typeof c.title === 'string' && c.title.trim() ? { title:c.title.trim().slice(0, 200) } : {}) });
    else dropped.push(c);
  }
  out.custom = kept;
  out.order = cleanOrder(parsed.order);
  coerceDefaults(out);
  out.__droppedCustom = dropped.length;
  for (const e of out.log)   if (!e.day && e.at) try { e.day = todayKey(new Date(e.at)); } catch {}
  for (const n of out.notes) if (!n.day && n.at) try { n.day = todayKey(new Date(n.at)); } catch {}
  return out;
}

/* ── v1 → v2 migration (idempotent) ────────────────────────
 * Adds ease, lapses, interval (days), dueAt (epoch ms local midnight) to every
 * done entry; backfills log/notes `day`; sets v:2. If v is already 2 or a card
 * already carries `dueAt`, it is left alone.
 */
export function migrateV1toV2(S){
  let backedUp = false;
  if (S.v === 2) { repairCards(S); return { S, backedUp }; }
  // Save the raw v1 blob exactly once.
  try {
    if (!localStorage.getItem('braingym.v1.backup')) {
      const raw = localStorage.getItem(KEY);
      if (raw) { localStorage.setItem('braingym.v1.backup', raw); backedUp = true; }
    }
  } catch {}

  const OLD_INTERVAL = { 1:0, 2:2, 3:4, 4:9, 5:21 };
  for (const id of Object.keys(S.done)) {
    const d = S.done[id];
    if (Number.isFinite(d.dueAt) && d.ease != null) continue;   // idempotent
    const lastDay = d.last || null;
    const nextDay = d.nextDue || null;
    let interval;
    if (lastDay && nextDay) {
      interval = Math.max(1, Math.round((Date.parse(nextDay) - Date.parse(lastDay)) / DAY));
    } else if (d.avg) {
      interval = OLD_INTERVAL[Math.round(d.avg)] || 1;
    } else {
      interval = 1;
    }
    d.interval = Math.min(interval, 180);
    d.ease     = EASE_START;
    d.lapses   = S.log.filter(l => l.id === id && (l.rating === 1 || l.selfRating === 1)).length;
    const anchor = nextDay ? Date.parse(nextDay) : Date.now();
    d.dueAt    = localMidnight(anchor, 0);
    d.relearning = false;
    delete d.checks;   // dead field from v1
  }
  for (const e of S.log)   if (!e.day && e.at) try { e.day = todayKey(new Date(e.at)); } catch {}
  for (const n of S.notes) if (!n.day && n.at) try { n.day = todayKey(new Date(n.at)); } catch {}
  S.v = 2;
  return { S, backedUp };
}

/* A v2 card with no usable due date (hand-edited or truncated backup) would
 * never come due and would show NaN% retention. Make it due today instead. */
function repairCards(S){
  for (const d of Object.values(S.done)) {
    if (!Number.isFinite(d.dueAt)) { d.dueAt = localMidnight(Date.now(), 0); d.relearning = false; }
    if (!Number.isFinite(d.interval) || d.interval < 0) d.interval = 1;
    if (!Number.isFinite(d.ease)) d.ease = EASE_START;
  }
}
