// Kinema — front-of-house for a local Wan 2.2 video engine.
const $ = (s) => document.querySelector(s);
const state = {
  aspect: '16:9',
  duration: 4,
  pending: new Map(), // id -> card element
};

const stageFor = (node) =>
  node === 12 ? 'Sketching the scene'
  : node === 13 ? 'Refining motion & detail'
  : node === 14 || node === 15 ? 'Encoding your video'
  : 'Warming up the engine';

/* ---------- engine pill ---------- */
async function checkEngine() {
  const pill = $('#engine-pill'), label = $('#engine-label'), note = $('#set-engine');
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    if (j.comfyui) {
      pill.dataset.state = 'on';
      label.textContent = 'Local engine ready';
      if (note) note.textContent = `Engine: ComfyUI ${j.version || ''} · ${j.gpus?.length || '?'} GPU${j.gpus?.length === 1 ? '' : 's'}`;
    } else throw 0;
  } catch {
    pill.dataset.state = 'off';
    label.textContent = 'Engine offline';
    if (note) note.textContent = 'Engine offline — start ComfyUI on :8188';
  }
}

/* ---------- compose ---------- */
const promptEl = $('#prompt');
promptEl.addEventListener('input', () => { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + 'px'; });
promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#compose').requestSubmit(); });

for (const b of document.querySelectorAll('[data-aspect]')) b.addEventListener('click', () => { state.aspect = b.dataset.aspect; setPressed('[data-aspect]', b); });
for (const b of document.querySelectorAll('[data-duration]')) b.addEventListener('click', () => { state.duration = Number(b.dataset.duration); setPressed('[data-duration]', b); });
function setPressed(sel, active) { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === active)); }

$('#compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  const btn = $('#generate');
  btn.disabled = true;
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, aspect: state.aspect, duration: state.duration }) });
    if (!r.ok) throw new Error((await r.json()).error || 'could not queue');
    const { id } = await r.json();
    promptEl.value = ''; promptEl.style.height = 'auto';
    addPendingCard(id, prompt, state.aspect);
  } catch (err) { alertUser(err.message); }
  btn.disabled = false;
});

function alertUser(msg) {
  const pill = $('#engine-pill');
  pill.dataset.state = 'off'; $('#engine-label').textContent = msg;
  setTimeout(checkEngine, 4000);
}

/* ---------- pending card ---------- */
function ensureLibrary() {
  $('#library').hidden = false;
  $('#empty-hint').classList.add('hidden');
  $('#hero').classList.add('compact');
}
function ringSVG() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('class', 'ring'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle class="track" cx="24" cy="24" r="20"/><circle class="bar" cx="24" cy="24" r="20" stroke-dasharray="125.6" stroke-dashoffset="125.6"/>';
  return svg;
}
function addPendingCard(id, prompt, aspect) {
  ensureLibrary();
  const card = document.createElement('article');
  card.className = 'card pending';
  card.style.aspectRatio = aspect === '9:16' ? '9 / 14' : aspect === '1:1' ? '1 / 1' : '16 / 10';
  const ring = ringSVG();
  const stage = document.createElement('p'); stage.className = 'stage'; stage.textContent = 'Warming up the engine';
  const pct = document.createElement('p'); pct.className = 'pct'; pct.textContent = 'queued · usually 2–4 min';
  card.append(ring, stage, pct);
  $('#grid').prepend(card);
  state.pending.set(id, { card, ring, stage, pct, bar: ring.querySelector('.bar') });
  pollJob(id);
}

function pollJob(id) {
  const t = setInterval(async () => {
    let j;
    try { j = await (await fetch(`/api/status/${id}`)).json(); } catch { return; }
    const p = state.pending.get(id);
    if (!p) { clearInterval(t); return; }
    if (j.state === 'running') {
      p.stage.textContent = stageFor(j.node);
      if (j.progress != null) {
        p.pct.textContent = `${Math.round(j.progress * 100)}%`;
        p.bar.style.strokeDashoffset = String(125.6 * (1 - j.progress));
      }
    }
    if (j.state === 'done') { clearInterval(t); state.pending.delete(id); p.card.remove(); refreshLibrary(); }
    if (j.state === 'error') { clearInterval(t); state.pending.delete(id); p.card.classList.add('error'); p.ring.remove(); p.stage.textContent = 'Generation failed'; p.pct.textContent = j.error?.slice(0, 80) || 'try again'; }
  }, 1200);
}

/* ---------- library ---------- */
async function refreshLibrary() {
  let vids = [];
  try { vids = await (await fetch('/api/videos')).json(); } catch { return; }
  const grid = $('#grid');
  // Reconcile: add new, drop removed, keep existing DOM (never abort in-flight loads).
  const existing = new Map([...grid.children].filter((el) => !el.classList.contains('pending')).map((el) => [el.dataset.url, el]));
  const seen = new Set();
  for (const v of vids) {
    seen.add(v.url);
    if (!existing.has(v.url)) grid.append(videoCard(v));
  }
  // Newest generation takes the cinematic stage.
  const done = [...grid.children].filter((el) => !el.classList.contains('pending'));
  done.forEach((el, i) => el.classList.toggle('featured', i === 0));
  for (const [url, el] of existing) if (!seen.has(url)) el.remove();
  $('#library-count').textContent = vids.length ? `${vids.length} video${vids.length === 1 ? '' : 's'}` : '';
  if (!vids.length && !state.pending.size) { $('#library').hidden = true; $('#empty-hint').classList.remove('hidden'); $('#hero').classList.remove('compact'); }
  else ensureLibrary();
}

function videoCard(v) {
  const card = document.createElement('article');
  card.className = 'card'; card.tabIndex = 0;
  card.dataset.url = v.url;
  card.setAttribute('role', 'button');
  const ariaLabel = (v.prompt || 'a generated video') + ' — open player';
  card.setAttribute('aria-label', ariaLabel);
  const vid = document.createElement('video');
  vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'none';
  if (v.poster) { vid.poster = v.poster; vid.preload = 'none'; } else { vid.src = v.url; vid.preload = 'metadata'; }
  vid.addEventListener('mouseenter', () => vid.play().catch(() => {}));
  vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0.1; });
  const badge = document.createElement('span'); badge.className = 'play-badge';
  badge.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#fff" d="M8 5l12 7-12 7z"/></svg>';
  const dur = document.createElement('span'); dur.className = 'dur-badge';
  dur.textContent = v.duration ? `${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, '0')}` : 'video';
  if (v.poster) vid.src = v.url;
  const label = document.createElement('div'); label.className = 'card-label'; label.textContent = v.prompt || 'untitled';
  card.append(vid, badge, dur, label);
  const open = () => openPlayer(v);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

/* ---------- player ---------- */
function openPlayer(v) {
  $('#player-video').src = v.url;
  $('#player-prompt').textContent = v.prompt || 'untitled';
  $('#player-download').href = v.url;
  $('#player-remix').onclick = () => { closeOverlays(); promptEl.value = v.prompt || ''; promptEl.dispatchEvent(new Event('input')); promptEl.focus(); };
  $('#player').hidden = false;
}
function closeOverlays() {
  $('#player').hidden = true; $('#drawer').hidden = true;
  $('#player-video').pause(); $('#player-video').removeAttribute('src'); $('#player-video').load();
}
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', closeOverlays);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlays(); });

/* ---------- settings ---------- */
$('#settings-btn').addEventListener('click', () => { $('#drawer').hidden = false; $('#settings-btn').setAttribute('aria-expanded', 'true'); });

/* ---------- boot ---------- */
checkEngine(); setInterval(checkEngine, 30000);
refreshLibrary(); setInterval(refreshLibrary, 8000);
