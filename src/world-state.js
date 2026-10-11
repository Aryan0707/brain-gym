/* World Map: isolated written-course progress; never touches the video deck. */
import { nextReview, localMidnight } from './scheduler.js';

export const WORLD_KEY = 'braingym.world.v1';
export const blankWorld = () => ({ v:1, lessons:{}, drafts:{}, lastLesson:null });
const idOK = id => typeof id === 'string' && /^wm-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 160;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const pointsOK = x => Array.isArray(x) && x.length === 3 && x.every(v => typeof v === 'boolean');
const ratingOK = x => Number.isInteger(x) && x >= 1 && x <= 5;
const finite = x => Number.isFinite(x) && x >= 0;
export const sameLocalDay = (a, b) => localMidnight(a) === localMidnight(b);

/* The card a new self-check produces. `previous` is the stored entry, or undefined on a first save.
   Return `previous.card` itself to leave the schedule untouched; otherwise return a new card.
   Every success multiplies the interval, so re-saving without a guard once moved a lesson from
   4 days to 180 in eight minutes. The video trainer answers a same-day repeat with "Schedule unchanged". */
export function scheduleFor(previous, effectiveRating, now){
  // Same rule as the video trainer: a second save on the same local day is practice, not a review.
  if (previous?.card && Number.isFinite(previous.at) && sameLocalDay(previous.at, now)) return previous.card;
  const card = nextReview(previous?.card, effectiveRating, now);
  card.reps = (previous?.card?.reps || 0) + 1;
  card.sum = (previous?.card?.sum || 0) + effectiveRating;
  card.avg = card.sum / card.reps;
  return card;
}

/* Due for review, and not already practised today: like the video trainer, a lesson saved today
   leaves the queue until tomorrow, since another save today would not move its schedule. */
export const worldDue = (entry, now) => object(entry?.card) && Number.isFinite(entry.card.dueAt)
  && entry.card.dueAt <= now && !(Number.isFinite(entry.at) && sameLocalDay(entry.at, now));

/* How many saved lessons are due. The Library calls this with the raw stored string;
   anything unreadable counts as nothing due, never as an error. */
export function worldDueCount(raw, now){
  try {
    const lessons = JSON.parse(raw)?.lessons;
    if (!object(lessons)) return 0;
    return Object.values(lessons).filter(e => worldDue(e, now)).length;
  } catch { return 0; }
}

/* Strict imports: validate before backing up or replacing anything. Unknown but
   well-formed historical IDs are retained so a course edit cannot erase notes. */
export function decodeWorld(raw){
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(data) || data.v !== 1 || !object(data.lessons) || !object(data.drafts)
      || !(data.lastLesson === null || idOK(data.lastLesson))) throw Error('Invalid World Map progress file.');
  const next = blankWorld();
  next.lastLesson = data.lastLesson;
  for (const [id, entry] of Object.entries(data.lessons)) {
    if (!idOK(id) || !object(entry) || typeof entry.note !== 'string' || entry.note.trim().length < 15
        || entry.note.length > 12000 || !pointsOK(entry.matched) || !ratingOK(entry.rating)
        || !ratingOK(entry.effectiveRating) || entry.selfChecked !== true || !finite(entry.at)
        || !object(entry.card) || !finite(entry.card.dueAt) || !finite(entry.card.interval)
        || !Number.isInteger(entry.card.reps) || entry.card.reps < 1 || !finite(entry.card.ease)
        || !finite(entry.card.lapses)) throw Error('Invalid World Map recall record.');
    const effectiveRating = Math.min(entry.rating, [1,2,3,5][entry.matched.filter(Boolean).length]);
    next.lessons[id] = { note:entry.note, matched:entry.matched.slice(), rating:entry.rating,
      effectiveRating, selfChecked:true, at:entry.at, card:{ ...entry.card } };
  }
  for (const [id, text] of Object.entries(data.drafts)) {
    if (!idOK(id) || typeof text !== 'string' || text.length > 12000) throw Error('Invalid World Map draft.');
    next.drafts[id] = text;
  }
  return next;
}

export class WorldStore {
  constructor(storage, lessonIds){
    this.storage = storage;
    this.allowed = new Set(lessonIds);
    this.state = blankWorld();
    this.warning = '';
    this.persisted = false;
    this.writeBlocked = false;
    let raw;
    try { raw = storage.getItem(WORLD_KEY); }
    catch { this.warning = 'Progress is not saved on this device. Export a copy before leaving.'; return; }
    if (raw === null) { this.persisted = true; return; }
    try { this.state = decodeWorld(raw); this.persisted = true; }
    catch {
      try {
        const parsed = JSON.parse(raw);
        if (object(parsed) && parsed.v !== 1) {
          this.writeBlocked = true;
          this.warning = 'This progress uses a different version. The original is untouched; new practice is not saved.';
          return;
        }
      } catch {}
      try {
        this.backup(raw);
        this.recoveredRaw = raw;
        this.warning = 'Progress was unreadable. A raw copy was kept before starting fresh.';
        this.persisted = true;
      } catch {
        this.writeBlocked = true;
        this.warning = 'Progress was unreadable and could not be backed up. The original is untouched; new practice is not saved.';
      }
    }
  }

  backup(raw){
    let key = `braingym.world.backup.${Date.now()}`;
    while (this.storage.getItem(key) !== null) key += '-copy';
    this.storage.setItem(key, raw);
  }

  sync(){
    if (!this.persisted || this.writeBlocked) return;
    try {
      const raw = this.storage.getItem(WORLD_KEY);
      if (raw === this.recoveredRaw) return; // backed-up corruption awaiting the first fresh write
      this.state = raw === null ? blankWorld() : decodeWorld(raw);
    } catch {
      this.writeBlocked = true;
      this.warning = 'Stored progress changed to an unreadable version. The original is untouched; new practice is not saved.';
    }
  }

  persist(next){
    this.state = next;
    try {
      if (this.writeBlocked) throw Error('Protected old state');
      this.storage.setItem(WORLD_KEY, JSON.stringify(next));
      this.recoveredRaw = undefined;
      this.persisted = true;
    } catch {
      this.persisted = false;
      if (!this.writeBlocked) this.warning = 'Progress is not saved on this device. Export a copy before leaving.';
    }
    return this.persisted;
  }

  setDraft(id, text){
    if (!this.allowed.has(id) || typeof text !== 'string' || text.length > 12000) throw Error('Invalid recall draft.');
    this.sync();
    const drafts = { ...this.state.drafts };
    if (text) drafts[id] = text; else delete drafts[id];
    this.persist({ ...this.state, drafts });
  }

  record(id, { note, matched, rating }, now = Date.now()){
    if (!this.allowed.has(id) || typeof note !== 'string' || note.trim().length < 15
        || note.length > 12000 || !pointsOK(matched) || !ratingOK(rating) || !finite(now))
      throw Error('Write a fresh answer, self-check three points, and choose a rating.');
    this.sync();
    const previous = this.state.lessons[id];
    const effectiveRating = Math.min(rating, [1,2,3,5][matched.filter(Boolean).length]);
    const card = scheduleFor(previous, effectiveRating, now);
    const rescheduled = !previous || card !== previous.card;
    const entry = { note, matched:matched.slice(), rating, effectiveRating,
      selfChecked:true, at:now, card:{ ...card } };
    const drafts = { ...this.state.drafts }; delete drafts[id];
    this.persist({ ...this.state, lessons:{ ...this.state.lessons, [id]:entry }, drafts, lastLesson:id });
    return { ...entry, rescheduled };
  }

  import(raw){
    const next = decodeWorld(raw);
    const previous = this.storage.getItem(WORLD_KEY);
    if (previous !== null) this.backup(previous);
    this.storage.setItem(WORLD_KEY, JSON.stringify(next));
    this.state = next;
    this.persisted = true;
    this.writeBlocked = false;
    this.warning = '';
    return next;
  }
}
