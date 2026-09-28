/* Session picker, streak, retention/capacity — all read S + LIB, all pure-ish. */
import { LIB } from './library.js';
import { TARGET, todayKey, days, keyOf, segmentDuration } from './util.js';
import { retention, isDue } from './scheduler.js';

/* rep counting ─────────────────────────────────────────── */
export function firstRepsToday(S){
  const t = todayKey();
  return S.log.filter(l => (l.day || l.at?.slice(0,10)) === t && !l.repeat);
}
export const repsToday = S => firstRepsToday(S).length;

export function repeatedToday(S, id){
  const t = todayKey();
  return S.log.some(l => l.id === id && (l.day || l.at?.slice(0,10)) === t);
}

/* due queue ────────────────────────────────────────────── */
export function dueList(S, nowMs = Date.now()){
  return LIB.videos
    .filter(v => S.done[keyOf(v)] && isDue(S.done[keyOf(v)], nowMs))
    .map(v => ({ v, overdueDays: Math.max(0, Math.floor((nowMs - S.done[keyOf(v)].dueAt) / 86400000)) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

/* capacity: retention across all items in the module (unseen = 0). */
export function capacity(S, moduleKey, nowMs = Date.now()){
  const all = LIB.videos.filter(v => v.module === moduleKey);
  if (!all.length) return 0;
  let sum = 0;
  for (const v of all) if (S.done[keyOf(v)]) sum += retention(S.done[keyOf(v)], nowMs);
  return Math.round((sum / all.length) * 100);
}

/* streak ──────────────────────────────────────────────── */
export function displayStreak(S){
  const last = S.streak?.last;
  if (!last) return 0;
  return days(last) <= 1 ? S.streak.cur : 0;
}
export function bumpStreak(S){
  const t = todayKey();
  if (S.streak.last === t) return;
  S.streak.cur = (S.streak.last && days(S.streak.last) === 1) ? S.streak.cur + 1 : 1;
  S.streak.best = Math.max(S.streak.best, S.streak.cur);
  S.streak.last = t;
}

/* session picker ──────────────────────────────────────── */
/* Reels and unknown-length custom items count as short; unknown YouTube as mid. */
const lengthOf = v => segmentDuration(v) || (v.src === 'ig' || v.tier === 'reel' ? 60 : 600);

/* Keep order, but take the first item of each module before any repeats. */
export function interleave(items){
  const firsts = [], rest = [], seenMods = new Set();
  for (const v of items) {
    (seenMods.has(v.module) ? rest : firsts).push(v);
    seenMods.add(v.module);
  }
  return [...firsts, ...rest];
}

export function pickSession(S, lang, extraRep, nowMs = Date.now()){
  const picks = [];
  const seen = new Set();
  const okLang = v => lang === 'all' || v.lang === lang;
  const push = v => { if (v && !seen.has(keyOf(v))) { seen.add(keyOf(v)); picks.push(v); } };

  // Interleave reviews: most overdue first, but not two from the same module.
  const due = dueList(S, nowMs).filter(x => okLang(x.v) && !repeatedToday(S, keyOf(x.v))).map(x => x.v);
  interleave(due).slice(0, 2).forEach(push);

  // Weakest module first; inside a module, shortest first (a reel primes the deep video).
  const fresh = LIB.videos.filter(v => !S.done[keyOf(v)] && okLang(v));
  const cap = Object.fromEntries(Object.keys(LIB.modules).map(m => [m, capacity(S, m, nowMs)]));
  const cand = [...fresh].sort((a, b) => (cap[a.module] ?? 0) - (cap[b.module] ?? 0) || lengthOf(a) - lengthOf(b));
  let lastLang = null;
  const target = Math.max(1, TARGET + S.extra - repsToday(S) + (extraRep ? 1 : 0));
  while (picks.length < target && cand.length) {
    const pool = cand.filter(v => !seen.has(keyOf(v)) && !picks.some(p => p.module === v.module));
    const usable = pool.length ? pool : cand.filter(v => !seen.has(keyOf(v)));
    if (!usable.length) break;
    const alt = lang === 'all' && lastLang ? usable.find(v => v.lang !== lastLang) : null;
    const next = alt || usable[0];
    push(next);
    lastLang = next.lang;
  }
  return picks;
}
