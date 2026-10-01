/* B.R.A.I.N. playlist: every lesson in one ordered list you can reorder and play straight through.
   Pure: no DOM, no storage. The saved order is S.order (an array of lesson keys).

   Until you reorder, there is no saved order: the list is each module's learning path (reel → drill → deep,
   shortest first), modules in library order. After a reorder the saved order wins; lessons it does not know
   (the daily feed, links you add later) go to the end. */
import { keyOf } from './util.js';
import { pathFor } from './tutor.js';

/* THE ordering policy when you have not arranged anything: one module after another, each shallow to deep.
   Change this one function to change the default curriculum (e.g. interleave modules or alternate languages). */
export function defaultOrder(videos, modules){
  return Object.keys(modules).flatMap(m => pathFor(videos, m));
}

/* The full playlist as video objects: saved order first (stale keys dropped), then anything new. */
export function playlistOrder(saved, videos, modules){
  const byKey = new Map(videos.map(v => [keyOf(v), v]));
  const seen = new Set(), out = [];
  const take = v => { if (!v) return; const k = keyOf(v); if (!seen.has(k)) { seen.add(k); out.push(v); } };
  for (const k of Array.isArray(saved) ? saved : []) take(byKey.get(k));
  defaultOrder(videos, modules).forEach(take);
  videos.forEach(take);   // a video whose module is unknown still plays
  return out;
}

/* Move `key` by `delta` places in a list of keys (clamped to the ends). Returns a new array. */
export function moveBy(keys, key, delta){
  const i = keys.indexOf(key);
  if (i < 0) return keys.slice();
  const to = Math.max(0, Math.min(keys.length - 1, i + delta));
  const out = keys.slice(); out.splice(i, 1); out.splice(to, 0, key);
  return out;
}

/* Put `key` straight after `anchor` (or first when there is no anchor). Returns a new array. */
export function moveAfter(keys, key, anchor){
  if (key === anchor || keys.indexOf(key) < 0) return keys.slice();
  const out = keys.filter(k => k !== key);
  const at = anchor == null ? 0 : out.indexOf(anchor) + 1;
  out.splice(at < 0 ? 0 : at, 0, key);
  return out;
}

const inLang = (v, lang) => lang === 'all' || v.lang === lang;

/* First lesson you have not learned yet, in playlist order. null = the playlist is finished. */
export function resumePoint(S, list, lang = 'all'){
  return list.find(v => inLang(v, lang) && !S.done[keyOf(v)]) || null;
}

/* The lesson after `currentKey`: the next unlearned one further down; if none, the first unlearned one
   you skipped above it; null when everything is learned. */
export function nextInPlaylist(S, list, currentKey, lang = 'all'){
  const pool = list.filter(v => inLang(v, lang));
  const at = pool.findIndex(v => keyOf(v) === currentKey);
  const open = v => keyOf(v) !== currentKey && !S.done[keyOf(v)];
  return pool.slice(at + 1).find(open) || pool.slice(0, Math.max(at, 0)).find(open) || null;
}

/* Turn pasted text into every link in it, in order, without repeats. `parse` is intake.parseLink. */
export function parseMany(raw, parse){
  const seen = new Set(), out = [];
  for (const token of String(raw ?? '').split(/\s+/)) {
    const hit = token && parse(token);
    if (hit && !seen.has(hit.id)) { seen.add(hit.id); out.push(hit); }
  }
  return out;
}
