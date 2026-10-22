# Compatibility & Pinned Versions

This node is developed and tested against a specific stack. When something breaks after an update, it's almost always because ComfyUI or one of the node packs moved — not because of this node. This file exists so you can match the tested stack exactly.

The optional Windows installer pins its own stack, listed in [installer/STACK.md](installer/STACK.md).

## Tested environment

| Component | Version |
|-----------|---------|
| ComfyUI | 0.39.2 |
| Python | 3.12.10 |
| PyTorch | 2.9.1+cu130 |
| OS | Windows 10/11 (portable ComfyUI) |

## Custom node packs

These are the pack versions the node was tested against. You don't need to pin them unless something breaks — this table is your fallback.

| Pack | Link | Tested version | Used by |
|------|------|----------------|---------|
| ComfyUI-H3-Motion-Context-MultiRef | [GitHub](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) | Update 9 | Chain / Keyframes / Extend modes |
| comfyui-vrgamedevgirl | [GitHub](https://github.com/vrgamegirl19/comfyui-vrgamedevgirl) | 9.2.0 | Audio Drive mode |
| ComfyUI-VideoHelperSuite | [GitHub](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | 1.7.9 | Preview without saving (auto-save off) |
| ComfyUI-SeedVR2_VideoUpscaler | [GitHub](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | 2.5.24 | Upscale mode (SeedVR2) |
| Nvidia_RTX_Nodes_ComfyUI | [GitHub](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI) | 0.2.1 | Upscale mode (RTX VSR) |
| ComfyUI-MiniMax-H3-Turbo | [GitHub](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) | 1.2.3 | Turbo preset |
| comfyui-kjnodes | [GitHub](https://github.com/kijai/ComfyUI-KJNodes) | 1.5.2 | High Quality preset (SageAttention) / Live Preview |
| comfy-kitchen (pip) | [GitHub](https://github.com/Comfy-Org/comfy-kitchen) | 0.2.37 | Kitchen chip (ModelAttentionBackend) |
| ComfyUI-MiniMax-H3-Studio | [GitHub](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) | 0.1.0-alpha.20 | Image mode |
| MaskVidExperiments | [GitHub](https://github.com/drozbay/MaskVidExperiments) | 0.2.1 | Mask mode |
| ComfyUI-PlagueKind-Nodes | [GitHub](https://github.com/PlagueKind/ComfyUI-PlagueKind-Nodes) | 1.5.6 | SLA Draft preset (SLA chip) |
| H3-Optimizations | [GitHub](https://github.com/Zironic/H3-Optimizations) | 0.2.45 | H3 Memory Opt chip |

## SLA Draft preset

The SLA Draft quality preset pairs H3 SLA Attention from ComfyUI-PlagueKind-Nodes with Comfy Kitchen and a turbo LoRA. It defaults to the reference recipe (er_sde sampler, beta scheduler, 6 steps, 8-step turbo LoRA at full strength) but only as defaults: sampler, scheduler and steps are never forced at build time, so the user's own choice always wins. SLA must be the last model patch, wired directly into the guider and scheduler, so the preset never combines SLA with Block Sparse or SageAttention. The pack needs a recent ComfyUI core (comfy_api), and the SLA kernel falls back to dense attention on any failure. Tested on version 1.5.6 of the pack.

## Known issues on newer ComfyUI cores

If your ComfyUI is newer than the tested version and H3 breaks, update ComfyUI to the latest first — most of these are already fixed upstream.

### `ComfyUI-MiniMaxH3-Cache` only conflicts with Chain and Extend

The H3 Cache accelerator was removed from this node because the pack has not been updated for newer ComfyUI cores. Its startup patch replaces `MiniMaxH3Model._forward` with a signature that drops the native `denoise_mask` / `audio_denoise_mask` arguments and the `cond_audio` segment, which ComfyUI-H3-Motion-Context-MultiRef Update 6 probes and refuses to run without. Upstream [PR #6](https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache/pull/6) only removes a `time_shift_slope` call and does not restore those signatures, so the conflict would not go away by updating.

The patch runs globally at startup, so it breaks **Chain and Extend on ComfyUI 0.33** even when no cache node is in the graph (verified: Extend raises the Motion-Context mask-engine guard, Chain fails with `KeyError: 'cond_audio'`). Keyframes and plain workflows (T2V / I2V / R2V / Audio Drive) are unaffected and run fine with the pack installed. If you keep the pack installed for other workflows, disable it (rename the folder to end in lowercase `.disabled`) only when you want to run Chain or Extend; otherwise the Motion-Context guard above will reject those modes.

### R2V: `shape mismatch: value tensor of shape [...] cannot be broadcast to indexing result of shape [...]`

Core bug on builds between 2026-08-06 and 2026-08-13 (fails at `all_video_rows[~img_update] = cond_video_rows` in `comfy/ldm/minimax/model.py`). Fixed upstream on 2026-08-13 (commit `e01fb4c`). Fix: update ComfyUI to the latest. This is not caused by the reference image count.

## Models

All official, from [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3):

| File | Folder |
|------|--------|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | `vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae/` |
| `sam3.1_multiplex_fp16.safetensors` | `checkpoints/` |
