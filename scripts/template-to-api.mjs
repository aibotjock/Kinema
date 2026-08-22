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

const api = {};
for (const [key, node] of nodes) {
  if (node.type === 'MarkdownNote' || node.type === 'Note' || node.type === 'Reroute') continue;
  if (subgraphNodes.has(node.type)) continue; // bridged below via consumers
  const inputs = {};
  let w = [...node.widgets];
  // Widget names for nodes whose template carries no inputs array (dynamic-IO nodes).
  let oiNames = null;
  if (node.inputs.length === 0 && node.widgets.length > 0 && process.env.OI_SNAPSHOT) {
    const oi = JSON.parse(await readFile(process.env.OI_SNAPSHOT, 'utf8'))[node.type];
    const order = [...(oi?.input?.required ? Object.keys(oi.input.required) : []), ...(oi?.input?.optional ? Object.keys(oi.input.optional) : [])];
    oiNames = order.filter((n) => !['IMAGE', 'LATENT', 'MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'NOISE', 'GUIDER', 'SAMPLER', 'SIGMAS', 'AUDIO', 'VIDEO'].includes(oi.input.required?.[n]?.[0] ?? oi.input.optional?.[n]?.[0]));
  }
  const inputList = node.inputs.length ? node.inputs : (oiNames || []).map((name) => ({ name, link: null }));
  for (const inp of inputList) {
    if (inp.link != null) {
      let src = links.get(`${node.prefix || ''}|${inp.link}`) || null;
      let fromKey = src?.from, fromSlot = src?.fromSlot;
      if (fromKey && subgraphNodes.has(nodes.get(fromKey)?.type || '')) {
        // source is a subgraph instance: map its output slot to the def output's internal link
        const inst = nodes.get(fromKey);
        const sg = subgraphNodes.get(inst.type);
        const outSlot = fromSlot;
        const sgOut = sg.outputs[outSlot];
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
      // skip frontend-only control_after_generate tokens
      if (typeof v === 'string' && CONTROL_TOKENS.has(v) && typeof w[0] === 'number') v = undefined;
      if (v !== undefined) inputs[inp.name] = v;
    }
  }
  api[key] = { class_type: node.type, inputs };
}

console.log(JSON.stringify(api, null, 1));
