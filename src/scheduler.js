/* B.R.A.I.N. scheduler — PURE functions, no DOM, no localStorage.
 *
 * Card shape:
 *   { reps, lapses, ease, interval, dueAt, first, last, sum, avg, relearning? }
 *
 * The scheduler owns intervals and due dates. Callers pass an already-capped
 * effectiveRating (own-note key cap etc) and the current epoch ms.
 */

export const EASE_START     = 2.5;
export const EASE_MIN       = 1.3;
export const EASE_MAX       = 3.0;
export const MAX_INTERVAL   = 180;                 // days
export const RELEARN_HOURS  = 3;
export const HOUR_MS        = 3_600_000;
export const DAY_MS         = 86_400_000;

// Days added AFTER the first successful rep, keyed by effective rating.
// Also used as the first-success interval after a lapse (rating 2..5), with
// rating 2 explicitly forced to 1 day to stay conservative.
export const FIRST_INTERVAL = { 2: 1, 3: 1, 4: 2, 5: 4 };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* Local-midnight-of-today-plus-N-days as an epoch ms. */
export function localMidnight(nowMs, addDays = 0){
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + addDays);
  return d.getTime();
}

export function isDue(card, nowMs){
  if (!card || card.dueAt == null) return false;
  return card.dueAt <= nowMs;
}

/* Estimated share of the card the user would still recall right now.
 * relearning cards are treated as half-known regardless of nominal interval. */
export function retention(card, nowMs){
  if (!card) return 0;
  if (card.relearning) return 0.5;
  const iv = Math.max(card.interval || 0, 1);
  const elapsedDays = Math.max(0, (nowMs - (card.dueAt - iv * DAY_MS)) / DAY_MS);
  return Math.pow(0.9, elapsedDays / iv);
}

/* Human-readable preview for a rating-in-progress. Consumed by trainer hint AND
 * any UI that shows "next review". Never duplicate the maths — always call this. */
export function previewText(card, effectiveRating, nowMs){
  const next = nextReview(card, effectiveRating, nowMs);
  if (next.relearning) {
    const hrs = Math.max(1, Math.round((next.dueAt - nowMs) / HOUR_MS));
    return `again in ${hrs}h`;
  }
  const iv = next.interval;
  if (iv <= 0) return 'again today';
  if (iv === 1) return 'tomorrow';
  if (iv < 14) return `in ${iv} days`;
  const d = new Date(next.dueAt);
  const fmt = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `on ${fmt}`;
}

/* Short status tag for a card already in the deck, shown on each Library row
 * (e.g. "Due", "✓ 5d"). Space is tight: aim for ≤ 8 characters.
 *
 * Card states to cover:
 *   isDue(card, nowMs)            → ready to review now
 *   card.relearning && !due       → rated 1, back within RELEARN_HOURS (hours, not days)
 *   otherwise                     → scheduled; card.dueAt is a local midnight N days out
 */
export function dueLabel(card, nowMs){
  if (isDue(card, nowMs)) return 'Due';
  if (card.relearning) return `↻ ${Math.max(1, Math.ceil((card.dueAt - nowMs) / HOUR_MS))}h`;
  return `✓ ${Math.max(1, Math.ceil((card.dueAt - nowMs) / DAY_MS))}d`;
}

function baseCard(){
  return { reps:0, lapses:0, ease:EASE_START, interval:0, dueAt:null,
           first:null, last:null, sum:0, avg:0, relearning:false };
}

/* nextReview returns the NEW card. Pure — no side effects. */
export function nextReview(prev, effectiveRating, nowMs){
  const card = { ...baseCard(), ...(prev || {}) };
  const r = Math.max(1, Math.min(5, effectiveRating | 0));

  // Rating 1: lapse. The card returns in a few hours regardless of previous state.
  if (r === 1) {
    card.lapses  = (card.lapses || 0) + 1;
    card.ease    = clamp((card.ease || EASE_START) - 0.20, EASE_MIN, EASE_MAX);
    card.interval = 0;
    card.dueAt   = nowMs + RELEARN_HOURS * HOUR_MS;
    card.relearning = true;
    return card;
  }

  // First success (or first success after a lapse): fixed short interval.
  const isFirstSuccess = (card.reps || 0) === 0 || card.relearning;
  if (isFirstSuccess) {
    card.interval  = card.relearning ? 1 : (FIRST_INTERVAL[r] ?? 1);
    card.relearning = false;
  } else {
    // Later successes: interval expands from prev × ease, adjusted per rating.
    const prevIv = Math.max(1, card.interval || 1);
    const ease   = card.ease || EASE_START;
    if (r === 2) {
      card.interval = Math.max(1, Math.round(prevIv * 1.2));
      card.ease = clamp(ease - 0.15, EASE_MIN, EASE_MAX);
    } else if (r === 3) {
      card.interval = Math.max(prevIv + 1, Math.round(prevIv * ease * 0.85));
    } else if (r === 4) {
      card.interval = Math.max(prevIv + 1, Math.round(prevIv * ease));
    } else if (r === 5) {
      card.interval = Math.max(prevIv + 1, Math.round(prevIv * ease * 1.3));
      card.ease = clamp(ease + 0.10, EASE_MIN, EASE_MAX);
    }
  }
  card.interval = Math.min(card.interval, MAX_INTERVAL);
  card.dueAt = localMidnight(nowMs, card.interval);
  return card;
}
