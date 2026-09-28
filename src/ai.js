/* B.R.A.I.N. in-app AI: "Explain it simpler", through OpenRouter with a cheap model.
   The key is pasted in Settings and stays in THIS browser only (its own localStorage entry):
   never in the app code, the repo, or a progress export. Research uses a stronger model
   offline (tools/research_video.py); the app only needs short, cheap explanations. */
import { $, keyOf, esc } from './util.js';

export const AI_MODEL = 'anthropic/claude-haiku-4.5';
const API = 'https://openrouter.ai/api/v1/chat/completions';
const KEY_STORE = 'braingym.ai.key';
const CACHE_STORE = 'braingym.ai.explain';   // one explanation per video+language, so each costs once

export const looksLikeKey = k => /^sk-or-v1-[0-9a-f]{64}$/.test(k);
export function getKey(){ try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
export function setKey(k){
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {}
}
function cache(){ try { return JSON.parse(localStorage.getItem(CACHE_STORE)) || {}; } catch { return {}; } }
function remember(id, text){
  const c = cache(); c[id] = text;
  try { localStorage.setItem(CACHE_STORE, JSON.stringify(c)); } catch {}
}

/* Only what the lesson itself states: title, why it is in the library, and approved key points. */
export function explainMessages(v, lang){
  const facts = [`Lesson: ${v.title}`, v.why && `What it teaches: ${v.why}`,
    v.recallKeys?.length && `Key points:\n- ${v.recallKeys.join('\n- ')}`].filter(Boolean).join('\n');
  const language = lang === 'hi'
    ? 'Write in simple spoken Hindi (Devanagari). Common English words like "bias" or "focus" are fine.'
    : 'Write in simple English.';
  return [
    { role:'system', content:
      'You explain one idea from a short learning video to someone who did not fully get it. ' +
      'Explain it like to a 12-year-old: 3 short sentences, then one everyday example that starts with "Example:". ' +
      'No jargon, no lists, no headings. Stay on the idea of this lesson; do not add advice it does not give. ' + language },
    { role:'user', content: facts },
  ];
}

export async function explainSimpler(v, lang, { fetchImpl = fetch } = {}){
  const id = `${keyOf(v)}|${lang}`;
  const hit = cache()[id];
  if (hit) return hit;
  const key = getKey();
  if (!key) throw Object.assign(new Error('no-key'), { code:'no-key' });
  if (navigator.onLine === false) throw Object.assign(new Error('offline'), { code:'offline' });
  const res = await fetchImpl(API, {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json', 'X-Title':'B.R.A.I.N.' },
    body: JSON.stringify({ model:AI_MODEL, max_tokens:300, temperature:0.3, messages:explainMessages(v, lang) }),
  });
  if (!res.ok) throw Object.assign(new Error(`http-${res.status}`), { code:res.status });
  const text = (await res.json()).choices?.[0]?.message?.content?.trim();
  if (!text) throw Object.assign(new Error('empty'), { code:'empty' });
  remember(id, text);
  return text;
}

const ERRORS = {
  'no-key': 'Add your OpenRouter key in Settings to use AI explanations.',
  offline: 'You are offline. Explanations need the internet the first time.',
  401: 'Your OpenRouter key was not accepted. Check it in Settings.',
  402: 'Your OpenRouter account is out of credit.',
  429: 'Too many requests. Try again in a minute.',
};

/* ── UI: an [data-explain] panel sits in the Watch and Check steps (never in Recall) ── */
let currentVideo = () => null;

function render(panel, v, lang, text){
  const other = lang === 'hi' ? 'en' : 'hi';
  panel.querySelector('.explain-out').innerHTML =
    text.split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('') +
    `<p class="explain-meta"><button class="linkish" data-explain-lang="${other}">${other === 'hi' ? 'हिंदी में समझाओ' : 'Explain in English'}</button>
      <small>AI · Claude Haiku 4.5 · can be wrong</small></p>`;
}

async function run(panel, lang){
  const v = currentVideo(); if (!v) return;
  const out = panel.querySelector('.explain-out'), btn = panel.querySelector('.explain-btn');
  out.hidden = false; btn.disabled = true;
  out.innerHTML = '<p class="muted">Thinking…</p>';
  try {
    const text = await explainSimpler(v, lang);
    if (currentVideo() === v) render(panel, v, lang, text);
  } catch (e) {
    out.innerHTML = `<p class="muted">${esc(ERRORS[e.code] || 'Could not get an explanation. Try again.')}</p>` +
      (e.code === 'no-key' || e.code === 401 ? '<button class="linkish" data-open-sheet="settings">Open Settings</button>' : '');
  } finally { btn.disabled = false; }
}

export function resetExplain(){
  document.querySelectorAll('[data-explain]').forEach(p => {
    const out = p.querySelector('.explain-out'); out.hidden = true; out.innerHTML = '';
  });
}

function renderKeyStatus(){
  const has = !!getKey();
  $('#aiKeyStatus').textContent = has
    ? 'Key saved on this device only. ~$0.001 per new explanation.'
    : 'Paste an OpenRouter key (openrouter.ai/keys). It stays on this device only.';
  $('#aiKeyRemove').hidden = !has;
  $('#aiKey').value = '';
  $('#aiKey').placeholder = has ? '•••••••• saved' : 'sk-or-v1-…';
}

export function initAi(getCurrent){
  currentVideo = getCurrent;
  document.body.addEventListener('click', e => {
    const b = e.target.closest('[data-explain] .explain-btn, [data-explain] [data-explain-lang]');
    if (!b) return;
    const v = currentVideo(); if (!v) return;
    run(b.closest('[data-explain]'), b.dataset.explainLang || (v.lang === 'hi' ? 'hi' : 'en'));
  });
  if (!$('#aiKey')) return;
  $('#aiKeySave').onclick = () => {
    const k = $('#aiKey').value.trim();
    if (!looksLikeKey(k)) { $('#aiKeyStatus').textContent = 'That does not look like an OpenRouter key (sk-or-v1-… 73 characters). Paste it once.'; return; }
    setKey(k); renderKeyStatus();
  };
  $('#aiKeyRemove').onclick = () => { setKey(''); renderKeyStatus(); };
  renderKeyStatus();
}
