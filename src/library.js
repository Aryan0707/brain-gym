/* B.R.A.I.N. library: single global LIB, load from library.json, custom reels. */
import { keyOf } from './util.js';
export const LIB = { modules:{}, videos:[] };

export async function loadLibrary(){
  const r = await fetch('library.json');
  if (!r.ok) throw new Error(`library.json: HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.modules || !Array.isArray(data.videos)) throw new Error('library.json: bad shape');
  LIB.modules = data.modules;
  LIB.videos  = data.videos.slice();
  return LIB;
}

/* Drop every user-added video (before an import or reset replaces S.custom). */
export function clearCustom(){ LIB.videos = LIB.videos.filter(v => !v.custom); }

export const vid = key => LIB.videos.find(v => keyOf(v) === key);

const REEL_RE = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/;
export function reelIdFrom(url){
  const m = String(url).trim().match(REEL_RE);
  return m ? m[1] : null;
}

/* Custom items are { id, module, lang, src? } — src defaults to 'ig' so v1/v2
 * saves (reels only) keep working. The name stays for import/test callers. */
export function rehydrateReel(c){
  if (LIB.videos.find(v => v.id === c.id)) return;
  // A content update can rename or drop a module; re-file the video rather than
  // leave it pointing at a module every renderer would fail to look up.
  if (!LIB.modules[c.module]) c.module = Object.keys(LIB.modules)[0];
  if (c.src === 'yt') {
    LIB.videos.push({
      id: c.id, module: c.module, lang: c.lang, custom: true, src: 'yt', vertical: !!c.shorts,
      title: c.title || `YouTube ${c.shorts ? 'Short' : 'video'} — added by you`, channel: 'YouTube',
      dur: null, views: null, tier: c.shorts ? 'reel' : 'drill',
      thumb: `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`,
      why: 'You added this one. Watch for the single idea worth keeping.',
      prompt: 'The one idea in this video:',
    });
    return;
  }
  LIB.videos.push({
    id: c.id, module: c.module, lang: c.lang, custom: true, src: 'ig', vertical: true,
    title: `Instagram Reel — added by you (${c.id})`, channel: 'Instagram',
    dur: null, views: null, tier: 'reel', thumb: null,
    why: 'You added this one. Reels are short — watch it twice, then write the idea.',
    prompt: 'The one idea in this reel:',
  });
}
