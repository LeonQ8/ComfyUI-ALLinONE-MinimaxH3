# Models & Custom Nodes

**T2V, I2V and R2V need nothing extra** — every node they use (H3 conditioning, sigma shift, samplers, video/audio decode, video save) ships with a recent ComfyUI. The other modes and presets use a few community packs — install only the ones you use, via ComfyUI-Manager (search by pack name), then fully restart ComfyUI and hard-refresh the browser (`Ctrl+F5`).

## Models

Official MiniMax H3 files from [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3), placed in your standard `ComfyUI/models/` folders:

| File | Folder |
|------|--------|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | `vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae/` |

## Custom nodes

### Per mode

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

### Per quality preset (Settings → Quality)

| Preset | Packs you need |
|--------|----------------|
| Turbo | [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) + a Turbo LoRA (below) |
| Speed | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) + [ComfyUI-MiniMaxH3-Cache](https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache) |
| Balanced | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) |
| High | [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) (SageAttention) |
| Native | — (ComfyUI core only) |

Each accelerator also has an on/off chip under the Quality dropdown (SolAttn / H3 Cache / SageAttn) — flip them for any mix; the preset label switches to **Custom**. Accelerators that are switched off are not even written into the workflow, so their packs don't need to be installed.

**Preview without saving** (auto-save off): [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)

**Live Preview** (the toggle under the video): [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) plus `taeh3.safetensors` in `ComfyUI/models/vae_approx/` ([Kijai/MiniMax-H3-TAE](https://huggingface.co/Kijai/MiniMax-H3-TAE)). Powered by KJNodes Model Preview Override: the clip plays in the preview box while it samples. A quality dropdown next to the toggle picks Fast, Balanced or Detailed previews, which trade preview smoothness against generation speed. Works in every video mode, not with the Turbo preset or Image mode. Your copy can sit in a subfolder of `vae_approx`, pick it under Settings: Live Preview decoder. Tested on ComfyUI 0.32.

**Image mode prompts**: they follow the H3 Studio shape, a `summary:` line with the goal and a `detailed_description:` with the full scene. Name your references `@Image1`, `@Image2` and give each one a clear job (identity, pose, style, outfit). Edits are a semantic regeneration of the source image, not pixel inpainting, so describe what changes instead of expecting a perfect cutout. The Discover tab ships with Text to image, Image edit and Reference mix templates.

**Image mode models**: besides your usual H3 files, H3 Studio's prompt machinery wants two small Qwen3.5 models in `ComfyUI/models/text_encoders/`:

| Model | Download |
|-------|----------|
| `qwen3.5_2b_bf16.safetensors` | [Comfy-Org/Qwen3.5](https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_2b_bf16.safetensors) |
| `qwen3.5_4b_bf16.safetensors` | [Comfy-Org/Qwen3.5](https://huggingface.co/Comfy-Org/Qwen3.5/resolve/main/text_encoders/qwen3.5_4b_bf16.safetensors) |

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
