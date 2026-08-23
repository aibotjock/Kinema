// Wan InfiniteTalk — persona speaks a script (audio-driven talking video).
// Skeleton from the official 0.33 template; key nodes patched explicitly
// (the converter's widget alignment drifts on dynamic-combo nodes).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skeleton = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'infinitetalk.skeleton.json'), 'utf8'));

export const TALK_MODELS = {
  unet: 'Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors',
  patchSingle: 'wan2.1_infiniteTalk_single_fp16.safetensors',
  vae: 'wan_2.1_vae.safetensors',
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  audioEncoder: 'wav2vec2-chinese-base_fp16.safetensors',
  turbo: 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
};

export function talkLength(audioSeconds, fps = 25) {
  const want = Math.ceil(audioSeconds * fps);
  return 4 * Math.max(1, Math.ceil(want / 4)) + 1; // 4k+1 grid
}

export function buildTalk({ audioFile, imageFile, prompt = 'a person talking naturally to camera, subtle head motion, natural blinking', width = 832, height = 480, audioSeconds = 10, engineTag = '', seed = Math.floor(Math.random() * 2 ** 48) }) {
  const g = structuredClone(skeleton);
  g['24'].inputs.audio = audioFile;
  g['32'].inputs.image = imageFile;
  // Single-speaker: drop the second-speaker demo branch (LoadAudio 90, AudioConcat 113,
  // BatchImages 172, Painters 174/175, CreateVideo 140 + SaveVideo 141) and
  // explicitly wire the surviving output chain.
  for (const k of ['90', '113', '172', '174', '175', '140', '141', 'sg0:93']) delete g[k];
  for (const [k, n] of Object.entries(g)) if (n.class_type === 'Painter') delete g[k];
  for (const n of Object.values(g)) {
    for (const [name, val] of Object.entries(n.inputs)) {
      if (Array.isArray(val) && ['90', '113', '172', '174', '175', '140', '141', 'sg0:93'].includes(String(val[0]))) delete n.inputs[name];
    }
  }
  g['138'].inputs.images = ['sg0:119', 0]; // VAEDecode frames
  g['138'].inputs.audio = ['24', 0];       // the speaker's cloned voice
  // Resolve loader markers to this machine's files.
  const FILE_FOR = { unet_name: TALK_MODELS.unet, vae_name: TALK_MODELS.vae, clip_name: TALK_MODELS.textEncoder, name: TALK_MODELS.patchSingle, lora_name: TALK_MODELS.turbo, audio_encoder_name: TALK_MODELS.audioEncoder, model_name: TALK_MODELS.audioEncoder };
  for (const n of Object.values(g)) {
    if (!/Loader/.test(n.class_type)) continue;
    for (const [iname, val] of Object.entries(n.inputs)) {
      if (typeof val === 'string' && val.startsWith('{{') && FILE_FOR[iname]) n.inputs[iname] = FILE_FOR[iname];
    }
  }
  if (g['sg0:16']?.class_type === 'CLIPLoader') g['sg0:16'].inputs.type = 'wan';
  // Same shift on the other loaders' option slots: the template converter had
  // dropped each filename into the following option widget. Restore real values.
  if (g['sg0:13']?.class_type === 'UNETLoader') g['sg0:13'].inputs.weight_dtype = 'default';
  if (g['sg0:16']) g['sg0:16'].inputs.device = 'default';
  if (g['sg0:179']?.class_type === 'LoraLoaderModelOnly') g['sg0:179'].inputs.strength_model = 1.0;
  // Any audio-encoder loader still unresolved gets the wav2vec2 file on its first string input.
  for (const n of Object.values(g)) {
    if (n.class_type === 'AudioEncoderLoader') {
      for (const [iname, val] of Object.entries(n.inputs)) {
        if (typeof val === 'string' && val.startsWith('{{')) n.inputs[iname] = TALK_MODELS.audioEncoder;
      }
    }
  }
  // Speaker audio path: single speaker — wire our LoadAudio directly into the encoder.
  g['sg0:25'].inputs.audio = ['24', 0];
  const talk = g['sg0:129'];
  Object.assign(talk.inputs, {
    mode: 'single_speaker',
    width, height,
    length: talkLength(audioSeconds),
    motion_frame_count: 9,
    audio_scale: 1.0,
    start_image: ['32', 0],
    clip_vision_output: undefined,
    previous_frames: undefined,
  });
  // scene prompt for motion character
  for (const [k, n] of Object.entries(g)) {
    if (n.class_type === 'CLIPTextEncode' && typeof n.inputs.text === 'string' && n.inputs.text.startsWith('{{')) n.inputs.text = prompt;
    if (n.class_type === 'SaveVideo') n.inputs.filename_prefix = `video/cvu${engineTag}`;
  }
  for (const k of Object.keys(talk.inputs)) if (talk.inputs[k] === undefined) delete talk.inputs[k];
  // Prune every node not reachable backward from a SaveVideo: the template's
  // dead demo branches (second-speaker subgraph, painters, etc.) carry unresolved
  // {{MARKERS}} that fail validation even though they never execute.
  const live = new Set();
  const visit = (id) => {
    if (live.has(id)) return;
    live.add(id);
    const n = g[id];
    if (!n) return;
    for (const v of Object.values(n.inputs)) if (Array.isArray(v) && g[v[0]]) visit(v[0]);
  };
  for (const [k, n] of Object.entries(g)) if (n.class_type === 'SaveVideo') visit(k);
  for (const k of Object.keys(g)) if (!live.has(k)) delete g[k];
  // Resolve remaining scalar markers generically.
  const MARKERS = { SEED: seed, WIDTH: width, HEIGHT: height, LENGTH: talkLength(audioSeconds), AUDIO_SCALE: 1.0, STEPS: 4, CFG: 1.0, FPS: 25, DENOISE: 1.0 };
  for (const n of Object.values(g)) {
    for (const [iname, val] of Object.entries(n.inputs)) {
      const m = typeof val === 'string' ? /^\{\{([A-Z_]+)\}\}$/.exec(val) : null;
      if (m && MARKERS[m[1]] !== undefined) n.inputs[iname] = MARKERS[m[1]];
    }
  }
  // Fail fast if any unresolved markers remain — they become runtime type errors otherwise.
  for (const [k, n] of Object.entries(g)) {
    for (const [name, val] of Object.entries(n.inputs)) {
      if (typeof val === 'string' && val.startsWith('{{')) throw new Error(`unresolved marker ${k}.${name} = ${val}`);
    }
  }
  return g;
}
