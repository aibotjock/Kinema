// MiniMax H3 — omni-modal video+audio. Graph topology verified against the official
// ComfyUI 0.33 local template (video_minimax_h3_t2v/i2v) via scripts/template-to-api.mjs.
// Frame grid: 17k+5 at 24fps. Native canvas: 768px short edge (max 768x1344, /32).

const M = {
  diffusion: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  turbo4: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
};

export const H3_RESOLUTIONS = {
  landscape: { 480: [832, 480], 720: [1344, 768], 1080: [1344, 768, 'upscale'] },
  portrait: { 480: [480, 832], 720: [768, 1344], 1080: [768, 1344, 'upscale'] },
  square: { 480: [640, 640], 720: [768, 768], 1080: [768, 768, 'upscale'] },
};

export function h3Length(seconds) {
  const want = seconds * 24;
  const k = Math.max(1, Math.ceil((want - 5) / 17));
  return 17 * k + 5; // 2s->56, 4s->107, 6s->158, 10s->274
}

export function buildH3({ prompt, negative = '', aspect = 'landscape', resolution = 720, duration = 4, seed = Math.floor(Math.random() * 2 ** 48), imageNode = null }) {
  const [width, height] = H3_RESOLUTIONS[aspect][resolution] || H3_RESOLUTIONS[aspect][720];
  const length = h3Length(duration);
  const g = {
    '119': { class_type: 'VAELoader', inputs: { vae_name: M.videoVae } },
    '120': { class_type: 'VAELoader', inputs: { vae_name: M.audioVae } },
    '127': { class_type: 'UNETLoader', inputs: { unet_name: M.diffusion, weight_dtype: 'default' } },
    '134': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: M.turbo4, strength_model: 1.0, model: ['127', 0] } },
    '128': { class_type: 'CLIPLoader', inputs: { clip_name: M.textEncoder, type: 'minimax', device: 'default' } },
    '131': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['128', 0], vae: ['119', 0], prompt, width, height, length } },
    '129': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '123': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '124': { class_type: 'BasicScheduler', inputs: { model: ['134', 0], scheduler: 'simple', steps: 4, denoise: 1.0 } },
    '126': { class_type: 'BasicGuider', inputs: { model: ['134', 0], conditioning: ['131', 0] } },
    '125': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['129', 0], guider: ['126', 0], sampler: ['123', 0], sigmas: ['124', 0], latent_image: ['131', 1] } },
    '122': { class_type: 'VAEDecode', inputs: { samples: ['125', 0], vae: ['119', 0] } },
    '121': { class_type: 'VAEDecodeAudio', inputs: { samples: ['125', 0], vae: ['120', 0] } },
    '130': { class_type: 'CreateVideo', inputs: { images: ['122', 0], audio: ['121', 0], fps: 24 } },
    '16': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/cvu', format: 'mp4', codec: 'h264', video: ['130', 0] } },
  };
  if (imageNode) g['131'].inputs.first_frame = [imageNode, 0]; // I2V: guide with a start frame
  return g;
}
