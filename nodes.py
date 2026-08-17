import os
import json
import glob
import time
import uuid
import shutil
import subprocess
import hashlib
import base64
import io
import queue
import threading
import weakref
from collections import OrderedDict
from pathlib import Path

import folder_paths
import node_helpers
from aiohttp import web
from server import PromptServer

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(NODE_DIR, "config.json")
SUBFOLDER = "one-node-minimax-h3"
MAX_HISTORY = 50


def _ensure_h3_keyframe_ref_merge():
    """ComfyUI 0.32/0.33 core bug: a conditioning carrying BOTH minimax_keyframes
    and minimax_refs crashes the sampler - model_base.extra_conds lets the refs
    branch overwrite cond_video_latents, so the fixed-row count no longer
    matches the packed layout (RuntimeError: shape mismatch). Preferred repair:
    the H3 Motion Context MultiRef pack's standalone patch_payload. Fallback:
    a built-in merge wrapper so the identity anchor works even without that
    pack. Both are idempotent and dormant once ComfyUI fixes it natively."""
    repaired = False
    try:
        import importlib.util as _ilu
        pack_name = "ComfyUI-H3-Motion-Context-MultiRef"
        root = os.path.dirname(NODE_DIR)
        path = os.path.join(root, pack_name, "patch_payload.py")
        if os.path.isfile(path):
            spec = _ilu.spec_from_file_location("_h3one_patch_payload", path)
            mod = _ilu.module_from_spec(spec)
            spec.loader.exec_module(mod)
            repaired = bool(mod.apply_patch(require_merge=True, require_av_masks=False))
    except Exception as e:
        print("[H3One] H3 keyframe+ref payload repair failed: %s" % e)
    if repaired:
        print("[H3One] H3 keyframe+ref payload repair: enabled")
        return
    try:
        import comfy.model_base as _cmb
        _orig = _cmb.MiniMaxH3.extra_conds
        if getattr(_orig, "_h3one_merge_repair", False):
            return

        def _latent_rows(latents):
            total = 0
            for z in latents:
                total += int(z.shape[0]) * int(z.shape[2]) * (int(z.shape[3]) // 2) * (int(z.shape[4]) // 2)
            return total

        def _extra_conds(self, **kwargs):
            out = _orig(self, **kwargs)
            payload = getattr(out.get("minimax_payload") if isinstance(out, dict) else None, "cond", None)
            if not isinstance(payload, dict):
                return out
            kfs = payload.get("keyframes")
            refs = payload.get("refs")
            if not kfs or not refs:
                return out
            kf_lats = [kf.get("latent") for kf in kfs if kf.get("latent") is not None]
            ref_lats = [r["latent"] for r in refs if "latent" in r]
            have = payload.get("cond_video_latents") or []
            if _latent_rows(have) == _latent_rows(kf_lats) + _latent_rows(ref_lats):
                return out
            payload["cond_video_latents"] = kf_lats + ref_lats
            return out

        _extra_conds._h3one_merge_repair = True
        _cmb.MiniMaxH3.extra_conds = _extra_conds
        print("[H3One] H3 keyframe+ref payload repair: enabled (built-in merge)")
    except Exception as e:
        print("[H3One] H3 keyframe+ref payload repair (built-in) failed: %s" % e)


_ensure_h3_keyframe_ref_merge()

_H3STUDIO_PREVIEW_PATCHED = False


def _ensure_h3studio_preview_nested_fix():
    """ComfyUI 0.32+ hands the sampler callback a NestedTensor (video and audio
    latents); the H3 Studio pack's TAEH3 preview only understands plain tensors,
    so every frame snapshot raises and the live preview stays black. Wrap the
    pack's latent picker to unbind the nested tensor first. Idempotent and
    dormant once the pack handles it natively."""
    global _H3STUDIO_PREVIEW_PATCHED
    if _H3STUDIO_PREVIEW_PATCHED:
        return
    try:
        import h3studio.nodes.preview as _preview_mod
    except Exception:
        return
    try:
        _orig = _preview_mod._first_h3_latent
        if getattr(_orig, "_h3one_nested_guard", False):
            _H3STUDIO_PREVIEW_PATCHED = True
            return

        def _guarded_first_h3_latent(torch_mod, value, latent_shapes):
            if getattr(value, "is_nested", False):
                value = value.unbind()[0]
            return _orig(torch_mod, value, latent_shapes)

        _guarded_first_h3_latent._h3one_nested_guard = True
        _preview_mod._first_h3_latent = _guarded_first_h3_latent
        _H3STUDIO_PREVIEW_PATCHED = True
        print("[H3One] H3 Studio live preview nested-latent fix: enabled")
    except Exception as e:
        print("[H3One] H3 Studio live preview nested-latent fix failed: %s" % e)


_ensure_h3studio_preview_nested_fix()


# ---------------------------------------------------------------------------
# Built-in TAEH3 live preview
# ---------------------------------------------------------------------------
_H3ONE_PREVIEW_KEY = "h3one_tae_preview"
_H3ONE_PREVIEW_CACHE_LIMIT = 8
_H3ONE_PREVIEW_DRAIN_TIMEOUT = 8.0
_H3ONE_PREVIEW_CACHE = OrderedDict()
_H3ONE_PREVIEW_CACHE_LOCK = threading.RLock()
_H3ONE_PREVIEW_DECODERS = {}
_H3ONE_PREVIEW_DECODER_LOCK = threading.RLock()


def _h3one_tae_choices():
    try:
        choices = list(folder_paths.get_filename_list("vae_approx"))
    except Exception:
        choices = []
    if "taeh3.safetensors" not in choices:
        choices.insert(0, "taeh3.safetensors")
    return choices


def _h3one_tae_block(torch, channels_in, channels_out, use_midblock_gn=False):
    class Block(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.conv = torch.nn.Sequential(
                torch.nn.Conv2d(channels_in, channels_out, 3, padding=1),
                torch.nn.ReLU(inplace=True),
                torch.nn.Conv2d(channels_out, channels_out, 3, padding=1),
                torch.nn.ReLU(inplace=True),
                torch.nn.Conv2d(channels_out, channels_out, 3, padding=1),
            )
            self.skip = (
                torch.nn.Conv2d(channels_in, channels_out, 1, bias=False)
                if channels_in != channels_out
                else torch.nn.Identity()
            )
            expanded = channels_in * 4
            self.pool = (
                torch.nn.Sequential(
                    torch.nn.Conv2d(channels_in, expanded, 1, bias=False),
                    torch.nn.GroupNorm(4, expanded),
                    torch.nn.ReLU(inplace=True),
                    torch.nn.Conv2d(expanded, channels_in, 1, bias=False),
                )
                if use_midblock_gn
                else None
            )

        def forward(self, value):
            if self.pool is not None:
                value = value + self.pool(value)
            return torch.nn.functional.relu(self.conv(value) + self.skip(value))

    return Block()


def _h3one_tae_decoder(torch, state):
    class Clamp(torch.nn.Module):
        def forward(self, value):
            return torch.tanh(value / 3) * 3

    by_index = {}
    for key, weight in state.items():
        head, _, rest = key.partition(".")
        if not head.isdigit():
            raise ValueError("not a flat TAE state dict")
        by_index.setdefault(int(head), {})[rest] = weight
    modules = []
    for index in range(max(by_index) + 1):
        entry = by_index.get(index)
        if entry is None:
            modules.append(Clamp() if index == 0 else torch.nn.ReLU() if index == 2 else torch.nn.Upsample(scale_factor=2))
        elif "conv.0.weight" in entry:
            w = entry["conv.0.weight"]
            modules.append(_h3one_tae_block(torch, w.shape[1], w.shape[0], use_midblock_gn="pool.0.weight" in entry))
        elif "weight" in entry:
            w = entry["weight"]
            modules.append(torch.nn.Conv2d(w.shape[1], w.shape[0], 3, padding=1, bias="bias" in entry))
        else:
            raise ValueError("unrecognized TAE module at index %d" % index)
    return torch.nn.Sequential(*modules)


def _h3one_first_h3_latent(torch, value, latent_shapes):
    if getattr(value, "is_nested", False):
        value = value.unbind()[0]
    if value.ndim == 3 and latent_shapes:
        shape = tuple(int(part) for part in latent_shapes[0])
        required = 1
        for dim in shape[1:]:
            required *= dim
        flat = value.reshape((value.shape[0], -1))
        if flat.shape[1] < required:
            raise ValueError("packed latent too small to restore the video shape")
        value = flat[:, :required].reshape((value.shape[0],) + shape[1:])
    if value.ndim == 5:
        return value
    raise ValueError("unexpected H3 latent shape %s" % (tuple(value.shape),))


def _h3one_limit_latent(torch, value, max_resolution):
    out_h = int(value.shape[-2]) * 16
    out_w = int(value.shape[-1]) * 16
    longest = max(out_h, out_w)
    if longest <= int(max_resolution):
        return value
    scale = float(max_resolution) / longest
    latent_h = max(1, round(value.shape[-2] * scale))
    latent_w = max(1, round(value.shape[-1] * scale))
    return torch.nn.functional.interpolate(value, size=(latent_h, latent_w), mode="bilinear", align_corners=False)


def _h3one_animated_webp(decoder, latent, max_frames, fps, quality):
    from PIL import Image

    total = int(latent.shape[2])
    count = max(1, min(int(max_frames), total))
    if count > 1:
        indices = sorted({round(i * (total - 1) / (count - 1)) for i in range(count)})
    else:
        indices = [0]
    frames = []
    for idx in indices:
        frame = decoder(latent[:, :, idx])
        pixels = frame[0].detach().float().clamp(0, 1).mul(255).byte().permute(1, 2, 0).cpu().numpy()
        frames.append(Image.fromarray(pixels, mode="RGB"))
    buffer = io.BytesIO()
    fps_safe = max(8, min(30, int(fps)))
    duration = max(34, min(500, round(1000 / fps_safe)))
    frames[0].save(buffer, format="WEBP", quality=int(quality), save_all=True,
                   append_images=frames[1:], duration=duration, loop=0)
    return frames[0].width, frames[0].height, "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


class _H3OnePreviewJob:
    def __init__(self, latent, step, total_steps, run_id, elapsed_seconds, average_step_seconds):
        self.latent = latent
        self.step = step
        self.total_steps = total_steps
        self.run_id = run_id
        self.elapsed_seconds = elapsed_seconds
        self.average_step_seconds = average_step_seconds


class _H3OnePreviewWrapper:
    def __init__(self, checkpoint_path, node_id, max_resolution, frames, fps, quality, every):
        self.checkpoint_path = checkpoint_path
        self.node_id = node_id
        self.max_resolution = max_resolution
        self.frames = frames
        self.fps = fps
        self.quality = quality
        self.every = every
        self.decoder = None
        self.run_serial = 0
        self.active_run_id = ""
        self._jobs = None
        self._worker = None
        self._worker_lock = threading.RLock()
        self._idle = threading.Event()
        self._idle.set()

    def _load(self):
        import torch
        import comfy.utils

        with _H3ONE_PREVIEW_DECODER_LOCK:
            decoder = _H3ONE_PREVIEW_DECODERS.get(self.checkpoint_path)
            if decoder is None:
                state = comfy.utils.load_torch_file(self.checkpoint_path, safe_load=True)
                decoder = _h3one_tae_decoder(torch, state)
                decoder.load_state_dict(state, strict=True)
                decoder = decoder.eval().to(device="cpu", dtype=torch.float32)
                _H3ONE_PREVIEW_DECODERS[self.checkpoint_path] = decoder
        return decoder

    def _send(self, job):
        if job.run_id != self.active_run_id:
            return
        import torch

        latent = _h3one_limit_latent(torch, job.latent, self.max_resolution)
        decoder = self._load()
        with torch.inference_mode():
            width, height, data_url = _h3one_animated_webp(decoder, latent, self.frames, self.fps, self.quality)
        if job.run_id != self.active_run_id:
            return
        PromptServer.instance.send_sync(
            "h3one-preview",
            {
                "node_id": self.node_id,
                "image": data_url,
                "step": job.step + 1,
                "total": job.total_steps,
                "width": width,
                "height": height,
                "run_id": job.run_id,
                "elapsed_seconds": job.elapsed_seconds,
                "average_step_seconds": job.average_step_seconds,
                "eta_seconds": max(0.0, job.average_step_seconds * (job.total_steps - job.step - 1)),
            },
            PromptServer.instance.client_id,
        )

    def _worker_main(self):
        while True:
            job = self._jobs.get()
            try:
                if job is None:
                    return
                self._idle.clear()
                self._send(job)
            except Exception as error:
                print("[H3One] live preview frame skipped: %s" % error)
                if job is not None and getattr(job, "run_id", None):
                    self._report_error(error, job.run_id)
            finally:
                self._idle.set()
                self._jobs.task_done()

    def _ensure_worker(self):
        with self._worker_lock:
            if self._worker is not None and self._worker.is_alive():
                return
            self._jobs = queue.Queue(maxsize=1)
            self._worker = threading.Thread(target=self._worker_main, name="H3OneTAE-preview", daemon=True)
            self._worker.start()

    def _discard_pending(self):
        if self._jobs is None:
            return
        while True:
            try:
                self._jobs.get_nowait()
            except queue.Empty:
                return
            else:
                self._jobs.task_done()

    def _enqueue(self, job):
        self._ensure_worker()
        try:
            self._jobs.put_nowait(job)
        except queue.Full:
            self._discard_pending()
            try:
                self._jobs.put_nowait(job)
            except queue.Full:
                pass

    def stop(self):
        if self._jobs is None:
            return
        self._discard_pending()
        try:
            self._jobs.put_nowait(None)
        except queue.Full:
            pass

    def _finish_run(self, run_id):
        if self.active_run_id == run_id:
            self.active_run_id = ""
        self._discard_pending()
        self._idle.wait(timeout=_H3ONE_PREVIEW_DRAIN_TIMEOUT)

    def _report_error(self, message, run_id):
        try:
            PromptServer.instance.send_sync(
                "h3one-preview",
                {"node_id": self.node_id, "run_id": run_id, "error": str(message)[:500]},
                PromptServer.instance.client_id,
            )
        except Exception:
            pass

    def _reset_frontend(self, total_steps, run_id):
        PromptServer.instance.send_sync(
            "h3one-preview",
            {"node_id": self.node_id, "run_id": run_id, "total": int(total_steps), "reset": True},
            PromptServer.instance.client_id,
        )

    def __call__(self, executor, noise, latent_image, sampler, sigmas, denoise_mask, callback, disable_pbar, seed, latent_shapes):
        import torch

        self.run_serial += 1
        run_id = "%s:%s" % (self.node_id, self.run_serial)
        self.active_run_id = run_id
        self._discard_pending()
        total_steps = max(0, len(sigmas) - 1) if sigmas is not None and hasattr(sigmas, "__len__") else 0
        sampling_started = time.perf_counter()
        try:
            self._reset_frontend(total_steps, run_id)
        except Exception:
            pass

        def preview_callback(step, x0, x, total_steps):
            if int(step) % int(self.every) == 0 and int(step) + 1 < int(total_steps):
                try:
                    elapsed = time.perf_counter() - sampling_started
                    completed = max(1, int(step) + 1)
                    latent = _h3one_first_h3_latent(torch, x0, latent_shapes)
                    snapshot = latent.detach().to(device="cpu", dtype=torch.float32, copy=True)
                    self._enqueue(_H3OnePreviewJob(
                        snapshot, int(step), int(total_steps), run_id,
                        elapsed, elapsed / completed,
                    ))
                except Exception as error:
                    print("[H3One] live preview snapshot skipped: %s" % error)
                    self._report_error(error, run_id)
            if callback is not None:
                callback(step, x0, x, total_steps)

        try:
            result = executor(
                noise, latent_image, sampler, sigmas, denoise_mask,
                preview_callback, disable_pbar, seed, latent_shapes=latent_shapes,
            )
        finally:
            self._finish_run(run_id)
        return result


class H3OneTAELivePreview:
    """Attaches the built-in TAEH3 live preview to a model clone. The whole
    clip is decoded per sampling step and pushed as an animated WebP, so the
    preview plays while the final video is still sampling."""

    CATEGORY = "One Node"
    FUNCTION = "attach"
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "enabled": ("BOOLEAN", {"default": False}),
                "tiny_vae": (_h3one_tae_choices(), {"default": "taeh3.safetensors"}),
                "max_resolution": ("INT", {"default": 512, "min": 256, "max": 768, "step": 64}),
                "preview_frames": ("INT", {"default": 10, "min": 2, "max": 20, "step": 1}),
                "fps": ("INT", {"default": 24, "min": 8, "max": 30, "step": 1}),
                "quality": ("INT", {"default": 80, "min": 50, "max": 90, "step": 1}),
                "preview_every_n_steps": ("INT", {"default": 1, "min": 1, "max": 20, "step": 1}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    @staticmethod
    def attach(model, enabled, tiny_vae, max_resolution, preview_frames, fps, quality, preview_every_n_steps, unique_id=None):
        if not enabled:
            return (model,)
        import comfy.patcher_extension

        checkpoint_path = folder_paths.get_full_path("vae_approx", tiny_vae)
        if not checkpoint_path:
            print("[H3One] live preview disabled: %s was not found in models/vae_approx" % tiny_vae)
            return (model,)
        node_id = str(unique_id or "")
        cache_key = (id(model), node_id)
        with _H3ONE_PREVIEW_CACHE_LOCK:
            entry = _H3ONE_PREVIEW_CACHE.get(cache_key)
            if entry is not None and entry[0]() is model:
                patched, wrapper = entry[1], entry[2]
            else:
                patched = model.clone()
                wrapper = _H3OnePreviewWrapper(
                    checkpoint_path, node_id,
                    int(max_resolution), int(preview_frames), int(fps), int(quality),
                    max(1, int(preview_every_n_steps)),
                )
                try:
                    upstream_ref = weakref.ref(model)
                except TypeError:
                    def upstream_ref():
                        return model
                _H3ONE_PREVIEW_CACHE[cache_key] = (upstream_ref, patched, wrapper)
                while len(_H3ONE_PREVIEW_CACHE) > _H3ONE_PREVIEW_CACHE_LIMIT:
                    _old_key, old_entry = _H3ONE_PREVIEW_CACHE.popitem(last=False)
                    old_entry[2].stop()
        patched.remove_wrappers_with_key(comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, _H3ONE_PREVIEW_KEY)
        patched.add_wrapper_with_key(comfy.patcher_extension.WrappersMP.OUTER_SAMPLE, _H3ONE_PREVIEW_KEY, wrapper)
        print("[H3One] TAEH3 live preview attached | node=%s | %s | %dpx | %d frames" % (
            node_id, tiny_vae, int(max_resolution), int(preview_frames)))
        return (patched,)


# User config and history live OUTSIDE the node folder so they survive
# reinstalls / git pulls. Built-in presets ship in the repo's config.json
# (read-only defaults); user edits are stored here and merged in at read time.
USER_CONFIG_DIR = os.path.join(folder_paths.get_user_directory(), "default", SUBFOLDER)
USER_CONFIG_PATH = os.path.join(USER_CONFIG_DIR, "config.json")
USER_HISTORY_PATH = os.path.join(USER_CONFIG_DIR, "history.json")

_VIDEO_EXTS = (".mp4", ".webm", ".gif", ".mkv", ".mov", ".m4v", ".avi")
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
_ALLOWED_TEMPLATES = (
    "t2v.json", "i2v.json", "r2v.json", "audio_drive.json",
    "keyframes.json", "video_extend.json", "chain_section.json", "upscale.json",
    "upscale_rtx.json", "image.json",
)


# ---------------------------------------------------------------------------
# Config (built-in defaults merged with user edits; only the diff is stored)
# ---------------------------------------------------------------------------
def _load_builtin_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load_user_config():
    try:
        with open(USER_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load_config():
    builtin = _load_builtin_config()
    user = _load_user_config()
    merged = dict(builtin)
    merged.update({k: v for k, v in user.items() if k != "prompt_templates"})
    merged["prompt_templates"] = dict(builtin.get("prompt_templates", {}))
    merged["prompt_templates"].update(user.get("prompt_templates", {}))
    merged["custom_presets"] = user.get("custom_presets", {})
    return merged


def _save_config(patch):
    user = _load_user_config()
    for k, v in patch.items():
        user[k] = v
    os.makedirs(USER_CONFIG_DIR, exist_ok=True)
    tmp = USER_CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(user, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USER_CONFIG_PATH)


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
def _load_history():
    try:
        with open(USER_HISTORY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_history(items):
    os.makedirs(USER_CONFIG_DIR, exist_ok=True)
    tmp = USER_HISTORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USER_HISTORY_PATH)


# ---------------------------------------------------------------------------
# Favorites (stored in the user dir so they survive reinstalls)
# ---------------------------------------------------------------------------
def _favorites_path():
    return os.path.join(USER_CONFIG_DIR, "favorites.json")


def _load_favorites():
    try:
        with open(_favorites_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data) if isinstance(data, list) else set()
    except Exception:
        return set()


def _save_favorites(favset):
    os.makedirs(USER_CONFIG_DIR, exist_ok=True)
    with open(_favorites_path(), "w", encoding="utf-8") as f:
        json.dump(sorted(favset), f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# LoRA trigger words (read from the safetensors header, like the flux node)
# ---------------------------------------------------------------------------
def _read_safetensors_header(path):
    try:
        with open(path, "rb") as f:
            length_bytes = f.read(8)
            if len(length_bytes) < 8:
                return None
            import struct
            header_len = struct.unpack("<Q", length_bytes)[0]
            if header_len > 100 * 1024 * 1024:
                return None
            header_bytes = f.read(header_len)
        return json.loads(header_bytes.decode("utf-8"))
    except Exception:
        return None


def _extract_trigger_words(header):
    if not header:
        return []
    meta = header.get("__metadata__", {})
    if not isinstance(meta, dict):
        return []
    triggers = []
    v = meta.get("modelspec.trigger_phrase") or meta.get("trigger_phrase") or meta.get("trigger_word")
    if v and isinstance(v, str) and v.strip():
        triggers.extend([t.strip() for t in v.split(",") if t.strip()])
    raw = meta.get("ss_trigger_words")
    if raw:
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    triggers.extend([str(t).strip() for t in parsed if str(t).strip()])
                elif isinstance(parsed, str) and parsed.strip():
                    triggers.extend([t.strip() for t in parsed.split(",") if t.strip()])
            except Exception:
                triggers.extend([t.strip() for t in raw.split(",") if t.strip()])
        elif isinstance(raw, list):
            triggers.extend([str(t).strip() for t in raw if str(t).strip()])
    seen = set()
    result = []
    for t in triggers:
        if t.lower() not in seen:
            seen.add(t.lower())
            result.append(t)
    return result


@PromptServer.instance.routes.get("/h3one/lora_triggers")
async def lora_triggers(request):
    lora_name = request.query.get("name", "")
    if not lora_name:
        return web.json_response({"ok": False, "error": "no name"}, status=400)
    try:
        bases = folder_paths.get_folder_paths("loras")
    except Exception:
        return web.json_response({"ok": False, "error": "cannot resolve loras folder"}, status=500)
    for base in bases:
        candidate = os.path.normpath(os.path.join(base, lora_name))
        try:
            Path(candidate).resolve().relative_to(Path(base).resolve())
        except Exception:
            continue
        if os.path.isfile(candidate) and candidate.lower().endswith(".safetensors"):
            header = _read_safetensors_header(candidate)
            triggers = _extract_trigger_words(header)
            return web.json_response({"ok": True, "triggers": triggers, "name": lora_name})
    return web.json_response({"ok": False, "error": "file not found", "triggers": []})


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------
def _get_output_dir():
    try:
        return str(Path(folder_paths.get_output_directory()).resolve())
    except Exception:
        return str(Path(os.path.join(os.path.dirname(NODE_DIR), "output")).resolve())


def _safe_join(base, *parts):
    target = Path(base)
    for p in parts:
        target = target / p
    target = target.resolve()
    try:
        target.relative_to(Path(base).resolve())
    except Exception:
        raise ValueError("invalid path")
    return str(target)


def _find_ffmpeg():
    try:
        import custom_nodes.ComfyUI_VideoHelperSuite.videohelpersuite.ffmpeg_path as vhs_fp  # noqa
        p = vhs_fp.get_ffmpeg_path() if hasattr(vhs_fp, "get_ffmpeg_path") else getattr(vhs_fp, "ffmpeg_path", "")
        if p and os.path.isfile(p):
            return p
    except Exception:
        pass
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    root = NODE_DIR
    for _ in range(6):
        if os.path.isdir(os.path.join(root, "custom_nodes")):
            break
        root = os.path.dirname(root)
    for name in ("ComfyUI-VideoHelperSuite", "ComfyUI_VideoHelperSuite", "comfyui-videohelpersuite"):
        vhs_dir = os.path.join(root, "custom_nodes", name)
        if os.path.isdir(vhs_dir):
            for _r, _d, files in os.walk(vhs_dir):
                if exe in files:
                    return os.path.join(_r, exe)
    portable = os.path.dirname(root)
    for cand in (os.path.join(portable, exe), os.path.join(root, exe), os.path.join(portable, "bin", exe)):
        if os.path.isfile(cand):
            return cand
    return shutil.which("ffmpeg")


_ffmpeg_path = None


def _ff():
    global _ffmpeg_path
    if _ffmpeg_path is None:
        _ffmpeg_path = _find_ffmpeg() or ""
    return _ffmpeg_path or None


# ---------------------------------------------------------------------------
# Model / file scanning
# ---------------------------------------------------------------------------
def _scan(folder_key, extensions=None):
    exts = extensions or [".safetensors", ".ckpt", ".pt", ".pth", ".gguf"]
    try:
        bases = folder_paths.get_folder_paths(folder_key)
    except Exception:
        return []
    found = []
    for base in bases:
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base, followlinks=True):
            for fn in files:
                if any(fn.lower().endswith(e) for e in exts):
                    found.append(os.path.relpath(os.path.join(root, fn), base))
    return sorted(found)


def _scan_output_videos():
    base = Path(_get_output_dir())
    out_dir = base / SUBFOLDER
    if not out_dir.is_dir():
        return []
    found = []
    for root, _dirs, files in os.walk(str(out_dir)):
        for fn in files:
            low = fn.lower()
            kind = "video" if low.endswith(_VIDEO_EXTS) else ("image" if low.endswith(_IMAGE_EXTS) else None)
            if kind is None:
                continue
            full = os.path.join(root, fn)
            found.append({
                "filename": fn,
                "subfolder": os.path.relpath(os.path.dirname(full), str(base)).replace("\\", "/"),
                "mtime": os.path.getmtime(full),
                "kind": kind,
            })
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return found


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@PromptServer.instance.routes.get("/h3one/workflow/{name}")
async def serve_template(request):
    name = request.match_info.get("name", "")
    if name not in _ALLOWED_TEMPLATES:
        return web.Response(status=404, text="template not found")
    _ensure_h3studio_preview_nested_fix()
    path = os.path.join(NODE_DIR, "workflows", name)
    with open(path, "r", encoding="utf-8-sig") as f:
        return web.json_response(json.load(f))


@PromptServer.instance.routes.get("/h3one/models")
async def get_models(request):
    return web.json_response({
        "diffusion_models": _scan("diffusion_models"),
        "text_encoders": _scan("text_encoders"),
        "vaes": _scan("vae"),
        "loras": _scan("loras"),
    })


@PromptServer.instance.routes.get("/h3one/seedvr2_models")
async def get_seedvr2_models(request):
    """SeedVR2 upscale models: DiT (diffusion transformer) + VAE. Scans the
    models/SEEDVR2 folder (GGUF and safetensors both work), merged with the
    pack's registry list - any registry entry auto-downloads on first use."""
    _DIT_DEFAULTS = [
        "seedvr2_ema_3b-Q4_K_M.gguf",
        "seedvr2_ema_3b-Q8_0.gguf",
        "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
        "seedvr2_ema_3b_fp16.safetensors",
        "seedvr2_ema_7b-Q4_K_M.gguf",
        "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
        "seedvr2_ema_7b_fp16.safetensors",
        "seedvr2_ema_7b_sharp-Q4_K_M.gguf",
        "seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors",
        "seedvr2_ema_7b_sharp_fp16.safetensors",
    ]
    _VAE_DEFAULTS = ["ema_vae_fp16.safetensors"]
    try:
        found_dit = []
        found_vae = []
        seed_dir = os.path.join(folder_paths.models_dir, "SEEDVR2")
        if os.path.isdir(seed_dir):
            for fn in os.listdir(seed_dir):
                low = fn.lower()
                if not low.endswith((".gguf", ".safetensors")):
                    continue
                if "vae" in low:
                    found_vae.append(fn)
                else:
                    found_dit.append(fn)
        dit = sorted(found_dit)
        vae = sorted(found_vae)
        for m in _DIT_DEFAULTS:
            if m not in dit:
                dit.append(m)
        for m in _VAE_DEFAULTS:
            if m not in vae:
                vae.append(m)
        return web.json_response({"dit": dit, "vae": vae})
    except Exception as e:
        return web.json_response({"dit": [], "vae": [], "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/h3one/input_files")
async def list_input_files(request):
    try:
        ftype = request.query.get("type", "video")
        if ftype == "audio":
            exts = (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac")
        elif ftype == "image":
            exts = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
        else:
            exts = (".mp4", ".webm", ".mkv", ".avi", ".mov")
        input_dir = folder_paths.get_input_directory()
        found = sorted(fn for fn in os.listdir(input_dir) if fn.lower().endswith(exts))
        return web.json_response({"files": found})
    except Exception as e:
        return web.json_response({"files": [], "error": str(e)})


@PromptServer.instance.routes.post("/h3one/upload")
async def upload_file(request):
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            return web.json_response({"ok": False, "error": "no file field"}, status=400)
        filename = field.filename
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"}, status=400)
        filename = Path(filename).name
        input_dir = folder_paths.get_input_directory()
        dest = os.path.join(input_dir, filename)
        with open(dest, "wb") as f:
            while True:
                chunk = await field.read_chunk(65536)
                if not chunk:
                    break
                f.write(chunk)
        return web.json_response({"ok": True, "filename": filename})
    except Exception as e:
        print(f"[H3One] upload error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/h3one/tae_status")
async def get_tae_status(request):
    """Reports whether the taeh3 tiny decoder is present in models/vae_approx
    (live preview depends on it; the H3 Studio preview node needs the file)."""
    try:
        bases = folder_paths.get_folder_paths("vae_approx")
    except Exception:
        bases = []
    found = []
    for base in bases:
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for fn in files:
                if fn.lower() == "taeh3.safetensors":
                    found.append(os.path.relpath(os.path.join(root, fn), base))
    return web.json_response({"ok": True, "found": bool(found), "files": sorted(found)})


@PromptServer.instance.routes.get("/h3one/config")
async def get_config(request):
    return web.json_response(_load_config())


@PromptServer.instance.routes.post("/h3one/config")
async def save_config_route(request):
    try:
        patch = await request.json()
        if not isinstance(patch, dict):
            return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
        _save_config(patch)
        return web.json_response({"ok": True})
    except Exception as e:
        print(f"[H3One] config save error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/presets")
async def save_preset(request):
    """Upsert a custom prompt preset for a mode. Stored in the user config
    (survives reinstalls); merged with the built-in presets at read time."""
    _VALID_MODES = ("t2v", "i2v", "r2v", "audio_drive", "keyframes", "extend", "chain", "image")
    try:
        data = await request.json()
        mode = str(data.get("mode", "")).strip()
        name = str(data.get("name", "")).strip()
        prompt = str(data.get("prompt", "")).strip()
        original_name = str(data.get("original_name", "")).strip()
        if mode not in _VALID_MODES or not name or not prompt:
            return web.json_response({"ok": False, "error": "a valid mode, name and prompt are required"}, status=400)
        user = _load_user_config()
        custom = user.get("custom_presets", {})
        if not isinstance(custom, dict):
            custom = {}
        lst = list(custom.get(mode, []))
        # Remove the entry being edited: drop the original name when renaming,
        # and drop any same-named entry (upsert).
        lst = [p for p in lst
               if (not original_name or str(p.get("name", "")).strip().lower() != original_name.lower())
               and str(p.get("name", "")).strip().lower() != name.lower()]
        lst.append({"name": name, "prompt": prompt})
        custom[mode] = lst
        _save_config({"custom_presets": custom})
        return web.json_response({"ok": True})
    except Exception as e:
        print(f"[H3One] preset save error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.delete("/h3one/presets")
async def delete_preset(request):
    _VALID_MODES = ("t2v", "i2v", "r2v", "audio_drive", "keyframes", "extend", "chain", "image")
    try:
        data = await request.json()
        mode = str(data.get("mode", "")).strip()
        name = str(data.get("name", "")).strip()
        if mode not in _VALID_MODES or not name:
            return web.json_response({"ok": False, "error": "a valid mode and name are required"}, status=400)
        user = _load_user_config()
        custom = user.get("custom_presets", {})
        if not isinstance(custom, dict):
            custom = {}
        lst = list(custom.get(mode, []))
        custom[mode] = [p for p in lst if str(p.get("name", "")).strip().lower() != name.lower()]
        _save_config({"custom_presets": custom})
        return web.json_response({"ok": True})
    except Exception as e:
        print(f"[H3One] preset delete error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/h3one/history")
async def get_history(request):
    return web.json_response({"items": _load_history()})


@PromptServer.instance.routes.post("/h3one/history")
async def add_history(request):
    try:
        data = await request.json()
        file_type = str(data.get("type", "output") or "output")
        if file_type not in ("output", "temp", "input"):
            file_type = "output"
        entry = {
            "id": str(uuid.uuid4()),
            "timestamp": int(time.time()),
            "mode": data.get("mode", ""),
            "quality": data.get("quality", ""),
            "prompt": data.get("prompt", "")[:2000],
            "duration": data.get("duration", 0),
            "resolution": data.get("resolution", ""),
            "seed": data.get("seed", 0),
            "gen_time": data.get("gen_time", 0),
            "video": data.get("video", ""),
            "subfolder": data.get("subfolder", ""),
            "type": file_type,
            "kind": data.get("kind", "video"),
        }
        items = _load_history()
        items.insert(0, entry)
        _save_history(items[:MAX_HISTORY])
        return web.json_response({"ok": True, "id": entry["id"]})
    except Exception as e:
        print(f"[H3One] history save error: {e}")
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.delete("/h3one/history/{item_id}")
async def delete_history(request):
    try:
        item_id = request.match_info.get("item_id", "")
        items = [i for i in _load_history() if i.get("id") != item_id]
        _save_history(items)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/h3one/gallery")
async def get_gallery(request):
    favs = _load_favorites()
    videos = _scan_output_videos()
    for v in videos:
        v["favorite"] = v["filename"] in favs
    return web.json_response({"videos": videos})


@PromptServer.instance.routes.post("/h3one/stage_input")
async def stage_input(request):
    """Copy an existing output or temp video into the input folder so LoadVideo can
    read it (used by the upscale hook and Send to Extend). Returns the input-folder
    filename."""
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"}, status=400)
        if data.get("type") == "temp":
            src = _safe_join(str(Path(folder_paths.get_temp_directory()).resolve()), subfolder, filename)
        else:
            src = _safe_join(_get_output_dir(), subfolder, filename)
        if not os.path.isfile(src):
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        input_dir = Path(folder_paths.get_input_directory()).resolve()
        os.makedirs(str(input_dir), exist_ok=True)
        ext = os.path.splitext(filename)[1] or ".mp4"
        dest_name = f"h3_src_{uuid.uuid4().hex[:10]}{ext}"
        shutil.copy2(src, os.path.join(str(input_dir), dest_name))
        return web.json_response({"ok": True, "name": dest_name})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/favorite")
async def toggle_favorite(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        fav = bool(data.get("favorite", False))
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"}, status=400)
        favs = _load_favorites()
        if fav:
            favs.add(filename)
        else:
            favs.discard(filename)
        _save_favorites(favs)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/open_folder")
async def open_folder(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        if not filename:
            return web.json_response({"ok": False, "error": "no filename"})
        vpath = _safe_join(_get_output_dir(), subfolder, filename)
        if not os.path.exists(vpath):
            return web.json_response({"ok": False, "error": "file not found"}, status=404)
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", vpath.replace("/", "\\")])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(vpath)])
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/delete")
async def delete_file(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        if not filename:
            return web.json_response({"ok": False, "error": "filename required"}, status=400)
        vpath = _safe_join(_get_output_dir(), subfolder, filename)
        if not os.path.exists(vpath):
            return web.json_response({"ok": False, "error": "file not found"}, status=404)
        os.remove(vpath)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


# Stores the latest output per node instance (keyed by the node's graph id).
# The JS widget POSTs here after each generation; noop() hands it to downstream
# nodes on the next graph run.
_last_output_by_node = {}


@PromptServer.instance.routes.post("/h3one/set_output")
async def set_output(request):
    try:
        data = await request.json()
        node_id = str(data.get("node_id", ""))
        info = data.get("info") or {}
        if node_id:
            _last_output_by_node[node_id] = {
                "filename": info.get("filename", ""),
                "subfolder": info.get("subfolder", ""),
            }
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


def _empty_image_tensor():
    import torch
    return torch.zeros((1, 64, 64, 3), dtype=torch.float32)


def _video_poster(path, timeout=20):
    """Extract the first frame of a generated video as an IMAGE tensor."""
    import numpy as np
    from PIL import Image, ImageOps
    ff = _ff()
    if not ff:
        return None
    tmp = os.path.join(folder_paths.get_temp_directory(), f"h3one_poster_{uuid.uuid4().hex[:10]}.png")
    try:
        subprocess.run(
            [ff, "-y", "-ss", "0.1", "-i", path, "-frames:v", "1", "-q:v", "3", tmp],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=False,
        )
        if not os.path.isfile(tmp):
            return None
        img = Image.open(tmp)
        img = ImageOps.exif_transpose(img).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        import torch
        return torch.from_numpy(arr)[None,]
    except Exception:
        return None
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


class H3OneNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {"prompt": ("STRING", {"forceInput": True})},
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("poster", "video")
    FUNCTION = "noop"
    CATEGORY = "One Node"
    OUTPUT_NODE = True

    def noop(self, unique_id=None, **kwargs):
        info = _last_output_by_node.get(str(unique_id)) or {}
        filename = info.get("filename", "")
        subfolder = info.get("subfolder", "")
        poster = None
        rel = ""
        if filename:
            rel = f"{subfolder}/{filename}" if subfolder else filename
            try:
                path = _safe_join(_get_output_dir(), subfolder, filename)
                if os.path.isfile(path):
                    poster = _video_poster(path)
            except Exception:
                pass
        return {"result": (poster if poster is not None else _empty_image_tensor(), rel)}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


class H3CacheBust:
    """Internal cache-invalidation node (inserted by the JS between the CLIP
    loader and the H3 conditioning node).

    Why it exists: ComfyUI's execution cache fingerprints each node from its
    input values AND the fingerprints of the nodes wired into it. V3 autogrow
    inputs (ref_images / ref_audios / ...) arrive as dicts of links - and the
    cache does not traverse links nested inside dicts. A changed reference
    image/audio therefore left the cache signature unchanged and every
    downstream node (conditioning -> sampler -> save) was served stale output.

    This node sits upstream of the conditioning node and returns a digest of
    every input that must invalidate generation: the prompt, all media file
    names, plus the on-disk content of those files (so replacing a file under
    the same name also invalidates)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "fingerprint": ("STRING", {"multiline": True, "default": ""}),
            }
        }

    RETURN_TYPES = ("CLIP",)
    RETURN_NAMES = ("clip",)
    FUNCTION = "passthrough"
    CATEGORY = "One Node"

    def passthrough(self, clip, fingerprint=""):
        return (clip,)

    @classmethod
    def IS_CHANGED(cls, fingerprint, **kwargs):
        h = hashlib.sha256()
        h.update((fingerprint or "").encode("utf-8", "replace"))
        try:
            data = json.loads(fingerprint or "{}") or {}
        except Exception:
            data = {}
        for entry in data.get("files", []) or []:
            name = ""
            if isinstance(entry, dict):
                name = entry.get("name") or ""
            elif isinstance(entry, (list, tuple)) and len(entry) > 1:
                name = entry[1] or ""
            if not name:
                continue
            try:
                path = folder_paths.get_annotated_filepath(str(name))
            except Exception:
                continue
            if not path or not os.path.isfile(path):
                continue
            try:
                with open(path, "rb") as f:
                    while True:
                        chunk = f.read(1 << 20)
                        if not chunk:
                            break
                        h.update(chunk)
            except Exception:
                pass
        return h.digest().hex()


class H3IdentityAnchor:
    """Pins a reference image as a stock first/last keyframe anchor on the H3
    conditioning, so the shot starts (or ends) exactly on that image. Uses only
    core ComfyUI keyframe support - no third-party layout patches required."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "conditioning": ("CONDITIONING",),
                "vae": ("VAE",),
                "latent": ("LATENT",),
                "frame_count": ("INT", {"default": 124, "min": 5, "max": 3600, "step": 1}),
                "width": ("INT", {"default": 1344, "min": 32, "max": 16384, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": 16384, "step": 32}),
                "anchor": (["first", "last"], {"default": "first"}),
            },
            "optional": {
                "image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "apply"
    CATEGORY = "One Node"

    def apply(self, conditioning, vae, latent, frame_count=124, width=1344, height=768, anchor="first", image=None):
        if image is None:
            return (conditioning,)
        import comfy.utils as _cu
        # Mirror core MiniMaxH3ImageToVideo's first-frame path exactly: stretch
        # the image to the target canvas, then VAE-encode (BHWC is handled by
        # the comfy VAE wrapper). The keyframe latent MUST have the canvas's
        # latent row count or the packed layout's fixed-row bookkeeping breaks.
        img = image[:1]
        img = img[..., :3].movedim(-1, 1)
        img = _cu.common_upscale(img, int(width), int(height), "lanczos", "disabled")
        img = img.movedim(1, -1)
        z = vae.encode(img)
        idx = 0 if anchor == "first" else max(0, int(frame_count) - 1)
        kf = {"resolved_frame_index": idx, "latent": z}
        cond = node_helpers.conditioning_set_values(conditioning, {
            "minimax_keyframes": [kf],
            "minimax_frame_count": int(frame_count),
        })
        return (cond,)


class H3AudioTrim:
    """Trims an AUDIO input to a target duration (clamped to the 15s H3 ref
    spec). MiniMax H3 reference audio clips are specified as 2-15 seconds, and
    an audio ref longer than the target video is out-of-distribution for the
    packed layout - this node keeps ref audio within spec."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "trim_seconds": ("FLOAT", {"default": 5.0, "min": 0.5, "max": 15.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "apply"
    CATEGORY = "One Node"

    def apply(self, audio, trim_seconds=5.0):
        if not isinstance(audio, dict) or "waveform" not in audio:
            return (audio,)
        try:
            secs = min(15.0, max(0.5, float(trim_seconds)))
        except Exception:
            secs = 15.0
        sr = int(audio.get("sample_rate", 32000) or 32000)
        n = int(secs * sr)
        waveform = audio["waveform"]
        if waveform.ndim >= 2 and waveform.shape[-1] > n:
            out = dict(audio)
            out["waveform"] = waveform[..., :n]
            return (out,)
        return (audio,)


NODE_CLASS_MAPPINGS = {"H3OneNode": H3OneNode, "H3CacheBust": H3CacheBust, "H3IdentityAnchor": H3IdentityAnchor, "H3AudioTrim": H3AudioTrim, "H3OneTAELivePreview": H3OneTAELivePreview}
NODE_DISPLAY_NAME_MAPPINGS = {"H3OneNode": "ALL in ONE MiniMaxH3", "H3CacheBust": "H3 Cache Fingerprint (internal)", "H3IdentityAnchor": "H3 Identity Anchor (internal)", "H3AudioTrim": "H3 Audio Trim (internal)", "H3OneTAELivePreview": "H3 Live Preview TAEH3 (internal)"}
