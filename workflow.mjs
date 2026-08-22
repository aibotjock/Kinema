// Wan 2.2 T2V 14B fp8 dual-pass + lightx2v 4-step — API-format graph builder.
// Verified against this install's /object_info on 2026-08-22.

const MODELS = {
  high: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
  low: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
  loraHigh: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
  loraLow: 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'wan_2.1_vae.safetensors',
};

const ASPECTS = {
  '16:9': { width: 832, height: 480 },
  '9:16': { width: 480, height: 832 },
  '1:1': { width: 640, height: 640 },
};

// Wan lengths satisfy 4k+1: 2s=33, 4s=65, 6s=97 at 16fps.
const DURATIONS = { 2: 33, 4: 65, 6: 97 };

export function buildWorkflow({ prompt, negative = '', aspect = '16:9', duration = 4, seed = Math.floor(Math.random() * 2 ** 48), steps = 4 }) {
  const { width, height } = ASPECTS[aspect] ?? ASPECTS['16:9'];
  const length = DURATIONS[duration] ?? DURATIONS[4];
  return {
    '1': { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.textEncoder, type: 'wan', device: 'default' } },
    '2': { class_type: 'VAELoader', inputs: { vae_name: MODELS.vae } },
    '3': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.high, weight_dtype: 'default' } },
    '4': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: MODELS.loraHigh, strength_model: 1.0, model: ['3', 0] } },
    '5': { class_type: 'ModelSamplingSD3', inputs: { shift: 8.0, model: ['4', 0] } },
    '6': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.low, weight_dtype: 'default' } },
    '7': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: MODELS.loraLow, strength_model: 1.0, model: ['6', 0] } },
    '8': { class_type: 'ModelSamplingSD3', inputs: { shift: 4.0, model: ['7', 0] } },
    '9': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 0] } },
    '10': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 0] } },
    '11': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width, height, length, batch_size: 1 } },
    '12': { class_type: 'KSampler', inputs: { seed, steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0, model: ['5', 0], positive: ['9', 0], negative: ['10', 0], latent_image: ['11', 0] } },
    '13': { class_type: 'KSampler', inputs: { seed, steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0, model: ['8', 0], positive: ['9', 0], negative: ['10', 0], latent_image: ['12', 0] } },
    '14': { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['2', 0] } },
    '15': { class_type: 'CreateVideo', inputs: { fps: 16, images: ['14', 0] } },
    '16': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/cvu', format: 'mp4', codec: 'h264', video: ['15', 0] } },
  };
}
