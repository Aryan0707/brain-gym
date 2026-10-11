/* World Map — written course; separate progress, shared proven scheduler. */
import { $, esc, fetchJSON, embedSrc, watchUrl } from './util.js';
import { WorldStore, decodeWorld, scheduleFor, worldDue } from './world-state.js';
import { previewText } from './scheduler.js';

let course, store, active = null, stage = 'read', lessons = [];
const own = (obj, id) => Object.prototype.hasOwnProperty.call(obj, id);
const matches = (lesson, query) => !query || [lesson.title,lesson.summary,...lesson.concepts,...lesson.paragraphs]
  .join(' ').toLowerCase().includes(query);

function warning(){
  $('#worldWarning').textContent = store.warning;
  $('#worldWarning').hidden = !store.warning;
}

function roadmap(){
  const previous = [...document.querySelectorAll('[data-layer]')];
  const opened = new Set(previous.filter(d => d.open).map(d => d.dataset.layer));
  const query = $('#worldSearch').value.toLowerCase().trim();
  const count = lessons.filter(l => matches(l,query)).length;
  $('#worldClear').hidden = !query;
  $('#worldSearchStatus').textContent = !query ? '' : count
    ? `${count} lesson${count === 1 ? '' : 's'} found · original numbering kept`
    : 'No lessons match. Try a broader concept or clear search.';
  $('#worldRoadmap').innerHTML = course.layers.map((layer, i) => {
    if (!layer.lessons.some(l => matches(l,query))) return '';
    const checked = layer.lessons.filter(l => own(store.state.lessons, l.id)).length;
    return `<details class="world-layer" data-layer="${esc(layer.id)}" ${query || opened.has(layer.id) || (!previous.length && i === 0) ? 'open' : ''}><summary><span class="world-layer-number">${i + 1}</span><span>${layer.stage ? `<span class="world-layer-stage">${esc(layer.stage)}</span>` : ''}<span class="world-layer-title">${esc(layer.title)}</span><span class="world-layer-summary">${checked}/${layer.lessons.length} self-checked</span></span></summary><div class="world-layer-content">${layer.stageNote ? `<p class="world-layer-stage-note">${esc(layer.stageNote)}</p>` : ''}<p class="world-layer-goal"><b>Goal:</b> ${esc(layer.goal)}</p>${layer.lessons.map((l,j) => !matches(l,query) ? '' : `<a class="world-lesson-link" data-lesson="${esc(l.id)}" href="world.html?lesson=${encodeURIComponent(l.id)}" ${active?.id === l.id ? 'aria-current="page"' : ''}><span class="world-lesson-number">${i + 1}.${j + 1}</span><span class="world-lesson-copy">${esc(l.title)}<small>${l.minutes} min · written lesson${l.video ? ' · video' : ''}</small></span>${own(store.state.lessons,l.id) ? '<span class="world-status">✓</span>' : ''}</a>`).join('')}<details class="world-checkpoint"><summary>Layer checkpoint</summary><p>${esc(layer.checkpoint)}</p></details></div></details>`;
  }).join('');
}

function progress(){
  const checked = lessons.filter(l => own(store.state.lessons, l.id)).length;
  const due = lessons.filter(l => worldDue(store.state.lessons[l.id], Date.now()));
  $('#worldProgressText').textContent = `${checked} / ${lessons.length} self-checked`;
  $('#worldProgress').max = lessons.length;
  $('#worldProgress').value = checked;
  $('#worldDueText').textContent = due.length ? `${due.length} due` : '';
  $('#worldReview').disabled = !due.length;
  const next = lessons.find(l => !own(store.state.lessons, l.id)) || lessons[0];
  $('#worldContinue').textContent = checked ? `Continue · ${next.position} →` : 'Start at Layer 1 →';
  warning();
  roadmap();
}

/* The video is a click-to-load facade: nothing reaches YouTube until the reader presses play. */
const videoFacade = v => `<button class="world-video-play" type="button" data-video="${esc(v.id)}"><span class="world-video-icon" aria-hidden="true">▶</span><span>${esc(v.title)}<small>${esc(v.channel)} · ${Math.round(v.dur / 60)} min · plays from YouTube</small></span></button>`;

function stopVideo(){
  const frame = document.querySelector('#lessonBody iframe');
  if (frame && active?.video) frame.outerHTML = videoFacade(active.video);
}

function setStage(value){
  stage = value;
  if (value !== 'read') stopVideo();
  $('#lessonBody').hidden = value !== 'read';
  $('#worldRecall').hidden = !['recall','check'].includes(value);
  $('#worldCheck').hidden = value !== 'check';
  $('#worldDone').hidden = value !== 'done';
  $('#worldBeginRecall').hidden = value !== 'read';
  // Before saving, the locked answer is the evidence; rereading would discard it.
  $('#worldReRead').hidden = value !== 'done';
  $('#worldReveal').hidden = value !== 'recall';
  $('#worldNote').disabled = value === 'check';
  for (const [id,s] of [['worldStepRead','read'],['worldStepRecall','recall'],['worldStepCheck','check']]) {
    const el = $(`#${id}`);
    if (s === value || (s === 'check' && value === 'done')) el.setAttribute('aria-current','step');
    else el.removeAttribute('aria-current');
  }
}

function ratingHint(){
  const radio = document.querySelector('[name="world-rating"]:checked');
  $('#worldSave').disabled = !radio || stage !== 'check';
  if (!radio) return;
  const matched = [...document.querySelectorAll('#worldPoints input')].map(c => c.checked);
  const effective = Math.min(Number(radio.value), [1,2,3,5][matched.filter(Boolean).length]);
  const previous = store.state.lessons[active.id], now = Date.now();
  const when = previous && scheduleFor(previous, effective, now) === previous.card
    ? 'date unchanged (practised today)' : previewText(previous?.card, effective, now);
  $('#worldRatingHint').textContent = `${matched.filter(Boolean).length}/3 points self-marked · Effective rating ${effective}/5 · Review ${when}.`;
}

function openLesson(id, push = true){
  const item = lessons.find(x => x.id === id);
  if (!item) { showMap(false); $('#worldWarning').hidden = false; $('#worldWarning').textContent = 'That lesson link was not found. Choose a lesson from the map.'; return; }
  active = item;
  if (push) history.pushState({ world:id }, '', `world.html?lesson=${encodeURIComponent(id)}`);
  $('#worldOverview').hidden = true;
  $('#worldLesson').hidden = false;
  $('#worldMapBtn').hidden = false;
  document.body.classList.add('reading');
  $('#lessonPosition').textContent = `Layer ${item.layerNumber}${item.layerStage ? ` · ${item.layerStage}` : ''} · ${item.layerTitle} / ${item.position}`;
  $('#lessonTitle').textContent = item.title;
  $('#lessonSummary').textContent = item.summary;
  $('#lessonMeta').textContent = `${item.minutes} min read${item.video ? ` + ${Math.round(item.video.dur / 60)} min video` : ''} · Written lesson · English`;
  const sources = item.sourceIds.map(id => course.sources.find(s => s.id === id)).filter(s => s && /^https:\/\//.test(s.url));
  const v = item.video;
  $('#lessonBody').innerHTML = item.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')
    + `<section class="world-example"><h3>${esc(item.example.title)}</h3><p>${esc(item.example.text)}</p></section>`
    + (v ? `<section class="world-video"><h3>Watch an easy explainer</h3><div class="world-video-frame">${videoFacade(v)}</div><p class="world-small">${esc(v.why)} Needs internet. <a href="${esc(watchUrl(v))}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></p></section>` : '')
    + `<section class="world-limit"><h3>Where this explanation stops</h3><p>${esc(item.limit)}</p></section>`
    + `<details class="world-sources"><summary>Sources & further reading (${sources.length})</summary><ul>${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><p>${esc(s.note)}</p></li>`).join('')}</ul><p>Lessons are a plain-English synthesis, not quotations. Source pages need an internet connection.</p></details>`;
  $('#worldPrompt').textContent = item.prompt;
  $('#worldNote').value = store.state.drafts[id] || '';
  $('#worldNote').disabled = false;
  $('#worldReveal').disabled = $('#worldNote').value.trim().length < 15;
  $('#worldPoints').innerHTML = item.recallKeys.map((point,i) => `<label><input type="checkbox" data-point="${i}"><span>${esc(point)}</span></label>`).join('');
  document.querySelectorAll('[name="world-rating"]').forEach(r => { r.checked = false; });
  $('#worldRatingHint').textContent = 'Choose a rating after checking your answer.';
  $('#worldSave').disabled = true;
  $('#worldPrevious').hidden = true;
  $('#worldPrev').disabled = lessons.indexOf(item) === 0;
  $('#worldNext').disabled = lessons.indexOf(item) === lessons.length - 1;
  setStage(own(store.state.lessons,id) || store.state.drafts[id] ? 'recall' : 'read');
  roadmap();
  const group = document.querySelector(`[data-layer="${item.layerId}"]`); if (group) group.open = true;
  $('#lessonTitle').focus({ preventScroll:true });
  window.scrollTo(0, 0);
}

function showMap(push = true){
  if (push) history.pushState({ world:null }, '', 'world.html');
  stopVideo();
  active = null;
  $('#worldOverview').hidden = false;
  $('#worldLesson').hidden = true;
  $('#worldMapBtn').hidden = true;
  document.body.classList.remove('reading');
  progress();
}

function wire(){
  $('#worldRoadmap').onclick = e => { const a = e.target.closest('[data-lesson]'); if (a) { e.preventDefault(); openLesson(a.dataset.lesson); } };
  $('#worldMapBtn').onclick = () => { showMap(); window.scrollTo(0,0); };
  $('#lessonBody').onclick = e => {
    const play = e.target.closest('[data-video]');
    if (!play || !active?.video) return;
    // A fresh iframe, never a reused one: changing a live iframe's src adds a history entry.
    const frame = Object.assign(document.createElement('iframe'), {
      src:`${embedSrc(active.video)}&autoplay=1`, title:`Video: ${active.video.title}`, allowFullscreen:true,
      allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share' });
    play.replaceWith(frame);
  };
  $('#worldSearch').oninput = roadmap;
  $('#worldClear').onclick = () => { $('#worldSearch').value = ''; roadmap(); $('#worldSearch').focus(); };
  $('#worldExport').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(store.state,null,2)],{ type:'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'brain-world-map-progress.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url),3000);
    $('#worldDataStatus').textContent = 'Exported World Map progress only. Video progress uses the main app export.';
  };
  $('#worldImportBtn').onclick = () => $('#worldImport').click();
  $('#worldImport').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Invalid file: course progress must be smaller than 2 MB.');
      const raw = await file.text(), preview = decodeWorld(raw);
      const count = Object.keys(preview.lessons).length;
      if (!confirm(`Replace only World Map progress with ${count} self-checked lessons? A raw backup will be kept. Video progress is not changed.`)) return;
      store.import(raw); showMap();
      $('#worldDataStatus').textContent = 'World Map progress imported. Previous course data was backed up if present.';
    } catch (error) { $('#worldDataStatus').textContent = `${error.message} Nothing was replaced.`; }
    finally { e.target.value = ''; }
  };
  $('#worldContinue').onclick = () => openLesson((lessons.find(l => !own(store.state.lessons,l.id)) || lessons[0]).id);
  $('#worldReview').onclick = () => {
    const due = lessons.filter(l => worldDue(store.state.lessons[l.id],Date.now())).sort((a,b) => store.state.lessons[a.id].card.dueAt - store.state.lessons[b.id].card.dueAt);
    if (due[0]) openLesson(due[0].id);
  };
  $('#worldBeginRecall').onclick = () => { setStage('recall'); $('#worldNote').focus(); };
  $('#worldNote').oninput = () => {
    store.setDraft(active.id, $('#worldNote').value);
    $('#worldReveal').disabled = $('#worldNote').value.trim().length < 15;
    warning();
  };
  $('#worldReveal').onclick = () => {
    if ($('#worldNote').value.trim().length < 15 || stage !== 'recall') return;
    setStage('check');
    const previous = store.state.lessons[active.id];
    $('#worldPrevious').hidden = !previous;
    $('#worldPreviousText').textContent = previous?.note || '';
    $('#worldPoints').querySelector('input')?.focus();
  };
  $('#worldPoints').onchange = ratingHint;
  document.querySelector('.world-rating').onchange = ratingHint;
  $('#worldSave').onclick = () => {
    const selected = document.querySelector('[name="world-rating"]:checked');
    if (stage !== 'check' || !selected) return;
    const matched = [...document.querySelectorAll('#worldPoints input')].map(c => c.checked);
    const entry = store.record(active.id,{ note:$('#worldNote').value,matched,rating:Number(selected.value) });
    $('#worldDoneText').textContent = `${store.persisted ? 'Saved on this device.' : 'Not saved on this device—export a copy.'} ${matched.filter(Boolean).length}/3 points self-marked; effective rating ${entry.effectiveRating}/5. ${entry.rescheduled ? 'Next review' : 'Already practised today, so the review date stays'}: ${new Date(entry.card.dueAt).toLocaleString('en-GB')}. This records practice, not verified mastery.`;
    setStage('done');
    progress();
  };
  $('#worldReRead').onclick = () => {
    // A reread follows a locked answer. Start a new recall with a fresh answer.
    $('#worldNote').value = ''; $('#worldReveal').disabled = true;
    store.setDraft(active.id,'');
    document.querySelectorAll('[name="world-rating"]').forEach(r => { r.checked=false; });
    $('#worldPoints').querySelectorAll('input').forEach(c => { c.checked=false; });
    $('#worldSave').disabled = true;
    setStage('read');
    warning();
  };
  $('#worldPrev').onclick = () => { const i = lessons.indexOf(active); if (i > 0) openLesson(lessons[i - 1].id); };
  $('#worldNext').onclick = () => { const i = lessons.indexOf(active); if (i < lessons.length - 1) openLesson(lessons[i + 1].id); };
  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('lesson');
    if (id) openLesson(id,false); else showMap(false);
  });
}

async function enableOffline(){
  const status = $('#worldOfflineStatus');
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'Offline caching needs HTTPS or localhost. The course still works online.';
    return;
  }
  const cached = async () => {
    const paths = ['world.html','world.css','style.css','src/world-map.js',
      'src/world-state.js','src/util.js','src/scheduler.js','courses/world-map.json'];
    const hits = await Promise.all(paths.map(p => caches.match(new URL(p,location.href))));
    return hits.every(Boolean);
  };
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const report = async () => {
      if (reg.waiting) {
        status.textContent = 'An updated offline copy is waiting. Return to Library to accept the app update.';
      } else if (await cached()) {
        status.textContent = 'Ready offline: written lessons and recall. Videos and source websites need internet.';
      } else {
        status.textContent = 'Offline copy is not ready yet. Keep this page online until it is cached.';
      }
    };
    const watch = () => reg.installing?.addEventListener('statechange', report);
    reg.addEventListener('updatefound', watch);
    watch();
    navigator.serviceWorker.ready.then(report).catch(() => {});
    await report();
  } catch {
    status.textContent = await cached().catch(() => false)
      ? 'Ready offline: written lessons and recall. Videos and source websites need internet.'
      : 'Offline copy could not be prepared. Keep a connection to read the course.';
  }
}

async function boot(){
  try {
    const r = await fetchJSON('courses/world-map.json');
    if (!r.ok || r.data?.version !== 1 || !Array.isArray(r.data.layers) || !r.data.layers.length) throw Error('Course data was unavailable.');
    course = r.data;
    lessons = course.layers.flatMap((layer,i) => layer.lessons.map((lesson,j) => ({ ...lesson,
      layerId:layer.id, layerNumber:i + 1,layerTitle:layer.title,layerStage:layer.stage,position:`${i + 1}.${j + 1}` })));
    let storage; try { storage = localStorage; } catch {}
    store = new WorldStore(storage,lessons.map(l => l.id));
    $('#courseTitle').textContent = course.title;
    $('#courseSubtitle').textContent = course.subtitle;
    $('#courseDescription').textContent = course.description;
    $('#courseCounts').textContent = `${course.layers.length} layers · ${lessons.length} written lessons`;
    $('#worldCoverage').innerHTML = course.coverage.map(c => `<span>${esc(c)}</span>`).join('');
    progress(); wire();
    $('#worldLoading').hidden = true;
    $('#worldApp').hidden = false;
    $('#worldApp').dataset.worldReady = 'true';
    const id = new URLSearchParams(location.search).get('lesson');
    if (id) openLesson(id,false);
    enableOffline();
  } catch (e) {
    $('#worldLoading').hidden = true;
    $('#worldError').hidden = false;
    $('#worldErrorText').textContent = `${e.message} If offline, open the course online once so it can be cached.`;
  }
}
boot();
