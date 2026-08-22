// Convert ComfyUI UI-format templates (incl. subgraph-packaged) to API-format graphs.
// Usage: node scripts/template-to-api.mjs <template.json> > out.json
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
const doc = JSON.parse(await readFile(file, 'utf8'));

// 1. Flatten: outer nodes + subgraph-internal nodes.
const nodes = new Map(); // key -> {id, type, widgets, inputs: [{name, link}]}
const links = new Map(); // linkId -> [fromKey, fromSlot]

function addNodes(list, prefix, linkList) {
  for (const n of list) {
    const key = prefix ? `${prefix}:${n.id}` : String(n.id);
    nodes.set(key, { key, prefix, type: n.type, widgets: n.widgets_values || [], inputs: (n.inputs || []).map((i) => ({ name: i.name, link: i.link, type: i.type })) });
  }
  for (const l of linkList || []) {
    // Two shapes: classic array [id, from, slot, to, slot, type] or object {id, origin_id, origin_slot, ...}
    const id = Array.isArray(l) ? l[0] : l.id;
    const from = Array.isArray(l) ? l[1] : l.origin_id;
    const slot = Array.isArray(l) ? l[2] : l.origin_slot;
    links.set(`${prefix}|${id}`, { from: prefix ? `${prefix}:${from}` : String(from), fromSlot: slot });
  }
}

addNodes(doc.nodes || [], '', doc.links);
const subgraphNodes = new Map(); // subgraph uuid -> {outputs: [{name,link}], inputs}
(doc.definitions?.subgraphs || []).forEach((sg, idx) => {
  const p = `sg${idx}`;
  addNodes(sg.nodes || [], p, sg.links);
  subgraphNodes.set(sg.id, { prefix: p, outputs: sg.outputs || [], inputs: sg.inputs || [] });
});

// Bridge subgraph instance edges: outer link targeting a subgraph-instance node's input slot
// corresponds to the subgraph def's input slot (which has its own internal link).
function resolveIntoSubgraph(instanceKey, inputName) {
  const type = nodes.get(instanceKey).type;
  const sg = subgraphNodes.get(type);
  if (!sg) return null;
  const slot = sg.inputs.findIndex((i) => i.name === inputName);
  if (slot < 0 || sg.inputs[slot].link == null) return null;
  // find the internal link with that id
  for (const [k, v] of links) {
    if (k.startsWith(sg.prefix + '|') && k.endsWith('|' + sg.inputs[slot].link)) return v;
  }
  return null;
}

// 2. Widgets whose values carry frontend-only controls ("randomize"/"fixed"/"increment")
// — those sit after seed-like widgets and don't exist in API inputs.
const CONTROL_TOKENS = new Set(['fixed', 'increment', 'decrement', 'randomize']);

const OI = process.env.OI_SNAPSHOT ? JSON.parse(await readFile(process.env.OI_SNAPSHOT, 'utf8')) : {};
const LINKY = new Set(['IMAGE', 'LATENT', 'MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'NOISE', 'GUIDER', 'SAMPLER', 'SIGMAS', 'AUDIO', 'VIDEO', 'CONTROL_NET', 'MASK']);

const api = {};
for (const [key, node] of nodes) {
  if (node.type === 'MarkdownNote' || node.type === 'Note' || node.type === 'Reroute') continue;
  if (subgraphNodes.has(node.type)) continue; // bridged below via consumers
  const inputs = {};
  let w = [...node.widgets];
  // Full input order from object_info: link inputs come from the template's inputs
  // array (by name); every remaining name consumes widgets_values in order.
  const oi = OI[node.type];
  const order = [...(oi?.input?.required ? Object.keys(oi.input.required) : []), ...(oi?.input?.optional ? Object.keys(oi.input.optional) : [])];
  const tmplInputs = new Map(node.inputs.map((i) => [i.name, i]));
  const inputList = order.length
    ? order.map((name) => tmplInputs.get(name) || { name, link: null })
    : node.inputs; // unknown class: fall back to template inputs only
  for (const inp of inputList) {
    if (tmplInputs.has(inp.name) && inp.link != null) {
      let src = links.get(`${node.prefix || ''}|${inp.link}`) || null;
      let fromKey = src?.from, fromSlot = src?.fromSlot;
      if (fromKey && subgraphNodes.has(nodes.get(fromKey)?.type || '')) {
        const inst = nodes.get(fromKey);
        const sg = subgraphNodes.get(inst.type);
        const sgOut = sg.outputs[fromSlot];
        if (sgOut?.link != null) {
          for (const [k, v] of links) {
            if (k.startsWith(sg.prefix + '|') && k.endsWith('|' + sgOut.link)) { fromKey = v.from; fromSlot = v.fromSlot; break; }
          }
        }
      } else if (!src) {
        const bridged = resolveIntoSubgraph(key, inp.name);
        if (bridged) { fromKey = bridged.from; fromSlot = bridged.fromSlot; }
      }
      if (fromKey) inputs[inp.name] = [fromKey, fromSlot];
    } else {
      let v = w.shift();
      if (typeof v === 'string' && CONTROL_TOKENS.has(v) && typeof w[0] === 'number') v = undefined; // control_after_generate
      if (Array.isArray(v) && !LINKY.has(String(v))) v = v; // grouped values pass through as-is
      if (v !== undefined) inputs[inp.name] = v;
    }
  }
  api[key] = { class_type: node.type, inputs };
}

console.log(JSON.stringify(api, null, 1));
