/* B.R.A.I.N. shared helpers — no state, no DOM writes beyond the toast. */

export const DAY = 86_400_000;
export const TARGET = 3;
export const KEY = 'braingym.v1';
export const DRAFT_KEY = 'braingym.drafts';
export const RANKS = ['Dull Blade','Awake','Sharp','Keen','Razor','Strategist','Consigliere','The Don'];

export const $ = s => document.querySelector(s);

export const todayKey = (d = new Date()) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};

export const days = a => Math.floor((Date.parse(todayKey()) - Date.parse(a)) / DAY);

export const mins = d => d ? `${Math.round(d/60)}m` : '—';
export const keyOf = v => v.key || (Number.isFinite(v.start) ? `${v.id}@${v.start}` : v.id);
export const segmentDuration = v => Number.isFinite(v.start) && Number.isFinite(v.end)
  ? Math.max(0, v.end - v.start) : v.dur;

export const durLabel = v => segmentDuration(v)
  ? `${Math.round(segmentDuration(v) / 60)}m${v.tier === 'deep' ? ' · deep' : ''}`
  : (v.src === 'ig' ? 'reel' : '—');

export const embedSrc = v => {
  if (v.src === 'ig') return `https://www.instagram.com/reel/${encodeURIComponent(v.id)}/embed/captioned/`;
  const p = new URLSearchParams({ rel:'0', modestbranding:'1', playsinline:'1' });
  if (Number.isFinite(v.start)) p.set('start', String(v.start));
  if (Number.isFinite(v.end)) p.set('end', String(v.end));
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?${p}`;
};

export const watchUrl = v => v.src === 'ig'
  ? `https://www.instagram.com/reel/${encodeURIComponent(v.id)}/`
  : `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}${Number.isFinite(v.start) ? '&t=' + v.start + 's' : ''}`;

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let toastTimer = null;
export function toast(msg){
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}
