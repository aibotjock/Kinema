// Bake a converted template graph into a marker-substitutable skeleton.
// Strips UI plumbing (Primitives/Math/Switches/subgraph boundary pins) and
// replaces their consumer inputs with {{MARKERS}} by input name.
// Usage: node scripts/bake-template.mjs <converted.json> <out.skeleton.json>
import { readFile, writeFile } from 'node:fs/promises';

const [inFile, outFile] = process.argv.slice(2);
const g = JSON.parse(await readFile(inFile, 'utf8'));

const PLUMBING = new Set(['PrimitiveInt', 'PrimitiveFloat', 'PrimitiveBoolean', 'PrimitiveString', 'ComfyMathExpression', 'ComfySwitchNode', 'MarkdownNote', 'Note', 'Reroute', 'ResolutionSelector', 'ImageScaleToTotalPixels', 'EasyCache', 'easy cacheShowString|ShowString', 'ShowString', 'easy showString', 'easy imageScaleToTotalPixels']);
const MARKERS = {
  prompt: '{{PROMPT}}', negative_prompt: '{{NEGATIVE}}', text: '{{PROMPT}}',
  width: '{{WIDTH}}', height: '{{HEIGHT}}', length: '{{LENGTH}}', batch_size: 1,
  noise_seed: '{{SEED}}', seed: '{{SEED}}', steps: '{{STEPS}}', cfg: '{{CFG}}',
  fps: '{{FPS}}', filename_prefix: '{{PREFIX}}', denoise: 1.0,
};

const isPlumbingKey = (k) => {
  const node = g[k];
  if (!node) return true;
  if (PLUMBING.has(node.class_type)) return true;
  if (/-10$/.test(k)) return true; // subgraph boundary pins
  return false;
};

const out = {};
for (const [k, node] of Object.entries(g)) {
  if (isPlumbingKey(k)) continue;
  const inputs = {};
  for (const [name, val] of Object.entries(node.inputs)) {
    if (Array.isArray(val)) {
      const [src] = val;
      if (isPlumbingKey(src) || /:-10$/.test(String(src))) {
        inputs[name] = MARKERS[name] !== undefined ? MARKERS[name] : `{{${name.toUpperCase()}}}`;
      } else {
        inputs[name] = val;
      }
    } else {
      inputs[name] = val;
    }
  }
  out[k] = { class_type: node.class_type, inputs };
}

// verify no dangling refs
for (const [k, node] of Object.entries(out)) {
  for (const [name, val] of Object.entries(node.inputs)) {
    if (Array.isArray(val) && !out[val[0]]) throw new Error(`dangling ${k}.${name} -> ${val[0]}`);
  }
}
await writeFile(outFile, JSON.stringify(out, null, 1));
console.log(`baked ${Object.keys(out).length} nodes -> ${outFile}`);
