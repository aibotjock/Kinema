// Kinema — front-of-house for a local Wan 2.2 video engine.
const $ = (s) => document.querySelector(s);
const state = {
  model: null,
  models: [],
  mode: 't2v',
  aspect: 'landscape',
  resolution: 720,
  duration: 4,
  image: null, // {name} from /api/upload/image
  pending: new Map(), // id -> card element
};

/* ---------- model picker ---------- */
async function loadModels() {
  let data = { default: 'minimax-h3', models: [] };
  try { data = await (await fetch('/api/models')).json(); } catch { return; }
  state.models = data.models;
  if (!state.model) state.model = data.default;
  const wrap = document.getElementById('model-cards');
  wrap.replaceChildren(...data.models.map((m) => modelCard(m)));
  syncChips();
}

function modelCard(m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'model-card' + (m.id === state.model ? ' selected' : '') + (m.installed ? '' : ' missing');
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(m.id === state.model));
  const badges = [
    m.modes.includes('i2v') && 'image→video',
    m.modes.includes('audio') && 'with sound',
  ].filter(Boolean).map((t) => `<span class="badge">${t}</span>`).join('');
  b.innerHTML = `
    <span class="mc-head"><span class="mc-name">${m.name}</span>${m.installed ? '<span class="mc-on">ready</span>' : '<span class="mc-off">not installed</span>'}</span>
    <span class="mc-tag">${m.tagline}</span>
    <span class="mc-exp">${m.explanation}</span>
    <span class="mc-badges">${badges}</span>
    <span class="mc-speed">${m.speeds}</span>`;
  b.addEventListener('click', () => {
    state.model = m.id;
    for (const el of document.querySelectorAll('.model-card')) {
      el.classList.toggle('selected', el === b);
      el.setAttribute('aria-checked', String(el === b));
    }
    syncChips();
  });
  return b;
}

/* keep chips honest per model: resolutions it supports, mode availability */
function syncChips() {
  const m = state.models.find((x) => x.id === state.model);
  if (!m) return;
  for (const b of document.querySelectorAll('[data-res]')) {
    const r = b.dataset.res;
    const support = m.resolutions[r];
    b.hidden = !support || support === 'unavailable';
    b.setAttribute('aria-pressed', String(Number(r) === state.resolution));
    b.title = support === 'upscaled' ? 'Rendered smaller, then upscaled to this size' : support === 'fast' ? 'Fastest draft quality' : 'Full quality at this size';
  }
  if (!m.resolutions[String(state.resolution)] || m.resolutions[String(state.resolution)] === 'unavailable') {
    state.resolution = 720;
    for (const b of document.querySelectorAll('[data-res]')) b.setAttribute('aria-pressed', String(b.dataset.res === '720'));
  }
  const i2v = document.getElementById('i2v-slot');
  i2v.hidden = state.mode !== 'i2v';
}

for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { state.mode = b.dataset.mode; setPressed('[data-mode]', b); syncChips(); });
for (const b of document.querySelectorAll('[data-aspect]')) b.addEventListener('click', () => { state.aspect = b.dataset.aspect; setPressed('[data-aspect]', b); });
for (const b of document.querySelectorAll('[data-res]')) b.addEventListener('click', () => { state.resolution = Number(b.dataset.res); setPressed('[data-res]', b); });
for (const b of document.querySelectorAll('[data-duration]')) b.addEventListener('click', () => { state.duration = Number(b.dataset.duration); setPressed('[data-duration]', b); });

/* ---------- i2v image slot ---------- */
const fileInput = document.getElementById('i2v-file');
const dropZone = document.querySelector('.i2v-drop');
for (const ev of ['dragover', 'dragleave', 'drop']) dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.toggle('drag', ev === 'dragover'); });
dropZone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) uploadImage(f); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadImage(fileInput.files[0]); });

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file, file.name);
  document.getElementById('i2v-hint').textContent = 'Uploading…';
  try {
    const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
    const j = await r.json();
    state.image = j;
    const img = document.getElementById('i2v-preview');
    img.src = `/api/view?filename=${encodeURIComponent(j.name)}&subfolder=${encodeURIComponent(j.subfolder || '')}&type=input`;
    img.hidden = false;
    document.getElementById('i2v-hint').textContent = 'Starting image ready — the video grows from it.';
  } catch {
    document.getElementById('i2v-hint').textContent = 'Upload failed — try again.';
  }
}

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
      label.textContent = j.ready > 1 ? `${j.ready} engines ready · work split` : 'Local engine ready';
      if (note) note.textContent = j.engines?.map((e) => `${e.id}: ComfyUI ${e.version || '?'}${e.ok ? '' : ' (offline)'}`).join(' · ') || `ComfyUI ${j.version || ''}`;
    } else throw 0;
  } catch {
    pill.dataset.state = 'off';
    label.textContent = 'Engine offline';
    if (note) note.textContent = 'Engine offline — start ComfyUI (see scripts/start-comfyui-dual.sh)';
  }
}

/* ---------- compose ---------- */
const promptEl = $('#prompt');
promptEl.addEventListener('input', () => { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + 'px'; });
promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#compose').requestSubmit(); });

function setPressed(sel, active) { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === active)); }

$('#compose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  const btn = $('#generate');
  btn.disabled = true;
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, aspect: state.aspect, duration: state.duration, model: state.model, mode: state.mode, resolution: state.resolution, image: state.image?.name }) });
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
loadModels();
checkEngine(); setInterval(checkEngine, 30000);
refreshLibrary(); setInterval(refreshLibrary, 8000);

/* ---------- persona studio ---------- */
const studio = {
  persona: null,
  async load() {
    let list = [];
    try { list = await (await fetch('/api/personas')).json(); } catch { return; }
    const wrap = document.getElementById('persona-cards');
    wrap.replaceChildren(...list.map((p) => {
      const b = document.createElement('div');
      b.className = 'model-card persona-card' + (studio.persona === p.id ? ' selected' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(studio.persona === p.id));
      b.tabIndex = 0;
      b.innerHTML = `
        ${p.imageUrl ? `<img class="mc-face" src="${p.imageUrl}" alt="${p.name}'s face">` : ''}
        <span class="mc-head"><span class="mc-name">${p.name}</span>${p.consentGranted ? '<span class="mc-on">consented</span>' : '<span class="mc-off">no consent</span>'}</span>
        <span class="mc-tag">${p.tagline || 'persona'}</span>
        <span class="mc-exp">Voice: ${p.hasVoiceSample ? 'cloned from consented sample' : 'none yet'} · consent by ${p.consentBy || '—'} on ${p.consentDate?.slice(0, 10) || ''}</span>
        <span class="pc-actions">
          <button type="button" class="pc-btn pc-pick"${p.hasVoiceSample ? '' : ' disabled'}>${p.hasVoiceSample ? '▶ Hear voice' : 'no voice yet'}</button>
          <button type="button" class="pc-btn pc-del" title="Delete persona and its cloned voice (revokes consent)">✕ delete</button>
        </span>
        <span class="mc-use">${studio.persona === p.id ? '✓ in the studio below' : `Make ${p.name} speak →`}</span>`;
      b.addEventListener('click', () => {
        studio.persona = p.id;
        for (const el of wrap.children) {
          el.classList.toggle('selected', el === b);
          const use = el.querySelector('.mc-use');
          if (use) use.textContent = el === b ? '✓ in the studio below' : `Make ${el.querySelector('.mc-name').textContent} speak →`;
        }
        document.getElementById('persona-form').hidden = true;
        const strip = document.getElementById('pc-strip');
        if (p.imageUrl) { strip.hidden = false; document.getElementById('pc-face').src = p.imageUrl; }
        document.getElementById('pc-pname').textContent = p.name;
        document.getElementById('pc-pstate').textContent = p.consentGranted ? 'consented · cloned local voice' : 'no consent';
        const compose = document.getElementById('persona-compose');
        compose.hidden = false;
        document.getElementById('pc-title').textContent = `Make ${p.name} speak`;
        if (!document.getElementById('pf-script').value) compose.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      b.querySelector('.pc-pick').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (b.dataset.preview) return playWav(b.dataset.preview);
        const btn = ev.currentTarget;
        btn.disabled = true; btn.textContent = 'cloning…';
        try {
          const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: p.id, script: `Hi, I am ${p.name}. This is my locally cloned voice.` }) });
          if (!r.ok) throw new Error((await r.json()).error);
          const { wav } = await r.json();
          b.dataset.preview = wav;
          playWav(wav);
          btn.textContent = '▶ Hear voice';
        } catch (e) { btn.textContent = e.message.slice(0, 30); }
        btn.disabled = false;
      });
      b.querySelector('.pc-del').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Delete ${p.name} and their cloned voice? This revokes recorded consent.`)) return;
        await fetch(`/api/personas?id=${p.id}`, { method: 'DELETE' });
        studio.load();
      });
      return b;
    }));
    if (list.length) {
      if (!studio.persona && list[0].hasVoiceSample) wrap.querySelector('.persona-card')?.click();
      else document.getElementById('persona-compose').hidden = !studio.persona;
    }
    // Seed the compose result slot with the latest persona film, so the payoff is visible up front.
    try {
      const vids = await (await fetch('/api/videos')).json();
      const talk = vids.find((v) => v.talk);
      if (talk) {
        const v = document.getElementById('pc-result');
        v.src = talk.url; v.poster = talk.poster || ''; v.hidden = false;
        document.getElementById('pf-status').textContent = `Latest persona film (${talk.duration ?? '?'}s) — make a new one above.`;
      }
    } catch { /* history unavailable */ }
  },
};
function playWav(url) {
  const wrap = document.getElementById('pc-preview');
  const a = document.getElementById('pf-audio');
  wrap.hidden = false; a.src = url; a.play().catch(() => {});
}
document.getElementById('new-persona').addEventListener('click', () => { document.getElementById('persona-form').hidden = false; });
document.getElementById('pf-consent').addEventListener('change', (e) => { document.getElementById('pf-create').disabled = !e.target.checked; });
document.getElementById('pf-script').addEventListener('input', (e) => { document.getElementById('pc-count').textContent = `${e.target.value.length}/400`; });
async function pollFilm(id, statusEl) {
  for (let i = 0; i < 200; i++) {
    let j;
    try { j = await (await fetch(`/api/status/${id}`)).json(); } catch { j = null; }
    if (j?.state === 'done') {
      const v = document.getElementById('pc-result');
      v.src = j.videoUrl; v.hidden = false;
      statusEl.textContent = 'Film ready — playing below.';
      return;
    }
    if (j?.state === 'error') { statusEl.textContent = `Film failed: ${j.error || 'engine error'}`; return; }
    statusEl.textContent = `Filming… ${j?.node ? `${String(j.node).slice(0, 24)} ` : ''}${j?.progress != null ? `${Math.round(j.progress * 100)}%` : ''}`;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
document.getElementById('pf-create').addEventListener('click', async () => {
  const name = document.getElementById('pf-name').value.trim();
  const consent = document.getElementById('pf-consent').checked;
  const consentName = document.getElementById('pf-consentname').value.trim();
  const img = document.getElementById('pf-image').files[0];
  const voc = document.getElementById('pf-voice').files[0];
  if (!name || !img) return alert('Name and face image are required.');
  if (!consent || !consentName) return alert('No consent, no clone — that is the rule. Name the consent giver and tick the box.');
  const st = (id) => document.getElementById(id);
  st('pf-create').disabled = true; st('pf-create').textContent = 'Creating…';
  try {
    const fd1 = new FormData(); fd1.append('image', img, img.name);
    const r1 = await (await fetch('/api/persona-image', { method: 'POST', body: fd1 })).json();
    let voiceName = null;
    if (voc) {
      const fd2 = new FormData(); fd2.append('file', voc, voc.name);
      const r2 = await (await fetch('/api/persona-voice', { method: 'POST', body: fd2 })).json();
      voiceName = r2.name;
    }
    const r = await fetch('/api/personas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name, tagline: st('pf-tag').value, image: r1.name, voiceSample: voiceName, voiceRefText: st('pf-reftext').value,
      consent: { granted: consent, name: consentName },
    }) });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('persona-form').hidden = true;
    studio.load();
  } catch (e) { alert(e.message); }
  st('pf-create').disabled = false; st('pf-create').textContent = 'Create persona';
});
document.getElementById('pf-speak').addEventListener('click', async () => {
  const script = document.getElementById('pf-script').value.trim();
  if (!script || !studio.persona) return;
  const s = document.getElementById('pf-status');
  s.textContent = 'Cloning voice locally…';
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: studio.persona, script }) });
    if (!r.ok) throw new Error((await r.json()).error);
    const { wav } = await r.json();
    playWav(wav);
    s.textContent = 'Voice ready — listen, then generate the film.';
  } catch (e) { s.textContent = e.message; }
});
document.getElementById('pf-film').addEventListener('click', async () => {
  const script = document.getElementById('pf-script').value.trim();
  if (!script || !studio.persona) return;
  const s = document.getElementById('pf-status');
  document.getElementById('pc-result').hidden = true;
  s.textContent = 'Cloning the voice, then filming — minutes, all local.';
  try {
    const r = await fetch('/api/film', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId: studio.persona, script }) });
    if (!r.ok) throw new Error((await r.json()).error);
    const j = await r.json();
    addPendingCard(j.id, script.slice(0, 80), 'landscape');
    playWav(j.voice);
    pollFilm(j.id, s);
  } catch (e) { s.textContent = e.message; }
});
studio.load();
