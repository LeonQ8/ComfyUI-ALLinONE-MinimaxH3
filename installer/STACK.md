# Installer stack

What the Windows installer sets up. `update.bat` moves an install to this stack. The exact pins live in `stack.json` and `constraints.txt`; this page lists them in readable form.

Stack version: **2026.10.22**

## Core

| Component | Version |
|-----------|---------|
| Python (embeddable) | 3.12.10 |
| pip | 26.1 |
| ComfyUI | 0.42.1 (`63be2f9`) |
| PyTorch | 2.9.1+cu130 |
| torchvision | 0.24.1+cu130 |
| torchaudio | 2.9.1+cu130 |
| SageAttention | 2.2.0+cu130torch2.9.0andhigher.post4 |
| Triton | triton-windows 3.5.1.post24 |
| comfy-kitchen | 0.2.39 |
| ComfyUI frontend | 1.55.18 |
| transformers | 5.10.4 |
| diffusers | 0.36.0 |

## Node packs

| Pack | Version | Commit |
|------|---------|--------|
| ComfyUI-ALLinONE-MinimaxH3 | 0.22.2 | `a285c45` |
| ComfyUI-H3-Motion-Context-MultiRef | n/a | `361624f` |
| ComfyUI-VideoHelperSuite | 1.7.9 | `4d907be` |
| ComfyUI-SeedVR2_VideoUpscaler | 2.5.24 | `4490bd1` |
| Nvidia_RTX_Nodes_ComfyUI | 0.2.1 | `168d35e` |
| ComfyUI-MiniMax-H3-Turbo | 1.2.3 | `4274783` |
| ComfyUI-KJNodes | 1.5.3 | `f4bae1f` |
| ComfyUI-MiniMax-H3-Studio | 0.1.0-alpha.20 | `29da5a3` |
| MaskVidExperiments | 0.2.1 | `c32ed8c` |
| ComfyUI-PlagueKind-Nodes | 1.5.6 | `d58d006` |
| H3-Optimizations | 0.2.46 | `c6bc3cf` |
| ComfyUI-Spectrum-MiniMax-H3 | 0.2.29 | `806fe49` |
| comfyui-vrgamedevgirl | 9.2.0 | `7f82604` |

## Differences from a manual install

A manual install follows [COMPATIBILITY.md](../COMPATIBILITY.md), which uses ComfyUI 0.39.2. The installer uses ComfyUI 0.42.1 and the pack versions listed above, plus these changes:

- ComfyUI-MiniMax-H3-Studio comes from the LeonQ8 fork: upstream alpha.20 plus the decode fix from thaakeno/ComfyUI-MiniMax-H3-Studio PR #73, needed on ComfyUI 0.40 and newer.
- transformers is pinned to 5.10.4. Some older versions, such as 5.8.1, crash on import when SeedVR2 is installed.
- llama-cpp-python is not installed. Only the vrgamedevgirl LLM prompt nodes use it, and it has no prebuilt Windows wheel on PyPI.

## What the installer does

- Downloads only from python.org, PyPI, download.pytorch.org and GitHub.
- Pins every component: node packs and ComfyUI by full commit, Python packages by exact version.
- Checks Python, pip, the Triton headers and the SageAttention wheel against SHA-256 checksums.
- Needs no admin rights, changes no Windows settings, adds no services or startup items and collects no data.
- Saves everything inside the install folder, including pip's download cache (`pip_cache`). Windows' temp folder is used while it works.
- Uninstall by deleting the install folder.

The code is in this folder and is short enough to read.

## History

- **2026.10.22**: first release. ComfyUI 0.42.1, PyTorch 2.9.1 for CUDA 13.0, 13 node packs.
