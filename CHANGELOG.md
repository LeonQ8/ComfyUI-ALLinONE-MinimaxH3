# Changelog

All notable changes to this project are documented here, newest first.

## [0.2.0] — 2026-08-16

- New **Native** quality preset: core ComfyUI H3 pipeline with no SolAttn, no H3 cache and no SageAttention — needs no extra packs.
- SolAttn / H3 Cache / SageAttention are now toggle chips under Quality — switch each accelerator on or off independently; any manual mix shows as **Custom**. Disabled accelerators are left out of the workflow entirely (their packs don't need to be installed).

## [0.1.2] — 2026-08-15

- Fixed the Support button in the node UI — it was a placeholder URL, now links to the real Ko-fi page.
- README: added status/license badges and a beta note, updated screenshots and requirements links.

## [0.1.1] — 2026-08-15

- Prompts are now saved **per mode** — each mode keeps its own prompt and restores it when you switch tabs (also survives ComfyUI workflow-tab switches).
- Compatibility docs updated to ComfyUI 0.32.0.

## [0.1.0] — 2026-08-15

- Initial release: T2V, I2V, R2V, Audio Drive, Keyframes, Extend, Chain, and Upscale in a single node.
