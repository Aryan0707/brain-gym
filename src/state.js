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
import { KEY, DRAFT_KEY, DAY, todayKey } from './util.js';
import { localMidnight, EASE_START, DAY_MS } from './scheduler.js';

const IMPORT_KEY_RE = /^[A-Za-z0-9_-]{5,40}$/;
const LANGS = ['hi', 'en'];

export function blank(){
  return { v:2, xp:0, done:{}, log:[], notes:[], custom:[],
           streak:{cur:0,best:0,last:null}, sessionDate:null, extra:0 };
}

export function save(S){ localStorage.setItem(KEY, JSON.stringify(S)); }

export function loadState(){
  const raw = localStorage.getItem(KEY);
  if (!raw) return { S: blank(), event: 'blank' };
  try {
    const S = JSON.parse(raw);
    if (!S || typeof S !== 'object' || Array.isArray(S)) throw new Error('root not object');
    return { S: coerceDefaults(S), event: 'ok' };
  } catch {
    // Quarantine unreadable blob so nothing is lost.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { localStorage.setItem(`braingym.corrupt.${stamp}`, raw); } catch {}
    localStorage.removeItem(KEY);
    return { S: blank(), event: 'corrupt' };
  }
}

function coerceDefaults(S){
  if (!S.streak) S.streak = { cur:0, best:0, last:null };
  if (!S.custom) S.custom = [];
  if (!S.log)    S.log = [];
  if (!S.notes)  S.notes = [];
  if (!S.done)   S.done = {};
  if (typeof S.extra !== 'number') S.extra = 0;
  if (typeof S.xp    !== 'number') S.xp = 0;
  return S;
}

/* ── drafts ─────────────────────────────────────────────── */
export function loadDrafts(){
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}
function saveDrafts(d){ try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {} }

let draftTimer = null;
export function saveDraft(id, text){
  if (!id) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const d = loadDrafts();
    if (text && text.trim()) d[id] = { text, at: new Date().toISOString() };
    else delete d[id];
    saveDrafts(d);
  }, 400);
}
export function loadDraft(id){ return loadDrafts()[id]?.text || ''; }
export function clearDraft(id){ const d = loadDrafts(); delete d[id]; saveDrafts(d); }
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
    const prefix = `braingym.backup.${reason}.`;
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort();
    while (keys.length > 3) localStorage.removeItem(keys.shift());
  } catch {}
}
export function restoreLatestBackup(reason){
  const prefix = `braingym.backup.${reason}.`;
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort();
  if (!keys.length) return null;
  try { return JSON.parse(localStorage.getItem(keys[keys.length - 1])); } catch { return null; }
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
        ...(c.src === 'yt' ? { src:'yt', ...(c.shorts === true ? { shorts:true } : {}) } : {}) });
    else dropped.push(c);
  }
  out.custom = kept;
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
  if (S.v === 2) return { S, backedUp };
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
    if (d.dueAt != null && d.ease != null) continue;   // idempotent
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
