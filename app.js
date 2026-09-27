/* B.R.A.I.N. — Brain Gym. Vanilla JS, no deps, offline-first (localStorage). */
const LIB = { modules:{}, videos:[] };
const KEY = 'braingym.v1';
const DAY = 86400000;
const TARGET = 3;
const RANKS = ['Dull Blade','Awake','Sharp','Keen','Razor','Strategist','Consigliere','The Don'];
const INTERVAL = {1:0, 2:2, 3:4, 4:9, 5:21};   // rating → days until review (0 = again today)

let S = null;                 // state
let lang = 'all';
let modFilter = 'all';
let tierFilter = 'all';
let srcFilter = 'all';
let q = '';
let extra = false;
let current = null;           // vid in trainer
let pendingRating = 0;

/* ── helpers ───────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const todayKey = (d = new Date()) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const days = a => Math.floor((Date.parse(todayKey()) - Date.parse(a)) / DAY);
const vid = id => LIB.videos.find(v => v.id === id);
const mins = d => d ? `${Math.round(d/60)}m` : '—';
const durLabel = v => v.dur ? `${Math.round(v.dur / 60)}m${v.tier === 'deep' ? ' · deep' : ''}` : (v.src === 'ig' ? 'reel' : '—');
const embedSrc = v => v.src === 'ig'
  ? `https://www.instagram.com/reel/${v.id}/embed/captioned/`
  : `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1&playsinline=1`;
const watchUrl = v => v.src === 'ig'
  ? `https://www.instagram.com/reel/${v.id}/` : `https://www.youtube.com/watch?v=${v.id}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }
function blank(){
  return { v:1, xp:0, done:{}, log:[], notes:[], custom:[], streak:{cur:0,best:0,last:null},
           sessionDate:null, extra:0 };
}

/* ── instagram reels you add yourself ──────────────────── */
const REEL_RE = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/;
function reelIdFrom(url){
  const m = String(url).trim().match(REEL_RE);
  return m ? m[1] : null;
}
function addReel(url, module, lang){
  const id = reelIdFrom(url);
  const msg = $('#addMsg');
  if (!id) { msg.textContent = 'That does not look like an Instagram reel link.'; msg.className = 'muted err'; return; }
  if (vid(id)) { msg.textContent = 'Already in your library.'; msg.className = 'muted'; openTrainer(id); return; }
  const item = { id, module, lang, custom:true, src:'ig', vertical:true,
    title:`Instagram Reel — added by you (${id})`, channel:'Instagram',
    dur:null, views:null, tier:'reel', thumb:null,
    why:'You added this one. Reels are short — watch it twice, then write the idea.',
    prompt:'The one idea in this reel:' };
  LIB.videos.push(item);
  S.custom.push({ id, module, lang });
  save();
  msg.textContent = `Added ${id}. Playing it now — if it does not load, the reel is not embeddable.`;
  msg.className = 'muted';
  renderAll();
  openTrainer(id);
}
function removeReel(id){
  LIB.videos = LIB.videos.filter(v => v.id !== id);
  S.custom = S.custom.filter(c => c.id !== id);
  delete S.done[id];
  save(); renderAll(); toast('reel removed');
}

/* ── state maths ───────────────────────────────────────── */
function repsToday(){ const t = todayKey(); return S.log.filter(l => l.at.slice(0,10) === t).length; }

function dueList(){
  const t = todayKey();
  return LIB.videos
    .filter(v => S.done[v.id]?.nextDue && S.done[v.id].nextDue <= t)
    .map(v => ({ v, d: days(S.done[v.id].nextDue) }))
    .sort((a, b) => b.d - a.d);
}

function capacity(m){
  const all = LIB.videos.filter(v => v.module === m);
  const seen = all.filter(v => S.done[v.id]);
  if (!seen.length) return 0;
  const avg = seen.reduce((s, v) => s + (S.done[v.id].avg || 0), 0) / seen.length;
  return Math.round((seen.length / all.length) * 65 + (avg / 5) * 35);
}

function minutesTrained(){ return Object.keys(S.done).reduce((s, k) => s + (vid(k)?.dur || 0) / 60, 0); }
function level(){ return Math.min(8, 1 + Math.floor(S.xp / 150)); }

function bumpStreak(){
  const t = todayKey();
  if (S.streak.last === t) return;
  S.streak.cur = (S.streak.last && days(S.streak.last) === 1) ? S.streak.cur + 1 : 1;
  S.streak.best = Math.max(S.streak.best, S.streak.cur);
  S.streak.last = t;
}

/* ── session picker ────────────────────────────────────── */
function pickSession(extraRep){
  const picks = [];
  const seen = new Set();
  const okLang = v => lang === 'all' || v.lang === lang;
  const push = v => { if (v && !seen.has(v.id)) { seen.add(v.id); picks.push(v); } };

  dueList().filter(x => okLang(x.v)).slice(0, 2).forEach(x => push(x.v));

  const fresh = LIB.videos.filter(v => !S.done[v.id] && okLang(v));
  const cand = [...fresh].sort((a, b) => capacity(a.module) - capacity(b.module));
  let lastLang = null;
  while (picks.length < TARGET + (extraRep ? 1 : 0) && cand.length) {
    const pool = cand.filter(v => !seen.has(v.id) && !picks.some(p => p.module === v.module));
    const usable = pool.length ? pool : cand.filter(v => !seen.has(v.id));
    if (!usable.length) break;
    // when Both is selected, alternate delivery language so a session is never all one language
    const alt = lang === 'all' && lastLang ? usable.find(v => v.lang !== lastLang) : null;
    const next = alt || usable[0];
    push(next);
    lastLang = next.lang;
  }
  return picks;
}

/* ── render: chrome ────────────────────────────────────── */
function renderChrome(){
  $('#mStreak').textContent = S.streak.cur;
  $('#mXP').textContent = S.xp;
  const L = level();
  $('#mLevel').textContent = L;
  $('#mRank').textContent = RANKS[L - 1];
  $('#heroLvl').textContent = `Level ${L} · ${RANKS[L - 1]}`;
  $('#mDue').textContent = dueList().length;
  const t = repsToday(), goal = TARGET + S.extra;
  const off = 113 - Math.min(1, t / goal) * 113;
  $('#ringFg').style.strokeDashoffset = off;
  $('#ringTxt').textContent = `${t}/${goal}`;
}

/* ── render: today ─────────────────────────────────────── */
function cardHTML(v, mode){
  const d = S.done[v.id];
  const mod = LIB.modules[v.module];
  const isDue = mode === 'due';
  const foot = d
    ? `<span class="chip done">✓ rep ${d.reps}</span><span class="d muted" style="font-size:11.5px">next ${d.nextDue ? (days(d.nextDue) >= 0 ? 'due now' : 'in ' + Math.abs(days(d.nextDue)) + 'd') : '—'}</span>`
    : `<span class="chip">new</span>`;
  return `<article class="card" data-id="${v.id}">
    <div class="thumb${v.src === 'ig' ? ' ig' : ''}" data-open="${v.id}">
      ${v.src === 'ig' ? '<div class="reeltile">REEL<br><span>'+esc(v.channel)+'</span></div>'
                       : `<img loading="lazy" src="${v.thumb}" alt="">`}
      <div class="play">${isDue ? '↻' : '▶'}</div>
      <div class="badge">${durLabel(v)}</div>
    </div>
    <div class="body">
      <div class="row"><span class="chip hi" style="${v.lang === 'hi' ? '' : 'display:none'}">हिंदी</span>
        <span class="chip en" style="${v.lang === 'en' ? '' : 'display:none'}">english</span>
        <span class="chip${v.src === 'ig' ? ' igchip' : ''}">${v.src === 'ig' ? 'instagram' : 'youtube'}</span>
        <span class="chip" style="color:${mod[1]}">${mod[0]}</span></div>
      <h4>${esc(v.title)}</h4>
      <div class="chan">${esc(v.channel)}</div>
      <div class="why">${esc(v.why)}</div>
      <div class="foot">${foot}<span style="flex:1"></span>
        ${v.custom ? `<button class="btn ghost red" data-rm="${v.id}">✕</button>` : ''}
        <button class="btn" data-open="${v.id}">${d ? 'Review' : 'Start'}</button></div>
    </div>
  </article>`;
}

function renderToday(){
  const done = repsToday() >= TARGET + S.extra;
  $('#screen-today').classList.toggle('is-done', done);
  const due = dueList().filter(x => lang === 'all' || x.v.lang === lang);
  $('#dueSection').innerHTML = due.length
    ? `<h2 class="sh">Due for review — ${due.length}</h2><div class="list">${
        due.slice(0, 4).map(x => cardHTML(x.v, 'due')).join('')}</div>` : '';

  if (done && !extra) {
    $('#sessionCards').innerHTML = '';
    $('#sessDone').hidden = false;
    $('#sessDoneSub').textContent = `${repsToday()} reps done today · ${S.xp} xp · level ${level()} (${RANKS[level()-1]})`;
    return;
  }
  $('#sessDone').hidden = true;
  const picks = pickSession(S.extra > 0 || extra);
  $('#sessionCards').innerHTML = picks.length
    ? `<h2 class="sh">Today's reps</h2><div class="list">${picks.map(v => cardHTML(v, 'new')).join('')}</div>`
    : '<p class="muted">Every video in this language filter is done. Switch the filter or run reviews.</p>';
  const left = Math.max(0, TARGET + S.extra - repsToday());
  $('#sessTitle').textContent = left ? `${left} rep${left > 1 ? 's' : ''} to go` : 'Session complete';
  $('#sessSub').textContent = due.length
    ? `${due.length} review${due.length > 1 ? 's' : ''} ready. Start with what you learned before.`
    : 'Watch. Recall. Rate. Repeat.';
  $('#ringTxt').textContent = `${repsToday()}/${TARGET + S.extra}`;
}

/* ── render: library ───────────────────────────────────── */
function renderLibrary(){
  const mods = ['all', ...Object.keys(LIB.modules)];
  $('#modChips').innerHTML = mods.map(m => {
    const label = m === 'all' ? 'All modules' : LIB.modules[m][0];
    const col = m === 'all' ? 'var(--fg)' : LIB.modules[m][1];
    const on = modFilter === m ? `on" style="background:${col};color:#08090b` : '';
    return `<button data-mod="${m}" class="${on}">${label}</button>`;
  }).join('');

  let list = LIB.videos.filter(v =>
    (modFilter === 'all' || v.module === modFilter) &&
    (lang === 'all' || v.lang === lang) &&
    (srcFilter === 'all' || v.src === srcFilter) &&
    (tierFilter === 'all' || v.tier === tierFilter || (tierFilter === 'drill' && !v.dur)) &&
    (!q || (v.title + ' ' + v.channel + ' ' + v.why).toLowerCase().includes(q)));

  $('#libCount').textContent = `${LIB.videos.filter(v => S.done[v.id]).length}/${LIB.videos.length}`;
  $('#libCards').innerHTML = list.length
    ? list.map(v => cardHTML(v)).join('')
    : '<p class="muted">Nothing matches that filter.</p>';
}

/* ── render: progress ──────────────────────────────────── */
function renderProgress(){
  $('#capacities').innerHTML = Object.keys(LIB.modules).map(m => {
    const c = capacity(m), col = LIB.modules[m][1];
    const all = LIB.videos.filter(v => v.module === m).length;
    const doneN = LIB.videos.filter(v => v.module === m && S.done[v.id]).length;
    return `<div class="cap"><div class="top2"><b>${LIB.modules[m][0]}</b>
      <span>${c}% · ${doneN}/${all}</span></div>
      <div class="bar"><i style="width:${c}%;background:${col}"></i></div></div>`;
  }).join('');

  const total = Object.keys(S.done).length;
  const avg = total ? (Object.values(S.done).reduce((s, d) => s + (d.avg || 0), 0) / total).toFixed(1) : '—';
  const overall = Math.round(Object.keys(LIB.modules).reduce((s, m) => s + capacity(m), 0) / Object.keys(LIB.modules).length);
  const stats = [
    [overall + '%', 'brain capacity'], [total, 'videos trained'],
    [Math.round(minutesTrained()), 'minutes'], [S.streak.cur, 'day streak'],
    [S.streak.best, 'best streak'], [avg, 'avg recall rating'],
    [S.log.length, 'total reps'], [dueList().length, 'due now'],
  ];
  $('#statGrid').innerHTML = stats.map(([a, b]) => `<div class="stat"><b>${a}</b><i>${b}</i></div>`).join('');

  const due = dueList();
  $('#queueList').innerHTML = due.length
    ? due.map(x => `<div class="qitem"><span class="t">${esc(x.v.title)}</span>
        <span class="d">${LIB.modules[x.v.module][0]}</span>
        <button class="btn ghost" data-open="${x.v.id}">review</button></div>`).join('')
    : '<p class="muted">Queue empty. Everything is scheduled ahead.</p>';

  const notes = [...S.notes].reverse().slice(0, 60);
  $('#notebook').innerHTML = notes.length
    ? notes.map(n => `<div class="note"><div class="h"><b>${esc(n.title)}</b>
        <span class="chip">${n.rating}/5</span><span>${n.at.slice(0, 10)}</span></div>
        <div class="b">${esc(n.text)}</div></div>`).join('')
    : '<p class="muted">No ideas written down yet. The notebook is where the training actually sticks.</p>';
}

/* ── trainer ───────────────────────────────────────────── */
function openTrainer(id){
  const v = vid(id); if (!v) return;
  current = v; pendingRating = 0;
  $('#frame').src = embedSrc(v);
  document.querySelector('.player').classList.toggle('vertical', !!v.vertical);
  $('#tOpen').href = watchUrl(v);
  $('#tOpen').textContent = v.src === 'ig' ? 'Open on Instagram ↗' : 'Open on YouTube ↗';
  $('#tTitle').textContent = v.title;
  $('#tChannel').textContent = v.channel;
  $('#tMod').textContent = LIB.modules[v.module][0];
  $('#tMod').style.color = LIB.modules[v.module][1];
  $('#tLang').textContent = v.lang === 'hi' ? 'हिंदी / Hinglish' : 'English';
  $('#tDur').textContent = v.dur ? mins(v.dur) : (v.src === 'ig' ? 'reel' : '—');
  $('#tWhy').textContent = v.why;
  $('#tPrompt').textContent = '› ' + v.prompt;
  const last = S.notes.filter(n => n.id === v.id).slice(-1)[0];
  $('#tNote').value = last ? last.text : '';
  $('#c1').checked = $('#c2').checked = $('#c3').checked = false;
  document.querySelectorAll('#rate button').forEach(b => b.classList.toggle('on', false));
  $('#btnFinish').disabled = true;
  $('#schedHint').textContent = S.done[v.id]
    ? `Rep ${S.done[v.id].reps + 1} · last rating ${S.done[v.id].avg}/5`
    : 'First rep. Rate yourself honestly — that is what schedules the next review.';
  go('train');
}

function finishRep(){
  const v = current; if (!v || !pendingRating) return;
  const t = todayKey();
  const note = $('#tNote').value.trim();
  const d = S.done[v.id] || { reps:0, sum:0, avg:0, nextDue:null, first:null };
  d.reps += 1; d.sum += pendingRating; d.avg = +(d.sum / d.reps).toFixed(1);
  d.first = d.first || t;
  d.last = t;
  d.nextDue = todayKey(new Date(Date.now() + INTERVAL[pendingRating] * DAY));
  d.checks = [$('#c1').checked, $('#c2').checked, $('#c3').checked];
  S.done[v.id] = d;

  S.log.push({ id:v.id, at:new Date().toISOString(), rating:pendingRating });
  S.xp += 10 + pendingRating * 2;
  if (note) S.notes.push({ id:v.id, title:v.title, text:note, rating:pendingRating, at:new Date().toISOString() });
  bumpStreak();
  save();

  toast(`+${10 + pendingRating * 2} xp · ${INTERVAL[pendingRating] ? 'review in ' + INTERVAL[pendingRating] + 'd' : 'comes back today'}`);
  go('today');
  renderAll();
}

function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200);
}

/* ── routing + wiring ──────────────────────────────────── */
function go(name){
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.tabbar .tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  const tr = $('#screen-train');
  tr.classList.toggle('active', name === 'train');
  if (name !== 'train') {
    $('#frame').src = 'about:blank';
    $('.screens').scrollTop = 0;
  } else {
    $('.trainScroll').scrollTop = 0;
  }
  $('#langSeg').hidden = true;
  $('#langBtn').textContent = lang === 'all' ? 'Both' : (lang === 'hi' ? 'हिंदी' : 'English');
}
function renderAll(){ renderChrome(); renderToday(); renderLibrary(); renderProgress(); }

function wire(){
  document.querySelectorAll('.tabbar .tab').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#langBtn').onclick = e => { e.stopPropagation(); $('#langSeg').hidden = !$('#langSeg').hidden; };
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
    $('#langSeg').hidden = true;                 // close on select
    renderAll();
  };
  $('#tierSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    tierFilter = b.dataset.tier;
    document.querySelectorAll('#tierSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderLibrary();
  };
  $('#srcSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    srcFilter = b.dataset.src;
    document.querySelectorAll('#srcSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderLibrary();
  };
  $('#reelMod').innerHTML = Object.keys(LIB.modules)
    .map(m => `<option value="${m}">${LIB.modules[m][0]}</option>`).join('');
  $('#btnAddReel').onclick = () => {
    addReel($('#reelUrl').value, $('#reelMod').value, $('#reelLang').value);
    $('#reelUrl').value = '';
  };
  $('#reelUrl').onkeydown = e => { if (e.key === 'Enter') $('#btnAddReel').click(); };
  document.body.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); removeReel(rm.dataset.rm); }
  }, true);
  $('#q').oninput = e => { q = e.target.value.toLowerCase().trim(); renderLibrary(); };
  $('#btnBack').onclick = () => { go('today'); renderAll(); };
  $('#btnExtra').onclick = () => { extra = true; S.extra += 1; save(); renderAll(); };
  $('#rate').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    pendingRating = +b.dataset.r;
    document.querySelectorAll('#rate button').forEach(x => x.classList.toggle('on', x === b));
    $('#btnFinish').disabled = false;
    $('#schedHint').textContent = INTERVAL[pendingRating]
      ? `Scheduled: you will see this again in ${INTERVAL[pendingRating]} day(s).`
      : 'Scheduled: back in the queue today. A rep you rated 1 does not count as learned.';
  };
  $('#btnFinish').onclick = finishRep;

  $('#btnExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type:'application/json' }));
    a.download = `brain-gym-${todayKey()}.json`; a.click();
  };
  $('#btnImport').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { S = JSON.parse(r.result); save(); renderAll(); toast('imported'); }
                       catch { toast('bad file'); } };
    r.readAsText(f);
  };
  $('#btnReset').onclick = () => {
    if (confirm('Wipe all progress, notes and streaks? This cannot be undone.')) {
      S = blank(); save(); renderAll(); toast('reset');
    }
  };
  addEventListener('keydown', e => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === '1') go('today');
    if (e.key === '2') go('library');
    if (e.key === '3') go('progress');
  });
}

/* ── boot ──────────────────────────────────────────────── */
(async function boot(){
  const r = await fetch('library.json');
  const data = await r.json();
  LIB.modules = data.modules;
  LIB.videos = data.videos;
  S = JSON.parse(localStorage.getItem(KEY) || 'null') || blank();
  if (!S.custom) S.custom = [];
  // rehydrate any reels you added in an earlier session
  S.custom.forEach(c => {
    if (LIB.videos.find(v => v.id === c.id)) return;
    LIB.videos.push({ id:c.id, module:c.module, lang:c.lang, custom:true, src:'ig', vertical:true,
      title:`Instagram Reel — added by you (${c.id})`, channel:'Instagram', dur:null, views:null,
      tier:'reel', thumb:null,
      why:'You added this one. Reels are short — watch it twice, then write the idea.',
      prompt:'The one idea in this reel:' });
  });
  if (S.sessionDate !== todayKey()) { S.sessionDate = todayKey(); S.extra = 0; extra = false; }
  save();
  wire();
  renderAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http/no-SW context: fine */ });
  }
  console.log(`B.R.A.I.N. loaded · ${LIB.videos.length} videos · ${Object.keys(LIB.modules).length} modules`);
})();
