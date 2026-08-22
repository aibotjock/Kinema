# Kinema — Local Video Gen WebUI

A simplified web interface for generating AI videos **locally** with ComfyUI.
Describe what you want to see, press Generate, get a video. **No node graph, ever.**

```
prompt ─▶ Wan 2.2 T2V 14B fp8 (dual-pass) + lightx2v 4-step LoRAs ─▶ mp4
```

Everything runs on your own GPUs — nothing leaves the machine, no account, no cloud.

## What it does

- **One-screen flow**: prompt box, shape (Landscape/Portrait/Square), duration (2s/4s/6s), Generate.
- **Live progress**: queued → sampling stages → encoding, with a progress ring per generation.
- **Your videos**: newest generation takes a full-width cinematic stage; the rest live in a grid with duration badges and prompt captions. Click any card to play, download, or remix the prompt.
- **Local engine status**: green "Local engine ready" pill wired to ComfyUI's `/system_stats`.

## Requirements

- **Node.js ≥ 21** (uses the global `WebSocket`; zero npm dependencies)
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** running on `127.0.0.1:8188`
- Models in ComfyUI's folders (all fp8, fits a single 24GB GPU):

| File | Folder |
|---|---|
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` |
| `wan_2.1_vae.safetensors` | `models/vae/` |
| `wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models/` |
| `wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors` | `models/diffusion_models/` |
| `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors` | `models/loras/` |
| `wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors` | `models/loras/` |

- `ffmpeg` on PATH for poster thumbnails (falls back to video-metadata previews if absent).
  On systems without a system ffmpeg, an `imageio-ffmpeg` wheel binary works — set the path in `server.mjs`.

## Run

```bash
# 1. start ComfyUI
cd ~/ComfyUI && .venv/bin/python main.py --port 8188

# 2. start Kinema
cd comfy-video-ui && node server.mjs
# → http://127.0.0.1:4317
```

A 2–6 second clip takes roughly 2–4 minutes warm on one RTX 3090.

## How it works

- `workflow.mjs` composes the Wan 2.2 graph (high-noise shift 8.0 → low-noise shift 4.0, 4 steps each, cfg 1.0, euler/simple) and enforces Wan's 4k+1 frame rule per duration.
- `server.mjs` is the whole backend: static serving, workflow composition, a persistent ComfyUI websocket for progress, history extraction, poster/duration extraction, and a range-aware video proxy.
- `public/` is the frontend — vanilla HTML/CSS/JS, no frameworks, no CDNs, works offline.

## Notes

- Video generation happens in ComfyUI's queue — anything you run there shares the GPU.
- Built through an evidence-gated builder/critic loop: browser-rendered evidence (console/network/overflow/a11y gates) had to pass before any visual verdict, with blind A/B critique against a best-in-class reference driving the design rounds.
