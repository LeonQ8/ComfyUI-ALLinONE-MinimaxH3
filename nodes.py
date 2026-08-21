import os
import io
import json
import glob
import math
import time
import uuid
import shutil
import subprocess
import hashlib
import threading
import tempfile
import zipfile
from copy import deepcopy
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
    "keyframes.json", "video_extend.json", "chain_section.json", "mask.json", "upscale.json",
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


def _atomic_write_json(path, data):
    """Write `data` as JSON to `path` atomically.

    Writes to a UUID-suffixed sibling `.tmp`, replaces the target with
    `os.replace`, and cleans up the tmp in `finally` so a crash mid-write
    never leaves a stray file. Concurrent calls cannot trample each other
    because the tmp name is unique per call.
    """
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass


def _save_config(patch):
    user = _load_user_config()
    for k, v in patch.items():
        user[k] = v
    os.makedirs(USER_CONFIG_DIR, exist_ok=True)
    _atomic_write_json(USER_CONFIG_PATH, user)


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
    _atomic_write_json(USER_HISTORY_PATH, items)


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
    _atomic_write_json(_favorites_path(), sorted(favset))


_favorite_lock = threading.Lock()


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


def _media_key(filename, subfolder="", file_type="output"):
    """Stable identity for any media file: `type|subfolder|filename`.

    `subfolder` is normalized so Windows backslashes do not desync Linux servers.
    `filename` is reduced to its basename so a path-traversal payload in the
    client cannot leak across files.
    """
    name = Path(str(filename or "").replace("\\", "/")).name
    sub = str(subfolder or "").replace("\\", "/")
    typ = str(file_type or "output")
    return f"{typ}|{sub}|{name}"


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
    seen = set()
    for base in bases:
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base, followlinks=True):
            for fn in files:
                if any(fn.lower().endswith(e) for e in exts):
                    rel = os.path.relpath(os.path.join(root, fn), base)
                    key = rel.replace("\\", "/").lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    found.append(rel)
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
            sub = os.path.relpath(os.path.dirname(full), str(base)).replace("\\", "/")
            item = {
                "filename": fn,
                "subfolder": sub,
                "type": "output",
                "mtime": os.path.getmtime(full),
                "kind": kind,
                "media_key": _media_key(fn, sub, "output"),
            }
            if kind == "image":
                dims = _image_dims(full)
                if dims:
                    item["width"], item["height"] = dims
            found.append(item)
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return found


def _image_dims(path):
    """Read the pixel size of a PNG or JPEG without a decoder, so the UI can
    show true dimensions while displaying a downscaled thumbnail."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(32)
    except Exception:
        return None
    try:
        if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR":
            import struct
            return struct.unpack(">II", head[16:24])
        if head[:2] == b"\xff\xd8":
            return _jpeg_dims(path)
    except Exception:
        return None
    return None


def _jpeg_dims(path):
    """Scan JPEG markers for a SOF segment that carries the real dimensions."""
    import struct
    with open(path, "rb") as fh:
        fh.seek(2)
        while True:
            marker = fh.read(2)
            if len(marker) != 2:
                return None
            while marker[0] != 0xFF:
                marker = marker[1:] + fh.read(1)
                if len(marker) != 2:
                    return None
            if marker[1] in (0xD8, 0x01) or 0xD0 <= marker[1] <= 0xD7:
                continue
            length_bytes = fh.read(2)
            if len(length_bytes) != 2:
                return None
            length = struct.unpack(">H", length_bytes)[0] - 2
            if marker[1] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                data = fh.read(5)
                if len(data) != 5:
                    return None
                return struct.unpack(">HH", data[1:5])
            if length > 0:
                fh.seek(length, os.SEEK_CUR)


def _favorite_matches(video, favs):
    """True when a scanned video is a favorite. Favorites are stored as media
    keys (`type|subfolder|filename`); a legacy bare-filename entry still matches
    so favorites saved before the media-key migration keep working."""
    return video["media_key"] in favs or video["filename"] in favs


def _bulk_delete_targets(videos, mode, selected=None, favs=None):
    """Resolve the videos a bulk delete should remove. Returns None for an
    unknown mode. `selected` is the client's list of {subfolder, filename}.
    Matching uses the same subfolder strings the gallery serves, so files with
    duplicate names in different subfolders never collide."""
    if mode == "all":
        return list(videos)
    if mode == "non_favorites":
        favs = favs or set()
        return [v for v in videos if not _favorite_matches(v, favs)]
    if mode == "selected":
        keys = {
            (str(i.get("subfolder", "")), str(i.get("filename", "")))
            for i in (selected or []) if isinstance(i, dict)
        }
        return [v for v in videos if (v["subfolder"], v["filename"]) in keys]
    return None


def _archive_entry_name(item):
    """Path inside the favorites ZIP: subfolder (minus the node's own prefix)
    plus the filename, forward-slashed so the archive is platform-neutral."""
    sub = str(item.get("subfolder", "")).replace("\\", "/").strip("/")
    if sub == SUBFOLDER:
        sub = ""
    elif sub.startswith(SUBFOLDER + "/"):
        sub = sub[len(SUBFOLDER) + 1:]
    return "/".join(part for part in (sub, str(item.get("filename", ""))) if part)


def _build_favorites_zip(items):
    """Zip the given scanned outputs into a temp file and return its path. The
    caller streams the file to the client and removes it afterwards; the temp
    name is unique per call so concurrent downloads never collide."""
    fd, archive_path = tempfile.mkstemp(prefix="h3_favorites_", suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in items:
                path = _safe_join(_get_output_dir(), item["subfolder"], item["filename"])
                if not os.path.isfile(path):
                    continue
                archive.write(path, _archive_entry_name(item))
    except Exception:
        try:
            os.remove(archive_path)
        except OSError:
            pass
        raise
    return archive_path


def _resolve_download_items(videos, mode, selected=None, favs=None):
    """Resolve which scanned videos a download should zip. Returns None for an
    unknown mode. `favorites` zips every favorite; `selected` zips the client's
    list of {subfolder, filename} using the same matching as bulk delete."""
    if mode == "favorites":
        favs = favs or set()
        return [v for v in videos if _favorite_matches(v, favs)]
    if mode == "selected":
        targets = _bulk_delete_targets(videos, "selected", selected)
        return targets if targets is not None else []
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@PromptServer.instance.routes.get("/h3one/workflow/{name}")
async def serve_template(request):
    name = request.match_info.get("name", "")
    if name not in _ALLOWED_TEMPLATES:
        return web.Response(status=404, text="template not found")
    path = os.path.join(NODE_DIR, "workflows", name)
    with open(path, "r", encoding="utf-8-sig") as f:
        return web.json_response(json.load(f))


@PromptServer.instance.routes.get("/h3one/models")
async def get_models(request):
    return web.json_response({
        "checkpoints": _scan("checkpoints"),
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
            exts = (".mp4", ".m4v", ".webm", ".mkv", ".avi", ".mov")
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
    _VALID_MODES = ("t2v", "i2v", "r2v", "audio_drive", "keyframes", "extend", "chain", "mask", "image")
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
    _VALID_MODES = ("t2v", "i2v", "r2v", "audio_drive", "keyframes", "extend", "chain", "mask", "image")
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
        subfolder = str(data.get("subfolder", "") or "")
        filename = str(data.get("video", "") or "")
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
            "video": filename,
            "subfolder": subfolder,
            "type": file_type,
            "kind": data.get("kind", "video"),
            "media_key": _media_key(filename, subfolder, file_type),
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


def _thumb_bytes(path, max_dim=512):
    """Downscale an image so the browser never decodes a full-size PNG for a
    small thumbnail or compare view. Returns JPEG bytes, or None when the file
    is not an image or no decoder is available."""
    low = str(path).lower()
    if not low.endswith(_IMAGE_EXTS):
        return None
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        with Image.open(path) as img:
            img.load()
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return buf.getvalue()
    except Exception:
        return None


@PromptServer.instance.routes.get("/h3one/thumb")
async def get_thumb(request):
    """Serve a downscaled JPEG of an output/temp image so the gallery and
    compare never decode huge full-res files. Falls back to the raw file when
    no decoder is available."""
    try:
        filename = request.query.get("filename", "")
        subfolder = request.query.get("subfolder", "")
        ftype = request.query.get("type", "output")
        try:
            max_dim = max(32, min(4096, int(request.query.get("max", "512"))))
        except Exception:
            max_dim = 512
        if not filename:
            return web.Response(status=400, body=b"no filename")
        name = Path(str(filename).replace("\\", "/")).name
        if ftype == "temp":
            base = str(Path(folder_paths.get_temp_directory()).resolve())
        elif ftype == "input":
            base = str(Path(folder_paths.get_input_directory()).resolve())
        else:
            base = _get_output_dir()
        path = _safe_join(base, subfolder, name)
        if not os.path.isfile(path):
            return web.Response(status=404, body=b"not found")
        data = _thumb_bytes(path, max_dim)
        if data is None:
            with open(path, "rb") as fh:
                data = fh.read()
            return web.Response(body=data, content_type="application/octet-stream")
        return web.Response(body=data, content_type="image/jpeg")
    except ValueError:
        return web.Response(status=400, body=b"invalid path")
    except Exception as e:
        print(f"[H3One] thumb error: {e}")
        return web.Response(status=500, body=b"thumb error")


def _video_dims(path):
    """Read a video's frame size via PyAV so the upscale planner can cap the
    output resolution before it reaches the native RTX/SeedVR2 engines."""
    try:
        import av
        with av.open(path) as container:
            stream = next(s for s in container.streams if s.type == "video")
            w = getattr(stream, "codec_context", None)
            if w is not None and w.width and w.height:
                return (w.width, w.height)
            if stream.width and stream.height:
                return (stream.width, stream.height)
    except Exception:
        pass
    return None


@PromptServer.instance.routes.get("/h3one/dims")
async def get_media_dims(request):
    """Return {width, height} for an output/temp/input image or video, so the
    upscale planner can cap the output long edge instead of letting the native
    upscaler blow up on an absurdly large frame. Returns null dims when the
    file type or size can't be read."""
    try:
        filename = request.query.get("filename", "")
        subfolder = request.query.get("subfolder", "")
        ftype = request.query.get("type", "output")
        if not filename:
            return web.json_response({"ok": False, "width": None, "height": None}, status=400)
        name = Path(str(filename).replace("\\", "/")).name
        if ftype == "temp":
            base = str(Path(folder_paths.get_temp_directory()).resolve())
        elif ftype == "input":
            base = str(Path(folder_paths.get_input_directory()).resolve())
        else:
            base = _get_output_dir()
        path = _safe_join(base, subfolder, name)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "width": None, "height": None}, status=404)
        dims = _image_dims(path)
        if dims is None and str(path).lower().endswith(_VIDEO_EXTS):
            dims = _video_dims(path)
        if dims is None:
            return web.json_response({"ok": False, "width": None, "height": None})
        return web.json_response({"ok": True, "width": dims[0], "height": dims[1]})
    except ValueError:
        return web.json_response({"ok": False, "width": None, "height": None}, status=400)
    except Exception as e:
        print(f"[H3One] dims error: {e}")
        return web.json_response({"ok": False, "width": None, "height": None}, status=500)


@PromptServer.instance.routes.get("/h3one/gallery")
async def get_gallery(request):
    try:
        with _favorite_lock:
            favs = _load_favorites()
            videos = _scan_output_videos()
            video_keys = {v["media_key"] for v in videos}
            by_filename = {}
            for v in videos:
                by_filename.setdefault(v["filename"], []).append(v["media_key"])

            new_favs = set()
            for entry in favs:
                if "|" in entry:
                    if entry in video_keys:
                        new_favs.add(entry)
                else:
                    matches = by_filename.get(entry, [])
                    if matches:
                        for k in matches:
                            new_favs.add(k)
                    else:
                        pass
            if new_favs != favs:
                _save_favorites(new_favs)
            favs = new_favs

        for v in videos:
            v["favorite"] = v["media_key"] in favs
        return web.json_response({"videos": videos})
    except Exception as e:
        print(f"[H3One] gallery error: {e}")
        return web.json_response({"ok": False, "error": str(e), "videos": []}, status=500)


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
        subfolder = data.get("subfolder", "")
        file_type = str(data.get("type", "output") or "output")
        fav = bool(data.get("favorite", False))
        key = _media_key(filename, subfolder, file_type)
        if not key.endswith("|") or key.endswith("||"):
            bare = Path(str(filename or "")).name
            if not bare:
                return web.json_response({"ok": False, "error": "no filename"}, status=400)
        with _favorite_lock:
            favs = _load_favorites()
            bare = Path(str(filename or "")).name
            if fav:
                favs.add(key)
                if bare and bare != key:
                    favs.discard(bare)
            else:
                favs.discard(key)
                if bare:
                    favs.discard(bare)
            _save_favorites(favs)
        return web.json_response({"ok": True, "media_key": key})
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
        with _favorite_lock:
            favs = _load_favorites()
            key = _media_key(filename, subfolder)
            for stale in (key, Path(str(filename)).name):
                favs.discard(stale)
            _save_favorites(favs)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/delete_bulk")
async def delete_bulk(request):
    try:
        data = await request.json()
        mode = str(data.get("mode", ""))
        videos = _scan_output_videos()
        with _favorite_lock:
            favs = _load_favorites()
            targets = _bulk_delete_targets(videos, mode, data.get("items"), favs)
            if targets is None:
                return web.json_response({"ok": False, "error": "invalid delete mode"}, status=400)
            deleted = 0
            errors = []
            for item in targets:
                try:
                    path = _safe_join(_get_output_dir(), item["subfolder"], item["filename"])
                    if not os.path.isfile(path):
                        continue
                    os.remove(path)
                    deleted += 1
                    favs.discard(item["media_key"])
                    favs.discard(item["filename"])
                except Exception as e:
                    errors.append(f'{item["filename"]}: {e}')
            _save_favorites(favs)
        return web.json_response({"ok": True, "deleted": deleted, "errors": errors})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/h3one/download")
async def download(request):
    """Zip the requested outputs and stream them to the client. `mode: selected`
    zips the client's list of {subfolder, filename}; `mode: favorites` zips every
    favorited output. The archive is built in a temp file and removed after it is
    streamed, so concurrent downloads never collide."""
    archive_path = None
    try:
        data = await request.json()
        mode = str(data.get("mode", "selected"))
        videos = _scan_output_videos()
        with _favorite_lock:
            favs = _load_favorites()
        items = _resolve_download_items(videos, mode, data.get("items"), favs)
        if items is None:
            return web.json_response({"ok": False, "error": "invalid download mode"}, status=400)
        if not items:
            return web.json_response({"ok": False, "error": "nothing to download"}, status=404)
        archive_path = _build_favorites_zip(items)
        response = web.StreamResponse(headers={
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="h3_outputs.zip"',
        })
        await response.prepare(request)
        try:
            with open(archive_path, "rb") as archive:
                while True:
                    chunk = archive.read(1024 * 1024)
                    if not chunk:
                        break
                    await response.write(chunk)
            await response.write_eof()
        finally:
            os.remove(archive_path)
            archive_path = None
        return response
    except Exception as e:
        if archive_path:
            try:
                os.remove(archive_path)
            except OSError:
                pass
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
            filename = info.get("filename", "")
            subfolder = info.get("subfolder", "")
            file_type = str(info.get("type", "output") or "output")
            _last_output_by_node[node_id] = {
                "filename": filename,
                "subfolder": subfolder,
                "type": file_type,
                "media_key": _media_key(filename, subfolder, file_type),
            }
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


# ---------------------------------------------------------------------------
# SAM3 tracking preview (mask mode)
# ---------------------------------------------------------------------------
# Slices workflows/mask.json down to the tracking chain (the nodes that decide
# what SAM3 sees and tracks) plus the core SAM3_TrackPreview overlay, then
# fills the exact same fields the JS build fills for a real run. The result is
# queued as a standalone job that never loads H3 and never touches the inpaint
# or paste chain. Kept as pure helpers so the backend tests can assert the
# graph without a ComfyUI install.
_MASK_PREVIEW_TRACKING_NODES = ("16", "17", "18", "19", "20", "21", "22", "23", "24", "34")


def _mask_preview_workflow(template, p):
    """Build the tracking-only preview graph from the mask template."""
    wf = {}
    missing = []
    for node_id in _MASK_PREVIEW_TRACKING_NODES:
        if node_id not in template:
            missing.append(node_id)
            continue
        wf[node_id] = deepcopy(template[node_id])
    if missing:
        raise ValueError("mask template missing tracking nodes: " + ", ".join(sorted(missing)))
    try:
        seconds = max(0.2, min(15.0, float(p.get("duration", 5.0) or 5.0)))
    except (TypeError, ValueError):
        seconds = 5.0
    try:
        start_time = max(0.0, float(p.get("start_time", 0.0) or 0.0))
    except (TypeError, ValueError):
        start_time = 0.0
    text = str(p.get("text", "") or "").strip()
    initial = str(p.get("initial_mask", "") or "").strip()
    seed_paint = bool(initial) and not bool(text)
    wf["16"]["inputs"]["file"] = str(p.get("file", "") or "")
    wf["34"]["inputs"]["duration"] = seconds
    wf["34"]["inputs"]["start_time"] = start_time
    wf["18"]["inputs"]["max_seconds"] = seconds
    wf["18"]["inputs"]["target_fps"] = 24
    wf["19"]["inputs"]["ckpt_name"] = str(p.get("ckpt_name", "") or "")
    wf["20"]["inputs"]["text"] = text
    try:
        threshold = max(0.0, min(1.0, float(p.get("detection_threshold", 0.5) or 0.5)))
    except (TypeError, ValueError):
        threshold = 0.5
    wf["21"]["inputs"]["detection_threshold"] = threshold
    try:
        max_objects = max(0, int(p.get("max_objects", 1) or 1))
    except (TypeError, ValueError):
        max_objects = 1
    wf["21"]["inputs"]["max_objects"] = max_objects
    wf["22"]["inputs"]["object_indices"] = str(p.get("object_indices", "0") or "0")
    if not text:
        wf["21"]["inputs"].pop("conditioning", None)
    crop_check_masks = ["23", 0]
    if seed_paint:
        wf["200"] = {"class_type": "LoadImage", "inputs": {"image": initial}, "_meta": {"title": "Painted First-Frame Mask"}}
        wf["201"] = {"class_type": "ImageToMask", "inputs": {"image": ["200", 0], "channel": "red"}, "_meta": {"title": "Painted Mask To SAM"}}
        wf["21"]["inputs"]["initial_mask"] = ["201", 0]
        # The painted whole-head region must count as replacement area too, not
        # just a SAM seed. Follow it through the video with the SAM track so the
        # hair and accessories stay attached to the head, then the crop box and
        # latent region cover that whole region.
        wf["202"] = {"class_type": "H3PaintedRegion", "inputs": {"painted": ["201", 0], "track": ["23", 0], "grow": 8}, "_meta": {"title": "Painted + Tracked Region"}}
        wf["24"]["inputs"]["masks"] = ["202", 0]
        crop_check_masks = ["202", 0]
    # The crop box the preview shows must be the one the real run would use, so
    # mirror the JS build's Subject Crop dials. upscale is disabled here: it
    # resizes the crop for H3 but never moves the box, and the preview does not
    # need the resized pixels.
    try:
        crop_scale = max(1.0, min(4.0, float(p.get("crop_scale", 1.5) or 1.5)))
    except (TypeError, ValueError):
        crop_scale = 1.5
    wf["24"]["inputs"]["mode.crop_scale"] = crop_scale
    wf["24"]["inputs"]["mode.aspect_ratio"] = 0
    wf["24"]["inputs"]["upscale_megapixels"] = 0.0
    wf["100"] = {
        "class_type": "SAM3_TrackPreview",
        "inputs": {"track_data": ["21", 0], "images": ["18", 0], "opacity": 0.5, "fps": 24.0},
        "_meta": {"title": "Tracking Overlay"},
    }
    wf["101"] = {
        "class_type": "H3OneSAM3CropCheck",
        "inputs": {
            "bboxes": ["24", 2],
            "track_data": ["21", 0],
            "masks": crop_check_masks,
            "confidence_threshold": 0.4,
        },
        "_meta": {"title": "Crop + Confidence Report"},
    }
    return wf


def _load_mask_template():
    path = os.path.join(NODE_DIR, "workflows", "mask.json")
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _extract_preview_item(entry):
    """Pull the temp overlay file the SAM3_TrackPreview node wrote."""
    outputs = entry.get("outputs") or {}
    for key in ("images", "videos", "gifs"):
        items = outputs.get("100", {}).get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and item.get("filename"):
                name = str(item["filename"])
                if name.startswith("sam3_track_preview_") and name.lower().endswith(".mp4"):
                    return {
                        "filename": name,
                        "subfolder": str(item.get("subfolder", "") or ""),
                        "type": str(item.get("type", "temp") or "temp"),
                    }
    return None


def _extract_crop_check(entry):
    """Pull the JSON report the H3OneSAM3CropCheck node wrote."""
    outputs = entry.get("outputs") or {}
    text = outputs.get("101", {}).get("text")
    if not isinstance(text, list) or not text:
        return None
    try:
        data = json.loads(text[-1])
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _crop_report(bboxes, scores, masks=None, width=0, height=0, confidence_threshold=0.4):
    """Turn the crop boxes + SAM3 confidence into the JSON the frontend overlays.

    bboxes: BOUNDING_BOX payload from MVEx Subject Crop - a per-frame list of
            box lists, each box a dict {x, y, width, height} in source pixels.
    scores: SAM3 per-object detection confidence (0..1). SAM3 emits one value
            per tracked object, not per frame; 1.0 for painted-mask tracks.
    masks:  optional [N, H, W] source-res mask batch (torch tensor or numpy);
            enables the subject-clipping and pixel-area readouts. The crop box
            itself needs no mask, so it stays meaningful when masks are missing.
    """
    out_boxes = []
    for frame_boxes in bboxes or []:
        if not isinstance(frame_boxes, list) or not frame_boxes:
            continue
        first = frame_boxes[0]
        if not isinstance(first, dict):
            continue
        try:
            out_boxes.append([
                int(round(float(first.get("x", 0)))),
                int(round(float(first.get("y", 0)))),
                int(round(float(first.get("width", 0)))),
                int(round(float(first.get("height", 0)))),
            ])
        except (TypeError, ValueError):
            continue
    n = len(out_boxes)
    score_list = []
    for s in scores or []:
        try:
            score_list.append(max(0.0, min(1.0, float(s))))
        except (TypeError, ValueError):
            continue
    threshold = max(0.0, min(1.0, float(confidence_threshold)))
    min_score = min(score_list) if score_list else None
    low_confidence = bool(score_list) and min_score < threshold

    img_w, img_h = int(width), int(height)
    mask_arr = None
    if masks is not None:
        try:
            if hasattr(masks, "detach"):
                mask_arr = (masks.detach() > 0.5).cpu().numpy()
            else:
                import numpy as _np
                mask_arr = _np.asarray(masks) > 0.5
        except Exception:
            mask_arr = None
        if mask_arr is not None:
            if mask_arr.ndim == 4:
                mask_arr = mask_arr[:, 0]
            if mask_arr.ndim != 3:
                mask_arr = None
    if mask_arr is not None and mask_arr.shape[0] > 0:
        if img_h <= 0:
            img_h = mask_arr.shape[1]
        if img_w <= 0:
            img_w = mask_arr.shape[2]

    subject_min = None
    subject_sum = 0
    subject_count = 0
    subject_edge = 0
    clip_frames = 0
    max_cut = 0.0
    edge_touch = 0
    for i, box in enumerate(out_boxes):
        x, y, w, h = box
        if img_w > 0 and img_h > 0:
            if x <= 0 or y <= 0 or x + w >= img_w or y + h >= img_h:
                edge_touch += 1
        if mask_arr is None or i >= mask_arr.shape[0]:
            continue
        m = mask_arr[i]
        total = int(m.sum())
        subject_sum += total
        subject_count += 1
        if subject_min is None or total < subject_min:
            subject_min = total
        if total > 0:
            if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any():
                subject_edge += 1
            y1, y2 = max(0, y), min(m.shape[0], y + h)
            x1, x2 = max(0, x), min(m.shape[1], x + w)
            inside = int(m[y1:y2, x1:x2].sum())
            cut = (total - inside) / total
            if cut > 0.02:
                clip_frames += 1
            if cut > max_cut:
                max_cut = cut

    mean_step = 0.0
    max_step = 0.0
    if n > 1:
        steps = []
        prev = None
        for x, y, w, h in out_boxes:
            cx = x + w / 2.0
            cy = y + h / 2.0
            if prev is not None:
                steps.append(math.hypot(cx - prev[0], cy - prev[1]))
            prev = (cx, cy)
        if steps:
            mean_step = sum(steps) / len(steps)
            max_step = max(steps)

    min_dims = sorted(min(w, h) for _, _, w, h in out_boxes if min(w, h) > 0)
    median_min_dim = min_dims[len(min_dims) // 2] if min_dims else 0
    jitter = max_step / median_min_dim if median_min_dim > 0 else 0.0
    areas = sorted(w * h for _, _, w, h in out_boxes if w > 0 and h > 0)
    median_crop_area = areas[len(areas) // 2] if areas else 0
    subject_share = subject_min / median_crop_area if (subject_min is not None and median_crop_area > 0) else None

    return {
        "frames": n,
        "boxes": out_boxes,
        "scores": score_list,
        "min_score": min_score,
        "confidence_threshold": threshold,
        "low_confidence": low_confidence,
        "subject_area": {"min": subject_min, "mean": round(subject_sum / subject_count, 1)} if subject_count else None,
        "subject_share": round(subject_share, 3) if subject_share is not None else None,
        "crop_clip": {"frames": clip_frames, "max_cut": round(max_cut, 3)},
        "edge_touch": edge_touch,
        "subject_edge": subject_edge,
        "stability": {"mean_step": round(mean_step, 1), "max_step": round(max_step, 1), "jitter": round(jitter, 3)},
    }


_MASK_PREVIEW_TIMEOUT = 600.0


_MASK_PREVIEW_PROGRESS = {}


def _preview_progress_snapshot(token):
    if not token:
        return {"found": False, "value": 0, "max": 0, "done": False}
    entry = _MASK_PREVIEW_PROGRESS.get(token)
    if not entry:
        return {"found": False, "value": 0, "max": 0, "done": False}
    return {
        "found": True,
        "value": float(entry.get("value", 0)),
        "max": float(entry.get("max", 0)),
        "done": bool(entry.get("done")),
    }


def _sync_preview_progress(token, prompt_id):
    if not token:
        return
    entry = _MASK_PREVIEW_PROGRESS.get(token)
    if not entry or entry.get("pid") != prompt_id:
        return
    try:
        from comfy_execution.progress import get_progress_state
        state = get_progress_state()
        if state.prompt_id != prompt_id:
            return
        node = state.nodes.get("21")
        if node:
            entry["value"] = float(node.get("value", 0))
            entry["max"] = float(node.get("max", 0)) or 0
    except Exception:
        pass


def _mask_preview_queue_number(current):
    """Negative queue number so the preview runs ahead of pending jobs."""
    return -abs(float(current)) - 1.0


async def _run_mask_preview(wf, client_id, token=""):
    """Queue the preview graph at the front and wait for its temp overlay video."""
    import asyncio
    import execution
    server = PromptServer.instance
    prompt_id = str(uuid.uuid4())
    extra_data = {"client_id": str(client_id or ""), "enable_previews": False}
    if token:
        _MASK_PREVIEW_PROGRESS[token] = {"pid": prompt_id, "value": 0, "max": 0, "done": False}
        if len(_MASK_PREVIEW_PROGRESS) > 100:
            for stale in list(_MASK_PREVIEW_PROGRESS)[:-100]:
                _MASK_PREVIEW_PROGRESS.pop(stale, None)
    valid = await execution.validate_prompt(prompt_id, wf, None)
    if not valid[0]:
        detail = valid[1] if isinstance(valid[1], str) else json.dumps(valid[1] or "validation failed")
        return web.json_response({"ok": False, "error": "invalid preview workflow: " + detail}, status=400)
    outputs_to_execute = valid[2]
    number = float(getattr(server, "number", 0.0))
    setattr(server, "number", number + 1)
    server.prompt_queue.put((_mask_preview_queue_number(number), prompt_id, wf, extra_data, outputs_to_execute, {}))
    deadline = time.time() + _MASK_PREVIEW_TIMEOUT
    while True:
        _sync_preview_progress(token, prompt_id)
        entry = server.prompt_queue.get_history(prompt_id=prompt_id).get(prompt_id)
        if entry is not None:
            status = entry.get("status") or {}
            if status.get("completed"):
                if token:
                    _MASK_PREVIEW_PROGRESS[token]["done"] = True
                item = _extract_preview_item(entry)
                if item:
                    response = {"ok": True, "prompt_id": prompt_id, "kind": "video", **item}
                    crop = _extract_crop_check(entry)
                    if crop is not None:
                        response["crop"] = crop
                    return web.json_response(response)
                return web.json_response(
                    {"ok": False, "error": "SAM 3 finished but wrote no preview file", "prompt_id": prompt_id},
                    status=500,
                )
            messages = status.get("messages") or []
            for message in messages:
                if message and message[0] == "execution_error" and isinstance(message[1], dict):
                    detail = message[1].get("exception_message") or message[1].get("error") or "execution failed"
                    if token:
                        _MASK_PREVIEW_PROGRESS[token]["done"] = True
                    return web.json_response({"ok": False, "error": str(detail), "prompt_id": prompt_id}, status=500)
        if time.time() >= deadline:
            if token:
                _MASK_PREVIEW_PROGRESS[token]["done"] = True
            return web.json_response({"ok": False, "error": "tracking preview timed out", "prompt_id": prompt_id}, status=504)
        await asyncio.sleep(0.5)


@PromptServer.instance.routes.post("/h3one/mask_preview")
async def mask_preview(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
    if not str(data.get("file", "") or "").strip():
        return web.json_response({"ok": False, "error": "a source video file is required"}, status=400)
    try:
        template = _load_mask_template()
    except Exception as e:
        return web.json_response({"ok": False, "error": "cannot load mask template: %s" % e}, status=500)
    try:
        wf = _mask_preview_workflow(template, data)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    return await _run_mask_preview(wf, data.get("client_id", ""), str(data.get("token", "") or ""))


@PromptServer.instance.routes.get("/h3one/mask_preview_progress")
async def mask_preview_progress(request):
    return web.json_response(_preview_progress_snapshot(str(request.query.get("token", "") or "")))


# ---------------------------------------------------------------------------
# Smart inpainting: SAM3 point-prompt click-to-segment for the mask editor
# ---------------------------------------------------------------------------
# Reproduces SAM3_Detect's point-prompt path in-process so a click in the paint
# editor can produce an object-aware first-frame mask without a full queue run.
# Positive points include the object, negative points carve it out (e.g. a mic
# held in the hand). Kept as pure helpers so the backend tests can assert the
# coordinate math and mask thresholding without a ComfyUI install.
def _parse_smart_points(raw):
    """Normalize a client point list to [(x, y)] int pairs, clamped later.

    Accepts [{"x": int, "y": int}, ...] and returns a list of (int, int).
    Raises ValueError for a non-list or a malformed entry so the route can
    reject bad payloads instead of crashing mid-segment."""
    if not isinstance(raw, list):
        raise ValueError("expected a list of points")
    out = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValueError("each point must be an object")
        try:
            x = int(round(float(entry.get("x", 0))))
            y = int(round(float(entry.get("y", 0))))
        except (TypeError, ValueError):
            raise ValueError("point coordinates must be numeric")
        out.append((x, y))
    return out


def _clamp_smart_points(points, width, height):
    """Clamp pixel points into the frame bounds and drop empty frames."""
    w, h = int(width), int(height)
    if w <= 0 or h <= 0:
        return []
    out = []
    for x, y in points:
        out.append((max(0, min(w - 1, x)), max(0, min(h - 1, y))))
    return out


def _smart_mask_segment(model, image, positive, negative, refine_iterations=2, threshold=0.5):
    """Run SAM3 point prompting on a single source-res frame and return a mask.

    model: the SAM3 wrapped model (model.model.diffusion_model is the decoder).
    image: [1, H, W, 3] float frame tensor in 0..1 (source resolution).
    positive/negative: lists of (x, y) int pixel coords.
    refine_iterations: SAM decoder refinement passes after the first point pass.
    threshold: final binarization level.
    Returns a [H, W] float mask tensor (1.0 on the object, 0.0 off) on the
    same device the decoder ran on."""
    import torch
    import torch.nn.functional as F
    import comfy.model_management
    import comfy.utils

    B, H, W, C = image.shape
    frame_in = comfy.utils.common_upscale(image[..., :3].movedim(-1, 1), 1008, 1008, "bilinear", crop="disabled")
    comfy.model_management.load_model_gpu(model)
    device = comfy.model_management.get_torch_device()
    dtype = model.model.get_dtype()
    sam3_model = model.model.diffusion_model

    all_coords = [[x / W * 1008, y / H * 1008] for x, y in positive] + \
                 [[x / W * 1008, y / H * 1008] for x, y in negative]
    all_labels = [1] * len(positive) + [0] * len(negative)
    point_inputs = {
        "point_coords": torch.tensor([all_coords], dtype=dtype, device=device),
        "point_labels": torch.tensor([all_labels], dtype=torch.int32, device=device),
    }

    frame_t = frame_in.to(device=device, dtype=dtype)
    mask_logit = sam3_model.forward_segment(frame_t, point_inputs=point_inputs)
    for _ in range(max(0, int(refine_iterations) - 1)):
        mask_logit = sam3_model.forward_segment(frame_t, mask_inputs=mask_logit)
    mask = F.interpolate(mask_logit, size=(H, W), mode="bilinear", align_corners=False)
    return (mask[0, 0] > float(threshold)).float()


def _smart_mask_png(mask, width, height):
    """Render a binary mask tensor to black+white PNG bytes."""
    import io
    import numpy as np
    from PIL import Image
    arr = (mask.detach().cpu().numpy() * 255).astype("uint8")
    img = Image.fromarray(arr, mode="L").resize((int(width), int(height)), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _mask_source_frame(path, start_time=0.0):
    """Extract the frame at the trim start of a source video as a tensor.

    Mirrors what LoadVideo + Video Slice at start_time hand SAM3 in a real run:
    seek to the nearest frame at the given time and return [1, H, W, 3] float
    plus (width, height). Falls back to frame 0 when the seek or container
    cannot be read."""
    import numpy as np
    import torch
    try:
        import av
    except Exception:
        return None, None
    try:
        with av.open(path) as container:
            stream = next(s for s in container.streams if s.type == "video")
            stream.thread_type = "AUTO"
            seconds = max(0.0, float(start_time))
            if seconds > 0:
                try:
                    container.seek(int(seconds * stream.time_base.denominator), backward=True, stream=stream)
                except Exception:
                    pass
            frame = next(iter(container.decode(stream)))
            arr = frame.to_ndarray(format="rgb24")
            h, w = arr.shape[:2]
            f = torch.from_numpy(arr.astype(np.float32) / 255.0)[None,]
            return f, (w, h)
    except Exception:
        return None, None


@PromptServer.instance.routes.post("/h3one/smart_mask")
async def smart_mask(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "invalid payload"}, status=400)
    source = str(data.get("source", "") or "").strip()
    ckpt_name = str(data.get("ckpt_name", "") or "").strip()
    if not source:
        return web.json_response({"ok": False, "error": "a source video file is required"}, status=400)
    if not ckpt_name:
        return web.json_response({"ok": False, "error": "a SAM 3 checkpoint is required"}, status=400)
    try:
        positive = _parse_smart_points(data.get("positive"))
        negative = _parse_smart_points(data.get("negative"))
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    if not positive:
        return web.json_response({"ok": False, "error": "at least one positive point is required"}, status=400)
    try:
        start_time = max(0.0, float(data.get("start", 0.0) or 0.0))
    except (TypeError, ValueError):
        start_time = 0.0
    try:
        refine_iterations = max(0, min(5, int(data.get("refine_iterations", 2) or 2)))
    except (TypeError, ValueError):
        refine_iterations = 2
    try:
        threshold = max(0.0, min(1.0, float(data.get("threshold", 0.5) or 0.5)))
    except (TypeError, ValueError):
        threshold = 0.5

    try:
        name = Path(str(source).replace("\\", "/")).name
        path = _safe_join(str(Path(folder_paths.get_input_directory()).resolve()), "", name)
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid source path"}, status=400)
    if not os.path.isfile(path):
        return web.json_response({"ok": False, "error": "source video not found"}, status=404)

    frame, dims = _mask_source_frame(path, start_time)
    if frame is None or not dims:
        return web.json_response({"ok": False, "error": "could not read the source video"}, status=500)
    width, height = dims
    positive = _clamp_smart_points(positive, width, height)
    negative = _clamp_smart_points(negative, width, height)
    if not positive:
        return web.json_response({"ok": False, "error": "positive points fell outside the frame"}, status=400)

    try:
        checkpoint = folder_paths.get_full_path("checkpoints", ckpt_name)
        if not checkpoint or not os.path.isfile(checkpoint):
            raise ValueError("checkpoint not found")
        import comfy.sd
        model, _clip, _vae, _metadata = comfy.sd.load_checkpoint_guess_config(checkpoint, output_vae=True, output_clip=True)
        mask = _smart_mask_segment(model, frame, positive, negative, refine_iterations, threshold)
        png = _smart_mask_png(mask, width, height)
        mask_name = f"h3_smart_{uuid.uuid4().hex[:10]}.png"
        input_dir = folder_paths.get_input_directory()
        with open(os.path.join(input_dir, mask_name), "wb") as fh:
            fh.write(png)
        return web.json_response({"ok": True, "mask": mask_name, "width": width, "height": height})
    except Exception as e:
        print(f"[H3One] smart mask error: {e}")
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


def _mask_frame_plan(frame_count, source_fps, max_seconds, target_fps=24.0):
    count = int(frame_count)
    if count < 1:
        raise ValueError("The source video has no frames")
    source_fps = float(source_fps)
    target_fps = float(target_fps)
    max_seconds = float(max_seconds)
    if source_fps <= 0 or target_fps <= 0 or max_seconds <= 0:
        raise ValueError("Video duration and frame rates must be positive")
    seconds = min(max_seconds, count / source_fps)
    base = max(5, int(round(seconds * target_fps)))
    output_frames = base + (5 - base % 17) % 17
    last_source = min(count - 1, max(0, int(seconds * source_fps + 0.999999) - 1))
    indices = [min(last_source, int(round(i * source_fps / target_fps))) for i in range(output_frames)]
    return indices, output_frames, seconds, output_frames / target_fps


def _mask_audio_lengths(frame_count, target_fps, sample_rate):
    frame_count = max(1, int(frame_count))
    target_fps = max(1.0, float(target_fps))
    if abs(target_fps - 24.0) > 1e-6:
        raise ValueError("MiniMax H3 mask preparation requires 24 fps")
    sample_rate = max(1, int(sample_rate))
    output_samples = max(1, int(round(frame_count * sample_rate / target_fps)))
    audio_ticks = max(1, int(round(frame_count * 40.0 / target_fps)))
    model_samples = audio_ticks * 800
    return output_samples, model_samples


class H3MaskVideoPrepare:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "audio": ("AUDIO",),
                "source_fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.001}),
                "max_seconds": ("FLOAT", {"default": 5.0, "min": 0.2, "max": 15.0, "step": 0.1}),
                "target_fps": ("FLOAT", {"default": 24.0, "min": 24.0, "max": 24.0, "step": 1.0}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "AUDIO", "FLOAT", "INT")
    RETURN_NAMES = ("images", "model_audio", "source_audio", "fps", "frame_count")
    FUNCTION = "prepare"
    CATEGORY = "One Node"

    def prepare(self, images, audio, source_fps=24.0, max_seconds=5.0, target_fps=24.0):
        import torch

        target_fps = float(target_fps)
        if abs(target_fps - 24.0) > 1e-6:
            raise ValueError("MiniMax H3 mask preparation requires 24 fps")
        indices, frame_count, source_duration, _output_duration = _mask_frame_plan(
            int(images.shape[0]), source_fps, max_seconds, target_fps
        )
        index = torch.tensor(indices, dtype=torch.long, device=images.device)
        output_images = torch.index_select(images, 0, index)

        source_audio = audio if isinstance(audio, dict) else {}
        sample_rate = int(source_audio.get("sample_rate", 32000) or 32000)
        waveform = source_audio.get("waveform")
        if not isinstance(waveform, torch.Tensor):
            waveform = torch.zeros((1, 2, 0), dtype=torch.float32)
        elif waveform.ndim == 1:
            waveform = waveform[None, None, :]
        elif waveform.ndim == 2:
            waveform = waveform[None, :, :]
        source_wanted = max(1, int(round(source_duration * sample_rate)))
        output_wanted, model_wanted = _mask_audio_lengths(frame_count, target_fps, sample_rate)
        waveform = waveform[..., :min(source_wanted, output_wanted)]
        if waveform.shape[-1] < output_wanted:
            waveform = torch.nn.functional.pad(waveform, (0, output_wanted - waveform.shape[-1]))
        if waveform.shape[-2] < 1:
            model_waveform = torch.zeros((waveform.shape[0], 2, output_wanted), dtype=waveform.dtype, device=waveform.device)
        elif waveform.shape[-2] == 1:
            model_waveform = waveform.repeat(1, 2, 1)
        elif waveform.shape[-2] == 2:
            model_waveform = waveform
        else:
            model_waveform = waveform.mean(dim=1, keepdim=True).repeat(1, 2, 1)
        if not model_waveform.is_floating_point():
            model_waveform = model_waveform.float()
        model_waveform = torch.nn.functional.interpolate(
            model_waveform, size=model_wanted, mode="linear", align_corners=False
        )
        output_audio = dict(source_audio)
        output_audio["waveform"] = waveform
        output_audio["sample_rate"] = sample_rate
        model_audio = dict(output_audio)
        model_audio["waveform"] = model_waveform
        model_audio["sample_rate"] = 32000
        return output_images, model_audio, output_audio, float(target_fps), frame_count


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
        # Cover-crop the image to the target canvas (aspect preserved, no
        # distortion), then VAE-encode (BHWC is handled by the comfy VAE
        # wrapper). The keyframe latent MUST have the canvas's latent row
        # count or the packed layout's fixed-row bookkeeping breaks.
        img = image[:1]
        img = img[..., :3].movedim(-1, 1)
        img = _cu.common_upscale(img, int(width), int(height), "lanczos", "center")
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


class H3AudioJoinSmooth:
    """Fades the audio seam at the extend join.

    Extend output is [source audio] + [generated audio], but the generated
    audio continues the source tail through a lossy VAE round trip, so the two
    sides rarely meet sample-for-sample and the hard concat clicks. This node
    overlaps the source tail and the generated head with a short linear
    crossfade (the two sides are the same audio continuing, so an equal-power
    blend would boost the middle), then re-pads to the exact frame-derived
    duration so audio and video stay in sync. The crossfade is deliberately
    short (0.25s default) so speech and music keep their rhythm."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "source_frames": ("IMAGE",),
                "source_fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.001}),
                "continuation_frames": ("IMAGE",),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.001}),
                "fade_seconds": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "smooth"
    CATEGORY = "One Node"

    def smooth(self, audio, source_frames, source_fps, continuation_frames, fps=24.0, fade_seconds=0.25):
        if not isinstance(audio, dict) or "waveform" not in audio:
            return (audio,)
        try:
            fps = max(1.0, min(240.0, float(fps)))
            src_fps = max(1.0, min(240.0, float(source_fps)))
            fade = max(0.0, min(1.0, float(fade_seconds)))
        except Exception:
            return (audio,)
        waveform = audio["waveform"]
        if getattr(waveform, "ndim", 0) != 3:
            return (audio,)
        sr = int(audio.get("sample_rate", 32000) or 32000)
        if sr <= 0:
            return (audio,)
        src_raw = int(source_frames.shape[0])
        src_eff = max(1, int(round(src_raw * fps / src_fps)))
        cont = int(continuation_frames.shape[0])
        if cont < 1:
            return (audio,)
        join = int(round(src_eff / fps * sr))
        total_want = int(round((src_eff + cont) / fps * sr))
        n = int(waveform.shape[-1])
        if n < join:
            return (audio,)
        xf = int(round(fade * sr))
        if xf < 1:
            return (audio,)
        xf = min(xf, join, n - join)
        if xf < 1:
            return (audio,)

        import torch

        w = waveform[..., join - xf:join]
        c = waveform[..., join:join + xf]
        t = torch.arange(1, xf + 1, dtype=torch.float32, device=w.device).div(xf)
        blended = w * (1 - t) + c * t
        src_part = waveform[..., :join - xf]
        cont_part = waveform[..., join + xf:]
        merged = torch.cat([src_part, blended, cont_part], dim=-1)
        pad = total_want - int(merged.shape[-1])
        if pad > 0:
            merged = torch.nn.functional.pad(merged, (0, pad))
        elif pad < 0:
            merged = merged[..., :total_want]
        out = dict(audio)
        out["waveform"] = merged
        return (out,)


class H3PaintedRegion:
    """Follows a user-painted whole-head region through the video using the SAM3
    track, so hair and accessories stay attached to the head instead of sitting
    at their first-frame spot. Each frame the painted mask is shifted by the
    track's centroid drift since frame 0, then OR-ed with that frame's track
    mask. A track gap falls back to the last shift so the region never jumps or
    vanishes. The painted mask is one frame; the track is one frame per video
    frame."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "painted": ("MASK",),
                "track": ("MASK",),
                "grow": ("INT", {"default": 8, "min": 0, "max": 64, "step": 1}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("masks",)
    FUNCTION = "follow"
    CATEGORY = "One Node"

    def follow(self, painted, track, grow=8):
        import torch
        import torch.nn.functional as F
        p = painted
        t = track
        if p is None or t is None:
            raise ValueError("H3PaintedRegion needs both painted and track connected")
        n = max(p.shape[0], t.shape[0])
        t = t[:n] if t.shape[0] > 1 else t.repeat(n, 1, 1)
        t_bin = (t > 0.5).float()
        p0 = (p[:1] > 0.5).float()
        if grow > 0:
            p0 = (F.max_pool2d(p0[:, None], grow * 2 + 1, 1, grow)[:, 0] > 0).float()
        p_bin = p0.repeat(n, 1, 1)

        def centroid(m):
            total = m.sum()
            if total <= 0:
                return None, None
            ys = torch.arange(m.shape[-2], device=m.device, dtype=m.dtype)
            xs = torch.arange(m.shape[-1], device=m.device, dtype=m.dtype)
            cy = (m.sum(-1) * ys).sum() / total
            cx = (m.sum(-2) * xs).sum() / total
            return cx, cy

        base = centroid(t_bin[0])
        prev_shift = (0, 0)
        out = []
        for f in range(n):
            c = centroid(t_bin[f])
            if c[0] is None or base[0] is None:
                shift = prev_shift
            else:
                shift = (int(round(float(c[0] - base[0]))), int(round(float(c[1] - base[1]))))
                prev_shift = shift
            dx, dy = shift
            moved = torch.zeros_like(p_bin[f])
            h, w = moved.shape
            # dest[y+dy, x+dx] = src[y, x]: the painted region follows the head
            srow0 = max(0, -dy)
            srow1 = min(h, h - dy)
            scol0 = max(0, -dx)
            scol1 = min(w, w - dx)
            if srow1 > srow0 and scol1 > scol0:
                drow0 = srow0 + dy
                dcol0 = scol0 + dx
                moved[drow0:drow0 + (srow1 - srow0), dcol0:dcol0 + (scol1 - scol0)] = p_bin[f][srow0:srow1, scol0:scol1]
            out.append((moved + t_bin[f]).clamp_(0, 1))
        result = torch.stack(out)
        return (result.to(dtype=painted.dtype, device=painted.device),)


class H3OneSAM3CropCheck:
    """Hands the frontend a JSON report of the crop MVEx Subject Crop plans
    around the tracked subject plus SAM3's own per-object confidence, so the
    tracking preview can draw the crop box and flag shaky tracks before an H3
    run. Purely additive: it only reads the mask pipeline and writes a UI
    string, so wiring it into a real generation graph cannot change the output."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bboxes": ("BOUNDING_BOX",),
                "track_data": ("SAM3_TRACK_DATA",),
            },
            "optional": {
                "masks": ("MASK",),
                "confidence_threshold": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "inspect"
    CATEGORY = "One Node"
    OUTPUT_NODE = True

    def inspect(self, bboxes, track_data, masks=None, confidence_threshold=0.4):
        scores = []
        if isinstance(track_data, dict):
            raw = track_data.get("scores") or []
            if isinstance(raw, list):
                scores = raw
        report = _crop_report(bboxes, scores, masks=masks, confidence_threshold=confidence_threshold)
        payload = json.dumps(report)
        return {"result": (payload,), "ui": {"text": [payload]}}


NODE_CLASS_MAPPINGS = {"H3OneNode": H3OneNode, "H3CacheBust": H3CacheBust, "H3MaskVideoPrepare": H3MaskVideoPrepare, "H3IdentityAnchor": H3IdentityAnchor, "H3AudioTrim": H3AudioTrim, "H3AudioJoinSmooth": H3AudioJoinSmooth, "H3OneSAM3CropCheck": H3OneSAM3CropCheck, "H3PaintedRegion": H3PaintedRegion}
NODE_DISPLAY_NAME_MAPPINGS = {"H3OneNode": "ALL in ONE MiniMaxH3", "H3CacheBust": "H3 Cache Fingerprint (internal)", "H3MaskVideoPrepare": "H3 Mask Video Prepare (internal)", "H3IdentityAnchor": "H3 Identity Anchor (internal)", "H3AudioTrim": "H3 Audio Trim (internal)", "H3AudioJoinSmooth": "H3 Audio Join Smooth (internal)", "H3OneSAM3CropCheck": "H3 Crop + Confidence Report (internal)", "H3PaintedRegion": "H3 Painted Region (internal)"}
