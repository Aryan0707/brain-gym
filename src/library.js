/* B.R.A.I.N. library: single global LIB, load from library.json, custom reels. */
import { keyOf } from './util.js';
export const LIB = { modules:{}, videos:[] };

export async function loadLibrary(){
  const r = await fetch('library.json');
  const data = await r.json();
  LIB.modules = data.modules;
  LIB.videos  = data.videos.slice();
  return LIB;
}

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
