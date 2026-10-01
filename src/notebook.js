/* B.R.A.I.N. organized notebook: every video you learned, filed Module → shallow-to-deep,
   each with all of its notes (oldest first, so you can see the idea grow). Pure: no DOM. */
import { keyOf, segmentDuration } from './util.js';
import { levelOf, stepOf } from './level.js';

/* How deep a video goes: a reel primes, a drill teaches one idea, a deep video expands it. */
export const DEPTH = { reel:0, drill:1, deep:2 };
export const depthOf = v => DEPTH[v.tier] ?? (v.src === 'ig' ? DEPTH.reel : DEPTH.drill);

/* Order of two learned videos inside one module's shelf.
   Each item is { v, card, notes } — v is the library video, card is S.done[key]
   ({ reps, avg, first, last, ... }), notes are that video's notes oldest first. */
export function shelfOrder(a, b){
  // Basics to advanced, then shallow to deep (reel → drill → deep), then in the order you learned them,
  // then shortest first, so each module reads like a small curriculum.
  const sa = stepOf(a.v), sb = stepOf(b.v);
  return levelOf(a.v) - levelOf(b.v) || (sa === sb ? 0 : sa < sb ? -1 : 1) || depthOf(a.v) - depthOf(b.v)
    || String(a.card?.first ?? '9999').localeCompare(String(b.card?.first ?? '9999'))
    || (segmentDuration(a.v) || 0) - (segmentDuration(b.v) || 0);
}

/* Notes come from imported backups unvalidated, so title/text may be missing. */
const lower = s => String(s ?? '').toLowerCase();
const matches = (item, q) => !q
  || lower(item.v.title).includes(q)
  || item.notes.some(n => lower(n.text).includes(q));

/* [{ module, name, color, items:[{ v, card, notes }] }] — only modules you have learned in.
   Notes whose video left the library (a removed reel) land in a final "Removed videos" shelf. */
export function buildShelves({ videos, modules, notes, done, query = '' }){
  const q = query.toLowerCase().trim();
  const notesByKey = new Map();
  for (const n of notes) {
    if (!notesByKey.has(n.id)) notesByKey.set(n.id, []);
    notesByKey.get(n.id).push(n);
  }
  const placed = new Set();
  const shelves = Object.keys(modules).map(m => {
    const items = videos
      .filter(v => v.module === m && (done[keyOf(v)] || notesByKey.has(keyOf(v))))
      .map(v => { placed.add(keyOf(v)); return { v, card: done[keyOf(v)] || null, notes: notesByKey.get(keyOf(v)) || [] }; })
      .filter(item => matches(item, q))
      .sort(shelfOrder);
    return { module: m, name: modules[m][0], color: modules[m][1], items };
  }).filter(s => s.items.length);

  const orphans = [...notesByKey].filter(([key]) => !placed.has(key))
    .map(([key, ns]) => ({ v: { id: key, title: ns[ns.length - 1].title || 'Removed video', removed: true }, card: done[key] || null, notes: ns }))
    .filter(item => matches(item, q));
  if (orphans.length) shelves.push({ module: null, name: 'Removed videos', color: 'var(--muted)', items: orphans });
  return shelves;
}
