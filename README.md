# ComfyUI ALL-in-ONE MiniMax H3

![Status: Beta](https://img.shields.io/badge/status-beta-orange)
![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)

One node. The whole MiniMax H3 video pipeline.

No node graph to build, no wires to connect, no hunting through twelve custom node packs to figure out which workflow is the right one. Pick a mode, drop in your prompt or references, hit **Generate** — the node does the rest.

![ALL in ONE MiniMaxH3 — T2V tab](assets/t2v_main.png)

## Modes

| Mode | What it does |
|------|--------------|
| **T2V** | Text to video with native audio (fl2va model) |
| **I2V** | Animate a start frame, optionally morph to an end frame |
| **R2V** | Reference images / videos / audio drive the clip (ref2va model) |
| **Audio Drive** | Your audio track is the soundtrack, and it drives mouth movement (lip sync) |
| **Keyframes** | Pin still images at arbitrary frame positions |
| **Extend** | Continue an existing video seamlessly |
| **Chain** | Multi-clip continuation with H3 Motion Context (latent path, no re-encode) |
| **Upscale** | RTX/Seed2VR Video Super Resolution hook |
| **Image** | Still images with H3: text to image, image edit, or reference mix (up to 9 references) via H3 Studio |

## Screenshots

**History** — searchable, with prompt reuse and per-entry preview.

![History](assets/history.png)

**Library** — every output in one place: inline preview, favorites, open-folder, delete, RTX upscale hook.

![Library](assets/library.png)

**Settings** — theme accent, sounds, models.

![Settings](assets/settings.png)

## Requirements

### Models

Official MiniMax H3 files from [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3), placed in your standard `ComfyUI/models/` folders:

| File | Folder |
|------|--------|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | `vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae/` |

### Custom nodes

**T2V, I2V and R2V need nothing extra** — every node they use (H3 conditioning, sigma shift, samplers, video/audio decode, video save) ships with a recent ComfyUI. The other modes and presets use a few community packs — install only the ones you use, via ComfyUI-Manager (search by pack name), then fully restart ComfyUI and hard-refresh the browser (`Ctrl+F5`).

**Per mode**

| Mode | Packs you need |
|------|----------------|
| T2V / I2V / R2V | — (ComfyUI core only) |
| Audio Drive | [comfyui-vrgamedevgirl](https://github.com/vrgamegirl19/comfyui-vrgamedevgirl) |
| Keyframes | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Extend | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Chain | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Upscale — RTX VSR | [Nvidia_RTX_Nodes_ComfyUI](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI) (NVIDIA RTX GPUs only) |
| Upscale — SeedVR2 | [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) |
| Image | [ComfyUI-MiniMax-H3-Studio](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) |

**Per quality preset** (Settings → Quality)

| Preset | Packs you need |
|--------|----------------|
| Turbo | [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) + a Turbo LoRA (below) |
| Speed | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) + [ComfyUI-MiniMaxH3-Cache](https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache) |
| Balanced | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) |
| High | [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) (SageAttention) |
| Native | — (ComfyUI core only) |

Each accelerator also has an on/off chip under the Quality dropdown (SolAttn / H3 Cache / SageAttn) — flip them for any mix; the preset label switches to **Custom**. Accelerators that are switched off are not even written into the workflow, so their packs don't need to be installed.

**Preview without saving** (auto-save off): [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)

**Image mode prompts**: they follow the H3 Studio shape, a `summary:` line with the goal and a `detailed_description:` with the full scene. Name your references `@Image1`, `@Image2` and give each one a clear job (identity, pose, style, outfit). Edits are a semantic regeneration of the source image, not pixel inpainting, so describe what changes instead of expecting a perfect cutout. The Discover tab ships with Text to image, Image edit and Reference mix templates.

**LightX LoRAs for Image mode** (only the LightX sampling profiles need them, Base profiles need nothing). Drop the file into `ComfyUI/models/loras/`, the node checks for it before generating:

| Profile | LoRA file |
|---------|-----------|
| LightX v1.0 FL2VA 8 steps | [official full](https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors) or [Kijai rank 24](https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors) |
| LightX v1.0 FL2VA 4 steps | [Kijai rank 31](https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors) |
| LightX v0.1 ER-SDE / SA-Solver | [Kijai rank 21](https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors) |
| LightX v0.1 REF2V (Reference Mix) | [Kijai rank 20](https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors) |

**Turbo LoRA** (for the Turbo preset): download `minimax_h3_turbo_v4_step600_ema.safetensors` from [larryvrh/MiniMax-H3-Turbo-Lora](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora) into `ComfyUI/models/loras/`.

> **Seeing "Node not found"?** That's a missing pack from the tables above. The two most common:
> - `Audio Drive` node → install **comfyui-vrgamedevgirl**
> - Extend / Chain / Keyframes nodes → install **ComfyUI-H3-Motion-Context-MultiRef**
>
> Install via ComfyUI-Manager, restart ComfyUI completely, then hard-refresh the browser.

Exact tested versions of everything are in **[COMPATIBILITY.md](COMPATIBILITY.md)** — check that file first if something breaks after you update ComfyUI or a pack.

## Installation

```bash
# inside ComfyUI/custom_nodes/
git clone https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3.git
```

Restart ComfyUI, then double-click the canvas and search for **ALL in ONE MiniMaxH3**.

## Compatibility

I develop and test against a pinned stack (ComfyUI version, custom node commits, model files). It's all listed in **[COMPATIBILITY.md](COMPATIBILITY.md)**, if a render fails after you updated something, start there.

## Credits

- The "one node" idea and UI approach: Ján — [one-node-flux-2-klein](https://github.com/yanokusnir-ai/one-node-flux-2-klein) and [one-node-gemma-4](https://github.com/yanokusnir-ai/one-node-gemma-4)
- Chain / Keyframes / Extend wiring: [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) by seitanism
- Base graphs: the official MiniMax H3 native workflows from Comfy-Org
- Turbo preset: ComfyUI-MiniMax-H3-Turbo pack
- Image mode: [ComfyUI-MiniMax-H3-Studio](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) by thaakeno

## Support

This node is in **beta** — if something breaks, please [open an issue](https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3/issues), it's the fastest way to get it fixed.

If you like this node and it saves you a few hours of graph surgery, a coffee is always appreciated.<3

<a href="https://ko-fi.com/leonq8" target="_blank"><img height="36" style="border:0px;height:36px;" src="https://storage.ko-fi.com/cdn/kofi5.png?v=3" border="0" alt="Buy Me a Coffee at ko-fi.com" /></a>

## License

GPL-3.0 — see [LICENSE](LICENSE).
