/* B.R.A.I.N. tutor: AI study notes for a lesson, and the step-by-step path through a module.
   Pure: no DOM, no network (the AI call lives in ai.js). */
import { keyOf, segmentDuration } from './util.js';
import { depthOf } from './notebook.js';
import { levelOf } from './level.js';

/* notes.json → { [videoId]: { summary, points:[{ t, text }] } }. Filled by loadNotes() in library.js. */
export const NOTES = {};

export const notesFor = v => (v && NOTES[v.id]?.points?.length && !Number.isFinite(v.start)) ? NOTES[v.id] : null;

const stamp = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { stamp };

/* The note a new lesson starts with: the AI's points as bullets, ready to edit. */
export const notesAsText = n => n.points.map(p => `• ${p.text}`).join('\n');

/* Did the learner change the AI draft? 'as-is' | 'edited' — logged so progress can tell them apart. */
export const noteOrigin = (draft, written) =>
  String(written).trim() === String(draft).trim() ? 'as-is' : 'edited';

/* Index of the last point already reached at playback second `t` (-1 before the first). */
export function reachedIndex(points, t){
  let i = -1;
  for (let k = 0; k < points.length; k++) if (points[k].t <= t + 0.5) i = k;
  return i;
}

/* One module's path: basics to advanced (level, see level.js), then shallow to deep (reel → drill → deep), then
   shortest first, then library order. Each step builds on the last, so a module reads like a small course.
   A lesson with no approved level sorts by its length class, as before. `lang` filters, 'all' keeps both. */
export function pathFor(videos, module, lang = 'all'){
  return videos
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.module === module && (lang === 'all' || v.lang === lang))
    .sort((a, b) => levelOf(a.v) - levelOf(b.v) || depthOf(a.v) - depthOf(b.v)
      || (segmentDuration(a.v) || 0) - (segmentDuration(b.v) || 0) || a.i - b.i)
    .map(({ v }) => v);
}

/* Where `v` sits on its path and what comes next.
   → { step, total, next, upcoming } | null. `next` is the first step you have not learned after `v`,
   else the first unlearned step anywhere on the path (a step you skipped); null when the path is done.
   `upcoming` = the next few unlearned steps, for the AI to choose between. */
export function pathAfter(S, videos, v, lang = 'all', how = 3){
  const path = pathFor(videos, v.module, lang);
  const at = path.findIndex(x => keyOf(x) === keyOf(v));
  if (at < 0) return null;
  const todo = path.filter(x => !S.done[keyOf(x)] && keyOf(x) !== keyOf(v));
  const after = todo.filter(x => path.indexOf(x) > at);
  const upcoming = (after.length ? after : todo).slice(0, how);
  const learned = path.filter(x => S.done[keyOf(x)] || keyOf(x) === keyOf(v)).length;
  return { step: at + 1, total: path.length, learned, next: upcoming[0] || null, upcoming };
}

/* The model's answer → one of `candidates` and a short reason, else null (the plain path order is used). */
export function parseNextPick(text, candidates){
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch { return null; }
  const pick = candidates.find(c => keyOf(c) === o?.id);
  const reason = String(o?.reason ?? '').trim().slice(0, 240);
  return pick && reason ? { video: pick, reason } : null;
}
