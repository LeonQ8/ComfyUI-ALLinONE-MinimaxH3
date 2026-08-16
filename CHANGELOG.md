# Changelog

Newest first.

## 0.4.1 (2026-08-17)

Fixed Live Preview staying black on ComfyUI 0.32. The node now patches the H3 Studio preview for the new nested latents at runtime, no update to the pack needed.

The finished video now shows up in the gallery even when the completion events get lost. The node polls for completion as a fallback.

## 0.4.0 (2026-08-17)

New Live Preview toggle under the video in every video mode. Watch the clip appear while it samples using the TAEH3 tiny decoder. Slows generation a little and needs taeh3.safetensors in ComfyUI/models/vae_approx plus the H3 Studio pack. Not available with the Turbo preset or Image mode.

## 0.3.0 (2026-08-16)

New Image mode built on ComfyUI-MiniMax-H3-Studio. Text to image, edit a source image, or mix up to 9 references with @Image1 style roles. Base and LightX sampling profiles plus custom steps, sampler and scheduler. Needs the H3 Studio pack and the two Qwen3.5 prompt models, download links are in the README.

Turbo now uses whatever steps you set, 6 is only the default.

## 0.2.0 (2026-08-16)

New Native quality preset that runs the H3 pipeline with no accelerators.

SolAttn, H3 Cache and SageAttention can now be switched on and off with their own chips under Quality. Mixed setups show as Custom.

## 0.1.2 (2026-08-15)

Fixed the Support button, it now links to the real Ko-fi page.

README badges and beta note.

## 0.1.1 (2026-08-15)

Prompts are now saved per mode and restored when switching tabs.

Compatibility docs updated to ComfyUI 0.32.0.

## 0.1.0 (2026-08-15)

First release with T2V, I2V, R2V, Audio Drive, Keyframes, Extend, Chain and Upscale in a single node.
