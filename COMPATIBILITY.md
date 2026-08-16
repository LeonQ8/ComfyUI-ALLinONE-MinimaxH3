# Compatibility & Pinned Versions

This node is developed and tested against a specific stack. When something breaks after an update, it's almost always because ComfyUI or one of the node packs moved — not because of this node. This file exists so you can match the tested stack exactly.

## Tested environment

| Component | Version |
|-----------|---------|
| ComfyUI | 0.32.0 |
| Python | 3.12.10 |
| PyTorch | 2.9.1+cu130 |
| OS | Windows 10/11 (portable ComfyUI) |

## Custom node packs

These are the commit SHAs the node was developed against. You don't need to pin them unless something breaks — this table is your fallback.

| Pack | Link | Tested commit | Used by |
|------|------|---------------|---------|
| ComfyUI-H3-Motion-Context-MultiRef | [GitHub](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef) | `0719855` | Chain / Keyframes / Extend modes |
| comfyui-vrgamedevgirl | [GitHub](https://github.com/vrgamegirl19/comfyui-vrgamedevgirl) | `3931613` | Audio Drive mode |
| ComfyUI-VideoHelperSuite | [GitHub](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | `4ee72c0` | Preview without saving (auto-save off) |
| ComfyUI-SeedVR2_VideoUpscaler | [GitHub](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | `4490bd1` | Upscale mode (SeedVR2) |
| Nvidia_RTX_Nodes_ComfyUI | [GitHub](https://github.com/Comfy-Org/Nvidia_RTX_Nodes_ComfyUI) | v0.1.3 | Upscale mode (RTX VSR) |
| ComfyUI-MiniMax-H3-Turbo | [GitHub](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) | `546b502` | Turbo preset |
| ComfyUI-SolAttn_triton | [GitHub](https://github.com/kijai/ComfyUI-SolAttn_triton) | `842c4ea` | Speed preset |
| ComfyUI-MiniMaxH3-Cache | [GitHub](https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache) | `8a45e09` | Speed preset |
| comfyui-kjnodes | [GitHub](https://github.com/kijai/ComfyUI-KJNodes) | `6ab7e81` | High Quality preset (SageAttention) |
| ComfyUI-MiniMax-H3-Studio | [GitHub](https://github.com/thaakeno/ComfyUI-MiniMax-H3-Studio) | `c2bcbec` | Image mode / Live Preview |

## Known issues on newer ComfyUI cores

If your ComfyUI is newer than the tested pin and H3 breaks, update ComfyUI to the latest first — most of these are already fixed upstream.

### `module 'comfy.ldm.minimax.model' has no attribute 'time_shift_slope'`

ComfyUI core removed `time_shift_slope` on 2026-08-06 (commit `bdcb886`, PR #15243). `ComfyUI-MiniMaxH3-Cache` still calls it, so **every** H3 generation fails (even without the cache node in the graph — it patches the model at startup). Fix:

1. Update `ComfyUI-MiniMaxH3-Cache` once [PR #6](https://github.com/lihaoyun6/ComfyUI-MiniMaxH3-Cache/pull/6) is merged, or
2. Apply the one-line edit in `ComfyUI-MiniMaxH3-Cache/__init__.py`, `patched_forward`:
   ```python
   # replace:
   slope_a = minimax_model.time_shift_slope(sigma_v, shift_v, shift_a).to(audio_out.dtype)
   return [-video_out.to(video_x.dtype), (-slope_a) * audio_out.to(audio_x.dtype)]
   # with:
   return [-video_out.to(video_x.dtype), -audio_out.to(audio_x.dtype)]
   ```

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
