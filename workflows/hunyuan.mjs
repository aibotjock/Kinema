// HunyuanVideo 1.5 — 720p base + native 1080p super-resolution stage.
// Skeleton baked from the official 0.33 template; runtime patches by node role.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skeleton = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hunyuan-720p-t2v.skeleton.json'), 'utf8'));

const DIMS = {
  landscape: { 480: [832, 480], 720: [1248, 704], 1080: [1248, 704] }, // 1080p via SR stage
  portrait: { 480: [480, 832], 720: [704, 1248], 1080: [704, 1248] },
  square: { 480: [640, 640], 720: [704, 704], 1080: [704, 704] },
};
const hyLength = (secs) => { const k = Math.max(1, Math.ceil(secs * 24 / 4)); return 4 * k + 1; };

export function buildHunyuan({ prompt, negative = '', aspect = 'landscape', resolution = 720, duration = 4, seed = Math.floor(Math.random() * 2 ** 48), engineTag = '' }) {
  const g = structuredClone(skeleton);
  const [width, height] = (DIMS[aspect] || DIMS.landscape)[resolution] || DIMS[aspect][720];

  // Identify encode nodes by wiring: the one feeding CFGGuider.negative is negative.
  let negKey = null;
  for (const n of Object.values(g)) if (n.class_type === 'CFGGuider' && Array.isArray(n.inputs.negative)) negKey = String(n.inputs.negative[0]);

  for (const [k, n] of Object.entries(g)) {
    if (n.class_type === 'CLIPTextEncode' && typeof n.inputs.text === 'string') {
      n.inputs.text = (negKey === k || /blurry|low quality|worst quality/i.test(n.inputs.text)) && k === negKey ? negative : (k === negKey ? negative : prompt);
    }
    if (n.class_type === 'EmptyHunyuanVideo15Latent') Object.assign(n.inputs, { width, height, length: hyLength(duration) });
    if (n.class_type === 'RandomNoise') n.inputs.noise_seed = seed;
    if (n.class_type === 'CreateVideo') n.inputs.fps = 24;
    if (n.class_type === 'SaveVideo') n.inputs.filename_prefix = `video/cvu${engineTag}`;
    // {{MODEL}} markers: base chain uses the 720p transformer, SR chain the 1080p SR model.
    if (n.inputs.model === '{{MODEL}}') n.inputs.model = ['136', '135'].includes(k) ? ['111', 0] : ['12', 0];
  }
  return g;
}
