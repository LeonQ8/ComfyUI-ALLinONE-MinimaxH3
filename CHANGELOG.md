# Changelog

Newest first.

## 0.5.2 (2026-08-18)

Each LoRA now has an on/off switch, and the Advanced panel has an Enable all / Disable all button. Disabled LoRAs keep their row but skip loading, so you can stack up to 10 LoRAs and switch between setups without deleting them.

Known issues: Chain mode can have issues, will be looked at in future releases. Images made with Image workflows can show black in the History, will be fixed in future releases.

## 0.5.1 (2026-08-17)

Fixed a bug where the node could still use an old photo right after you added a new one. The new photo now always loads before generation starts, and if loading fails the old photo stays instead of silently breaking.

## 0.5.0 (2026-08-17)

Image Edit and Reference Mix now include a Compare slider for checking the source against the result. Image mode now shows one final still instead of the internal frame batch. Upscaling in Image workflows is currently broken and will be fixed in a later release.

## 0.4.2 (2026-08-17)

Minor fixes.

## 0.4.1 (2026-08-17)

Live Preview is new: a toggle under the video that shows the clip while it samples with the tiny TAEH3 decoder. Needs the H3 Studio pack plus taeh3.safetensors in a models/vae_approx folder. Works in every video mode, but not with the Turbo preset or Image mode.

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
