/* YouTube watch gate: pure decision plus tracked watched time. */
export const watchSatisfied = ({ src, pct = 0, ended = false, override = false }) =>
  src === 'ig' || !!override || !!ended || pct >= 0.8;

/* Count continuous playback only: seeking/pauses do not add watch time. */
export function accumulateWatch(watched, previousTime, currentTime){
  const delta = currentTime - previousTime;
  return watched + (delta > 0 && delta <= 2 ? delta : 0);
}
