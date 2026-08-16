# Changelog

All notable changes to this project are documented here, newest first.

## [Unreleased]

- New **Image** mode powered by ComfyUI-MiniMax-H3-Studio: text to image, image edit from a source image, and reference mix with up to 9 ordered references (@Image1 to @Image9 for identity, pose, style and more). Sampling profiles: Base (20/12 steps) and LightX acceleration. Images appear in the result view, gallery, library and history like videos.

## [0.2.0] - 2026-08-16

- New **Native** quality preset, runs the H3 pipeline as-is with no SolAttn, H3 cache or SageAttention.
- SolAttn, H3 Cache and SageAttention now have their own on/off switches under Quality. Mix them however you like, the label changes to **Custom** when you do. Anything left off stays out of the workflow.

## [0.1.2] - 2026-08-15

- Fixed the Support button in the node UI, it was a placeholder URL and now links to the real Ko-fi page.
- README: added status/license badges and a beta note, updated screenshots and requirements links.

## [0.1.1] - 2026-08-15

- Prompts are now saved per mode, each mode keeps its own prompt and restores it when you switch tabs (also survives ComfyUI workflow-tab switches).
- Compatibility docs updated to ComfyUI 0.32.0.

## [0.1.0] - 2026-08-15

- Initial release: T2V, I2V, R2V, Audio Drive, Keyframes, Extend, Chain, and Upscale in a single node.
