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
