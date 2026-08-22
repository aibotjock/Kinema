// comfy-video-ui server — zero dependencies (Node >= 21 for global WebSocket).
// Serves the app, composes the Wan 2.2 workflow, proxies ComfyUI, tracks progress.
import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflow } from './workflow.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const COMFY = 'http://127.0.0.1:8188';
const PORT = Number(process.env.PORT || 4317);
const CLIENT_ID = 'comfy-video-ui';
const THUMBS = path.join(ROOT, '.thumbs');
const execAsync = promisify(execFile);
await mkdir(THUMBS, { recursive: true });

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
const FFMPEG = existsSync('/usr/bin/ffmpeg') ? 'ffmpeg'
  : `${process.env.HOME}/.local/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`;
async function posterFor(filename, subfolder) {
  try {
    const src = path.join(process.env.HOME, 'ComfyUI/output', subfolder || '', filename);
    const dst = path.join(THUMBS, path.basename(filename).replace(/\.[^.]+$/, '') + '.jpg');
    if (!existsSync(dst)) await execAsync(FFMPEG, ['-ss', '0.5', '-i', src, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', dst]);
    return existsSync(dst) ? `/thumb/${path.basename(dst)}` : null;
  } catch { return null; }
}

// ---------- progress tracking ----------
const jobs = new Map(); // id -> {id, prompt, state, node, nodeTotal, videoUrl, error, created}
let comfyEvents = { runningNodeId: null, progressValue: 0, progressMax: 0 };

// One persistent socket to ComfyUI for progress events.
function connectWs() {
  const ws = new WebSocket(`ws://127.0.0.1:8188/ws?clientId=${CLIENT_ID}`);
  ws.onmessage = (ev) => {
    try {
      const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : null;
      if (!m) return;
      if (m.type === 'progress') comfyEvents = { ...comfyEvents, progressValue: m.data.value, progressMax: m.data.max };
      if (m.type === 'executing') comfyEvents = { ...comfyEvents, runningNodeId: m.data.node };
      if (m.type === 'execution_success' || m.type === 'execution_error') comfyEvents = { runningNodeId: null, progressValue: 0, progressMax: 0 };
    } catch { /* binary previews — ignore */ }
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
  ws.onerror = () => ws.close();
}
connectWs();

// ---------- ComfyUI helpers ----------
async function comfy(pathname, init) {
  const res = await fetch(COMFY + pathname, init);
  if (!res.ok) throw new Error(`ComfyUI ${pathname} -> ${res.status}`);
  return res.json();
}

// SaveVideo surfaces mp4s as images[] with animated:true (ComfyUI 0.27).
const extractVideo = (nodeOut) => nodeOut.videos || nodeOut.gifs || (nodeOut.animated && nodeOut.images ? nodeOut.images : []);

async function startGeneration({ prompt, negative, aspect, duration, seed }) {
  const workflow = buildWorkflow({ prompt, negative, aspect, duration, seed });
  const { prompt_id } = await comfy('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: CLIENT_ID }),
  });
  jobs.set(prompt_id, { id: prompt_id, prompt, state: 'running', videoUrl: null, error: null, created: Date.now() });
  return prompt_id;
}

async function jobStatus(id) {
  const job = jobs.get(id);
  if (!job) return { state: 'error', error: 'unknown job' };
  if (job.state === 'done' || job.state === 'error') return job;
  const hist = await comfy(`/history/${id}`);
  const h = hist[id];
  if (!h) {
    const queue = await comfy('/queue');
    const stillQueued = [...queue.queue_running, ...queue.queue_pending].some((q) => q[1] === id || q[0] === id || JSON.stringify(q).includes(id));
    job.state = stillQueued || comfyEvents.runningNodeId ? 'running' : 'running';
    job.node = comfyEvents.runningNodeId;
    job.progress = comfyEvents.progressMax ? comfyEvents.progressValue / comfyEvents.progressMax : null;
    return job;
  }
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

// History = ComfyUI history, newest first, videos only.
async function videoHistory() {
  const hist = await comfy('/history');
  const out = [];
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
          created: createdFromHistory(h),
          url: `/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`,
          poster: await posterFor(filename, subfolder),
          duration: await durationFor(filename, subfolder),
        });
      }
    }
  }
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

// ---------- gauntlet progress ledger ----------
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
    if (url.pathname === '/api/health') {
      try { const s = await comfy('/system_stats'); return send(200, { comfyui: true, version: s.system?.comfyui_version, gpus: (s.devices || []).map((d) => d.name) }); }
      catch { return send(200, { comfyui: false }); }
    }
    if (url.pathname === '/api/view') {
      const q = new URL(req.url, 'http://x').searchParams;
      const headers = {};
      if (req.headers.range) headers.range = req.headers.range;
      const upstream = await fetch(`${COMFY}/view?filename=${encodeURIComponent(q.get('filename') || '')}&subfolder=${encodeURIComponent(q.get('subfolder') || '')}&type=${encodeURIComponent(q.get('type') || 'output')}`, { headers });
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

server.listen(PORT, '127.0.0.1', () => console.log(`comfy-video-ui on http://127.0.0.1:${PORT}`));
