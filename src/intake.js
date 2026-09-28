/* Link intake: turn anything a user shares (a bare URL, Instagram's
 * "Check out this reel … https://…?igsh=…" text, a youtu.be link with ?t=)
 * into { src, id, start?, shorts? }. Pure — no DOM, no state. */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_ID = /^[A-Za-z0-9_-]{5,40}$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

/* "90", "90s", "1m30s", "1h2m3s" → seconds; anything else → undefined. */
export function parseTime(t){
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return +t;
  const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return undefined;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

export function parseLink(raw){
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const found = text.match(URL_IN_TEXT)?.[0] || (/^[\w.-]+\.[a-z]{2,}\//i.test(text) ? `https://${text}` : null);
  if (!found) return null;
  let u;
  try { u = new URL(found); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'instagram.com' || host === 'instagr.am') {
    // /reel/ID, /reels/ID, /p/ID, /tv/ID, and /username/reel/ID
    const i = parts.findIndex(p => ['reel','reels','p','tv'].includes(p));
    const id = i >= 0 ? parts[i + 1] : null;
    return id && IG_ID.test(id) ? { src:'ig', id } : null;
  }

  let id = null, shorts = false;
  if (host === 'youtu.be') id = parts[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts','embed','live','v'].includes(parts[0])) { id = parts[1]; shorts = parts[0] === 'shorts'; }
  }
  if (!id || !YT_ID.test(id)) return null;
  const start = parseTime(u.searchParams.get('t') || u.searchParams.get('start'));
  return { src:'yt', id, ...(start ? { start } : {}), ...(shorts ? { shorts:true } : {}) };
}

/* Links arrive as ?add=… (our own links, bookmarklets) or as the Web Share
 * Target fields ?url= / ?text= / ?title= (Android puts Instagram links in text). */
export function linkFromSearch(search){
  const p = new URLSearchParams(search);
  for (const name of ['add','url','text','title']) {
    const hit = parseLink(p.get(name));
    if (hit) return hit;
  }
  return null;
}
