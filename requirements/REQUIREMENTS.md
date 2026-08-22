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
| [`sam3.1_multiplex_fp16.safetensors`](https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors) | `checkpoints/` (Mask mode) |

## Custom nodes

### Per mode

| Mode | Packs you need |
|------|----------------|
| T2V / I2V / R2V | — (ComfyUI core only) |
| Audio Drive | [comfyui-vrgamedevgirl](https://github.com/vrgamegirl19/comfyui-vrgamedevgirl) |
| Keyframes | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Extend | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Chain | [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) |
| Mask | [MaskVidExperiments](https://github.com/drozbay/MaskVidExperiments) plus the SAM 3.1 checkpoint above |
| Upscale — RTX VSR | [Nvidia_RTX_Nodes_ComfyUI](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI) (NVIDIA RTX GPUs only) |
| Upscale — SeedVR2 | [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) |
| Image | [ComfyUI-MiniMax-H3-Studio](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) |

### Per quality preset (Settings → Quality)

| Preset | Packs you need |
|--------|----------------|
| Turbo | [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) + a Turbo LoRA (below) |
| Speed | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) |
| Balanced | [ComfyUI-SolAttn_triton](https://github.com/kijai/ComfyUI-SolAttn_triton) |
| High | [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) (SageAttention) |
| SLA Draft | [ComfyUI-PlagueKind-Nodes](https://github.com/PlagueKind/ComfyUI-PlagueKind-Nodes) + a Turbo LoRA (below) |
| Native | — (ComfyUI core only) |

Each accelerator also has an on/off chip under the Quality dropdown (SolAttn / SageAttn / Kitchen / SLA) — flip them for any mix; the preset label switches to **Custom**. Accelerators that are switched off are not even written into the workflow, so their packs don't need to be installed.

**Comfy Kitchen** (`pip install comfy-kitchen`, then restart ComfyUI) is ComfyUI's own int8 attention backend. It replaces SageAttention for people who prefer it: the Kitchen chip can run alone or together with SolAttn, but never with SageAttention — turning one on switches the other off. The chip is disabled with a hint when the package is not installed. The CUDA wheel needs an NVIDIA driver r580 or newer; without the package the node falls back to PyTorch attention.

**SLA Draft**: a fast draft preset for prompt tweaks. It runs H3 SLA Attention from [ComfyUI-PlagueKind-Nodes](https://github.com/PlagueKind/ComfyUI-PlagueKind-Nodes) as the last model patch, on top of Comfy Kitchen, with a 4-step turbo LoRA at reduced strength and 8 euler/simple steps. The pack's H3 AdaLN LoRA Fix node is added automatically so dense turbo LoRAs (like the dareties build) apply to the pruned base model. Needs a recent ComfyUI core (comfy_api). The SLA chip is exclusive with SolAttn and SageAttention and is disabled with a hint until the pack is installed and ComfyUI restarted. This is draft-only quality: prompt adherence is weaker, and multishot clips can reorder actions.

**Preview without saving** (auto-save off): [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)

**Compare & Stitch** (the Compare button on the outputs strip and in the Library): needs [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) for deterministic frame matching and the side-by-side export. The stitch node itself is internal to this pack; no other packs are needed.

**Live Preview** (the toggle under the video): [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) plus `taeh3.safetensors` in `ComfyUI/models/vae_approx/` ([Kijai/MiniMax-H3-TAE](https://huggingface.co/Kijai/MiniMax-H3-TAE)). Powered by KJNodes Model Preview Override: the clip plays in the preview box while it samples. A quality dropdown next to the toggle picks Fast, Balanced or Detailed previews, which trade preview smoothness against generation speed. Works in every video mode, not with the Turbo preset or Image mode. Your copy can sit in a subfolder of `vae_approx`, pick it under Settings: Live Preview decoder. Tested on ComfyUI 0.33.

**Image mode prompts**: they follow the H3 Studio shape, a `summary:` line with the goal and a `detailed_description:` with the full scene. Name your references `@Image1`, `@Image2` and give each one a clear job (identity, pose, style, outfit). Edits are a semantic regeneration of the source image, not pixel inpainting, so describe what changes instead of expecting a perfect cutout. The Discover tab ships with Text to image, Image edit and Reference mix templates.

**Mask mode**: add a source video, paint the region on its first frame or enter a text target for SAM 3, then add at least one replacement reference. MaskVidExperiments keeps the tracked crop stable, aligns the mask to H3 latent space, and pastes the generated region back into the source-resolution frames.

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
