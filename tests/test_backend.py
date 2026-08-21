"""Backend tests for One Node MiniMax H3 (nodes.py).

Loads nodes.py via importlib with stubbed ComfyUI modules so the suite runs
without a ComfyUI install. Each test isolates one pure helper used by the
backend (path safety, history, favorites, config, model scan).

Run from repo root: `python -m unittest discover -s tests -p 'test_*.py'`.
"""

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

try:
    import torch
    _HAS_TORCH = True
except Exception:  # pragma: no cover - CI hosts may not ship torch
    torch = None
    _HAS_TORCH = False


REPO_ROOT = Path(__file__).resolve().parent.parent
NODES_PATH = REPO_ROOT / "nodes.py"


def _install_stubs(tmp):
    """Wire sys.modules so nodes.py imports cleanly without a ComfyUI install.

    Idempotent and self-updating: every call rewires the lambdas with the
    current tmp, so each test gets fresh paths even when sys.modules is reused.
    """
    folder_paths = sys.modules.get("folder_paths") or types.ModuleType("folder_paths")
    sys.modules["folder_paths"] = folder_paths
    folder_paths.get_input_directory = lambda: str(Path(tmp) / "input")
    folder_paths.get_output_directory = lambda: str(Path(tmp) / "output")
    folder_paths.get_temp_directory = lambda: str(Path(tmp) / "temp")
    folder_paths.get_user_directory = lambda: str(Path(tmp) / "user")
    folder_paths.set_user_directory = lambda p: None
    folder_paths.get_folder_paths = lambda key: [str(Path(tmp) / "models" / key)]
    folder_paths.get_filename_list = lambda key: []

    sys.modules["node_helpers"] = sys.modules.get("node_helpers") or types.ModuleType("node_helpers")

    aiohttp = sys.modules.get("aiohttp") or types.ModuleType("aiohttp")
    sys.modules["aiohttp"] = aiohttp
    aiohttp_web = sys.modules.get("aiohttp.web") or types.ModuleType("aiohttp.web")
    sys.modules["aiohttp.web"] = aiohttp_web

    class _Response:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    def _json_response(data, status=200):
        return _Response(data=data, status=status)

    aiohttp_web.Response = _Response
    aiohttp_web.json_response = _json_response
    aiohttp.web = aiohttp_web

    server = sys.modules.get("server") or types.ModuleType("server")
    sys.modules["server"] = server

    class _Routes:
        def __getattr__(self, _verb):
            def accept_path(_path):
                def decorator(fn):
                    return fn
                return decorator
            return accept_path

    class _PromptServer:
        instance = type("inst", (), {"routes": _Routes()})()

    server.PromptServer = _PromptServer

    comfy = sys.modules.get("comfy") or types.ModuleType("comfy")
    sys.modules["comfy"] = comfy
    comfy_model_base = sys.modules.get("comfy.model_base") or types.ModuleType("comfy.model_base")
    sys.modules["comfy.model_base"] = comfy_model_base

    class _MiniMaxH3:
        _h3one_merge_repair = True
        extra_conds = {}

    comfy_model_base.MiniMaxH3 = _MiniMaxH3
    comfy.model_base = comfy_model_base


def _load_nodes(tmp):
    _install_stubs(tmp)
    name = f"h3_nodes_for_test_{Path(tmp).name}"
    if name in sys.modules:
        del sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, NODES_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _NodesTestBase(unittest.TestCase):
    """Each test gets a fresh tmpdir with its own USER_CONFIG_DIR."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="h3one_test_"))
        (self.tmp / "input").mkdir()
        (self.tmp / "output").mkdir()
        (self.tmp / "temp").mkdir()
        (self.tmp / "models").mkdir()
        self.nodes = _load_nodes(str(self.tmp))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def user_dir(self):
        d = self.tmp / "user" / "default" / "one-node-minimax-h3"
        d.mkdir(parents=True, exist_ok=True)
        return d


class TestSafeJoin(_NodesTestBase):
    def test_allows_nested_subpath(self):
        out = self.nodes._safe_join(str(self.tmp), "output", "video.mp4")
        self.assertTrue(out.endswith(os.path.join("output", "video.mp4")))

    def test_blocks_parent_traversal(self):
        with self.assertRaises(ValueError):
            self.nodes._safe_join(str(self.tmp / "output"), "..", "evil.txt")

    def test_blocks_absolute_path_outside(self):
        with self.assertRaises(ValueError):
            self.nodes._safe_join(str(self.tmp / "output"), "..", "..", "etc", "passwd")


class TestHistory(_NodesTestBase):
    def test_round_trip(self):
        path = self.user_dir() / "history.json"
        items = [{"id": "a", "video": "x.mp4", "mode": "t2v"}]
        self.nodes._save_history(items)
        self.assertTrue(path.is_file())
        loaded = self.nodes._load_history()
        self.assertEqual(loaded, items)

    def test_returns_empty_on_missing(self):
        self.assertEqual(self.nodes._load_history(), [])

    def test_returns_empty_on_corrupt_json(self):
        path = self.user_dir() / "history.json"
        path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.nodes._load_history(), [])


class TestFavorites(_NodesTestBase):
    def test_round_trip(self):
        path = self.user_dir() / "favorites.json"
        self.nodes._save_favorites({"x.mp4", "y.mp4"})
        self.assertTrue(path.is_file())
        loaded = self.nodes._load_favorites()
        self.assertEqual(loaded, {"x.mp4", "y.mp4"})

    def test_returns_empty_on_missing(self):
        self.assertEqual(self.nodes._load_favorites(), set())

    def test_returns_empty_on_corrupt(self):
        path = self.user_dir() / "favorites.json"
        path.write_text("not a list", encoding="utf-8")
        self.assertEqual(self.nodes._load_favorites(), set())

    def test_save_creates_user_dir(self):
        target = self.tmp / "brand_new" / "default" / "one-node-minimax-h3"
        self.assertFalse(target.exists())
        self.nodes.USER_CONFIG_DIR = str(target)
        self.nodes._save_favorites({"z.mp4"})
        self.assertTrue(target.is_dir())
        self.assertTrue((target / "favorites.json").is_file())


class TestConfig(_NodesTestBase):
    def test_builtin_loads_from_disk(self):
        cfg = self.nodes._load_builtin_config()
        self.assertIsInstance(cfg, dict)
        self.assertIn("resolution_presets", cfg)
        self.assertIsInstance(cfg["resolution_presets"], list)

    def test_quality_presets_carry_accelerator_flags(self):
        cfg = self.nodes._load_builtin_config()
        presets = cfg.get("quality_presets", {})
        self.assertTrue(presets, "quality_presets should exist")
        for key, p in presets.items():
            for flag in ("sol_attn", "sage", "kitchen"):
                self.assertIn(flag, p, f"preset {key} missing {flag}")

    def test_mask_prompt_template_is_shipped(self):
        cfg = self.nodes._load_builtin_config()
        mask = cfg.get("prompt_templates", {}).get("mask")
        self.assertIsInstance(mask, dict)
        self.assertTrue(mask.get("presets"))

    def test_user_overrides_builtin(self):
        user = self.user_dir()
        (user / "config.json").write_text(
            json.dumps({"new_key": "yes", "audio_on": False}),
            encoding="utf-8",
        )
        cfg = self.nodes._load_config()
        self.assertEqual(cfg.get("new_key"), "yes")
        self.assertEqual(cfg.get("audio_on"), False)
        self.assertIn("resolution_presets", cfg)


class TestScan(_NodesTestBase):
    def test_filters_by_extension(self):
        models = self.tmp / "models" / "loras"
        models.mkdir(parents=True, exist_ok=True)
        (models / "alpha.safetensors").write_bytes(b"")
        (models / "beta.ckpt").write_bytes(b"")
        (models / "readme.txt").write_text("not a model")
        found = self.nodes._scan("loras", [".safetensors", ".ckpt"])
        self.assertEqual(set(found), {"alpha.safetensors", "beta.ckpt"})

    def test_returns_sorted(self):
        models = self.tmp / "models" / "checkpoints"
        models.mkdir(parents=True, exist_ok=True)
        for name in ("z.safetensors", "a.safetensors", "m.safetensors"):
            (models / name).write_bytes(b"")
        found = self.nodes._scan("checkpoints", [".safetensors"])
        self.assertEqual(found, ["a.safetensors", "m.safetensors", "z.safetensors"])

    def test_dedupes_overlapping_base_folders(self):
        import sys

        import folder_paths as _folder_paths

        base_a = self.tmp / "models" / "diffusion_models"
        base_b = self.tmp / "models" / "unet"
        base_a.mkdir(parents=True, exist_ok=True)
        base_b.mkdir(parents=True, exist_ok=True)
        (base_a / "MiniMaxH3").mkdir()
        (base_b / "MiniMaxH3").mkdir()
        (base_a / "MiniMaxH3" / "minimax_h3_video_vae_fp16.safetensors").write_bytes(b"")
        (base_b / "MiniMaxH3" / "minimax_h3_video_vae_fp16.safetensors").write_bytes(b"")
        (base_a / "root.safetensors").write_bytes(b"")
        original = _folder_paths.get_folder_paths
        _folder_paths.get_folder_paths = lambda key: [str(base_a), str(base_b)]
        try:
            found = self.nodes._scan("diffusion_models", [".safetensors"])
        finally:
            _folder_paths.get_folder_paths = original
        self.assertEqual(
            found,
            ["MiniMaxH3" + os.sep + "minimax_h3_video_vae_fp16.safetensors", "root.safetensors"],
        )

    def test_empty_when_missing_dir(self):
        self.assertEqual(self.nodes._scan("nonexistent", [".safetensors"]), [])

    def test_models_route_includes_checkpoints(self):
        models = self.tmp / "models" / "checkpoints"
        models.mkdir(parents=True, exist_ok=True)
        (models / "sam3.safetensors").write_bytes(b"")
        response = _run(self.nodes.get_models(None))
        self.assertEqual(response.kwargs["data"]["checkpoints"], ["sam3.safetensors"])

    def test_video_input_route_recognizes_m4v(self):
        (self.tmp / "input" / "clip.m4v").write_bytes(b"")
        response = _run(self.nodes.list_input_files(_FakeRequest({}, query={"type": "video"})))
        self.assertEqual(response.kwargs["data"]["files"], ["clip.m4v"])

    def test_image_dims_reads_png_header(self):
        import struct

        png = (
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", 1920, 1080)
            + b"\x08\x02\x00\x00\x00"
        )
        path = self.tmp / "output" / "one-node-minimax-h3"
        path.mkdir(parents=True, exist_ok=True)
        (path / "pic.png").write_bytes(png)
        self.assertEqual(self.nodes._image_dims(str(path / "pic.png")), (1920, 1080))

    def test_image_dims_rejects_non_image(self):
        path = self.tmp / "output" / "one-node-minimax-h3"
        path.mkdir(parents=True, exist_ok=True)
        (path / "readme.txt").write_text("not an image")
        self.assertIsNone(self.nodes._image_dims(str(path / "readme.txt")))

    def test_thumb_route_serves_file_without_decoder(self):
        import struct

        png = (
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", 64, 64)
            + b"\x08\x02\x00\x00\x00"
        )
        out = self.tmp / "output" / "one-node-minimax-h3"
        out.mkdir(parents=True, exist_ok=True)
        (out / "pic.png").write_bytes(png)
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "pic.png", "subfolder": "one-node-minimax-h3", "max": "256"})))
        self.assertEqual(response.kwargs["body"], png)
        self.assertEqual(response.kwargs["content_type"], "application/octet-stream")

    def test_thumb_route_neutralizes_path_traversal(self):
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "..\\..\\evil.png", "subfolder": "", "max": "256"})))
        self.assertEqual(response.kwargs["status"], 404)

    def test_thumb_route_blocks_escaping_subfolder(self):
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "pic.png", "subfolder": "..\\..", "max": "256"})))
        self.assertEqual(response.kwargs["status"], 400)

    def test_thumb_route_404_when_missing(self):
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "ghost.png", "subfolder": "", "max": "256"})))
        self.assertEqual(response.kwargs["status"], 404)

    def test_thumb_route_defaults_max(self):
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "ghost.png", "subfolder": ""})))
        self.assertEqual(response.kwargs["status"], 404)

    def test_dims_route_reads_png_size(self):
        import struct

        png = (
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", 800, 600)
            + b"\x08\x02\x00\x00\x00"
        )
        out = self.tmp / "output" / "one-node-minimax-h3"
        out.mkdir(parents=True, exist_ok=True)
        (out / "pic.png").write_bytes(png)
        response = _run(self.nodes.get_media_dims(_FakeRequest({}, query={"filename": "pic.png", "subfolder": "one-node-minimax-h3"})))
        data = response.kwargs["data"]
        self.assertTrue(data["ok"])
        self.assertEqual(data["width"], 800)
        self.assertEqual(data["height"], 600)

    def test_dims_route_404_when_missing(self):
        response = _run(self.nodes.get_media_dims(_FakeRequest({}, query={"filename": "ghost.png", "subfolder": ""})))
        self.assertEqual(response.kwargs["status"], 404)

    def test_dims_route_null_for_non_media(self):
        out = self.tmp / "output" / "one-node-minimax-h3"
        out.mkdir(parents=True, exist_ok=True)
        (out / "readme.txt").write_text("hello")
        response = _run(self.nodes.get_media_dims(_FakeRequest({}, query={"filename": "readme.txt", "subfolder": "one-node-minimax-h3"})))
        data = response.kwargs["data"]
        self.assertFalse(data["ok"])
        self.assertIsNone(data["width"])
        self.assertIsNone(data["height"])


class _FakeRequest:
    def __init__(self, payload, query=None):
        self._payload = payload
        self.match_info = {}
        self.query = query or {}

    async def json(self):
        return self._payload


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestMediaKey(_NodesTestBase):
    def test_basic_shape(self):
        self.assertEqual(
            self.nodes._media_key("video.mp4", "chain", "output"),
            "output|chain|video.mp4",
        )

    def test_empty_subfolder(self):
        self.assertEqual(
            self.nodes._media_key("video.mp4", "", "output"),
            "output||video.mp4",
        )

    def test_normalizes_windows_backslashes(self):
        self.assertEqual(
            self.nodes._media_key("video.mp4", "chain\\0001", "output"),
            "output|chain/0001|video.mp4",
        )

    def test_strips_path_components_in_filename(self):
        self.assertEqual(
            self.nodes._media_key("..\\..\\evil.exe", "chain", "output"),
            "output|chain|evil.exe",
        )

    def test_collisions_resolved_by_subfolder(self):
        a = self.nodes._media_key("video.mp4", "chain", "output")
        b = self.nodes._media_key("video.mp4", "", "output")
        self.assertNotEqual(a, b)

    def test_collisions_resolved_by_type(self):
        a = self.nodes._media_key("video.mp4", "", "output")
        b = self.nodes._media_key("video.mp4", "", "temp")
        self.assertNotEqual(a, b)


class TestScanOutputVideos(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"\x00")

    def test_includes_media_key_and_type(self):
        self._make_output("a.mp4")
        vids = self.nodes._scan_output_videos()
        self.assertEqual(len(vids), 1)
        v = vids[0]
        self.assertEqual(v["filename"], "a.mp4")
        self.assertEqual(v["type"], "output")
        self.assertEqual(v["subfolder"], "one-node-minimax-h3")
        self.assertEqual(v["media_key"], "output|one-node-minimax-h3|a.mp4")

    def test_subfolder_appears_in_media_key(self):
        self._make_output("chain/a.mp4")
        vids = self.nodes._scan_output_videos()
        keys = {v["media_key"] for v in vids}
        self.assertIn("output|one-node-minimax-h3/chain|a.mp4", keys)

    def test_ignores_non_media(self):
        self._make_output("a.mp4", "b.txt", "c.png")
        vids = self.nodes._scan_output_videos()
        names = {v["filename"] for v in vids}
        self.assertIn("a.mp4", names)
        self.assertIn("c.png", names)
        self.assertNotIn("b.txt", names)


class TestAtomicSave(_NodesTestBase):
    def test_no_tmp_leftover_on_success(self):
        self.nodes._save_favorites({"a.mp4", "b.mp4"})
        leftovers = list(self.user_dir().glob("favorites.json.*.tmp"))
        self.assertEqual(leftovers, [])

    def test_no_tmp_leftover_on_replace_failure(self):
        def boom(*_args, **_kwargs):
            raise OSError("simulated replace failure")
        original_replace = self.nodes.os.replace
        self.nodes.os.replace = boom
        try:
            try:
                self.nodes._save_favorites({"x.mp4"})
            except OSError:
                pass
        finally:
            self.nodes.os.replace = original_replace
        leftovers = list(self.user_dir().glob("favorites.json.*.tmp"))
        self.assertEqual(leftovers, [])

    def test_atomic_save_concurrency(self):
        self.nodes._save_favorites({"seed.mp4"})
        errors = []
        successes = []

        def hammer(idx):
            try:
                for i in range(15):
                    payload = {"filename": f"file_{idx}_{i}.mp4", "subfolder": "", "type": "output", "favorite": True}
                    _run(self.nodes.toggle_favorite(_FakeRequest(payload)))
                    successes.append((idx, i))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=hammer, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        self.assertEqual(errors, [], f"unexpected errors: {errors}")
        self.assertGreater(len(successes), 0)
        leftovers = list(self.user_dir().glob("favorites.json.*.tmp"))
        self.assertEqual(leftovers, [], "atomic write left .tmp files behind")
        favs = self.nodes._load_favorites()
        self.assertGreater(len(favs), 0)


class TestFavoriteToggle(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"\x00")

    def test_toggle_stores_media_key(self):
        resp = _run(self.nodes.toggle_favorite(
            _FakeRequest({"filename": "video.mp4", "subfolder": "", "type": "output", "favorite": True})
        ))
        self.assertIn("media_key", resp.kwargs["data"])
        self.assertEqual(resp.kwargs["data"]["media_key"], "output||video.mp4")
        self.assertIn("output||video.mp4", self.nodes._load_favorites())

    def test_toggle_strips_path_components(self):
        _run(self.nodes.toggle_favorite(
            _FakeRequest({"filename": "..\\..\\evil.exe", "subfolder": "", "type": "output", "favorite": True})
        ))
        favs = self.nodes._load_favorites()
        self.assertIn("output||evil.exe", favs)
        self.assertNotIn("..\\..\\evil.exe", favs)

    def test_toggle_distinguishes_subfolders(self):
        _run(self.nodes.toggle_favorite(
            _FakeRequest({"filename": "video.mp4", "subfolder": "chain", "type": "output", "favorite": True})
        ))
        _run(self.nodes.toggle_favorite(
            _FakeRequest({"filename": "video.mp4", "subfolder": "", "type": "output", "favorite": True})
        ))
        favs = self.nodes._load_favorites()
        self.assertIn("output|chain|video.mp4", favs)
        self.assertIn("output||video.mp4", favs)


class TestGalleryMigration(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"\x00")

    def test_legacy_favorite_migrates_to_media_key(self):
        self._make_output("a.mp4")
        path = self.user_dir() / "favorites.json"
        path.write_text(json.dumps(["a.mp4"]), encoding="utf-8")
        resp = _run(self.nodes.get_gallery(_FakeRequest({})))
        vids = resp.kwargs["data"]["videos"]
        self.assertEqual(len(vids), 1)
        self.assertTrue(vids[0]["favorite"])
        persisted = self.nodes._load_favorites()
        self.assertIn("output|one-node-minimax-h3|a.mp4", persisted)
        self.assertNotIn("a.mp4", persisted)

    def test_legacy_ambiguous_filename_migrates_to_all(self):
        self._make_output("chain/dup.mp4", "dup.mp4")
        path = self.user_dir() / "favorites.json"
        path.write_text(json.dumps(["dup.mp4"]), encoding="utf-8")
        resp = _run(self.nodes.get_gallery(_FakeRequest({})))
        vids = resp.kwargs["data"]["videos"]
        self.assertEqual(len(vids), 2)
        self.assertTrue(all(v["favorite"] for v in vids))
        persisted = self.nodes._load_favorites()
        self.assertIn("output|one-node-minimax-h3|dup.mp4", persisted)
        self.assertIn("output|one-node-minimax-h3/chain|dup.mp4", persisted)
        self.assertNotIn("dup.mp4", persisted)

    def test_stale_favorite_evicted(self):
        self._make_output("a.mp4")
        path = self.user_dir() / "favorites.json"
        path.write_text(
            json.dumps(["a.mp4", "ghost.mp4", "output||nonexistent.mp4"]),
            encoding="utf-8",
        )
        resp = _run(self.nodes.get_gallery(_FakeRequest({})))
        vids = resp.kwargs["data"]["videos"]
        self.assertTrue(vids[0]["favorite"])
        persisted = self.nodes._load_favorites()
        self.assertEqual(persisted, {"output|one-node-minimax-h3|a.mp4"})

    def test_gallery_returns_favorite_flag(self):
        self._make_output("a.mp4", "chain/b.mp4")
        self.nodes._save_favorites({"output|one-node-minimax-h3|a.mp4"})
        resp = _run(self.nodes.get_gallery(_FakeRequest({})))
        vids = {v["filename"]: v for v in resp.kwargs["data"]["videos"]}
        self.assertTrue(vids["a.mp4"]["favorite"])
        self.assertFalse(vids["b.mp4"]["favorite"])


class TestBulkDeleteTargets(_NodesTestBase):
    def _video(self, filename, subfolder):
        return {"filename": filename, "subfolder": subfolder,
                "media_key": self.nodes._media_key(filename, subfolder)}

    def test_all_returns_every_video(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("b.mp4", "one-node-minimax-h3/chain")]
        targets = self.nodes._bulk_delete_targets(videos, "all")
        self.assertEqual(len(targets), 2)

    def test_non_favorites_filters_by_media_key(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("b.mp4", "one-node-minimax-h3")]
        targets = self.nodes._bulk_delete_targets(
            videos, "non_favorites", favs={"output|one-node-minimax-h3|a.mp4"})
        self.assertEqual([t["filename"] for t in targets], ["b.mp4"])

    def test_non_favorites_matches_legacy_bare_filename(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3")]
        targets = self.nodes._bulk_delete_targets(
            videos, "non_favorites", favs={"a.mp4"})
        self.assertEqual(targets, [])

    def test_selected_matches_subfolder_and_filename(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("a.mp4", "one-node-minimax-h3/chain")]
        targets = self.nodes._bulk_delete_targets(
            videos, "selected",
            [{"subfolder": "one-node-minimax-h3", "filename": "a.mp4"}])
        self.assertEqual([t["subfolder"] for t in targets], ["one-node-minimax-h3"])

    def test_unknown_mode_returns_none(self):
        self.assertIsNone(self.nodes._bulk_delete_targets([], "bogus"))


class TestArchiveEntryName(_NodesTestBase):
    def test_strips_node_subfolder_prefix(self):
        item = {"filename": "a.mp4", "subfolder": "one-node-minimax-h3/chain"}
        self.assertEqual(self.nodes._archive_entry_name(item), "chain/a.mp4")

    def test_bare_node_subfolder_becomes_flat(self):
        item = {"filename": "a.mp4", "subfolder": "one-node-minimax-h3"}
        self.assertEqual(self.nodes._archive_entry_name(item), "a.mp4")

    def test_unknown_subfolder_kept(self):
        item = {"filename": "a.mp4", "subfolder": "other/deep"}
        self.assertEqual(self.nodes._archive_entry_name(item), "other/deep/a.mp4")

    def test_normalizes_backslashes(self):
        item = {"filename": "a.mp4", "subfolder": "one-node-minimax-h3\\chain"}
        self.assertEqual(self.nodes._archive_entry_name(item), "chain/a.mp4")


class TestBuildFavoritesZip(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"frame data")

    def test_zips_existing_files_with_flat_names(self):
        self._make_output("a.mp4", "chain/b.mp4")
        items = self.nodes._scan_output_videos()
        import zipfile
        try:
            path = self.nodes._build_favorites_zip(items)
            with zipfile.ZipFile(path) as archive:
                names = sorted(archive.namelist())
            self.assertEqual(names, ["a.mp4", "chain/b.mp4"])
        finally:
            os.remove(path)

    def test_skips_files_that_vanish_mid_zip(self):
        self._make_output("a.mp4")
        items = self.nodes._scan_output_videos()
        os.remove(Path(self.nodes._get_output_dir()) / "one-node-minimax-h3" / "a.mp4")
        import zipfile
        try:
            path = self.nodes._build_favorites_zip(items)
            with zipfile.ZipFile(path) as archive:
                self.assertEqual(archive.namelist(), [])
        finally:
            os.remove(path)


class TestDeleteFileEvictsFavorites(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"\x00")

    def test_delete_removes_favorite_by_media_key(self):
        self._make_output("a.mp4")
        self.nodes._save_favorites({"output|one-node-minimax-h3|a.mp4"})
        _run(self.nodes.delete_file(_FakeRequest(
            {"filename": "a.mp4", "subfolder": "one-node-minimax-h3"})))
        self.assertEqual(self.nodes._load_favorites(), set())
        self.assertFalse((Path(self.nodes._get_output_dir())
                          / "one-node-minimax-h3" / "a.mp4").exists())

    def test_delete_keeps_other_favorites(self):
        self._make_output("a.mp4", "b.mp4")
        self.nodes._save_favorites({"output|one-node-minimax-h3|a.mp4",
                                    "output|one-node-minimax-h3|b.mp4"})
        _run(self.nodes.delete_file(_FakeRequest(
            {"filename": "a.mp4", "subfolder": "one-node-minimax-h3"})))
        self.assertEqual(self.nodes._load_favorites(), {"output|one-node-minimax-h3|b.mp4"})


class TestDeleteBulkRoute(_NodesTestBase):
    def _make_output(self, *files):
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        for rel in files:
            full = sub / rel
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_bytes(b"\x00")

    def _exists(self, *rel):
        return (Path(self.nodes._get_output_dir()) / "one-node-minimax-h3"
                / Path(*rel)).exists()

    def test_selected_deletes_only_those(self):
        self._make_output("a.mp4", "b.mp4", "chain/c.mp4")
        resp = _run(self.nodes.delete_bulk(_FakeRequest({
            "mode": "selected",
            "items": [{"subfolder": "one-node-minimax-h3", "filename": "a.mp4"}],
        })))
        self.assertTrue(resp.kwargs["data"]["ok"])
        self.assertEqual(resp.kwargs["data"]["deleted"], 1)
        self.assertFalse(self._exists("a.mp4"))
        self.assertTrue(self._exists("b.mp4"))
        self.assertTrue(self._exists("chain", "c.mp4"))

    def test_selected_does_not_collide_duplicate_names(self):
        self._make_output("a.mp4", "chain/a.mp4")
        _run(self.nodes.delete_bulk(_FakeRequest({
            "mode": "selected",
            "items": [{"subfolder": "one-node-minimax-h3", "filename": "a.mp4"}],
        })))
        self.assertFalse(self._exists("a.mp4"))
        self.assertTrue(self._exists("chain", "a.mp4"))

    def test_all_deletes_everything_and_clears_favorites(self):
        self._make_output("a.mp4", "b.mp4")
        self.nodes._save_favorites({"output|one-node-minimax-h3|a.mp4"})
        resp = _run(self.nodes.delete_bulk(_FakeRequest({"mode": "all"})))
        self.assertEqual(resp.kwargs["data"]["deleted"], 2)
        self.assertFalse(self._exists("a.mp4"))
        self.assertFalse(self._exists("b.mp4"))
        self.assertEqual(self.nodes._load_favorites(), set())

    def test_non_favorites_keeps_favorites(self):
        self._make_output("a.mp4", "b.mp4")
        self.nodes._save_favorites({"output|one-node-minimax-h3|a.mp4"})
        resp = _run(self.nodes.delete_bulk(_FakeRequest({"mode": "non_favorites"})))
        self.assertEqual(resp.kwargs["data"]["deleted"], 1)
        self.assertTrue(self._exists("a.mp4"))
        self.assertFalse(self._exists("b.mp4"))
        self.assertEqual(self.nodes._load_favorites(), {"output|one-node-minimax-h3|a.mp4"})

    def test_invalid_mode_rejected(self):
        resp = _run(self.nodes.delete_bulk(_FakeRequest({"mode": "bogus"})))
        self.assertFalse(resp.kwargs["data"]["ok"])


class TestResolveDownloadItems(_NodesTestBase):
    def _video(self, filename, subfolder):
        return {"filename": filename, "subfolder": subfolder,
                "media_key": self.nodes._media_key(filename, subfolder)}

    def test_selected_resolves_client_items(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("b.mp4", "one-node-minimax-h3")]
        items = self.nodes._resolve_download_items(
            videos, "selected",
            [{"subfolder": "one-node-minimax-h3", "filename": "a.mp4"}])
        self.assertEqual([v["filename"] for v in items], ["a.mp4"])

    def test_selected_does_not_collide_duplicate_names(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("a.mp4", "one-node-minimax-h3/chain")]
        items = self.nodes._resolve_download_items(
            videos, "selected",
            [{"subfolder": "one-node-minimax-h3", "filename": "a.mp4"}])
        self.assertEqual([v["subfolder"] for v in items], ["one-node-minimax-h3"])

    def test_favorites_matches_media_key_and_legacy(self):
        videos = [self._video("a.mp4", "one-node-minimax-h3"),
                  self._video("b.mp4", "one-node-minimax-h3")]
        items = self.nodes._resolve_download_items(
            videos, "favorites",
            favs={"output|one-node-minimax-h3|a.mp4", "b.mp4"})
        self.assertEqual([v["filename"] for v in items], ["a.mp4", "b.mp4"])

    def test_unknown_mode_returns_none(self):
        self.assertIsNone(self.nodes._resolve_download_items([], "bogus"))


class TestSetOutputPersistsMediaKey(_NodesTestBase):
    def test_set_output_writes_media_key(self):
        _run(self.nodes.set_output(_FakeRequest({
            "node_id": "42",
            "info": {"filename": "video.mp4", "subfolder": "chain", "type": "output"},
        })))
        self.assertEqual(
            self.nodes._last_output_by_node["42"]["media_key"],
            "output|chain|video.mp4",
        )

    def test_add_history_persists_media_key(self):
        _run(self.nodes.add_history(_FakeRequest({
            "mode": "t2v", "video": "video.mp4", "subfolder": "chain", "type": "output",
        })))
        items = self.nodes._load_history()
        self.assertEqual(items[0]["media_key"], "output|chain|video.mp4")


class _FakeWave:
    ndim = 3

    def __init__(self, n):
        self.shape = (1, 2, n)


class TestMaskVideoPrepare(_NodesTestBase):
    def test_frame_plan_resamples_and_pads_to_h3_grid(self):
        indices, frame_count, source_duration, duration = self.nodes._mask_frame_plan(150, 30, 5, 24)
        self.assertEqual(frame_count, 124)
        self.assertEqual(len(indices), 124)
        self.assertEqual(indices[0], 0)
        self.assertEqual(indices[-1], 149)
        self.assertTrue(all(a <= b for a, b in zip(indices, indices[1:])))
        self.assertEqual(source_duration, 5)
        self.assertAlmostEqual(duration, 124 / 24)

    def test_frame_plan_honors_shorter_limit(self):
        indices, frame_count, source_duration, _duration = self.nodes._mask_frame_plan(300, 30, 3, 24)
        self.assertEqual(frame_count, 73)
        self.assertEqual(indices[-1], 89)
        self.assertEqual(source_duration, 3)

    def test_frame_plan_rejects_empty_video(self):
        with self.assertRaisesRegex(ValueError, "no frames"):
            self.nodes._mask_frame_plan(0, 24, 5, 24)

    def test_audio_lengths_follow_video_and_h3_tick_grids(self):
        self.assertEqual(self.nodes._mask_audio_lengths(22, 24, 32000), (29333, 29600))
        self.assertEqual(self.nodes._mask_audio_lengths(5, 24, 32000), (6667, 6400))
        self.assertEqual(self.nodes._mask_audio_lengths(124, 24, 44100), (227850, 165600))

    def test_audio_lengths_reject_non_h3_frame_rate(self):
        with self.assertRaisesRegex(ValueError, "requires 24 fps"):
            self.nodes._mask_audio_lengths(124, 30, 32000)

    def test_prepare_schema_locks_target_rate_to_24_fps(self):
        target = self.nodes.H3MaskVideoPrepare.INPUT_TYPES()["required"]["target_fps"][1]
        self.assertEqual((target["default"], target["min"], target["max"]), (24.0, 24.0, 24.0))

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_prepare_keeps_video_and_audio_lengths_in_sync(self):
        images = torch.arange(150, dtype=torch.float32).reshape(150, 1, 1, 1)
        audio = {"waveform": torch.ones((1, 2, 500)), "sample_rate": 100}
        result = self.nodes.H3MaskVideoPrepare().prepare(images, audio, 30, 5, 24)
        output_images, model_audio, source_audio, fps, frame_count = result
        self.assertEqual(output_images.shape[0], 124)
        self.assertEqual(float(output_images[-1, 0, 0, 0]), 149)
        self.assertEqual(model_audio["waveform"].shape, (1, 2, 165600))
        self.assertEqual(model_audio["sample_rate"], 32000)
        self.assertEqual(source_audio["waveform"].shape[-1], round(124 / 24 * 100))
        self.assertEqual(fps, 24)
        self.assertEqual(frame_count, 124)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_prepare_normalizes_model_audio_and_pads_after_source_cut(self):
        images = torch.zeros((300, 1, 1, 1))
        channels = torch.stack([torch.ones(1000), torch.full((1000,), 2.0), torch.full((1000,), 3.0)])[None]
        result = self.nodes.H3MaskVideoPrepare().prepare(images, {"waveform": channels, "sample_rate": 100}, 30, 3, 24)
        _images, model_audio, source_audio, _fps, _frames = result
        self.assertEqual(model_audio["waveform"].shape, (1, 2, 97600))
        self.assertTrue(torch.allclose(model_audio["waveform"][0, :, :96000], torch.full((2, 96000), 2.0)))
        self.assertTrue(torch.equal(model_audio["waveform"][..., 96500:], torch.zeros((1, 2, 1100))))
        self.assertEqual(source_audio["waveform"].shape, (1, 3, 304))
        self.assertTrue(torch.equal(source_audio["waveform"][..., 300:], torch.zeros((1, 3, 4))))

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_prepare_supplies_stereo_silence_when_audio_is_missing(self):
        images = torch.zeros((5, 1, 1, 1))
        _images, model_audio, source_audio, _fps, _frames = self.nodes.H3MaskVideoPrepare().prepare(images, {}, 24, 1, 24)
        self.assertEqual(model_audio["waveform"].shape, (1, 2, 6400))
        self.assertEqual(source_audio["waveform"].shape, (1, 2, 6667))
        self.assertTrue(torch.count_nonzero(model_audio["waveform"]) == 0)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_prepare_duplicates_mono_only_for_the_model(self):
        images = torch.zeros((5, 1, 1, 1))
        mono = torch.ones((1, 1, 10000))
        _images, model_audio, source_audio, _fps, _frames = self.nodes.H3MaskVideoPrepare().prepare(
            images, {"waveform": mono, "sample_rate": 32000}, 24, 1, 24
        )
        self.assertEqual(model_audio["waveform"].shape, (1, 2, 6400))
        self.assertEqual(source_audio["waveform"].shape, (1, 1, 6667))
        self.assertTrue(torch.equal(model_audio["waveform"][:, 0], model_audio["waveform"][:, 1]))

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_prepare_resamples_44100_audio_to_exact_h3_ticks(self):
        images = torch.zeros((22, 1, 1, 1))
        waveform = torch.ones((1, 2, 50000))
        _images, model_audio, source_audio, _fps, _frames = self.nodes.H3MaskVideoPrepare().prepare(
            images, {"waveform": waveform, "sample_rate": 44100}, 24, 1, 24
        )
        self.assertEqual(model_audio["sample_rate"], 32000)
        self.assertEqual(model_audio["waveform"].shape[-1], 29600)
        self.assertEqual(source_audio["sample_rate"], 44100)
        self.assertEqual(source_audio["waveform"].shape[-1], 40425)


class TestMaskPreviewWorkflow(_NodesTestBase):
    TRACKING = {"16", "17", "18", "19", "20", "21", "22", "23", "24", "34"}

    @classmethod
    def setUpClass(cls):
        cls.mask_template = json.loads(
            (REPO_ROOT / "workflows" / "mask.json").read_text(encoding="utf-8-sig")
        )

    def _build(self, **overrides):
        params = {
            "file": "clip.mp4",
            "duration": 5,
            "ckpt_name": "sam3.1_multiplex_fp16.safetensors",
            "text": "face",
            "detection_threshold": 0.6,
            "max_objects": 1,
            "object_indices": "0",
            "initial_mask": "",
        }
        params.update(overrides)
        return self.nodes._mask_preview_workflow(self.mask_template, params)

    def test_keeps_only_tracking_nodes_plus_preview(self):
        wf = self._build()
        ids = set(wf.keys())
        self.assertEqual(ids, self.TRACKING | {"100"})
        class_types = {n["class_type"] for n in wf.values()}
        self.assertNotIn("MiniMaxH3ReferenceToVideo", class_types, "preview must not load H3")
        self.assertNotIn("SamplerCustomAdvanced", class_types)
        self.assertNotIn("MVEx_SubjectUncrop", class_types)

    def test_wires_track_preview_to_track_data_and_images(self):
        wf = self._build()
        preview = wf["100"]
        self.assertEqual(preview["class_type"], "SAM3_TrackPreview")
        self.assertEqual(preview["inputs"]["track_data"], ["21", 0])
        self.assertEqual(preview["inputs"]["images"], ["18", 0])
        self.assertEqual(preview["inputs"]["fps"], 24.0)

    def test_fills_the_same_fields_as_the_js_build(self):
        wf = self._build(duration=3, text="person", detection_threshold=0.8)
        self.assertEqual(wf["16"]["inputs"]["file"], "clip.mp4")
        self.assertEqual(wf["34"]["inputs"]["duration"], 3)
        self.assertEqual(wf["18"]["inputs"]["max_seconds"], 3)
        self.assertEqual(wf["18"]["inputs"]["target_fps"], 24)
        self.assertEqual(wf["19"]["inputs"]["ckpt_name"], "sam3.1_multiplex_fp16.safetensors")
        self.assertEqual(wf["20"]["inputs"]["text"], "person")
        self.assertEqual(wf["21"]["inputs"]["detection_threshold"], 0.8)
        self.assertEqual(wf["21"]["inputs"]["max_objects"], 1)
        self.assertEqual(wf["22"]["inputs"]["object_indices"], "0")
        self.assertIn("conditioning", wf["21"]["inputs"])

    def test_text_target_keeps_conditioning_and_ignores_paint(self):
        wf = self._build(text="face", initial_mask="mask.png")
        self.assertIn("conditioning", wf["21"]["inputs"])
        self.assertNotIn("initial_mask", wf["21"]["inputs"])
        self.assertNotIn("200", wf)
        self.assertNotIn("201", wf)

    def test_paint_seeds_the_tracker_when_no_text(self):
        wf = self._build(text="", initial_mask="mask.png")
        self.assertNotIn("conditioning", wf["21"]["inputs"])
        self.assertEqual(wf["21"]["inputs"]["initial_mask"], ["201", 0])
        self.assertEqual(wf["200"]["class_type"], "LoadImage")
        self.assertEqual(wf["200"]["inputs"]["image"], "mask.png")
        self.assertEqual(wf["201"]["class_type"], "ImageToMask")
        self.assertEqual(wf["201"]["inputs"]["image"], ["200", 0])
        self.assertEqual(wf["201"]["inputs"]["channel"], "red")

    def test_no_paint_means_no_initial_mask_wiring(self):
        wf = self._build(text="", initial_mask="")
        self.assertNotIn("initial_mask", wf["21"]["inputs"])
        self.assertNotIn("200", wf)
        self.assertNotIn("201", wf)

    def test_raises_when_tracking_nodes_are_missing(self):
        template = dict(self.mask_template)
        del template["21"]
        with self.assertRaisesRegex(ValueError, "21"):
            self.nodes._mask_preview_workflow(template, {"file": "clip.mp4"})

    def test_extracts_the_temp_overlay_file(self):
        entry = {
            "status": {"completed": True},
            "outputs": {
                "100": {"images": [{"filename": "sam3_track_preview_abc123.mp4", "subfolder": "", "type": "temp"}], "animated": [True]},
            },
        }
        item = self.nodes._extract_preview_item(entry)
        self.assertEqual(item, {"filename": "sam3_track_preview_abc123.mp4", "subfolder": "", "type": "temp"})

    def test_extract_ignores_unrelated_files(self):
        entry = {
            "status": {"completed": True},
            "outputs": {
                "15": {"images": [{"filename": "h3_mask_00001_.mp4", "subfolder": "one-node-minimax-h3", "type": "output"}]},
            },
        }
        self.assertIsNone(self.nodes._extract_preview_item(entry))

    def test_preview_queue_number_is_negative_and_front(self):
        self.assertLess(self.nodes._mask_preview_queue_number(0), 0)
        self.assertLess(self.nodes._mask_preview_queue_number(5), 0)
        self.assertLess(self.nodes._mask_preview_queue_number(-3), 0)
        self.assertEqual(self.nodes._mask_preview_queue_number(0), -1.0)
        self.assertEqual(self.nodes._mask_preview_queue_number(5), -6.0)


class TestAudioJoinSmooth(_NodesTestBase):
    def _node(self):
        return self.nodes.H3AudioJoinSmooth()

    def _img(self, frames):
        return type("Img", (), {"shape": (frames, 8, 8, 3)})()

    def test_non_dict_audio_passes_through(self):
        out = self._node().smooth(None, self._img(100), 24.0, self._img(50), 24.0, 0.25)
        self.assertIsNone(out[0])

    def test_audio_without_waveform_passes_through(self):
        out = self._node().smooth({"sample_rate": 240}, self._img(100), 24.0, self._img(50), 24.0, 0.25)
        self.assertEqual(out[0], {"sample_rate": 240})

    def test_empty_continuation_passes_through(self):
        audio = {"waveform": _FakeWave(1500), "sample_rate": 240}
        out = self._node().smooth(audio, self._img(100), 24.0, self._img(0), 24.0, 0.25)
        self.assertIs(out[0], audio)

    def test_fade_zero_passes_through(self):
        audio = {"waveform": _FakeWave(1500), "sample_rate": 240}
        out = self._node().smooth(audio, self._img(100), 24.0, self._img(50), 24.0, 0.0)
        self.assertIs(out[0], audio)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_crossfade_blends_join_and_preserves_length(self):
        sr = 240
        src, cont = 100, 50
        total = int(round((src + cont) / 24.0 * sr))
        join = int(round(src / 24.0 * sr))
        xf = int(round(0.1 * sr))  # 24 samples
        wave = torch.full((1, 2, total), 1.0)
        wave[..., join:] = 2.0
        audio = {"waveform": wave, "sample_rate": sr}
        out = self._node().smooth(audio, self._img(src), 24.0, self._img(cont), 24.0, 0.1)
        result = out[0]["waveform"]
        self.assertEqual(result.shape[-1], total, "length must stay AV-synced")
        self.assertAlmostEqual(float(result[0, 0, join - xf - 10]), 1.0, places=4)
        self.assertAlmostEqual(float(result[0, 0, total - 100]), 2.0, places=4)
        mid = result[0, 0, join - xf + xf // 2].item()
        self.assertTrue(1.0 < mid < 2.0, f"join should be blended, got {mid}")

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_source_fps_normalization_moves_join(self):
        sr = 240
        src, cont = 100, 50
        total = int(round((int(round(100 * 24.0 / 30.0)) + cont) / 24.0 * sr))
        wave = torch.zeros((1, 2, total))
        audio = {"waveform": wave, "sample_rate": sr}
        out = self._node().smooth(audio, self._img(src), 30.0, self._img(cont), 24.0, 0.1)
        self.assertEqual(out[0]["waveform"].shape[-1], total)


if __name__ == "__main__":
    unittest.main()
