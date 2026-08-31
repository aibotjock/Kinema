# Gauntlet Bar Reference Index

Blind-A/B bar material for the Kinema gauntlet. Captured 2026-08-31.
Checksums for every downloaded file are in `SHA256SUMS.txt`.

Two directories:

- `heygen/` — the commercial quality bar (cloud SaaS avatar video)
- `ltx25/`  — the open-weights local bar (LTX-2.5 in ComfyUI)

---

## heygen/ — HeyGen (commercial bar)

### Pages captured (desktop screenshots, 1440px wide, headless Chrome)

| File | Source URL | What it shows |
|---|---|---|
| `screenshot_avatars_1440.png` | https://www.heygen.com/avatars | Avatar library page: **1,100+ stock AI avatars**, photo-avatar-from-one-headshot flow, 175+ languages, G2 "#1 most realistic avatars", 1M+ developers |
| `screenshot_voices_1440.png` | https://www.heygen.com/voices | Voice library page: **300+ AI voices across 177+ languages/dialects**, multilingual dubbing with lip sync, voice+video in one workspace |
| `screenshot_voice_cloning_1440.png` | https://www.heygen.com/voice-cloning | Instant voice clone from a short sample (with consent flow), plus the 300+ ready-made voice library |
| `screenshot_interactive_avatar_1440.png` | https://www.heygen.com/interactive-avatar | **Interactive/real-time avatars**: real-time conversation (listens/understands/responds like a live video call), avatar creation from **10 seconds** of footage, webcam+browser only, use cases = AI sales rep / interviewer / tutor / 24-7 support, "10-second setup", "1000+ stock avatars", "175+ languages" |
| `screenshot_create_your_own_avatar_1440.png` | https://www.heygen.com/tool/create-your-own-avatar | Avatar creation funnel: record/upload yourself, or generate a custom character; realistic digital twin for a brand |

### Demo videos downloaded (published on heygen.com/avatars)

All are the exact files served by the public page (served from `dynamic.heygen.ai`).

| File | Specs | What it demonstrates |
|---|---|---|
| `heygen_demo_veo3_history_teacher.mp4` | 3840x2160 (4K UHD), VP9+Opus, 15.1 s | HeyGen's top "Veo 3" avatar tier — highest visual fidelity tier they sell. Character + scene generated from a Veo 3 base, then given HeyGen speech/lip sync. Source: `dynamic.heygen.ai/www/models/veo3/History_Teacher.mp4` |
| `heygen_demo_talia_cc.mp4` | 1080x1920 (vertical), H.264+AAC, 24.1 s | Longest talking-head: sustained 24 s of continuous speech, natural gesture + blink cadence, studio-lit "CC" tier avatar. The single best lip-sync reference in the set. Source: `dynamic.heygen.ai/www/video/Talia_CC_c05JiI3iU.mp4` |
| `heygen_demo_jack_french.mp4` | 1080x1920, H.264+AAC, 16.9 s | Multilingual bar — French delivery with correct phoneme-to-viseme mapping (not English mouth shapes pasted over French audio). Source: `dynamic.heygen.ai/www/video/Jack_French_YRTUxnnrR.mp4` |
| `heygen_demo_sylvie_ugc.mp4` | 1080x1920, H.264+AAC, 15.5 s | UGC/creator aesthetic: handheld selfie framing, casual delivery, "shot on a phone" look rather than studio look. Source: `dynamic.heygen.ai/www/video/sylvie-ugc__1__TXVJp0wzY.mp4` |

### Published demo videos NOT downloaded (URLs for the record)

From https://www.heygen.com/avatars — same CDN, not pulled (budget / already 4 representative tiers covered):

- `https://dynamic.heygen.ai/www/video/Jared_CC_qUCGsmhRQ.mp4` — second "CC" studio avatar, English.
- `https://dynamic.heygen.ai/www/video/kenneth-legal_ZxHNhN9Kx.mp4` — suited professional/legal vertical avatar.
- `https://dynamic.heygen.ai/www/video/realtor-three-homes_2026-07-09_12-37-27_bH073niow.mp4` — long-form real-estate walkthrough narration.
- `https://dynamic.heygen.ai/www/video/Listing_spotlight_2_GRVzEEixZ.mp4` — real-estate listing spot.

### Not downloadable (JS/app-gated) — URL + description

- **HeyGen avatar-creation demo video** — YouTube embed `https://www.youtube.com/embed/N9r_tmbLLE0`, referenced from https://www.heygen.com/tool/create-your-own-avatar. Shows the record-or-upload-yourself avatar build flow.
- **HeyGen Interactive Avatar live demo** — interactive player on https://www.heygen.com/interactive-avatar requires a browser session + mic; no static media file is exposed. The screenshot above captures the page and its claims.
- **LiveAvatar (next-gen real-time avatar)** — help article: https://help.heygen.com/en/articles/12758516-introducing-liveavatar. Product docs only, no public media asset.
- **Full 1,100-avatar and 300-voice libraries** — behind app login at app.heygen.com; public pages only expose the curated samples captured above.

---

## ltx25/ — LTX-2.5 on ComfyUI (open-weights local bar)

### Official sample videos from comfy.org/ltx-2.5

Downloaded straight from `media.comfy.org/website/ltx-2.5/`. These are the six
"card" showcases plus the hero loop on the official product page.

| File | Specs | Prompt caption on page | Tier label |
|---|---|---|---|
| `hero.mp4` | 1280x720, H.264, 20.0 s, 23.976 fps | Hero loop for the LTX 2.5 launch page ("fastest video generation model, now with sharper prompt adherence and audio") | — |
| `card-1.webm` | 1200x660, VP9, 5.0 s, 24 fps | "A fighter jet banks hard over a stormy, moonlit sea." | Free / i2v |
| `card-2.webm` | 1200x660, VP9, 7.0 s, 24 fps | "Luminous figure drinks from a flower-filled glass." | Free / i2v |
| `card-3.webm` | 1200x680, VP9, 5.1 s, **60 fps** | "A weathered face stares out from deep shadow." — the Diffusion-Fidelity-Rendering face/detail showcase | Free / i2v |
| `card-4.webm` | 1200x676, VP9, 8.0 s, **50 fps** | "Heavy-lift drones haul goats across a misty mountain range." — complex multi-subject motion | Free / i2v |
| `card-5.webm` | 1200x676, VP9, 8.0 s, **50 fps** | "A frost-covered astronaut gazes up at the aurora." | Premium / flf2v |
| `card-6.webm` | 1200x660, VP9, 7.0 s, 24 fps | "A coated rider and horse stand atop the clouds above Earth." | Premium / flf2v |

`screenshot_comfyorg_ltx25_1440.png` — full-page screenshot of https://comfy.org/ltx-2.5/ (1440px wide) with all six cards and the free/premium tier labels.

### The 3-shot / multi-shot chaining workflow

This is the headline bar item for "one clip, multiple shots, consistent character":

| File | What it is |
|---|---|
| `ltx25_pro_multishot_i2v_3shot.json` | Official workflow JSON from https://comfy.org/workflows/615266189e02-615266189e02/ — "LTX-2.5 (Pro): Image to Video". Description on page: *"Generate video from a single image using LTX-2.5's fast distilled model, delivering cinematic multi-shot sequences with consistent characters, lighting, and style across cuts. The workflow outputs a video file with native multishot support and automatic duration prediction."* **WARNING for this build: its only nodes are `LoadImage` -> `LtxApi25ImageToVideo` -> `SaveVideo`, i.e. it is a CLOUD/API node — it will NOT run under the local-only rule.** Download URL pattern: `https://comfy.org/workflows/download/615266189e02.json?filename=615266189e02` |
| `ltx25_pro_multishot_i2v_showcase.mp4` | The output video of that workflow, 1920x1080 H.264 **+ AAC audio track**, 5.16 s. Proves LTX-2.5 emits native generated audio alongside multi-shot video. Source: `https://comfy-hub-assets.comfy.org/uploads/96c90cae-201f-4bda-8d20-78b7d74e1d75.mp4` |

### Fully-local LTX-2.5 workflows (these DO run on our GPUs — no API nodes)

| File | What it is |
|---|---|
| `ltx25_i2v_local.json` | "LTX-2.5: Image to Video" from https://comfy.org/workflows/b37902cee452-b37902cee452/ — native multishot i2v with "industry-leading pixel quality... holds character, environment and lighting across cuts". Pure native ComfyUI nodes: `UNETLoader`, `CLIPLoader`, `VAELoader`, `LTXVImgToVideoInplace`, `EmptyLTXVLatentVideo`, `LTXVEmptyLatentAudio`, `LTXVConcatAVLatent`, `LTXVSeparateAVLatent`, **`LTXVAudioVAEDecode`**, `LTXVDualCFGGuider`, `LTXVLatentUpsampler`, `LatentUpscaleModelLoader`, `TextGenerateLTX2Prompt`, `SamplerCustomAdvanced`, `VAEDecodeTiled`, `CreateVideo`, `SaveVideo`. Zero cloud nodes. |
| `ltx25_local_i2v_multishot_showcase.mp4` | Output of the local i2v multishot workflow. Source: `https://comfy-hub-assets.comfy.org/uploads/3797af8e-2d26-4c76-a61a-138647979889.mp4` |
| `ltx25_flf2v_local.json` | "LTX-2.5: FLF2V" from https://comfy.org/workflows/d78377cf53f4-d78377cf53f4/ — first+last frame to video, same native node set plus `LTXVAddGuide` / `LTXVCropGuides`. Local-runnable. |
| `ltx25_local_flf2v_showcase.mp4` | Output of the local FLF2V workflow, 1080x1080 H.264 + AAC, 5.0 s. Source: `https://comfy-hub-assets.comfy.org/uploads/efcd20b7-a405-4e74-bc16-479315646196.mp4` |

### API-tier workflows (reference only — cloud nodes, not local-runnable)

| File | What it is |
|---|---|
| `ltx25_pro_t2v.json` | "LTX-2.5 (Pro): Text to Video" — https://comfy.org/workflows/93c182d3aefb-93c182d3aefb/ , `LtxApi25TextToVideo` node |
| `ltx25_pro_flf2v.json` | "LTX-2.5 (Pro): FLF2V" — https://comfy.org/workflows/527ecf1f2eb4-527ecf1f2eb4/ , API node |

### Related reference URLs (not downloaded)

- Day-0 support blog post: https://blog.comfy.org/p/ltx-25-day-0-support-in-comfyui
- ComfyUI docs tutorial (t2v / i2v / flf2v + multishot + audio): https://docs.comfy.org/tutorials/video/ltx/ltx-2-5
- All LTX workflow templates index: https://comfy.org/workflows/model/ltx
- Weights: https://huggingface.co/Lightricks/LTX-2.5 (native multishot generation, open weights)
- Cloud quick-launch templates referenced by the product page: `https://cloud.comfy.org/?template=video_ltx2_5_i2v` and `https://cloud.comfy.org/?template=api_ltx2_5_flf2v` (cloud — outside our local-only rule, recorded for completeness)

---

## How to use these for blind judging

1. **Lip sync / talking avatar**: play `heygen/heygen_demo_talia_cc.mp4` (24 s continuous
   speech) next to the local candidate, muted-video-first, then audio-only, then both.
   Judge mouth-corner and tongue-tip timing at phone-frame close range.
2. **Multilingual lip sync**: `heygen/heygen_demo_jack_french.mp4`.
3. **Avatar realism ceiling**: `heygen/heygen_demo_veo3_history_teacher.mp4` (4K).
4. **Cinematic multi-shot from one image**: `ltx25/ltx25_local_i2v_multishot_showcase.mp4`
   and `ltx25/ltx25_pro_multishot_i2v_showcase.mp4` — check cut consistency of character,
   wardrobe, lighting, and whether audio is present and synchronised.
5. **Face/skin detail at high fps**: `ltx25/card-3.webm` (60 fps face in shadow).
