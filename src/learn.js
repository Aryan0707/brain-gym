/* Recall prompt modes — different ways of pulling the same idea out of memory.
 * Pure: main.js builds the context, renders the text, and logs the mode used. */

export const PROMPT_MODES = {
  // The lesson's own prompt: straight retrieval of the one idea.
  recall:  { label: 'Recall',         text: v => v.prompt },
  // Feynman: plain words expose the gaps that jargon hides.
  feynman: { label: 'Explain simply', text: () => 'Explain it to a 12-year-old: no jargon, one concrete example.' },
  // Elaboration: hook the new idea onto something already known.
  connect: { label: 'Connect',        text: () => 'This is like something I already know — what, and why?' },
};

/* Everything the chooser may look at, built by main.js from S.done and S.log.
 *   reps        completed reps on this lesson before today (0 = first time)
 *   lapses      times it was rated "lost" after being learned
 *   lastRating  effective rating of the previous rep, or null
 *   pastModes   modes used on earlier reps, oldest first
 */
export function choosePromptMode({ reps, lapses, lastRating, pastModes }){
  const lastMode = pastModes[pastModes.length - 1];   // index, not Array#at: iOS < 15.4
  // First time: the lesson's own prompt is the only one written for this idea.
  if (!reps) return 'recall';
  // Shaky or relapsing: plain words expose exactly where the gap is.
  if ((lastRating ?? 3) <= 2 || lapses > 0 && lastMode !== 'feynman') return 'feynman';
  // Secure: alternate straight recall with connecting it to what I already know.
  return lastMode === 'connect' ? 'recall' : 'connect';
}

export function promptFor(v, mode){
  return (PROMPT_MODES[mode] || PROMPT_MODES.recall).text(v);
}

/* ── Learn faster: guess first, retrieve before looking, honest self-checks, then act ───────────────────────────
   All pure. main.js owns the DOM; these only decide. */

/* 1 · Pretest. A guess made before the video, even a wrong one, makes the video easier to learn from: you watch
   for the answer. The lesson's own recall prompt is the question; a guess is one line and never gates the video. */
export const PRETEST_MIN = 3;
export const hasGuess = text => String(text ?? '').trim().length >= PRETEST_MIN;

/* 2 · Retrieval before reading. A hint is a cue (the first words of a point), never the point. The learner asks for
   it one at a time, and every hint taken lowers the rating the rep can earn. */
export const HINT_CAP = 3;
/* The best rating a rep can earn after `hints` hints: none 5, one 4, two 3, three 2. */
export const hintCeiling = hints => hints > 0 ? Math.max(2, 5 - hints) : 5;
export function hintCues(points, words = 3){
  return (points || []).map(p => {
    const w = String(p).replace(/^[\s•\-*\d.)]+/, '').split(/\s+/).filter(Boolean);
    return w.length <= words ? w.join(' ') : w.slice(0, words).join(' ') + '…';
  });
}

/* 3 · Self-check against the AI's note points when a lesson has no curated key points. Unlike 3 curated keys, a
   notes list runs 6 to 10 points, so the ceiling follows the share covered. It is still a self-check. */
export function pointsCap(matched, total){
  if (!total) return 5;
  const f = matched / total;
  return f >= .6 ? 5 : f >= .4 ? 4 : f >= .2 ? 3 : matched >= 1 ? 2 : 1;
}

/* 4 · Confidence, said before the answer is revealed, is what lets you notice that you were sure and wrong. */
export const CONFIDENCE = { 1: 'Guessing', 2: 'Fairly sure', 3: 'Certain' };

/* share of the points recalled, 0..1, or null when the rep had no key to compare with */
export const recalledShare = recall => recall && recall.total > 0 ? recall.matched / recall.total : null;

/* One line about how well the confidence matched the result, or '' when there is nothing honest to say. */
export function calibrationNote(conf, recall){
  const share = recalledShare(recall);
  if (!CONFIDENCE[conf] || share === null) return '';
  if (conf === 3 && share < .4) return 'You were certain, but covered few of the points. That gap is the thing to study.';
  if (conf === 1 && share >= .6) return 'You said guessing, yet you knew most of it. Trust your memory a little more.';
  if (conf === 3 && share >= .6) return 'Certain and right. Calibrated.';
  return '';
}

/* Across reps that logged both: how often "certain" was actually right (share >= .6). null until 5 such reps. */
export function certainHitRate(log){
  const rows = (log || []).filter(l => l.conf === 3 && recalledShare(l.recall) !== null);
  if (rows.length < 5) return null;
  return Math.round(100 * rows.filter(l => recalledShare(l.recall) >= .6).length / rows.length);
}

/* 5 · Apply it. Knowing is not doing, so lessons about behaviour end with one if-then plan, and the next review asks
   whether it happened. Thinking and reasoning lessons are concepts, not habits: no plan is asked for. */
export const ACTION_MODULES = new Set(['habits', 'energy', 'money', 'people', 'calm', 'career', 'speak', 'learn']);
export const wantsAction = v => !!v && ACTION_MODULES.has(v.module);
export const ACTION_MIN = 8;
export const ACTION_OUTCOMES = { yes: 'Did it', partly: 'Partly', no: 'Not yet' };

/* Insert or update the plan for a lesson in S.actions (one open plan per lesson). Empty text removes it.
   `actions` is mutated and returned. Entries: { id, text, day, at, outcome?: 'yes'|'partly'|'no', outcomeDay? } */
export function savePlan(actions, id, text, day, at){
  const t = String(text ?? '').trim().slice(0, 300);
  const i = actions.findIndex(a => a.id === id && !a.outcome);
  if (t.length < ACTION_MIN) { if (i >= 0) actions.splice(i, 1); return actions; }
  if (i >= 0) actions[i].text = t;
  else actions.push({ id, text: t, day, at });
  return actions;
}
/* The unanswered plan for a lesson from an earlier day (a plan is asked about at the next review, not the same day). */
export const openPlan = (actions, id, day) =>
  (actions || []).find(a => a.id === id && !a.outcome && a.day !== day) || null;
export function answerPlan(actions, id, outcome, day){
  const a = (actions || []).find(x => x.id === id && !x.outcome);
  if (a && ACTION_OUTCOMES[outcome]) { a.outcome = outcome; a.outcomeDay = day; }
  return a || null;
}
/* Plans followed through: { done, answered } across answered plans, or null before 3 answers. */
export function followThrough(actions){
  const answered = (actions || []).filter(a => a.outcome);
  if (answered.length < 3) return null;
  return { done: answered.filter(a => a.outcome === 'yes').length, answered: answered.length };
}
