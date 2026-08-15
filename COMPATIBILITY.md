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

| Pack | Tested commit | Used by |
|------|---------------|---------|
| ComfyUI-H3-Motion-Context-MultiRef | `0719855` | Chain / Keyframes / Extend modes |
| comfyui-vrgamedevgirl | `3931613` | Audio Drive mode |
| ComfyUI-MiniMax-H3-Turbo | `546b502` | Turbo preset |
| ComfyUI-SolAttn_triton | `842c4ea` | Speed preset |
| ComfyUI-MiniMaxH3-Cache | `8a45e09` | Speed preset |
| comfyui-kjnodes | `6ab7e81` | High Quality preset (SageAttention) |

## Models

All official, from [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3):

| File | Folder |
|------|--------|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models/` |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | `vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae/` |
