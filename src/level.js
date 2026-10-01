/* B.R.A.I.N. levels: how far along a topic a lesson sits, from basics to advanced. Pure: no DOM, no storage.

   `level` is a field on a library lesson: 1 Basics, 2 Core, 3 Advanced. It is DIFFICULTY, which `tier` (reel,
   drill, deep) is not: tier only says how long a lesson is. Levels are proposed by tools/propose_levels.py and only
   reach library.json when the owner runs tools/apply_levels.py, so until then a lesson has none.

   Until a lesson has one, `levelOf` falls back to its length class, which keeps the path order exactly as it was.
   `hasLevel` tells the UI whether a level is real, so it never shows a label the owner has not approved. */

export const LEVELS = { 1: 'Basics', 2: 'Core', 3: 'Advanced' };

const isLevel = n => Number.isInteger(n) && n >= 1 && n <= 3;

/* A real, approved level on the lesson. */
export const hasLevel = v => isLevel(v?.level);

/* 1 | 2 | 3. The approved level, else the length class (reel 1, drill 2, deep 3) so old paths sort as before. */
export function levelOf(v){
  if (hasLevel(v)) return v.level;
  return ({ reel: 1, drill: 2, deep: 3 })[v?.tier] ?? (v?.src === 'ig' ? 1 : 2);
}

/* "Basics" | "Core" | "Advanced" for an approved level; '' when the lesson has none. */
export const levelLabel = v => hasLevel(v) ? LEVELS[v.level] : '';

/* Lessons per level in one module (and language): [basics, core, advanced]. Only approved levels count. */
export function levelCounts(videos, module, lang = 'all'){
  const out = [0, 0, 0];
  for (const v of videos) if (v.module === module && (lang === 'all' || v.lang === lang) && hasLevel(v)) out[v.level - 1]++;
  return out;
}
