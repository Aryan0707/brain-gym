/* B.R.A.I.N. main entry — boots the app, wires the DOM, owns render.
 *
 * Pure logic lives in scheduler.js / state.js / session.js / library.js / util.js.
 * This file is the only one that touches the DOM. Split further in Phase 5
 * when the mobile UI is rewritten.
 *
 * Test surface: `window.__bg` and `window.LIB`/`openTrainer`/`todayKey` are set
 * at the end of boot(). Do not remove — tests target those names.
 */
import { $, DAY, TARGET, KEY, RANKS, todayKey, days, mins, durLabel,
         embedSrc, watchUrl, keyOf, segmentDuration, esc, toast } from './util.js';
import { LIB, loadLibrary, loadNotes, vid, rehydrateReel, clearCustom, fetchTitle } from './library.js';
import { parseLink, linkFromSearch } from './intake.js';
import { blank, save, loadState, sanitizeState, migrateV1toV2,
         loadDraft, saveDraft, clearDraft, pruneDrafts,
         backupCurrent, restoreLatestBackup } from './state.js';
import { nextReview, previewText, dueLabel, retention, isDue, RELEARN_HOURS,
         HOUR_MS, DAY_MS, localMidnight } from './scheduler.js';
import { firstRepsToday, repsToday, newRepsToday, repeatedToday, dueList, capacity,
         displayStreak, bumpStreak, pickSession, interleave, rollDay } from './session.js';
import { watchSatisfied, accumulateWatch } from './watch.js';
import { PROMPT_MODES, choosePromptMode, promptFor, hasGuess, hintCues, hintCeiling, HINT_CAP, pointsCap,
         calibrationNote, certainHitRate, wantsAction, savePlan, openPlan, answerPlan, followThrough } from './learn.js';
import { buildShelves, depthOf } from './notebook.js';
import { initAi, resetExplain, suggestNext } from './ai.js';
import { candidatesFor, aiSearch, searchError, MIN_QUERY } from './search.js';
import { levelOf, hasLevel, levelLabel } from './level.js';
import { notesFor, reachedIndex, pathAfter, stamp } from './tutor.js';
import { playlistOrder, moveBy, moveAfter, resumePoint, nextInPlaylist, parseMany } from './playlist.js';

/* ── mutable UI/session state ──────────────────────────── */
let S = null;
let lang = 'all';
let modFilter = 'all';
let tierFilter = 'all';
let srcFilter = 'all';
let levelFilter = 'all';     // 'all' | '1' | '2' | '3' (basics, core, advanced)
let q = '';
let aiq = null, aiToken = 0;   // AI search: { query, sig, status:'loading'|'done'|'error', picks, msg, code }
let view = 'playlist';       // Library view: 'playlist' (one ordered list) | 'modules' (grouped)
let reordering = false;
let current = null;
let pendingRating = 0;
let recallRevealed = false;
let promptMode = 'recall';
let noteSnapshot = '';
let trainerStep = '';
let watch = { pct:0, ended:false, verified:false, override:false };
let watchedSeconds = 0, previousVideoTime = null, pollWatch = null, ytPlayer = null;
let ytAPIPromise = null, rewatching = false;
let activeTab = 'library', activeRoute = 'library', openSheetName = null, sheetOpener = null;
let guess = '';              // the pre-video guess for this first rep ('' = none)
let hintsUsed = 0, confidence = 0;   // hints shown on this rep; 1-3 confidence said before the check (0 = not said)
let playRate = 1.25;         // YouTube playback speed for a first watch (remembered)
let playTime = 0, nextToken = 0, autoTimer = null;
let trainerPushed = false;   // true when the trainer's history entry was pushed by us
const scrollPositions = { library:0, progress:0 };
let installedPrompt = null, noteQuery = '';
const lastOf = a => a[a.length - 1];
const routeQuery = route => `?go=${encodeURIComponent(route)}`;
const routeFromURL = () => {
  const r = new URLSearchParams(location.search).get('go') || 'library';
  return r === 'today' ? 'library' : r;
};
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = fn => {
  if (!document.startViewTransition || reduceMotion()) { fn(); return null; }
  const transition = document.startViewTransition(fn);
  // Rapid tab changes can skip a view transition; that is not an app error.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
  return transition;
};
function keyboardInset(){
  const vv = window.visualViewport;
  const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--kb', `${inset}px`);
}
function setHistory(route, mode='push'){
  if (mode === 'none') return;
  history[mode === 'replace' ? 'replaceState' : 'pushState']({ route }, '', routeQuery(route));
}
function setBackgroundInert(trainer){
  for (const node of [$('.appbar') || $('.top-nav'), $('.screens'), $('.tabbar')]) if (node) node.inert = trainer;
}
function focusRoute(name){
  const title = name === 'train' ? $('#stepLabel') : document.querySelector(`#screen-${name} h1, #screen-${name} h2`);
  if (title) { title.tabIndex = -1; title.focus({preventScroll:true}); }
}


/* ── video watch tracking ───────────────────────────────── */
function youtubeAPI(){
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytAPIPromise) return ytAPIPromise;
  ytAPIPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('YouTube API timeout')), 7000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timeout); reject(new Error('YouTube API blocked')); };
    document.head.append(script);
  }).catch(err => { ytAPIPromise = null; throw err; });
  return ytAPIPromise;
}
function stopPlayer(){
  clearInterval(pollWatch); pollWatch = null; previousVideoTime = null;
  if (ytPlayer) { try { ytPlayer.pauseVideo(); ytPlayer.destroy(); } catch {} ytPlayer = null; }
  const node = $('#ytPlayer');
  if (node) node.replaceWith(Object.assign(document.createElement('div'), { id:'ytPlayer' }));
  else $('.player').prepend(Object.assign(document.createElement('div'), { id:'ytPlayer' }));
  $('#frame').src = 'about:blank';
  $('#frame').hidden = false;
  $('#speed').hidden = true;
}
/* Playback speed for a YouTube first watch. Remembered; 1.25x by default (a cut of about a fifth of the time
   with little loss), and shown only while a tracked player exists. */
const RATES = [1, 1.25, 1.5, 1.75];
function loadRate(){
  try { const r = +localStorage.getItem('braingym.rate'); if (RATES.includes(r)) playRate = r; } catch {}
}
function applyRate(){
  try { ytPlayer?.setPlaybackRate?.(playRate); } catch {}
  document.querySelectorAll('#speed [data-rate]').forEach(b => {
    const on = +b.dataset.rate === playRate;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  const len = current ? segmentDuration(current) : 0;
  const saved = len ? Math.round(len * (1 - 1 / playRate) / 60) : 0;
  $('#speedSave').textContent = saved >= 1 ? `saves about ${saved} min` : '';
}
function updateWatchUI(){
  if (!current) return;
  if (current.src === 'ig') {
    $('#watchStatus').textContent = 'Instagram has no watch tracking. Your completion is self-reported.';
  } else {
    $('#watchStatus').textContent = watch.ended ? 'Video ended.'
      : `${Math.floor(watch.pct * 100)}% watched · 80% or end unlocks recall.`;
  }
  $('#btnWatched').disabled = !rewatching && !watchSatisfied({ src:current.src, ...watch });
}
/* ── tutor: AI notes that follow the video, and the step-by-step path ── */
function renderWatchNotes(v){
  const n = notesFor(v);
  $('#aiNotes').hidden = !n;
  if (!n) return;
  $('#aiNotesSum').textContent = n.summary || '';
  $('#aiNotesList').innerHTML = n.points.map((p, i) =>
    `<li data-i="${i}"><button type="button" data-seek="${p.t}"><time>${stamp(p.t)}</time><span>${esc(p.text)}</span></button></li>`).join('');
  markNotes();
}
/* Points already reached stay lit; the newest one is highlighted. */
function markNotes(){
  const n = notesFor(current); if (!n || $('#aiNotes').hidden) return;
  const at = reachedIndex(n.points, playTime);
  $('#aiNotesList').querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('on', i <= at);
    li.classList.toggle('now', i === at);
  });
}
function renderPathChip(v){
  const info = pathAfter(S, LIB.videos, v, lang);
  $('#tPath').hidden = !info;
  if (info) $('#tPath').textContent = [LIB.modules[v.module][0], levelLabel(v), `step ${info.step} of ${info.total}`].filter(Boolean).join(' · ');
}

async function startPlayer(v){
  stopPlayer();
  const key = keyOf(v);
  const fallback = $('#frame');
  fallback.src = embedSrc(v);
  if (v.src === 'ig') return;
  try {
    const YT = await youtubeAPI();
    if (!current || keyOf(current) !== key || trainerStep !== 'watch') return;
    const knownLength = segmentDuration(v);
    fallback.src = 'about:blank'; fallback.hidden = true;
    ytPlayer = new YT.Player('ytPlayer', {
      host:'https://www.youtube-nocookie.com', videoId:v.id,
      playerVars:{ playsinline:1, rel:0, modestbranding:1,
        ...(Number.isFinite(v.start) ? { start:v.start } : {}),
        ...(Number.isFinite(v.end) ? { end:v.end } : {}) },
      events:{
        onReady(){ applyRate(); },
        onStateChange(e){
          if (e.data === YT.PlayerState.PLAYING) {
            applyRate();   // YouTube can reset the speed when quality changes
            previousVideoTime = e.target.getCurrentTime();
            clearInterval(pollWatch);
            pollWatch = setInterval(() => {
              if (!current || keyOf(current) !== key || trainerStep !== 'watch') return;
              try {
                const t = e.target.getCurrentTime();
                watchedSeconds = accumulateWatch(watchedSeconds, previousVideoTime, t, playRate);
                previousVideoTime = t;
                const length = knownLength || e.target.getDuration?.() || 0;
                watch.pct = length ? Math.min(1, watchedSeconds / length) : 0;
                playTime = t; markNotes();
                updateWatchUI();
              } catch {}
            }, 1000);
          } else {
            clearInterval(pollWatch); pollWatch = null; previousVideoTime = null;
            if (e.data === YT.PlayerState.ENDED) {
              watch.ended = true; watch.pct = 1; updateWatchUI();
            }
          }
        },
        onError(){
          stopPlayer(); fallback.src = embedSrc(v);
          $('#watchStatus').textContent = 'Player unavailable. Use self-report after watching.';
          $('#btnWatchedExternal').textContent = 'I watched it (self-report)';
        },
      },
    });
    $('#speed').hidden = false; applyRate();
  } catch {
    $('#watchStatus').textContent = 'Watch tracking unavailable. Use self-report after watching.';
    $('#btnWatchedExternal').textContent = 'I watched it (self-report)';
  }
}
function setTrainerStep(step){
  trainerStep = step;
  for (const name of ['watch','recall','check','done'])
    $(`#step${name[0].toUpperCase()}${name.slice(1)}`).hidden = step !== name;
  const titles = { watch:'1 · Watch', recall:'Recall · from memory', check:'Check & rate', done:'Done' };
  $('#stepLabel').textContent = titles[step];
  $('#tOpen').hidden = step === 'recall' || step === 'done';
  if (step !== 'watch') stopPlayer();
  if (step === 'recall') {
    updateFinishState();
    setTimeout(() => $('#tNote').focus(), 0);
  }
  if (step === 'watch') startPlayer(current);
  window.scrollTo({top:0,behavior:'instant'});
  if ($('#trainSteps')) {
    $('#trainSteps').setAttribute('aria-label', `Step ${({watch:1,recall:2,check:3,done:3})[step]} of 3, ${step}`);
    $('#trainSteps').dataset.step = step;
  }
  if ($('#trainerAction')) $('#trainerAction').dataset.step = step;
  if ($('#trainerSecondary')) $('#trainerSecondary').dataset.step = step;
}

/* ── trainer helpers ───────────────────────────────────── */
let earlierNotes = [];
/* What a rep's self-check is measured against: the curated key points, else (a review) your own earlier note,
   else (a first rep) the AI's points from the video's captions, else nothing and the rep is self-rated. */
function recallSource(){
  if (current?.recallKeys?.length) return 'curated';
  if (S?.done[keyOf(current)] && earlierNotes.length) return 'own-note';
  return notesFor(current) ? 'notes' : null;
}
function recallPoints(){
  const src = recallSource();
  return src === 'curated' ? current.recallKeys
    : src === 'own-note' ? ['Today\'s note contains the core of my earlier note.']
    : src === 'notes' ? notesFor(current).points.map(p => p.text) : [];
}
const hasRecallNote = () => $('#tNote').value.trim().length >= 15;
const matchedPoints = () => document.querySelectorAll('#pointList input:checked').length;
function effectiveRating(){
  const src = recallSource(), m = matchedPoints();
  const capped = src === 'curated' ? Math.min(pendingRating, [1, 2, 3, 5][m])
    : src === 'notes' ? Math.min(pendingRating, pointsCap(m, recallPoints().length))
    : src === 'own-note' && !m ? Math.min(pendingRating, 2) : pendingRating;
  return Math.min(capped, hintCeiling(hintsUsed));   // every hint taken lowers what the rep can earn
}

function currentPreview(){
  if (!current || !pendingRating) return '';
  const card = S.done[keyOf(current)] || null;
  return previewText(card, effectiveRating(), Date.now());
}

function updateRecallHint(){
  if (!pendingRating) return;
  const preview = currentPreview();
  const source = recallSource();
  const hinted = hintsUsed ? ` ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''} used (rating max ${hintCeiling(hintsUsed)}).` : '';
  $('#schedHint').textContent = (source === 'curated'
    ? `${matchedPoints()}/${current.recallKeys.length} points recalled. Review ${preview}. Self-checked, not automatically graded.`
    : source === 'notes'
      ? `${matchedPoints()}/${recallPoints().length} of the AI's points covered. Review ${preview}. Self-checked.`
    : source === 'own-note'
      ? `Your earlier note: ${matchedPoints() ? 'core present' : 'core missing (rating capped at 2)'}. Review ${preview}. Self-checked.`
      : `Self-rated review: ${preview}.`) + hinted;
  const calib = source === 'curated' || source === 'notes'
    ? calibrationNote(confidence, { matched: matchedPoints(), total: recallPoints().length }) : '';
  $('#calibNote').textContent = calib; $('#calibNote').hidden = !calib;
}
function updateFinishState(){
  const left = Math.max(0, 15 - $('#tNote').value.trim().length);
  $('#noteCounter').textContent = left ? `${left} more character${left === 1 ? '' : 's'}` : 'Ready to check';
  $('#btnCheck').disabled = !hasRecallNote() || recallRevealed;
  $('#btnFinish').disabled = trainerStep !== 'check' || !pendingRating || !recallRevealed;
}

/* ── playlist order + addLink/removeReel: any Instagram or YouTube link ─── */
const orderList = () => playlistOrder(S.order, LIB.videos, LIB.modules);
const inLang = v => lang === 'all' || v.lang === lang;
/* New lessons you add go to the END of the playlist. The first time, the current order is frozen
 * into S.order so they do not slot into their module's path instead. */
function appendToPlaylist(ids){
  if (!S.order.length) S.order = orderList().map(keyOf).filter(k => !ids.includes(k));
  S.order.push(...ids);
}
/* A YouTube link you paste has no title. Ask YouTube (best effort, 3 at a time) and swap it in. */
async function fillTitles(items){
  const todo = items.filter(c => c.src === 'yt' && !c.title);
  let next = 0, got = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++], title = await fetchTitle(c.id);
      if (!title || !S.custom.includes(c)) continue;
      c.title = title; got++;
      const v = vid(c.id); if (v) v.title = title;
      if (current && keyOf(current) === c.id) $('#tTitle').textContent = title;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (got) { save(S); renderAll(); }
}
const newItem = (link, module, langCode) =>
  ({ id:link.id, module, lang:langCode, ...(link.src === 'yt' ? { src:'yt', ...(link.shorts ? { shorts:true } : {}) } : {}) });
const MAX_BULK = 60;

function addMany(links, module, langCode, say){
  const fresh = links.filter(l => !vid(l.id)).slice(0, MAX_BULK);
  if (!fresh.length) { say('All of those are already in your library.', true); return false; }
  const items = fresh.map(l => newItem(l, module, langCode));
  items.forEach(rehydrateReel);
  S.custom.push(...items);
  appendToPlaylist(items.map(i => i.id));
  save(S);
  try { localStorage.setItem('braingym.lastAdd', JSON.stringify({ module, lang: langCode })); } catch {}
  say('');
  if (openSheetName) closeSheet({historyMode:'replace'});
  view = 'playlist'; reordering = false; storeView();
  const skipped = links.length - fresh.length;
  toast(`${items.length} added to the end of your playlist${skipped ? ` · ${skipped} skipped (already there or over ${MAX_BULK})` : ''}`);
  renderAll();
  fillTitles(items);
  return true;
}
function addLink(raw, module, langCode, msg = $('#addReelMsg')){
  const links = parseMany(raw, parseLink);
  const say = (text, err=false) => { if (msg) { msg.textContent = text; msg.className = err ? 'muted err' : 'muted'; } };
  if (!links.length) { say('That is not an Instagram reel or YouTube link.', true); return false; }
  if (!LIB.modules[module]) { say('Pick a module first.', true); return false; }
  if (links.length > 1) return addMany(links, module, langCode, say);
  const link = links[0], { id, src } = link;
  if (openSheetName) closeSheet({historyMode:'replace'});
  if (vid(id)) { toast('already in your library'); openTrainer(id); return true; }
  const item = newItem(link, module, langCode);
  rehydrateReel(item);
  S.custom.push(item);
  appendToPlaylist([id]);
  save(S);
  try { localStorage.setItem('braingym.lastAdd', JSON.stringify({ module, lang: langCode })); } catch {}
  say('');
  toast(src === 'ig' ? 'reel added — if it will not play, Instagram blocks embedding it' : 'video added');
  renderAll();
  openTrainer(id);
  fillTitles([item]);
  return true;
}
/* Prefill the add sheet: a shared link, plus the module/language used last time. */
function openAddSheet(prefill = '', opener = document.activeElement){
  let last = {};
  try { last = JSON.parse(localStorage.getItem('braingym.lastAdd') || '{}'); } catch {}
  $('#addReelUrl').value = prefill;
  if (LIB.modules[last.module]) $('#addReelMod').value = last.module;
  if (['hi','en'].includes(last.lang)) $('#addReelLang').value = last.lang;
  updateAddPreview();
  openSheet('addReel', opener);
}
function updateAddPreview(){
  const raw = $('#addReelUrl').value, links = parseMany(raw, parseLink);
  const fresh = links.filter(l => !vid(l.id)), have = links.length - fresh.length;
  $('#addReelMsg').className = raw.trim() && !links.length ? 'muted err' : 'muted';
  $('#addReelConfirm').textContent = fresh.length > 1 ? `Add ${Math.min(fresh.length, MAX_BULK)} to playlist` : 'Add & start';
  $('#addReelMsg').textContent = !raw.trim() ? ''
    : !links.length ? 'Not recognised — paste an Instagram reel or YouTube link.'
    : links.length === 1 ? (have ? 'Already in your library — Add opens it.'
        : links[0].src === 'ig' ? '✓ Instagram reel' : `✓ YouTube ${links[0].shorts ? 'Short' : 'video'}`)
    : `✓ ${links.length} links: ${links.filter(l => l.src === 'yt').length} YouTube, ${links.filter(l => l.src === 'ig').length} reel${links.filter(l => l.src === 'ig').length === 1 ? '' : 's'}`
        + (have ? ` · ${have} already in your library` : '') + (fresh.length > MAX_BULK ? ` · only the first ${MAX_BULK} will be added` : '');
}
function removeReel(id){
  LIB.videos = LIB.videos.filter(v => !(v.custom && v.id === id));
  S.custom = S.custom.filter(c => c.id !== id);
  S.order = S.order.filter(k => k !== id);
  delete S.done[id];
  save(S); renderAll(); toast('reel removed');
}

/* ── render: chrome ────────────────────────────────────── */
function renderChrome(){
  $('#mStreak').textContent = displayStreak(S);
  $('#mXP').textContent = S.xp;
  const L = level();
  $('#mLevel').textContent = L;
  $('#mRank').textContent = RANKS[L - 1];
  const dueCount = dueList(S).length;
  $('#mDue').textContent = dueCount; $('#mDue').hidden = !dueCount;
  if ($('#navAction')) {
    const action=$('#navAction');
    const name=action.dataset.screen || activeTab;
    action.innerHTML = `<svg aria-hidden="true"><use href="#i-${name==='library'?'plus':'settings'}"></use></svg>`;
    action.setAttribute('aria-label', name==='library'?'Add a reel or YouTube link':'Open settings');
  }
}
function level(){ return Math.min(8, 1 + Math.floor(S.xp / 150)); }

function lessonRow(v, mode='library', { num = 0, edit = null } = {}){
  const id = keyOf(v), d = S.done[id], mod = LIB.modules[v.module];
  const due = d && isDue(d, Date.now());
  const label = mode === 'library' ? (!d ? 'New' : dueLabel(d, Date.now()))
    : due ? 'Review · due today' : `${mod[0]} · ${durLabel(v)}`;
  const pos = num ? `Lesson ${num}. ` : '';
  const controls = edit ? `<span class="reorder" role="group" aria-label="Reorder ${esc(v.title)}">
      <button type="button" data-move="${esc(id)}" data-dir="-1" ${edit.first ? 'disabled' : ''} aria-label="Move ${esc(v.title)} up">↑ Up</button>
      <button type="button" data-move="${esc(id)}" data-dir="1" ${edit.last ? 'disabled' : ''} aria-label="Move ${esc(v.title)} down">↓ Down</button>
      <button type="button" data-move-next="${esc(id)}" aria-label="Play ${esc(v.title)} next">Play next</button></span>` : '';
  return `<div class="row-item${edit ? ' editing' : ''}"><button class="lesson-row card" data-open="${esc(id)}" aria-label="${esc(pos + v.title)}. ${esc(label)}">
    ${num ? `<span class="row-num" aria-hidden="true">${num}</span>` : ''}<span class="row-art${v.src === 'ig' ? ' reel-art' : ''}">${v.src === 'ig'
      ? '<svg aria-hidden="true"><use href="#i-play"></use></svg>'
      : `<img loading="lazy" draggable="false" src="${esc(v.thumb)}" alt="">`}</span>
    <span class="row-copy"><strong>${esc(v.title)}</strong><small>${esc(mode === 'library'
      ? [levelLabel(v), durLabel(v), v.lang === 'hi' ? 'हिंदी' : 'English'].filter(Boolean).join(' · ') : label)}</small></span>
    ${mode === 'library' ? `<span class="row-state">${esc(label)}</span>` : ''}
    <svg class="row-chevron" aria-hidden="true"><use href="#i-chevron-right"></use></svg>
  </button>${v.custom && mode==='library' ? `<button class="remove-reel" data-rm="${esc(v.id)}" aria-label="Remove ${esc(v.title)}"><svg aria-hidden="true"><use href="#i-x"></use></svg></button>` : ''}${controls}</div>`;
}
/* ── render: library ───────────────────────────────────── */
function renderReviews(){
  // Hidden while searching or filtering: then the user is looking for something specific.
  const due = (q || modFilter !== 'all') ? []
    : dueList(S).map(x => x.v).filter(v => (lang === 'all' || v.lang === lang) && !repeatedToday(S, keyOf(v)));
  $('#dueSection').innerHTML = due.length
    ? `<h2 class="sh">Reviews due · ${due.length}</h2><div class="row-group">${due.slice(0,5).map(v=>lessonRow(v,'review')).join('')}</div>`
      + (due.length > 5 ? `<button class="btn ghost" data-tab-go="progress">See all ${due.length} in Progress</button>` : '')
    : '';
}
const storeView = () => { try { localStorage.setItem('braingym.view', view); } catch {} };
const passesFilters = v =>
  (modFilter === 'all' || v.module === modFilter) &&
  (lang === 'all' || v.lang === lang) &&
  (srcFilter === 'all' || v.src === srcFilter) &&
  (tierFilter === 'all' || v.tier === tierFilter || (tierFilter === 'drill' && !v.dur)) &&
  (levelFilter === 'all' || levelOf(v) === +levelFilter);
const filterSig = () => [modFilter, lang, srcFilter, tierFilter, levelFilter].join('|');
const isFiltered = () => !!q || modFilter !== 'all' || srcFilter !== 'all' || tierFilter !== 'all' || levelFilter !== 'all' || lang !== 'all';

/* The Filters sheet and its hidden legacy twins show the same four choices: keep every button in step. */
function syncFilterUI(){
  const mark = (ids, attr, val) => ids.forEach(id => document.querySelectorAll(`#${id} button`)
    .forEach(b => b.classList.toggle('on', b.dataset[attr] === val)));
  mark(['sheetSrcSeg', 'srcSeg'], 'src', srcFilter);
  mark(['sheetTierSeg', 'tierSeg'], 'tier', tierFilter);
  mark(['sheetLangSeg', 'settingsLangSeg', 'langSeg'], 'lang', lang);
  mark(['sheetLevelSeg'], 'level', levelFilter);
  if ($('#langBtn')) $('#langBtn').textContent = lang === 'all' ? 'Both' : (lang === 'hi' ? 'हिंदी' : 'English');
  // Levels are only offered once the owner has approved some: never filter by a guess.
  if ($('#levelSection')) $('#levelSection').hidden = !LIB.videos.some(hasLevel);
}

/* Playlist view: where you left off, then every lesson in one numbered, reorderable list. */
function renderPlaylistHead(all){
  const el = $('#playlistHead');
  el.hidden = view !== 'playlist' || isFiltered();
  if (el.hidden) return;
  const pool = all.filter(inLang);
  const learned = pool.filter(v => S.done[keyOf(v)]).length;
  const next = resumePoint(S, all, lang);
  el.innerHTML = next
    ? `<div class="ph-copy"><small>${learned ? 'Continue where you left off' : 'Start here'} · ${learned} of ${pool.length} learned</small>
        <strong>${esc(next.title)}</strong></div>
        <button class="btn" type="button" data-open="${esc(keyOf(next))}">${learned ? 'Continue' : 'Play'}</button>`
    : `<div class="ph-copy"><small>Playlist complete</small><strong>All ${pool.length} lessons learned</strong></div>`;
}
function renderLibrary(){
  if ($('#bootSkeleton')) $('#bootSkeleton').hidden = true;
  renderReviews();
  const mods = ['all', ...Object.keys(LIB.modules)];
  $('#modChips').innerHTML = mods.map(m => {
    const label = m === 'all' ? 'All modules' : LIB.modules[m][0];
    return `<button data-mod="${esc(m)}" class="module-chip${modFilter === m ? ' on' : ''}" ${m==='all'?'':`style="--mod:${esc(LIB.modules[m][1])}"`}>${m==='all'?'':'<i aria-hidden="true"></i>'}${esc(label)}</button>`;
  }).join('');
  const matches = v => passesFilters(v) &&
    (!q || (v.title + ' ' + v.channel + ' ' + v.why).toLowerCase().includes(q));
  const playlist = view === 'playlist';
  const ordered = playlist ? orderList() : LIB.videos;
  const list = ordered.filter(matches);
  document.querySelectorAll('#viewSeg button').forEach(b => {
    const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  const canReorder = playlist && !isFiltered();
  if (!canReorder) reordering = false;
  $('#playlistBar').hidden = !playlist;
  $('#playlistCount').textContent = `Playlist · ${list.length} lesson${list.length === 1 ? '' : 's'}`;
  $('#btnReorder').hidden = !canReorder;
  $('#btnReorder').textContent = reordering ? 'Done' : 'Reorder';
  $('#btnReorder').setAttribute('aria-pressed', String(reordering));
  renderPlaylistHead(ordered);
  $('#libCount').textContent = `${LIB.videos.filter(v => S.done[keyOf(v)]).length}/${LIB.videos.length}`;
  const empty = `<div class="emptystate">No lessons match ${q ? `“${esc(q)}”` : 'your filters'}. <button class="btn ghost" id="emptyClearSearch">Clear search</button></div>`;
  if (!list.length) $('#libCards').innerHTML = empty;
  else if (playlist) {
    const place = new Map(ordered.map((v, i) => [keyOf(v), i]));
    $('#libCards').innerHTML = `<div class="row-group playlist">${list.map(v => {
      const i = place.get(keyOf(v));
      return lessonRow(v, 'library', { num: i + 1, edit: reordering ? { first: i === 0, last: i === ordered.length - 1 } : null });
    }).join('')}</div>`;
  } else {
    $('#libCards').innerHTML = modFilter === 'all' ? Object.keys(LIB.modules).map(m => {
      const inMod = list.filter(v => v.module === m);
      return inMod.length ? `<h2 class="sh">${esc(LIB.modules[m][0])}</h2><div class="row-group">${inMod.map(v=>lessonRow(v)).join('')}</div>` : '';
    }).join('') : `<div class="row-group">${list.map(v=>lessonRow(v)).join('')}</div>`;
  }
  if (aiq && aiq.sig !== filterSig()) aiq = null;
  renderAiSearch();
  syncFilterUI();
  if ($('#filterCount')) {
    const count = [srcFilter !== 'all',tierFilter !== 'all',levelFilter !== 'all',lang !== 'all'].filter(Boolean).length;
    $('#filterCount').textContent = count; $('#filterCount').hidden = !count;
  }
}

/* ── AI search: lessons by meaning, ranked by the model from a keyword-narrowed list ── */
function renderAiSearch(){
  const out = $('#aiSearch');
  $('#aiSearchBar').hidden = q.length < MIN_QUERY || aiq?.status === 'loading';
  const showMatches = aiq?.status === 'done' && aiq.picks.length > 0;
  $('#libCards').hidden = showMatches;
  $('#playlistBar').hidden = showMatches || view !== 'playlist';
  if (!aiq) { out.innerHTML = ''; return; }
  if (aiq.status === 'loading') { out.innerHTML = '<p class="muted ai-note">Searching by meaning…</p>'; return; }
  if (aiq.status === 'error') {
    out.innerHTML = `<div class="ai-note"><p class="muted">${esc(aiq.msg)}</p>${
      aiq.code === 'no-key' || aiq.code === 401 ? '<button class="linkish" type="button" data-open-sheet="settings">Open Settings</button>' : ''}</div>`;
    return;
  }
  if (!aiq.picks.length) {
    out.innerHTML = `<p class="muted ai-note">No lesson in your library clearly matches “${esc(aiq.query)}”. Try other words, or add one with +.</p>`;
    return;
  }
  out.innerHTML = `<h2 class="sh">Best matches · ${aiq.picks.length}</h2><div class="row-group ai-hits">${
    aiq.picks.map(p => `<div class="ai-hit">${lessonRow(p.video)}<p class="ai-why">${esc(p.reason)}</p></div>`).join('')}</div>
    <p class="explain-meta"><small>AI · Claude Haiku 4.5 · can be wrong</small>
    <button class="linkish" type="button" id="aiSearchClear">Back to keyword results</button></p>`;
}
async function runAiSearch(){
  const query = $('#q').value.trim();
  if (query.length < MIN_QUERY) return;
  const token = ++aiToken;
  const { items } = candidatesFor(LIB.videos.filter(passesFilters), query, LIB.modules);
  aiq = { query, sig: filterSig(), status: 'loading', picks: [] };
  renderAiSearch();
  if (!items.length) { aiq = { ...aiq, status: 'done' }; renderAiSearch(); return; }
  try {
    const picks = await aiSearch(query, items, LIB.modules);
    if (token === aiToken) aiq = { ...aiq, status: 'done', picks };
  } catch (e) {
    if (token === aiToken) aiq = { ...aiq, status: 'error', code: e.code, msg: searchError(e) };
  }
  if (token === aiToken) renderAiSearch();
}
function clearAiSearch(){ aiToken++; aiq = null; renderAiSearch(); }

/* One lesson moved; the list is redrawn, so put focus back on the button that was used. */
function reorder(action, id, dir = 0){
  const keys = orderList().map(keyOf);
  if (action === 'next') {
    const first = resumePoint(S, orderList(), 'all');
    if (!first || keyOf(first) === id) { toast('Already up next'); return; }
    S.order = moveAfter(keys, id, keys[keys.indexOf(keyOf(first)) - 1] ?? null);
  } else S.order = moveBy(keys, id, dir);
  save(S); renderLibrary();
  const btn = document.querySelector(action === 'next' ? `[data-move-next="${CSS.escape(id)}"]` : `[data-move="${CSS.escape(id)}"][data-dir="${dir}"]:not(:disabled)`)
    || document.querySelector(`[data-move="${CSS.escape(id)}"]:not(:disabled)`);
  if (btn) { btn.focus({preventScroll:true}); btn.scrollIntoView({block:'nearest'}); }
}

/* ── render: progress ──────────────────────────────────── */
function renderProgress(){
  $('#capacities').innerHTML = Object.keys(LIB.modules).map(m => {
    const c = capacity(S, m), mod = LIB.modules[m];
    const all = LIB.videos.filter(v => v.module === m).length;
    const seen = LIB.videos.filter(v => v.module === m && S.done[keyOf(v)]).length;
    return `<button class="module-row" data-module-go="${esc(m)}" style="--mod:${esc(mod[1])}">
      <span class="module-label"><i aria-hidden="true"></i><strong>${esc(mod[0])}</strong></span>
      <span class="module-progress">${c}% <small>${seen} of ${all} seen</small></span>
      <span class="bar"><i style="width:${c}%"></i></span></button>`;
  }).join('');
  const checked = S.log.filter(l => l.recall);
  const checkedSummary = checked.length
    ? `${checked.reduce((n,l)=>n+l.recall.matched,0)}/${checked.reduce((n,l)=>n+l.recall.total,0)} self-checked recall` : 'No self-checks yet';
  $('#statGrid').innerHTML = [
    [displayStreak(S),'Streak',`Best ${S.streak.best}`],
    [dueList(S).length,'Due now','Reviews ready'],
    [S.notes.length,'Ideas kept',checkedSummary],
  ].map(([value,label,sub])=>`<div class="stat"><b>${value}</b><span>${label}</span><small>${esc(sub)}</small></div>`).join('');
  const hit = certainHitRate(S.log), plans = followThrough(S.actions);
  const learnLines = [hit !== null && `When you said "Certain", you were right ${hit}% of the time.`,
    plans && `${plans.done} of ${plans.answered} plans followed through.`].filter(Boolean);
  $('#learnStats').textContent = learnLines.join(' '); $('#learnStats').hidden = !learnLines.length;
  const due = dueList(S);
  $('#queueList').innerHTML = due.length ? `<div class="row-group">${due.map(x=>lessonRow(x.v,'review')).join('')}</div>`
    : '<p class="muted">Queue empty. Everything is scheduled ahead.</p>';
  const shelves = buildShelves({ videos:LIB.videos, modules:LIB.modules, notes:S.notes, done:S.done, query:noteQuery });
  const noteMeta = n => n.recall ? `${n.recall.matched}/${n.recall.total} checked`
    : Number.isFinite(n.rating) ? `${n.rating}/5 self-rated` : '';
  const noteDay = n => n.day || n.at?.slice(0,10) || '';
  $('#notebook').innerHTML = shelves.length
    ? shelves.map(s=>`<section class="shelf" style="--mod:${esc(s.color)}">
        <h3 class="shelf-h"><i aria-hidden="true"></i>${esc(s.name)} <small>${s.items.length} learned</small></h3>
        ${s.items.map(({v,card,notes})=>{ const last = lastOf(notes);
          return `<details class="note shelf-item"><summary>
            <span class="depth-tag">${v.removed ? 'removed' : ['reel','drill','deep'][depthOf(v)]}</span><strong>${esc(v.title)}</strong>
            <small>${card ? `${card.reps} rep${card.reps>1?'s':''} · ${card.avg}/5` : ''}${last ? `${card?' · ':''}${noteMeta(last)}` : ''}</small>
            ${last ? `<span class="note-excerpt">${esc(last.text)}</span>` : ''}</summary>
            <ol class="note-history">${notes.map(n=>`<li><time>${esc(noteDay(n))}</time> <small>${noteMeta(n)}</small><p>${esc(n.text)}</p></li>`).join('')}</ol>
            ${v.removed ? '' : `<button class="btn ghost" data-open="${esc(keyOf(v))}">Practise again</button>`}</details>`;}).join('')}
      </section>`).join('')
    : `<p class="muted">${noteQuery ? 'No notes match that search.' : 'No ideas written down yet. Your notebook fills after a rep.'}</p>`;
  if ($('#progressEmpty')) $('#progressEmpty').hidden = S.log.length > 0;
}

/* ── trainer ───────────────────────────────────────────── */
function openTrainer(id, {historyMode='push'}={}){
  const v = vid(id); if (!v) return;
  stopPlayer();
  current = v; pendingRating = 0; recallRevealed = false; noteSnapshot = '';
  resetExplain();
  rewatching = false;
  watch = { pct:0, ended:false, verified:false, override:false };
  watchedSeconds = 0;
  earlierNotes = S.notes.filter(n => n.id === keyOf(v)).slice(-3).reverse();
  document.querySelector('.player').classList.toggle('vertical', !!v.vertical);
  $('#tOpen').href = watchUrl(v);
  $('#tOpen').innerHTML = '<svg aria-hidden="true"><use href="#i-external"></use></svg>';
  $('#tOpen').setAttribute('aria-label', v.src === 'ig' ? 'Open on Instagram' : 'Open on YouTube');
  $('#tTitle').textContent = v.title;
  $('#frame').title = `Lesson video: ${v.title}`;
  $('#tChannel').textContent = v.channel;
  $('#tMod').textContent = LIB.modules[v.module][0];
  $('#tMod').style.setProperty('--mod', LIB.modules[v.module][1]);
  $('#tLang').textContent = v.lang === 'hi' ? 'Hindi' : 'English';
  $('#tDur').textContent = segmentDuration(v) ? mins(segmentDuration(v)) : (v.src === 'ig' ? 'reel' : '—');
  $('#tWhy').textContent = v.why;
  const card = S.done[keyOf(v)];
  const pastModes = S.log.filter(l => l.id === keyOf(v) && !l.repeat).map(l => l.mode || 'recall');
  promptMode = choosePromptMode({ reps: card?.reps || 0, lapses: card?.lapses || 0,
    lastRating: lastOf(S.log.filter(l => l.id === keyOf(v)))?.rating ?? null, pastModes });
  if (!PROMPT_MODES[promptMode]) promptMode = 'recall';
  $('#tPromptMode').textContent = PROMPT_MODES[promptMode].label;
  $('#tPromptMode').hidden = promptMode === 'recall';
  $('#tPrompt').textContent = '› ' + promptFor(v, promptMode);
  playTime = 0; cancelAuto();
  const notes = notesFor(v);
  const firstRep = !S.done[keyOf(v)];
  // The first rep is a real recall, like every review: the box starts empty and the AI's points come after the check.
  $('#tNote').value = loadDraft(keyOf(v));
  $('#recallHintText').textContent = notes
    ? 'Video and notes are hidden. Write what you remember; the AI notes come after you check.'
    : 'Video hidden while you write. Recall from memory.';
  $('#tNote').disabled = false;
  // Guess first (first rep only), then say how sure you are, hints one at a time, and a plan after.
  guess = ''; hintsUsed = 0; confidence = 0;
  $('#tGuess').value = '';
  $('#pretest').hidden = !firstRep;
  $('#pretestQ').textContent = v.prompt || '';
  $('#hintList').replaceChildren(); updateHintUI(); syncConfidence();
  $('#aiNotes').open = false;
  $('#guessEcho').hidden = true; $('#planCheck').hidden = true; $('#calibNote').hidden = true;
  $('#plan').hidden = true;
  $('#aiCompare').hidden = true;
  renderWatchNotes(v);
  renderPathChip(v);
  $('#tNoteSnapshot').textContent = '';
  $('#keyPoints').hidden = true;
  $('#pointList').replaceChildren();
  $('#selfRatedNote').hidden = true;
  document.querySelectorAll('#rate button').forEach(b => b.classList.remove('on'));
  $('#btnFinish').disabled = true;
  $('#btnWatched').textContent = v.src === 'ig' ? 'I watched the reel (self-report)' : "I've watched it";
  $('#btnWatchedExternal').hidden = v.src === 'ig';
  $('#btnWatchedExternal').textContent = 'Watched in the YouTube app';
  $('#schedHint').textContent = S.done[keyOf(v)]
    ? `Rep ${S.done[keyOf(v)].reps + 1} · last rating ${S.done[keyOf(v)].avg}/5`
    : 'Your self-check sets the next practice date.';
  trainerPushed = historyMode === 'push';
  go('train',{historyMode});
  setTrainerStep(S.done[keyOf(v)] ? 'recall' : 'watch');
  updateWatchUI();
}

function checkRecall(){
  if (trainerStep !== 'recall' || !hasRecallNote() || recallRevealed) return;
  noteSnapshot = $('#tNote').value.trim();
  recallRevealed = true;
  $('#tNote').disabled = true;
  $('#tNoteSnapshot').textContent = noteSnapshot;
  const source = recallSource();
  const points = recallPoints();
  $('#keyLegend').textContent = source === 'notes' ? 'Which of the AI\'s points did you cover?' : 'Which points were in your note?';
  $('#guessEcho').hidden = !guess;
  $('#guessEcho').textContent = guess ? `Before watching you guessed: “${guess}”. How close was it?` : '';
  const prior = openPlan(S.actions, keyOf(current), todayKey());
  $('#planCheck').hidden = !prior;
  if (prior) {
    $('#planCheckText').textContent = prior.text;
    document.querySelectorAll('#planOutcomes button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  }
  $('#keyPoints').hidden = !points.length;
  $('#selfRatedNote').hidden = !!points.length;
  $('#pointList').innerHTML = points.map((point, i) =>
    `<label class="recall-point"><input type="checkbox" value="${i}"><span>${esc(point)}</span></label>`).join('');
  if (source === 'own-note') {
    const summary = document.createElement('p');
    summary.className = 'earlierNote';
    summary.textContent = `Your earlier note: ${earlierNotes[0].text}`;
    $('#pointList').prepend(summary);
    if (earlierNotes.length > 1) {
      const older = document.createElement('details');
      older.innerHTML = `<summary>${earlierNotes.length - 1} older note${earlierNotes.length > 2 ? 's' : ''}</summary>`;
      for (const n of earlierNotes.slice(1)) {
        const p = document.createElement('p'); p.textContent = n.text; older.append(p);
      }
      $('#pointList').append(older);
    }
  }
  const compare = source !== 'notes' && notesFor(current);   // 'notes' already shows them as the checklist
  $('#aiCompare').hidden = !compare;
  if (compare) {
    $('#aiCompare').open = false;
    $('#aiCompareList').innerHTML = compare.points.map(p => `<li>${esc(p.text)}</li>`).join('');
  }
  setTrainerStep('check');
  updateFinishState();
}

function finishRep(){
  const v = current;
  if (trainerStep !== 'check' || !v || !pendingRating || !recallRevealed || !noteSnapshot) return;
  const source = recallSource();
  const matched = source ? matchedPoints() : null;
  const effective = effectiveRating();
  const t = todayKey();
  const now = Date.now();
  const id = keyOf(v);
  const isRepeat = repeatedToday(S, id);
  const firstRep = !S.done[id];
  const nextText = previewText(S.done[id] || null, effective, now);

  if (!isRepeat) {
    const prev = S.done[id] || null;
    const card = nextReview(prev, effective, now);
    card.reps  = (prev?.reps || 0) + 1;
    card.sum   = (prev?.sum  || 0) + effective;
    card.avg   = +(card.sum / card.reps).toFixed(1);
    card.first = prev?.first || t;
    card.last  = t;
    S.done[id] = card;
  }

  const nowIso = new Date().toISOString();
  const recall = source ? { matched, total:recallPoints().length, source } : null;
  const logEntry = { id, at:nowIso, day:t, rating:effective, selfRating:pendingRating,
    recall, mode:promptMode, watch:{ pct:watch.pct, ended:watch.ended, verified:watch.verified },
    ...(confidence ? { conf:confidence } : {}), ...(hintsUsed ? { hints:hintsUsed } : {}), ...(guess ? { guessed:true } : {}) };
  if (isRepeat) logEntry.repeat = true;
  S.log.push(logEntry);
  const xp = isRepeat ? 2 : 10 + effective * 2;
  S.xp += xp;
  if (!isRepeat) {
    S.notes.push({ id, title:v.title, text:noteSnapshot, rating:effective, at:nowIso, day:t, recall, mode:promptMode });
    bumpStreak(S);
  }
  clearDraft(id);
  save(S);
  if (S.log.length === 1) navigator.storage?.persist?.().catch(() => {});
  renderAll();
  $('#doneRing').textContent = `${newRepsToday(S)}/${TARGET + S.extra}`;
  $('#doneXP').textContent = `+${xp} xp${isRepeat ? ' · same-day repeat (goal unchanged)' : ''}`;
  $('#doneDue').textContent = isRepeat ? 'Schedule unchanged' : `Back ${nextText}`;
  setTrainerStep('done');
  $('#plan').hidden = !wantsAction(v) || isRepeat;
  $('#planText').value = ''; $('#planSaved').textContent = '';
  showNextStep(v, { firstRep, isRepeat, note:noteSnapshot, rating:effective });
  navigator.vibrate?.(12);
  if (S.log.length === 1) setTimeout(showInstallPrompt,900);
}

/* ── next step: the module path, adjusted by the AI's read of your note ── */
const autoOn = () => {
  let pref = null; try { pref = localStorage.getItem('braingym.autonext'); } catch {}
  return pref ? pref === 'on' : !navigator.webdriver;   // automation is never navigated by a timer unless it opts in
};
function cancelAuto(){ clearInterval(autoTimer); autoTimer = null; if ($('#autoLine')) $('#autoLine').textContent = ''; }

/* The old "what next" rule (reviews first, weakest module) — the fallback and the "mix it up" choice. */
function mixedNext(id){
  const pool = pickSession(S, lang, false).filter(x => keyOf(x) !== id && !repeatedToday(S, keyOf(x)));
  const wantNew = newRepsToday(S) < TARGET + S.extra;   // new videos first until today's goal is met
  return (wantNew && pool.find(x => !S.done[keyOf(x)])) || pool[0] || null;
}

function paintNext(video, { kicker, reason = '' }){
  $('#nextCard').hidden = !video;
  $('#btnNextRep').hidden = !video;
  $('#btnNextRep').dataset.next = video ? keyOf(video) : '';
  if (!video) return;
  $('#nextKick').textContent = kicker;
  $('#nextTitle').textContent = video.title;
  $('#nextWhy').textContent = video.why || '';
  $('#nextReason').textContent = reason; $('#nextReason').hidden = !reason;
  $('#btnNextRep').textContent = 'Start next lesson';
}

function startAuto(token){
  cancelAuto();
  if (!autoOn() || token !== nextToken || trainerStep !== 'done') return;
  if (!$('#plan').hidden) { $('#autoLine').textContent = 'Auto-continue is paused so you can plan. Tap Start next lesson when ready.'; return; }
  let left = 6;
  const tick = () => {
    if (token !== nextToken || trainerStep !== 'done' || activeRoute !== 'train') return cancelAuto();
    $('#autoLine').textContent = left ? `Next lesson starts in ${left}s. Uncheck to stop.` : '';
    if (!left--) { const id = $('#btnNextRep').dataset.next; cancelAuto(); if (id) openTrainer(id); }
  };
  tick(); autoTimer = setInterval(tick, 1000);
}

/* Playlist view: a new lesson flows to the next one in YOUR order; after a review, the next due review
 * first. Your order is authoritative, so the AI does not re-pick it. "Mix it up" keeps the old order. */
function playlistNext(v, { firstRep, mix, token }){
  const key = keyOf(v), list = orderList();
  const due = firstRep ? null : dueList(S).map(x => x.v)
    .find(x => keyOf(x) !== key && inLang(x) && !repeatedToday(S, keyOf(x)));
  const nx = due || nextInPlaylist(S, list, key, lang);
  if (due) paintNext(due, { kicker: 'Next review' });
  else if (nx) {
    const pool = list.filter(inLang);
    paintNext(nx, { kicker: `Playlist · ${pool.findIndex(x => keyOf(x) === keyOf(nx)) + 1} of ${pool.length}` });
  } else paintNext(mix, { kicker: 'Playlist complete. Up next' });
  const other = mix && keyOf(mix) !== $('#btnNextRep').dataset.next ? mix : null;
  $('#btnMix').hidden = !other; $('#btnMix').dataset.next = other ? keyOf(other) : '';
  startAuto(token);
}

async function showNextStep(v, { firstRep, isRepeat, note, rating }){
  const token = ++nextToken;
  const mix = mixedNext(keyOf(v));
  const info = firstRep && !isRepeat ? pathAfter(S, LIB.videos, v, lang) : null;
  $('#autoNext').checked = autoOn();
  $('#btnMix').hidden = true;
  if (view === 'playlist') return playlistNext(v, { firstRep: firstRep && !isRepeat, mix, token });
  if (!info?.next) {                 // a review, a repeat, or the path is finished: the usual order
    paintNext(mix, { kicker: info ? `${LIB.modules[v.module][0]} path complete. Up next` : 'Up next' });
    return startAuto(token);
  }
  const kick = n => `Next step · ${LIB.modules[v.module][0]} · ${n} of ${info.total}`;
  const plan = (video, reason = '') => paintNext(video, { kicker: kick(info.learned + 1), reason });
  plan(info.next);
  const showMix = () => { const m = mixedNext(keyOf(v)); $('#btnMix').hidden = !m; $('#btnMix').dataset.next = m ? keyOf(m) : ''; };
  showMix();
  let hold = false;
  if (info.upcoming.length > 1) {
    hold = true; $('#nextReason').textContent = 'Reading your note to choose the best next step…'; $('#nextReason').hidden = false;
  }
  if (hold) {
    const pick = await suggestNext(v, note, rating, info.upcoming, lang);
    if (token !== nextToken || trainerStep !== 'done') return;
    if (pick) plan(pick.video, pick.reason); else plan(info.next);
  }
  startAuto(token);
}

/* ── routing + wiring ──────────────────────────────────── */
function go(name, { historyMode='push', focus=true }={}){
  if (name === 'today') name = 'library';   // old links, shortcuts, muscle memory
  if (!['library','progress','train'].includes(name)) return;
  const wasSheetOpen = !!openSheetName;
  if (openSheetName) closeSheet({historyMode:'none'});
  if (name !== 'train' && activeRoute === name) {
    if (wasSheetOpen) setHistory(name,historyMode);
    window.scrollTo({top:0, behavior:reduceMotion() ? 'instant' : 'smooth'});
    return;
  }
  if (activeRoute !== 'train' && !activeRoute.startsWith('sheet/'))
    scrollPositions[activeRoute] = window.scrollY;
  if (name === 'train' && activeRoute !== 'train') activeTab = activeRoute;
  const route = name === 'train' ? `train/${keyOf(current)}` : name;
  activeRoute = name;
  setHistory(route, historyMode);
  const transition = motion(() => {
    document.querySelectorAll('.screen').forEach(s =>
      s.classList.toggle('active', s.id === 'screen-' + (name === 'train' ? activeTab : name)));
    document.querySelectorAll('.tabbar .tab').forEach(b => {
      const selected = b.dataset.tab === (name === 'train' ? activeTab : name);
      b.classList.toggle('active', selected);
      if (selected) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#screen-train').classList.toggle('active', name === 'train');
  });
  setBackgroundInert(name === 'train');
  if (name === 'train') window.scrollTo({top:0,behavior:'instant'});
  else {
    stopPlayer();
    activeTab = name;
    const restore = () => requestAnimationFrame(() => window.scrollTo({top:scrollPositions[name] || 0,behavior:'instant'}));
    if (transition) transition.updateCallbackDone.then(restore).catch(restore);
    else restore();
  }
  if ($('#navTitle')) $('#navTitle').textContent = name === 'train' ? 'Training' : ({library:'Library',progress:'Progress'})[name];
  if ($('#navAction')) { $('#navAction').dataset.screen = name; renderChrome(); }
  if ($('#langSeg')) $('#langSeg').hidden = true;
  if ($('#langBtn')) $('#langBtn').textContent = lang === 'all' ? 'Both' : (lang === 'hi' ? 'हिंदी' : 'English');
  if (focus) requestAnimationFrame(() => focusRoute(name));
}
const sheetIDs = {filters:'filtersSheet',settings:'settingsSheet',install:'installSheet',addReel:'addReelSheet',reset:'resetSheet',import:'importConfirm'};
function openSheet(name, opener=document.activeElement, {historyMode='push'}={}){
  const id = sheetIDs[name]; if (!id || !$('#' + id)) return;
  if (openSheetName) closeSheet({historyMode:'none'});
  sheetOpener = opener;
  openSheetName = name;
  setHistory(`sheet/${name}`, historyMode);
  $('#' + id).hidden = false;
  for (const node of [$('.appbar') || $('.top-nav'), $('.screens'), $('.tabbar'), $('#screen-train')]) if (node) node.inert = true;
  const first = $('#' + id).querySelector('button, input, select');
  first?.focus({preventScroll:true});
}
function closeSheet({historyMode='back'}={}){
  if (!openSheetName) return;
  const name = openSheetName;
  $('#' + sheetIDs[name]).hidden = true;
  openSheetName = null;
  setBackgroundInert(activeRoute === 'train');
  $('#screen-train').inert = false;
  if (historyMode === 'back') history.back();
  else if (historyMode === 'replace') setHistory(activeRoute === 'train' ? `train/${keyOf(current)}` : activeRoute,'replace');
  sheetOpener?.focus?.({preventScroll:true});
  sheetOpener = null;
}
function showInstallPrompt(){
  if (!S?.log.length || !$('#installSheet')) return;
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    && navigator.standalone !== true && !matchMedia('(display-mode: standalone)').matches;
  if (!ios && !installedPrompt) return;
  const last = Number(localStorage.getItem('braingym.installPromptAt') || 0);
  if (Date.now() - last < 14 * DAY_MS) return;
  localStorage.setItem('braingym.installPromptAt',String(Date.now()));
  if ($('#installButton')) $('#installButton').hidden = !installedPrompt;
  openSheet('install', $('#btnDone'));
}
function handlePopState(){
  const route = routeFromURL();
  if (openSheetName) closeSheet({historyMode:'none'});
  if (route.startsWith('sheet/')) {
    const name = route.slice(6);
    if (name === 'import') go(activeRoute === 'train' ? activeTab : activeRoute, {historyMode:'replace'});
    else openSheet(name,null,{historyMode:'none'});
    return;
  }
  if (route.startsWith('train/')) {
    const id = route.slice(6);
    if (vid(id)) openTrainer(id, {historyMode:'none'});
    else go('library',{historyMode:'none'});
    return;
  }
  go(route === 'progress' ? 'progress' : 'library',{historyMode:'none'});
}
function renderAll(){ renderChrome(); renderLibrary(); renderProgress(); }

/* Leave the trainer. history.back() only over an entry this app pushed: a
 * deep-linked or shared lesson has the previous site behind it, not our tabs. */
function leaveTrainer(){
  cancelAuto();
  if (trainerPushed) history.back();
  else go(activeTab, {historyMode:'replace'});
}

/* iOS keeps a suspended PWA in memory for days: on return, roll the day and
 * redraw so the Library shows this morning's reviews, not yesterday's.
 * renderAll never touches the trainer, so an in-progress note is safe. */
function onResume(){
  if (document.visibilityState !== 'visible' || !S) return;
  if (rollDay(S)) save(S);
  renderAll();
}

/* ── hints, confidence, plans ──────────────────────────── */
const hintSource = () => notesFor(current)?.points.map(p => p.text) || current?.recallKeys || [];
function updateHintUI(){
  const cap = current ? Math.min(HINT_CAP, hintSource().length) : 0;
  $('#hints').hidden = !cap;
  $('#btnHint').hidden = hintsUsed >= cap;
  $('#hintNote').textContent = hintsUsed
    ? `A hint is a cue, not the answer. Each one lowers the best rating this rep can earn (now ${hintCeiling(hintsUsed)}).` : '';
}
function showHint(){
  if (trainerStep !== 'recall' || recallRevealed || !current) return;
  const cues = hintCues(hintSource(), 3);
  if (hintsUsed >= Math.min(HINT_CAP, cues.length)) return;
  const li = document.createElement('li');
  li.textContent = `Hint ${hintsUsed + 1}: ${cues[hintsUsed]}`;
  $('#hintList').append(li);
  hintsUsed++; updateHintUI();
}
function syncConfidence(){
  document.querySelectorAll('#conf [data-c]').forEach(b => {
    const on = +b.dataset.c === confidence;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
}
let planTimer = null;
function onPlanInput(e){
  if (!current) return;   // no auto-continue timer can be running: startAuto does not start while a plan is shown
  const id = keyOf(current);
  savePlan(S.actions, id, e.target.value, todayKey(), new Date().toISOString());
  const kept = S.actions.some(a => a.id === id && !a.outcome);
  $('#planSaved').textContent = kept ? 'Saved. I will ask whether it happened at your next review of this lesson.' : '';
  clearTimeout(planTimer); planTimer = setTimeout(() => save(S), 400);
}
function onPlanAnswer(e){
  const b = e.target.closest('[data-o]'); if (!b || !current) return;
  if (!answerPlan(S.actions, keyOf(current), b.dataset.o, todayKey())) return;
  document.querySelectorAll('#planOutcomes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  save(S);
}

function wire(){
  loadRate();
  document.querySelectorAll('.tabbar .tab').forEach(b => b.onclick = () => go(b.dataset.tab));
  addEventListener('popstate', handlePopState);
  document.addEventListener('visibilitychange', onResume);
  addEventListener('pageshow', e => { if (e.persisted) onResume(); });
  window.visualViewport?.addEventListener('resize', keyboardInset);
  window.visualViewport?.addEventListener('scroll', keyboardInset);
  addEventListener('resize', keyboardInset);
  keyboardInset();
  let edge = null;
  addEventListener('touchstart', e => {
    const p=e.touches[0]; edge = activeRoute==='train' && p?.clientX<=20 ? {x:p.clientX,y:p.clientY} : null;
  }, {passive:true});
  addEventListener('touchend', e => {
    if (!edge) return;
    const p=e.changedTouches[0], dx=p.clientX-edge.x, dy=p.clientY-edge.y;
    if (dx>80 && Math.abs(dx)>Math.abs(dy)*1.5) leaveTrainer();
    edge=null;
  }, {passive:true});
  document.body.addEventListener('click', e => {
    const sheet = e.target.closest('[data-open-sheet]');
    if (sheet) { openSheet(sheet.dataset.openSheet, sheet); return; }
    const close = e.target.closest('[data-close-sheet]');
    if (close) { closeSheet(); return; }
    const mod = e.target.closest('[data-module-go]');
    if (mod) { modFilter=mod.dataset.moduleGo; renderLibrary(); go('library'); return; }
    if (e.target.id === 'emptyClearSearch' || e.target.id === 'clearSearch') {
      clearAiSearch(); q=''; $('#q').value=''; renderLibrary(); return;
    }
    if (e.target.id === 'aiSearchClear') { clearAiSearch(); return; }
  });
  if ($('#noteSearch')) $('#noteSearch').oninput = e => {noteQuery=e.target.value.toLowerCase().trim();renderProgress();};
  if ($('#navAction')) $('#navAction').onclick = e => {
    const action = $('#navAction').dataset.screen;
    if (action === 'library') openAddSheet('', e.currentTarget);
    else openSheet('settings',e.currentTarget);
  };
  if ($('#filterButton')) $('#filterButton').onclick = e => openSheet('filters',e.currentTarget);
  if ($('#streakButton')) $('#streakButton').onclick = () => go('progress');
  if ($('#langBtn')) $('#langBtn').onclick = e => { e.stopPropagation(); $('#langSeg').hidden = !$('#langSeg').hidden; };
  document.addEventListener('click', e => {
    if (!e.target.closest('#langSeg') && !e.target.closest('#langBtn')) $('#langSeg').hidden = true;
  });
  document.body.addEventListener('click', e => {
    const t = e.target.closest('[data-open]');
    if (t) { openTrainer(t.dataset.open); return; }
    const m = e.target.closest('[data-mod]');
    if (m) { modFilter = m.dataset.mod; renderLibrary(); return; }
    const tg = e.target.closest('[data-tab-go]');
    if (tg) { go(tg.dataset.tabGo); return; }
  });
  $('#langSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    lang = b.dataset.lang;
    document.querySelectorAll('#langSeg button').forEach(x => x.classList.toggle('on', x === b));
    $('#langBtn').textContent = lang === 'all' ? 'Both' : (lang === 'hi' ? 'हिंदी' : 'English');
    $('#langSeg').hidden = true;
    renderAll();
  };
  $('#tierSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    tierFilter = b.dataset.tier;
    document.querySelectorAll('#tierSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderLibrary();
  };
  // The Filters sheet: one segmented control per filter. Apply just closes it (every tap already filters).
  const sheetSeg = (id, set, rerender = renderLibrary) => { $(id).onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    set(b.dataset); rerender();
  }; };
  sheetSeg('#sheetSrcSeg',   d => { srcFilter = d.src; });
  sheetSeg('#sheetTierSeg',  d => { tierFilter = d.tier; });
  sheetSeg('#sheetLevelSeg', d => { levelFilter = d.level; });
  sheetSeg('#sheetLangSeg',  d => { lang = d.lang; }, renderAll);
  sheetSeg('#settingsLangSeg', d => { lang = d.lang; }, renderAll);
  $('#filtersApply').onclick = () => closeSheet();
  $('#srcSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    srcFilter = b.dataset.src;
    document.querySelectorAll('#srcSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderLibrary();
  };
  $('#reelMod').innerHTML = Object.keys(LIB.modules)
    .map(m => `<option value="${esc(m)}">${esc(LIB.modules[m][0])}</option>`).join('');
  $('#btnAddReel').onclick = () => {
    if (addLink($('#reelUrl').value, $('#reelMod').value, $('#reelLang').value, $('#addMsg')))
      $('#reelUrl').value = '';
  };
  $('#reelUrl').onkeydown = e => { if (e.key === 'Enter') $('#btnAddReel').click(); };
  $('#addReelMod').innerHTML = $('#reelMod').innerHTML;
  $('#addReelUrl').oninput = updateAddPreview;
  // A textarea so many links fit; Enter still submits a single link, and adds a new line once there are several.
  $('#addReelUrl').onkeydown = e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const v = $('#addReelUrl').value;
    if (e.metaKey || e.ctrlKey || (!v.includes('\n') && parseMany(v, parseLink).length <= 1)) {
      e.preventDefault(); $('#addReelConfirm').click();
    }
  };
  $('#viewSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.dataset.view === view) return;
    view = b.dataset.view; reordering = false; storeView(); renderLibrary();
  };
  $('#btnReorder').onclick = () => { reordering = !reordering; renderLibrary(); };
  $('#libCards').addEventListener('click', e => {
    const mv = e.target.closest('[data-move]');
    if (mv) { e.stopPropagation(); reorder('move', mv.dataset.move, +mv.dataset.dir); return; }
    const nx = e.target.closest('[data-move-next]');
    if (nx) { e.stopPropagation(); reorder('next', nx.dataset.moveNext); }
  });
  $('#addReelConfirm').onclick = () => addLink($('#addReelUrl').value, $('#addReelMod').value, $('#addReelLang').value);
  $('#addReelCancel').onclick = () => closeSheet();
  // iOS shows its own "Paste" callout here; the read only happens on this tap.
  $('#addReelPaste').hidden = !navigator.clipboard?.readText;
  $('#addReelPaste').onclick = async () => {
    try { $('#addReelUrl').value = (await navigator.clipboard.readText()).trim(); }
    catch { $('#addReelMsg').textContent = 'Clipboard blocked — long-press the box and choose Paste.'; return; }
    updateAddPreview();
  };
  document.body.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); removeReel(rm.dataset.rm); }
  }, true);
  $('#q').oninput = e => { aiq = null; aiToken++; q = e.target.value.toLowerCase().trim(); renderLibrary(); };
  $('#q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); runAiSearch(); } };
  $('#aiSearchBtn').onclick = runAiSearch;
  $('#btnBack').onclick = () => { leaveTrainer(); renderAll(); };
  $('#tNote').oninput = e => { saveDraft(current && keyOf(current), e.target.value); updateFinishState(); };
  $('#tGuess').oninput = e => { guess = hasGuess(e.target.value) ? e.target.value.trim() : ''; };
  $('#tGuess').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#speed').onclick = e => {
    const b = e.target.closest('[data-rate]'); if (!b) return;
    playRate = +b.dataset.rate;
    try { localStorage.setItem('braingym.rate', String(playRate)); } catch {}
    applyRate();
  };
  $('#btnHint').onclick = showHint;
  $('#conf').onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b || trainerStep !== 'recall' || recallRevealed) return;
    confidence = confidence === +b.dataset.c ? 0 : +b.dataset.c;
    syncConfidence();
  };
  $('#planText').oninput = onPlanInput;
  $('#planText').onblur = () => { clearTimeout(planTimer); save(S); };
  $('#planOutcomes').onclick = onPlanAnswer;
  $('#btnWatched').onclick = () => {
    if (trainerStep !== 'watch' || $('#btnWatched').disabled) return;
    if (rewatching) { rewatching = false; setTrainerStep('check'); return; }
    watch.verified = current.src === 'yt' && !watch.override && (watch.ended || watch.pct >= .8);
    setTrainerStep('recall');
  };
  $('#btnWatchedExternal').onclick = () => {
    if (trainerStep !== 'watch') return;
    if (rewatching) { rewatching = false; setTrainerStep('check'); return; }
    watch.override = true; watch.verified = false;
    setTrainerStep('recall');
  };
  $('#btnCheck').onclick = checkRecall;
  $('#btnRewatch').onclick = () => {
    if (trainerStep !== 'check' || !recallRevealed) return;
    rewatching = true;
    $('#pretest').hidden = true;
    $('#btnWatched').textContent = 'Back to check';
    $('#btnWatchedExternal').hidden = true;
    setTrainerStep('watch');
    updateWatchUI();
  };
  $('#btnNextRep').onclick = () => { const id = $('#btnNextRep').dataset.next; cancelAuto(); if (id) openTrainer(id); };
  $('#btnMix').onclick = () => { const id = $('#btnMix').dataset.next; cancelAuto(); if (id) openTrainer(id); };
  $('#autoNext').onchange = e => {
    try { localStorage.setItem('braingym.autonext', e.target.checked ? 'on' : 'off'); } catch {}
    e.target.checked ? startAuto(nextToken) : cancelAuto();
  };
  $('#aiNotesList').onclick = e => {
    const b = e.target.closest('[data-seek]'); if (!b) return;
    try { ytPlayer?.seekTo(+b.dataset.seek, true); } catch {}
  };
  $('#btnDone').onclick = () => { cancelAuto(); go(activeTab); renderAll(); };
  $('#pointList').onchange = updateRecallHint;
  $('#rate').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    pendingRating = +b.dataset.r;
    document.querySelectorAll('#rate button').forEach(x => x.classList.toggle('on', x === b));
    updateFinishState();
    updateRecallHint();
  };
  $('#btnFinish').onclick = finishRep;
  $('#btnExport').onclick = async () => {
    const file = new File([JSON.stringify(S,null,1)],`brain-gym-${todayKey()}.json`,{type:'application/json'});
    if (navigator.canShare?.({files:[file]})) {
      try { await navigator.share({files:[file],title:'B.R.A.I.N. progress'}); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  $('#btnImport').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let candidate;
      try { candidate = sanitizeState(r.result, LIB); }
      catch { toast('bad file — nothing was changed'); e.target.value = ''; return; }
      const dropped = candidate.__droppedCustom || 0;
      const summary = `Replace current progress with ${(candidate.log||[]).length} reps, ${(candidate.notes||[]).length} notes, ${(candidate.custom||[]).length} reels`
        + (dropped ? ` (dropped ${dropped} invalid reel${dropped>1?'s':''})?` : '?');
      $('#importSummary').textContent = summary;
      openSheet('import', $('#btnImport'));
      $('#importConfirmCancel').onclick = () => { closeSheet(); e.target.value = ''; };
      $('#importConfirmOk').onclick = () => {
        closeSheet();
        backupCurrent('preimport');
        try {
          delete candidate.__droppedCustom;
          S = candidate;
          const migrated = migrateV1toV2(S);
          S = migrated.S;
          clearCustom(); S.custom.forEach(rehydrateReel);
          rollDay(S);
          save(S); renderAll();
          toast(dropped ? `imported · ${dropped} invalid reel${dropped>1?'s':''} skipped` : 'imported');
        } catch (err) {
          console.error(err);
          const restored = restoreLatestBackup('preimport');
          if (restored) {
            S = migrateV1toV2(restored).S;
            clearCustom(); S.custom.forEach(rehydrateReel);
            save(S); renderAll();
          }
          toast('import failed — reverted');
        }
        e.target.value = '';
      };
    };
    r.onerror = () => { toast('could not read that file — nothing was changed'); e.target.value = ''; };
    r.readAsText(f);
  };
  $('#btnReset').onclick = e => openSheet('reset',e.currentTarget);
  if ($('#resetInput')) $('#resetInput').oninput = e => { $('#resetConfirm').disabled = e.target.value !== 'RESET'; };
  if ($('#resetConfirm')) $('#resetConfirm').onclick = () => {
    if ($('#resetInput').value !== 'RESET') return;
    backupCurrent('prereset');
    S = blank(); rollDay(S); clearCustom();
    save(S); renderAll(); closeSheet();
    $('#resetInput').value=''; $('#resetConfirm').disabled=true; toast('progress reset');
  };
  if ($('#storagePersist')) $('#storagePersist').onclick = async () => {
    const granted = await navigator.storage?.persist?.().catch(()=>false) || false;
    $('#storageStatus').textContent = granted ? 'Persistent storage granted on this device.' : 'Persistent storage not granted. Export a backup regularly.';
  };
  if ($('#installButton')) $('#installButton').onclick = async () => {
    if (!installedPrompt) return;
    const prompt = installedPrompt; installedPrompt = null;
    await prompt.prompt(); await prompt.userChoice; closeSheet();
  };
  addEventListener('beforeinstallprompt', e => {e.preventDefault();installedPrompt=e; if ($('#installButton')) $('#installButton').hidden=false;showInstallPrompt();});
  addEventListener('appinstalled', () => {installedPrompt=null; if (openSheetName==='install') closeSheet();});
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && openSheetName) {e.preventDefault();closeSheet();return;}
    if (openSheetName && e.key === 'Tab') {
      const el = $('#'+sheetIDs[openSheetName]);
      const controls = [...el.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]):not([hidden]),select:not([disabled]):not([hidden])')].filter(x=>x.getClientRects().length);
      if (!controls.length) return;
      if (e.shiftKey && document.activeElement===controls[0]) {e.preventDefault();lastOf(controls).focus();}
      else if (!e.shiftKey && document.activeElement===lastOf(controls)) {e.preventDefault();controls[0].focus();}
    }
  });
  addEventListener('keydown', e => {
    // Already handled (Escape closed a sheet), a sheet owns the keys, or a browser shortcut.
    if (e.defaultPrevented || openSheetName || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches('input,textarea,select,[contenteditable]')) return;
    const trainerOpen = $('#screen-train').classList.contains('active');
    if (e.key === 'Escape' && trainerOpen) { e.preventDefault(); $('#btnBack').click(); return; }
    if (trainerOpen) {
      // Rating keys only on the rating step: never pick a rating the user has not seen.
      if (trainerStep === 'check' && /^[1-5]$/.test(e.key)) {
        const btn = document.querySelector(`#rate [data-r="${e.key}"]`);
        if (btn) { e.preventDefault(); btn.click(); }
      }
      return;
    }
    if (e.key === '1') go('library');
    if (e.key === '2') go('progress');
  });
}

/* ── boot ──────────────────────────────────────────────── */
(async function boot(){
  try { await loadLibrary(); await loadNotes(); }
  catch (err) {
    // No lessons means nothing to render; say why instead of leaving a skeleton.
    console.error(err);
    if ($('#bootSkeleton')) $('#bootSkeleton').hidden = true;
    $('#libCards').innerHTML = `<div class="emptystate"><p>${navigator.onLine === false
      ? 'You are offline and the lessons are not saved on this device yet. Connect once, then they work offline.'
      : 'The lesson library could not be loaded.'}</p><button class="btn" type="button" id="bootRetry">Try again</button></div>`;
    $('#bootRetry').onclick = () => location.reload();
    addEventListener('online', () => location.reload(), { once:true });
    return;
  }
  const loaded = loadState();
  S = loaded.S;
  if (loaded.event === 'corrupt') setTimeout(() => toast('Saved data was unreadable — a copy was kept.'), 300);
  const mig = migrateV1toV2(S); S = mig.S;
  S.custom.forEach(rehydrateReel);
  try { const saved = localStorage.getItem('braingym.view'); if (saved === 'modules' || saved === 'playlist') view = saved; } catch {}
  rollDay(S);
  pruneDrafts();
  save(S);
  wire();
  initAi(() => current);
  renderAll();
  // A retired ?go=today link is rewritten so the address bar shows where you are.
  const legacyToday = new URLSearchParams(location.search).get('go') === 'today';
  history.replaceState({route:routeFromURL()},'',legacyToday ? routeQuery('library') : location.href);
  const initial = routeFromURL();
  if (initial.startsWith('train/') || initial.startsWith('sheet/') || ['library','progress'].includes(initial))
    handlePopState();
  else {
    $('[data-tab="library"]').setAttribute('aria-current','page');
    if ($('#navAction')) $('#navAction').dataset.screen='library';
  }
  // Shared link (?add=…, or Android share-target ?url=/?text=): prefill the add sheet.
  const shared = linkFromSearch(location.search);
  if (shared) {
    history.replaceState({route:'library'},'',routeQuery('library'));
    go('library',{historyMode:'none'});
    openAddSheet(shared.src === 'ig' ? `https://www.instagram.com/reel/${shared.id}/`
      : `https://www.youtube.com/${shared.shorts ? 'shorts/' + shared.id : 'watch?v=' + shared.id}`, null);
  }
  if (new URLSearchParams(location.search).get('start') === '1') {
    const first = view === 'playlist'
      ? (dueList(S).map(x => x.v).find(inLang) || resumePoint(S, orderList(), lang))
      : pickSession(S,lang,false)[0];
    if (first) requestAnimationFrame(()=>openTrainer(keyOf(first)));
  }
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const updateReady = () => {
        const worker = reg.waiting;
        if (!worker || !navigator.serviceWorker.controller) return;
        const notice=$('#toast');
        notice.replaceChildren();
        const button=document.createElement('button');
        button.type='button'; button.textContent='Update ready — tap to refresh';
        button.onclick=()=>worker.postMessage({type:'SKIP_WAITING'});
        notice.append(button); notice.classList.add('on');
      };
      updateReady();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange',updateReady));
      // First install claims the page too; only an update that replaces a live worker should reload.
      let refreshing=!hadController;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing=true; location.reload();
      });
    }).catch(() => {});
  }
  fetch('version.json').then(r=>r.ok?r.json():null).then(v=>{
    if ($('#settingsVersion')) $('#settingsVersion').textContent = v?.version || v?.commit || 'Local build';
  }).catch(()=>{if ($('#settingsVersion')) $('#settingsVersion').textContent='Local build';});
  console.log(`B.R.A.I.N. v${S.v} · ${LIB.videos.length} videos · ${Object.keys(LIB.modules).length} modules`);

  // ── test hook: same surface as Phase 0/1 plus the pure functions. ──
  window.__bg = {
    openTrainer, todayKey, repsToday: () => repsToday(S), newRepsToday: () => newRepsToday(S), LIB,
    S: () => S, setS: (next) => { S = next; save(S); renderAll(); },
    nextReview, previewText, dueLabel, retention, isDue, capacity: (m) => capacity(S, m),
    dueList: () => dueList(S), pickSession: (extraRep) => pickSession(S, lang, !!extraRep),
    localMidnight, HOUR_MS, DAY_MS, RELEARN_HOURS,
    migrateV1toV2, sanitizeState: (raw) => sanitizeState(raw, LIB),
    watchSatisfied, accumulateWatch, embedSrc, keyOf, segmentDuration, parseLink, linkFromSearch, interleave,
    watch: () => ({ ...watch }), rate: () => playRate, choosePromptMode, promptMode: () => promptMode,
    playlist: () => orderList().map(keyOf), view: () => view, parseMany: raw => parseMany(raw, parseLink),
    playlistOrder, moveBy, moveAfter, resumePoint, nextInPlaylist,
  };
  window.LIB = LIB;
  window.openTrainer = openTrainer;
  window.todayKey = todayKey;
})();
