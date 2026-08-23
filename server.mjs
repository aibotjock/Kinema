// comfy-video-ui server — zero dependencies (Node >= 21 for global WebSocket).
// Serves the app, composes the Wan 2.2 workflow, proxies ComfyUI engines, tracks progress.
// Multi-engine: set COMFY_URLS="http://127.0.0.1:8188,http://127.0.0.1:8189" — one
// ComfyUI per GPU — and generations dispatch to the least-loaded engine.
import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow } from './workflow.mjs';
import { buildH3 } from './workflows/h3.mjs';
import { buildHunyuan } from './workflows/hunyuan.mjs';
import { buildTalk, talkLength } from './workflows/infinitetalk.mjs';
import { MODELS, DEFAULT_MODEL } from './models.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4317);
const THUMBS = path.join(ROOT, '.thumbs');
const execAsync = promisify(execFile);
await mkdir(THUMBS, { recursive: true });

// ---------- engines (one ComfyUI per GPU) ----------
const engines = (process.env.COMFY_URLS || 'http://127.0.0.1:8188')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((url, i) => ({
    id: `e${i}`,
    tag: i === 0 ? '' : `-e${i}`,             // per-engine filename prefix -> no save collisions
    url,
    wsUrl: url.replace(/^http/, 'ws'),
    clientId: `comfy-video-ui-${i}`,
    alive: false,
    active: 0,                                  // in-flight generations
    events: { runningNodeId: null, progressValue: 0, progressMax: 0 },
  }));

for (const e of engines) connectWs(e);

function connectWs(engine) {
  const ws = new WebSocket(`${engine.wsUrl}/ws?clientId=${engine.clientId}`);
  ws.onmessage = (ev) => {
    try {
      const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      if (!m) return;
      if (m.type === 'progress') engine.events = { ...engine.events, progressValue: m.data.value, progressMax: m.data.max };
      if (m.type === 'executing') engine.events = { ...engine.events, runningNodeId: m.data.node };
      if (m.type === 'execution_success' || m.type === 'execution_error') engine.events = { runningNodeId: null, progressValue: 0, progressMax: 0 };
    } catch { /* binary previews — ignore */ }
  };
  ws.onopen = () => { engine.alive = true; };
  ws.onclose = () => { engine.alive = false; setTimeout(() => connectWs(engine), 2000); };
  ws.onerror = () => ws.close();
}

// ---------- progress tracking ----------
const jobs = new Map(); // id -> {id, prompt, state, node, engineId, videoUrl, error, created}

// ---------- ComfyUI helpers ----------
async function comfy(engine, pathname, init) {
  const res = await fetch(engine.url + pathname, init);
  if (!res.ok) throw new Error(`ComfyUI ${engine.url}${pathname} -> ${res.status}`);
  return res.json();
}

// SaveVideo surfaces mp4s as images[] with animated:true (ComfyUI 0.27).
const extractVideo = (nodeOut) => nodeOut.videos || nodeOut.gifs || (nodeOut.animated && nodeOut.images ? nodeOut.images : []);

const queueDepthCache = new Map(); // engineId -> {t, n}
async function queueDepth(engine) {
  const c = queueDepthCache.get(engine.id);
  if (c && Date.now() - c.t < 1500) return c.n;
  let n = engine.active;
  try {
    const q = await comfy(engine, '/queue');
    n = q.queue_running.length + q.queue_pending.length;
  } catch { /* engine unreachable */ }
  queueDepthCache.set(engine.id, { t: Date.now(), n });
  return n;
}

async function pickEngine() {
  const alive = engines.filter((e) => e.alive);
  const pool = alive.length ? alive : engines; // fall back to first if ws lagging
  const depths = await Promise.all(pool.map((e) => queueDepth(e)));
  return pool[depths.indexOf(Math.min(...depths))];
}

async function startGeneration({ prompt, negative, aspect, duration, seed, model = DEFAULT_MODEL, resolution = 720, mode = 't2v', image }) {
  const engine = await pickEngine();
  let workflow;
  if (model === 'minimax-h3') {
    let imageNode = null;
    if (mode === 'i2v' && image) imageNode = '90';
    workflow = buildH3({ prompt, aspect, resolution, duration, seed, imageNode });
    if (imageNode) workflow['90'] = { class_type: 'LoadImage', inputs: { image } };
  } else if (model === 'hunyuan-1-5') {
    workflow = buildHunyuan({ prompt, negative, aspect, resolution, duration, seed, engineTag: engine.tag });
  } else if (model === 'wan-2-2') {
    const wanAspect = { landscape: '16:9', portrait: '9:16', square: '1:1' }[aspect] || '16:9';
    workflow = buildWorkflow({ prompt, negative, aspect: wanAspect, duration, seed, engineTag: engine.tag });
  } else {
    const known = MODELS.find((m) => m.id === model);
    throw new Error(known ? `${known.name} is not installed yet — its pipeline lands with its download` : `unknown model: ${model}`);
  }
  const { prompt_id } = await comfy(engine, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: engine.clientId }),
  });
  engine.active += 1;
  jobs.set(prompt_id, { id: prompt_id, prompt, state: 'running', engineId: engine.id, videoUrl: null, error: null, created: Date.now() });
  return prompt_id;
}

async function jobStatus(id) {
  const job = jobs.get(id);
  if (!job) return { state: 'error', error: 'unknown job' };
  const engine = engines.find((e) => e.id === job.engineId) || engines[0];
  if (job.state === 'done' || job.state === 'error') return job;
  const hist = await comfy(engine, `/history/${id}`);
  const h = hist[id];
  if (!h) {
    job.state = 'running';
    job.node = engine.events.runningNodeId;
    job.progress = engine.events.progressMax ? engine.events.progressValue / engine.events.progressMax : null;
    return job;
  }
  engine.active = Math.max(0, engine.active - 1);
  if (h.status && h.status.status_str === 'error') {
    job.state = 'error';
    job.error = (h.status.messages || []).map((m) => m[1]?.exception_message).filter(Boolean).join('; ') || 'generation failed';
    return job;
  }
  for (const nodeOut of Object.values(h.outputs)) {
    const vid = extractVideo(nodeOut);
    if (vid.length) {
      const { filename, subfolder, type } = vid[0];
      job.videoUrl = `/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`;
      job.state = 'done';
      return job;
    }
  }
  job.state = 'error';
  job.error = 'finished without a video';
  return job;
}

// History = merged across engines, newest first, videos only.
async function videoHistory() {
  const out = [];
  await Promise.all(engines.map(async (engine) => {
    let hist = {};
    try { hist = await comfy(engine, '/history'); } catch { return; }
    for (const [id, h] of Object.entries(hist)) {
      const job = jobs.get(id);
      if (job?.state === 'error') continue;
      for (const nodeOut of Object.values(h.outputs)) {
        const vid = extractVideo(nodeOut);
        if (vid.length) {
          const { filename, subfolder, type } = vid[0];
          out.push({
            id,
            prompt: job?.prompt ?? guessPromptFromHistory(h),
            talk: Boolean(job?.talk),
            created: createdFromHistory(h),
            url: `/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`,
            poster: await posterFor(filename, subfolder),
            duration: await durationFor(filename, subfolder),
          });
        }
      }
    }
  }));
  return out.sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, 60);
}

function guessPromptFromHistory(h) {
  const graph = Array.isArray(h.prompt) ? h.prompt[2] : h.prompt;
  if (!graph || typeof graph !== 'object') return '';
  for (const node of Object.values(graph)) {
    if (node.class_type === 'CLIPTextEncode' && node.inputs.text && String(node.inputs.text).trim().length > 3) return String(node.inputs.text).slice(0, 140);
  }
  return '';
}

function createdFromHistory(h) {
  if (h.status?.completed_at) return h.status.completed_at * 1000;
  const meta = Array.isArray(h.prompt) ? h.prompt[3] : null;
  return meta?.create_time ?? null;
}

// ---------- media extraction ----------
const FFMPEG = existsSync('/usr/bin/ffmpeg') ? 'ffmpeg'
  : `${process.env.HOME}/.local/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`;

const durationCache = new Map();
async function durationFor(filename, subfolder) {
  try {
    const src = path.join(process.env.HOME, 'ComfyUI/output', subfolder || '', filename);
    if (durationCache.has(src)) return durationCache.get(src);
    let stderr = '';
    try { const r = await execAsync(FFMPEG, ['-i', src, '-f', 'null', '-']); stderr = r.stderr || ''; } catch (e) { stderr = e.stderr || ''; }
    const m = stderr.match(/Duration: (\d+):(\d+):(\d+)/);
    const secs = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    durationCache.set(src, secs);
    return secs;
  } catch { return null; }
}

// Poster frame per video (cached); grid shows images, video loads only in the player.
async function posterFor(filename, subfolder) {
  try {
    const src = path.join(process.env.HOME, 'ComfyUI/output', subfolder || '', filename);
    const dst = path.join(THUMBS, path.basename(filename).replace(/\.[^.]+$/, '') + '.jpg');
    if (!existsSync(dst)) await execAsync(FFMPEG, ['-ss', '0.5', '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', dst]);
    return existsSync(dst) ? `/thumb/${path.basename(dst)}` : null;
  } catch { return null; }
}

// ---------- personas (consent-first) ----------
const PERSONAS = path.join(ROOT, 'personas.json');
async function readPersonas() { try { return JSON.parse(await readFile(PERSONAS, 'utf8')); } catch { return []; } }
async function writePersonas(list) { await writeFile(PERSONAS, JSON.stringify(list, null, 2)); }

const VOICE_VENV = path.join(ROOT, '.venv-voice', 'bin', 'f5-tts_infer-cli');
function freestGpu() {
  try {
    const out = execSync('nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits').toString().trim().split('\n')
      .map((l) => l.split(',').map((s) => Number(s.trim())))
      .sort((a, b) => a[1] - b[1]);
    return out[0]?.[0] ?? 0;
  } catch { return 0; }
}
async function synthesizeVoice(persona, script) {
  // F5-TTS zero-shot clone from the consented reference sample (isolated venv, freest GPU).
  const out = path.join(ROOT, 'media', 'voices', `${persona.id}-${Date.now()}.wav`);
  const args = [
    '--ref_audio', path.join(ROOT, persona.voiceSample),
    '--ref_text', persona.voiceRefText || ' ',
    '--gen_text', script.slice(0, 800),
    '--output_dir', path.dirname(out), '--output_file', path.basename(out),
  ];
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: String(freestGpu()) };
  await execAsync(VOICE_VENV, args, { env, timeout: 600000 });
  return { wav: `/media/voices/${path.basename(out)}`, file: out };
}


async function writeProgress(entry) {
  const file = path.join(ROOT, 'PROGRESS.json');
  let data = { rounds: [] };
  if (existsSync(file)) { try { data = JSON.parse(await readFile(file, 'utf8')); } catch { /* fresh */ } }
  data.rounds.push({ t: new Date().toISOString(), ...entry });
  await writeFile(file, JSON.stringify(data, null, 2));
}

// ---------- tiny static server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    if (Buffer.isBuffer(body)) res.end(body);
    else res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  try {
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.prompt?.trim()) return send(400, { error: 'prompt required' });
      const id = await startGeneration(body);
      return send(200, { id });
    }
    if (url.pathname.startsWith('/api/status/') && req.method === 'GET') {
      return send(200, await jobStatus(url.pathname.split('/').pop()));
    }
    if (url.pathname === '/api/videos' && req.method === 'GET') return send(200, await videoHistory());
    if (url.pathname === '/api/models' && req.method === 'GET') {
      const engine = engines.find((e) => e.alive) || engines[0];
      let pool = [];
      try {
        const combo = (await comfy(engine, '/object_info/UNETLoader')).UNETLoader.input.required.unet_name;
        pool = Array.isArray(combo[0]) ? combo[0] : (combo[1]?.options || []); // 0.32- vs 0.33-format combos
      } catch { /* engine down */ }
      return send(200, {
        default: DEFAULT_MODEL,
        models: MODELS.map((m) => ({ ...m, installed: m.installed ?? m.required.every((f) => pool.includes(f)) })),
      });
    }
    if (url.pathname === '/api/upload/image' && req.method === 'POST') {
      // Raw multipart passthrough to ComfyUI.
      const engine = engines.find((e) => e.alive) || engines[0];
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const up = await fetch(`${engine.url}/upload/image`, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body });
      return send(up.status, await up.json());
    }
    if (url.pathname === '/api/health') {
      const report = await Promise.all(engines.map(async (e) => {
        try {
          const s = await comfy(e, '/system_stats');
          return { id: e.id, url: e.url, ok: true, version: s.system?.comfyui_version, devices: (s.devices || []).map((d) => d.name) };
        } catch { return { id: e.id, url: e.url, ok: false }; }
      }));
      const ready = report.filter((r) => r.ok);
      const first = ready[0];
      return send(200, {
        comfyui: ready.length > 0,
        engines: report,
        ready: ready.length,
        version: first?.version,
        gpus: first?.devices,
      });
    }
    if (url.pathname === '/api/view') {
      const q = new URL(req.url, 'http://x').searchParams;
      // Output dir is shared across engines; any live engine can serve any file.
      const engine = engines.find((e) => e.alive) || engines[0];
      const headers = {};
      if (req.headers.range) headers.range = req.headers.range;
      const upstream = await fetch(`${engine.url}/view?filename=${encodeURIComponent(q.get('filename') || '')}&subfolder=${encodeURIComponent(q.get('subfolder') || '')}&type=${encodeURIComponent(q.get('type') || 'output')}`, { headers });
      const outHeaders = {
        'content-type': upstream.headers.get('content-type') || 'video/mp4',
        'cache-control': 'no-store',
      };
      for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = upstream.headers.get(h);
        if (v) outHeaders[h] = v;
      }
      res.writeHead(upstream.status, outHeaders);
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }
    if (url.pathname.startsWith('/thumb/')) {
      const file = path.normalize(path.join(THUMBS, url.pathname.slice('/thumb/'.length)));
      if (!file.startsWith(THUMBS) || !existsSync(file)) return send(404, 'no poster', 'text/plain');
      return send(200, await readFile(file), 'image/jpeg');
    }
    if (url.pathname === '/api/personas' && req.method === 'GET') {
      const list = await readPersonas();
      return send(200, list.map(({ id, name, tagline, consent, image, voiceSample }) => ({ id, name, tagline, consentGranted: consent?.granted, consentBy: consent?.name, consentDate: consent?.date, image, imageUrl: image ? `/api/view?filename=${encodeURIComponent(image)}&type=input` : null, hasVoiceSample: Boolean(voiceSample) })));
    }
    if (url.pathname === '/api/personas' && req.method === 'DELETE') {
      // Revocation: removing a persona also deletes its cloned voice files.
      const id = url.searchParams.get('id');
      const list = await readPersonas();
      const persona = list.find((p) => p.id === id);
      if (!persona) return send(404, { error: 'unknown persona' });
      await writePersonas(list.filter((p) => p.id !== id));
      try {
        const dir = path.join(ROOT, 'media', 'voices');
        for (const f of await readdir(dir)) if (f.startsWith(`${persona.id}-`)) await unlink(path.join(dir, f));
      } catch { /* nothing to clean */ }
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/personas' && req.method === 'POST') {
      const body = await readBody(req); // JSON {name, tagline, image (uploaded name), voiceSample, voiceRefText, consent:{granted,name,note}}
      if (!body.name?.trim()) return send(400, { error: 'name required' });
      if (!body.image) return send(400, { error: 'persona image required' });
      if (!body.consent?.granted || !body.consent?.name?.trim()) {
        return send(403, { error: 'consent required: the person shown (or their rights holder) must be named and must have agreed. No consent, no clone.' });
      }
      const list = await readPersonas();
      const persona = {
        id: `p${Date.now().toString(36)}`,
        name: body.name.trim(),
        tagline: body.tagline?.trim() || '',
        image: body.image,
        voiceSample: body.voiceSample || null,
        voiceRefText: body.voiceRefText || '',
        consent: { granted: true, name: body.consent.name.trim(), date: new Date().toISOString(), note: body.consent.note || '' },
      };
      if (persona.voiceSample && !persona.voiceRefText) return send(400, { error: 'voiceRefText required with a voice sample — the sample must be transcribed so the clone is grounded' });
      list.push(persona);
      await writePersonas(list);
      return send(200, { id: persona.id });
    }
    if (url.pathname === '/api/persona-voice' && req.method === 'POST') {
      // multipart: fields file (wav) -> saved to media/voices; returns {name}
      const engine = engines.find((e) => e.alive) || engines[0];
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const up = await fetch(`${engine.url}/upload/image`, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body });
      if (!up.ok) {
        // fallback: save raw to media/uploads (name from header)
        const m = /filename="([^"]+)"/.exec(req.headers['content-type'] + JSON.stringify(req.headers)) || null;
        const fname = `sample-${Date.now()}.wav`;
        const { writeFile: wf } = await import('node:fs/promises');
        await wf(path.join(ROOT, 'media', 'voices', fname), body);
        return send(200, { name: fname });
      }
      const j = await up.json();
      return send(200, { name: j.name });
    }
    if (url.pathname === '/api/persona-image' && req.method === 'POST') {
      const engine = engines.find((e) => e.alive) || engines[0];
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const up = await fetch(`${engine.url}/upload/image`, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) });
      const j = await up.json();
      return send(up.status, j);
    }
    if (url.pathname === '/api/speak' && req.method === 'POST') {
      const { personaId, script } = await readBody(req);
      const persona = (await readPersonas()).find((p) => p.id === personaId);
      if (!persona) return send(404, { error: 'unknown persona' });
      if (!persona.voiceSample) return send(400, { error: 'this persona has no consented voice sample yet' });
      if (!script?.trim()) return send(400, { error: 'script required' });
      try {
        const { wav } = await synthesizeVoice(persona, script);
        return send(200, { wav });
      } catch (e) { return send(500, { error: `voice synthesis failed: ${e.message}` }); }
    }
    if (url.pathname === '/api/film' && req.method === 'POST') {
      const { personaId, script, prompt } = await readBody(req);
      const persona = (await readPersonas()).find((p) => p.id === personaId);
      if (!persona) return send(404, { error: 'unknown persona' });
      if (!script?.trim()) return send(400, { error: 'script required' });
      let voice;
      try { voice = await synthesizeVoice(persona, script); } catch (e) { return send(500, { error: `voice synthesis failed: ${e.message}` }); }
      // audio length -> video length
      let secs = 10;
      try {
        let stderr = '';
        try { const r = await execAsync(FFMPEG, ['-i', voice.file, '-f', 'null', '-']); stderr = r.stderr || ''; } catch (e) { stderr = e.stderr || ''; }
        const m = stderr.match(/Duration: (\d+):(\d+):(\d+)/);
        if (m) secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      } catch { /* default */ }
      const engine = await pickEngine();
      const audioName = path.basename(voice.file);
      // ComfyUI LoadAudio reads from input/ dir — copy wav there
      const { copyFile, mkdir } = await import('node:fs/promises');
      await mkdir(path.join(process.env.HOME, 'ComfyUI', 'input'), { recursive: true });
      await copyFile(voice.file, path.join(process.env.HOME, 'ComfyUI', 'input', audioName));
      const workflow = buildTalk({ audioFile: audioName, imageFile: persona.image, prompt: prompt || 'a person talking naturally to camera', audioSeconds: secs, engineTag: engine.tag });
      const { prompt_id } = await comfy(engine, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: engine.clientId }) });
      jobs.set(prompt_id, { id: prompt_id, prompt: script, state: 'running', engineId: engine.id, talk: true, videoUrl: null, error: null, created: Date.now() });
      return send(200, { id: prompt_id, voice: voice.wav, audioSeconds: secs });
    }
    if (url.pathname.startsWith('/media/') && req.method === 'GET') {
      const file = path.normalize(path.join(ROOT, url.pathname));
      if (!file.startsWith(path.join(ROOT, 'media'))) return send(403, 'forbidden', 'text/plain');
      if (!existsSync(file)) return send(404, 'not found', 'text/plain');
      return send(200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
    }
    if (url.pathname === '/api/progress-note' && req.method === 'POST') {
      await writeProgress(await readBody(req));
      return send(200, { ok: true });
    }
    // static
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p === '/progress') p = '/progress.html';
    if (p === '/PROGRESS.json') {
      const f = path.join(ROOT, 'PROGRESS.json');
      if (!existsSync(f)) return send(200, { rounds: [] });
      return send(200, await readFile(f), 'application/json');
    }
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(403, 'forbidden', 'text/plain');
    if (!existsSync(file)) return send(404, 'not found', 'text/plain');
    const data = await readFile(file);
    return send(200, data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    return send(500, { error: e.message });
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

server.listen(PORT, '127.0.0.1', () => console.log(`comfy-video-ui on http://127.0.0.1:${PORT} · engines: ${engines.map((e) => e.url).join(', ')}`));
