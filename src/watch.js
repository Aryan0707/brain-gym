/* YouTube watch gate: pure decision plus tracked watched time. */
export const watchSatisfied = ({ src, pct = 0, ended = false, override = false }) =>
  src === 'ig' || !!override || !!ended || pct >= 0.8;

/* Count continuous playback only: seeking/pauses do not add watch time. One poll is about a second of real time,
   so at 1.5x it moves the video about 1.5 seconds: the allowed step grows with the playback rate. */
export function accumulateWatch(watched, previousTime, currentTime, rate = 1){
  const delta = currentTime - previousTime;
  return watched + (delta > 0 && delta <= 2 * Math.max(1, rate) ? delta : 0);
}
