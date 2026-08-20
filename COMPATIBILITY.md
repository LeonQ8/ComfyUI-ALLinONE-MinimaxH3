# Compatibility & Pinned Versions

This node is developed and tested against a specific stack. When something breaks after an update, it's almost always because ComfyUI or one of the node packs moved — not because of this node. This file exists so you can match the tested stack exactly.

## Tested environment

| Component | Version |
|-----------|---------|
| ComfyUI | 0.33.0 |
| Python | 3.12.10 |
| PyTorch | 2.9.1+cu130 |
| OS | Windows 10/11 (portable ComfyUI) |

## Custom node packs

These are the commit SHAs the node was developed against. You don't need to pin them unless something breaks — this table is your fallback.

| Pack | Link | Tested commit | Used by |
|------|------|---------------|---------|
| ComfyUI-H3-Motion-Context-MultiRef | [GitHub](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) | `87de57b` | Chain / Keyframes / Extend modes |
| comfyui-vrgamedevgirl | [GitHub](https://github.com/vrgamegirl19/comfyui-vrgamedevgirl) | `3931613` | Audio Drive mode |
| ComfyUI-VideoHelperSuite | [GitHub](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | `4ee72c0` | Preview without saving (auto-save off) |
| ComfyUI-SeedVR2_VideoUpscaler | [GitHub](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | `4490bd1` | Upscale mode (SeedVR2) |
| Nvidia_RTX_Nodes_ComfyUI | [GitHub](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI) | v0.1.3 | Upscale mode (RTX VSR) |
| ComfyUI-MiniMax-H3-Turbo | [GitHub](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) | `4274783` | Turbo preset |
| ComfyUI-SolAttn_triton | [GitHub](https://github.com/kijai/ComfyUI-SolAttn_triton) | `842c4ea` | Speed preset |
| comfyui-kjnodes | [GitHub](https://github.com/kijai/ComfyUI-KJNodes) | `3f20054` | High Quality preset (SageAttention) / Live Preview |
| comfy-kitchen (pip) | [GitHub](https://github.com/Comfy-Org/comfy-kitchen) | 0.2.31 | Kitchen chip (ModelAttentionBackend) |
| ComfyUI-MiniMax-H3-Studio | [GitHub](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) | `99a868e` | Image mode |
| MaskVidExperiments | [GitHub](https://github.com/drozbay/MaskVidExperiments) | `d98cc89` (0.2.0) | Mask mode |

## Known issues on newer ComfyUI cores

If your ComfyUI is newer than the tested pin and H3 breaks, update ComfyUI to the latest first — most of these are already fixed upstream.

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
