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

try:
    import numpy as np
    _HAS_NUMPY = True
except Exception:  # pragma: no cover - CI hosts may not ship numpy
    np = None
    _HAS_NUMPY = False


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
            for flag in ("sol_attn", "sage", "kitchen", "sla"):
                self.assertIn(flag, p, f"preset {key} missing {flag}")

    def test_draft_preset_ships_sla_with_kitchen(self):
        cfg = self.nodes._load_builtin_config()
        draft = cfg.get("quality_presets", {}).get("draft")
        self.assertIsInstance(draft, dict, "draft preset must exist")
        self.assertEqual(draft.get("label"), "SLA Draft")
        self.assertEqual(draft.get("steps"), 8)
        self.assertTrue(draft.get("kitchen"), "draft must pair SLA with Kitchen")
        self.assertTrue(draft.get("sla"), "draft must enable SLA")
        self.assertFalse(draft.get("sol_attn"), "draft must not use SolAttn")
        self.assertFalse(draft.get("sage"), "draft must not use SageAttention")

    def test_sla_settings_defaults_shipped(self):
        cfg = self.nodes._load_builtin_config()
        defaults = cfg.get("model_defaults", {})
        self.assertEqual(defaults.get("speed_lora_strength"), 0.8)
        self.assertEqual(defaults.get("shift_video"), 8)
        self.assertEqual(defaults.get("shift_audio"), 3)

    def test_mask_prompt_template_is_shipped(self):
        cfg = self.nodes._load_builtin_config()
        mask = cfg.get("prompt_templates", {}).get("mask")
        self.assertIsInstance(mask, dict)
        self.assertTrue(mask.get("presets"))

    def test_mask_preset_stays_audio_neutral(self):
        cfg = self.nodes._load_builtin_config()
        presets = cfg.get("prompt_templates", {}).get("mask", {}).get("presets", [])
        self.assertTrue(presets, "mask presets should exist")
        for preset in presets:
            prompt = preset.get("prompt", "")
            self.assertNotIn("speaks", prompt, "presets must not bake in lip-sync; the Audio mode owns it")
            self.assertNotIn("mouth", prompt, "presets must not bake in lip-sync; the Audio mode owns it")

    def test_mask_prompt_uses_the_source_crop_as_a_motion_reference(self):
        cfg = self.nodes._load_builtin_config()
        mask = cfg.get("prompt_templates", {}).get("mask", {})
        self.assertIn("<Video 1>", mask.get("wrap", ""), "the mask template must label the source crop as a motion reference")
        self.assertIn("movement and performance come from <Video 1>", mask.get("wrap", ""), "identity and motion must be split between the ref image and the ref video")
        self.assertIn("weak_reference", mask.get("wrap", ""), "the ref video must be a motion-only reference, never the identity")
        for preset in mask.get("presets", []):
            prompt = preset.get("prompt", "")
            self.assertIn("<Video 1>", prompt)
            self.assertIn("the face of the person in <Video 1> never appears", prompt,
                          "the source dancer's face must not leak into the replacement")

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
        escape = os.sep.join(["..", ".."])
        response = _run(self.nodes.get_thumb(_FakeRequest({}, query={"filename": "pic.png", "subfolder": escape, "max": "256"})))
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


class TestSlaStatus(_NodesTestBase):
    """The SLA availability check must be safe without ComfyUI-PlagueKind-Nodes
    and reflect the pack once it registers H3SLAAttention."""

    def _fake_nodes_module(self, mappings):
        import sys

        nodes = types.ModuleType("nodes")
        nodes.NODE_CLASS_MAPPINGS = mappings
        sys.modules["nodes"] = nodes
        self._added_nodes_module = True

    def tearDown(self):
        super().tearDown()
        if getattr(self, "_added_nodes_module", False):
            import sys

            sys.modules.pop("nodes", None)

    def test_reports_false_when_pack_absent(self):
        self.assertFalse(self.nodes._sla_installed())

    def test_reports_false_when_class_not_registered(self):
        self._fake_nodes_module({"SomeOtherNode": object})
        self.assertFalse(self.nodes._sla_installed())

    def test_reports_true_when_registered(self):
        self._fake_nodes_module({"H3SLAAttention": object, "SomeOtherNode": object})
        self.assertTrue(self.nodes._sla_installed())

    def test_route_returns_found_flag(self):
        resp = _run(self.nodes.get_sla_status(_FakeRequest({})))
        data = resp.kwargs["data"]
        self.assertTrue(data["ok"])
        self.assertIn("found", data)
        self.assertFalse(data["found"])

    def test_route_reflects_registered_class(self):
        self._fake_nodes_module({"H3SLAAttention": object})
        resp = _run(self.nodes.get_sla_status(_FakeRequest({})))
        self.assertTrue(resp.kwargs["data"]["found"])


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
        self.assertEqual(ids, self.TRACKING | {"100", "101"})
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

    def test_wires_crop_check_to_bboxes_track_and_mask(self):
        wf = self._build()
        report = wf["101"]
        self.assertEqual(report["class_type"], "H3OneSAM3CropCheck")
        self.assertEqual(report["inputs"]["bboxes"], ["24", 2])
        self.assertEqual(report["inputs"]["track_data"], ["21", 0])
        self.assertEqual(report["inputs"]["masks"], ["23", 0])
        self.assertEqual(report["inputs"]["confidence_threshold"], 0.4)

    def test_crop_check_mirrors_the_real_runs_subject_crop_dials(self):
        wf = self._build(crop_scale=2.3, megapixels=0.5)
        self.assertEqual(wf["24"]["inputs"]["mode.crop_scale"], 2.3)
        self.assertEqual(wf["24"]["inputs"]["mode.aspect_ratio"], 0)
        self.assertEqual(wf["24"]["inputs"]["upscale_megapixels"], 0.0)

    def test_crop_check_clamps_bad_crop_scale(self):
        wf = self._build(crop_scale="oops", megapixels="nope")
        self.assertEqual(wf["24"]["inputs"]["mode.crop_scale"], 1.5)
        self.assertEqual(wf["24"]["inputs"]["upscale_megapixels"], 0.0)

    def test_extracts_the_crop_check_report(self):
        entry = {
            "status": {"completed": True},
            "outputs": {
                "100": {"videos": [{"filename": "sam3_track_preview_abc123.mp4", "subfolder": "", "type": "temp"}]},
                "101": {"text": [json.dumps({"frames": 3, "boxes": [[0, 0, 100, 100]]})]},
            },
        }
        crop = self.nodes._extract_crop_check(entry)
        self.assertEqual(crop["frames"], 3)
        self.assertEqual(crop["boxes"], [[0, 0, 100, 100]])

    def test_extract_crop_check_returns_none_when_absent(self):
        self.assertIsNone(self.nodes._extract_crop_check({"outputs": {"100": {"videos": []}}}))
        self.assertIsNone(self.nodes._extract_crop_check({"outputs": {"101": {"text": ["not json"]}}}))

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

    def test_threads_trim_start_time_into_the_video_slice(self):
        wf = self._build(start_time=41.2)
        self.assertEqual(wf["34"]["inputs"]["start_time"], 41.2)

    def test_defaults_trim_start_time_to_zero(self):
        wf = self._build()
        self.assertEqual(wf["34"]["inputs"]["start_time"], 0.0)

    def test_clamps_bad_trim_start_time_to_zero(self):
        wf = self._build(start_time="oops")
        self.assertEqual(wf["34"]["inputs"]["start_time"], 0.0)

    def test_clamps_negative_trim_start_time_to_zero(self):
        wf = self._build(start_time=-3.0)
        self.assertEqual(wf["34"]["inputs"]["start_time"], 0.0)

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

    def test_paint_follows_the_track_as_the_replacement_region(self):
        wf = self._build(text="", initial_mask="mask.png")
        self.assertEqual(wf["202"]["class_type"], "H3PaintedRegion")
        self.assertEqual(wf["202"]["inputs"]["painted"], ["201", 0])
        self.assertEqual(wf["202"]["inputs"]["track"], ["23", 0])
        self.assertEqual(wf["24"]["inputs"]["masks"], ["202", 0])
        self.assertEqual(wf["101"]["inputs"]["masks"], ["202", 0])

    def test_preview_error_passes_unrelated_failures_through(self):
        wf = self._build()
        self.assertEqual(self.nodes._preview_error_message("some other error", wf), "some other error")

    def test_preview_error_translates_empty_masks_with_a_text_target(self):
        wf = self._build(text="person", detection_threshold=1.0)
        msg = self.nodes._preview_error_message("all masks are empty, nothing to crop", wf)
        self.assertIn("person", msg)
        self.assertIn("100%", msg)
        self.assertIn("lower the Detection slider", msg)

    def test_preview_error_translates_empty_masks_with_a_reasonable_threshold(self):
        wf = self._build(text="person", detection_threshold=0.5)
        msg = self.nodes._preview_error_message("nothing to crop", wf)
        self.assertIn("person", msg)
        self.assertIn("clearer Mask target", msg)

    def test_preview_error_translates_empty_masks_with_no_text(self):
        wf = self._build(text="", initial_mask="")
        msg = self.nodes._preview_error_message("all masks are empty, nothing to crop", wf)
        self.assertIn("Mask target", msg)
        self.assertIn("paint a first-frame mask", msg)

    def test_text_target_does_not_add_the_region_node(self):
        wf = self._build(text="face", initial_mask="mask.png")
        self.assertNotIn("202", wf)
        self.assertEqual(wf["24"]["inputs"]["masks"], ["23", 0])
        self.assertEqual(wf["101"]["inputs"]["masks"], ["23", 0])

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


class TestCropReport(_NodesTestBase):
    def _boxes(self, *frame_boxes):
        return [[b] for b in frame_boxes]

    def _box(self, x, y, w, h):
        return {"x": x, "y": y, "width": w, "height": h}

    def test_scores_surface_min_confidence_and_low_flag(self):
        report = self.nodes._crop_report(
            self._boxes(self._box(0, 0, 100, 100), self._box(10, 0, 100, 100)),
            [0.9, 0.31],
            confidence_threshold=0.4,
        )
        self.assertEqual(report["min_score"], 0.31)
        self.assertTrue(report["low_confidence"])
        self.assertEqual(report["scores"], [0.9, 0.31])
        self.assertEqual(report["frames"], 2)

    def test_missing_scores_are_not_low_confidence(self):
        report = self.nodes._crop_report(self._boxes(self._box(0, 0, 100, 100)), [])
        self.assertIsNone(report["min_score"])
        self.assertFalse(report["low_confidence"])

    def test_clamps_out_of_range_scores(self):
        report = self.nodes._crop_report(
            self._boxes(self._box(0, 0, 100, 100)),
            [1.9, -0.4, "x"],
            confidence_threshold=0.4,
        )
        self.assertEqual(report["scores"], [1.0, 0.0])
        self.assertTrue(report["low_confidence"])

    def test_stability_measures_box_center_movement(self):
        report = self.nodes._crop_report(
            self._boxes(
                self._box(0, 0, 100, 100),
                self._box(0, 0, 100, 100),
                self._box(30, 40, 100, 100),
            ),
            [],
        )
        self.assertEqual(report["stability"]["max_step"], 50.0)
        self.assertEqual(report["stability"]["mean_step"], 25.0)
        self.assertGreater(report["stability"]["jitter"], 0.0)

    def test_empty_boxes_yield_a_safe_report(self):
        report = self.nodes._crop_report([], [])
        self.assertEqual(report["frames"], 0)
        self.assertEqual(report["boxes"], [])
        self.assertIsNone(report["min_score"])
        self.assertFalse(report["low_confidence"])
        self.assertEqual(report["stability"]["max_step"], 0.0)
        self.assertEqual(report["crop_clip"]["frames"], 0)

    def test_edge_touch_counts_boxes_pinned_at_the_frame_border(self):
        report = self.nodes._crop_report(
            self._boxes(self._box(10, 10, 100, 100), self._box(0, 0, 200, 200)),
            [],
            width=200,
            height=200,
        )
        self.assertEqual(report["edge_touch"], 1)

    @unittest.skipUnless(_HAS_NUMPY, "numpy not available")
    def test_mask_clipping_counts_frames_where_the_crop_cuts_the_subject(self):
        masks = np.zeros((2, 100, 100), dtype=bool)
        masks[0, 10:80, 10:80] = True
        masks[1, 10:80, 10:80] = True
        boxes = self._boxes(
            self._box(20, 20, 40, 40),
            self._box(0, 0, 90, 90),
        )
        report = self.nodes._crop_report(boxes, [], masks=masks)
        self.assertEqual(report["crop_clip"]["frames"], 1)
        self.assertGreater(report["crop_clip"]["max_cut"], 0.0)
        self.assertGreater(report["subject_area"]["min"], 0)

    @unittest.skipUnless(_HAS_NUMPY, "numpy not available")
    def test_mask_subject_inside_the_crop_is_not_clipped(self):
        masks = np.zeros((1, 100, 100), dtype=bool)
        masks[0, 30:60, 30:60] = True
        report = self.nodes._crop_report(
            self._boxes(self._box(20, 20, 60, 60)),
            [],
            masks=masks,
        )
        self.assertEqual(report["crop_clip"]["frames"], 0)
        self.assertEqual(report["crop_clip"]["max_cut"], 0.0)

    @unittest.skipUnless(_HAS_NUMPY, "numpy not available")
    def test_subject_edge_counts_frames_touching_the_frame_border(self):
        masks = np.zeros((2, 100, 100), dtype=bool)
        masks[0, 30:60, 30:60] = True
        masks[1, 0:10, 40:60] = True
        report = self.nodes._crop_report(
            self._boxes(self._box(0, 0, 100, 100), self._box(0, 0, 100, 100)),
            [],
            masks=masks,
            width=100,
            height=100,
        )
        self.assertEqual(report["subject_edge"], 1)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_torch_masks_are_handled(self):
        masks = torch.zeros((1, 100, 100))
        masks[0, 30:60, 30:60] = 1.0
        report = self.nodes._crop_report(
            self._boxes(self._box(20, 20, 60, 60)),
            [],
            masks=masks,
        )
        self.assertEqual(report["crop_clip"]["frames"], 0)
        self.assertEqual(report["subject_area"]["min"], 900)

    def test_node_inspect_returns_json_and_ui(self):
        node = self.nodes.H3OneSAM3CropCheck()
        boxes = [[{"x": 0, "y": 0, "width": 100, "height": 100}]]
        result = node.inspect(boxes, {"scores": [0.9]}, masks=None, confidence_threshold=0.4)
        payload = result["result"][0]
        data = json.loads(payload)
        self.assertEqual(data["frames"], 1)
        self.assertEqual(data["boxes"], [[0, 0, 100, 100]])
        self.assertEqual(data["min_score"], 0.9)
        self.assertEqual(result["ui"]["text"], [payload])

    def test_node_inspect_ignores_non_sam_track_data(self):
        node = self.nodes.H3OneSAM3CropCheck()
        result = node.inspect([[{"x": 0, "y": 0, "width": 100, "height": 100}]], None)
        data = json.loads(result["result"][0])
        self.assertEqual(data["scores"], [])
        self.assertFalse(data["low_confidence"])


@unittest.skipUnless(_HAS_TORCH, "torch not available")
class TestPaintedRegion(_NodesTestBase):
    def _node(self):
        return self.nodes.H3PaintedRegion()

    def test_static_track_leaves_the_painted_region_in_place(self):
        paint = torch.zeros((1, 8, 8))
        paint[0, 1:4, 1:4] = 1.0
        track = torch.zeros((3, 8, 8))
        track[:, 3:5, 3:5] = 1.0
        out = self._node().follow(paint, track, grow=0)[0]
        self.assertEqual(out.shape, (3, 8, 8))
        for f in range(3):
            self.assertEqual(out[f, 1:4, 1:4].min().item(), 1.0, "painted region must survive every frame")
            self.assertEqual(out[f, 3:5, 3:5].min().item(), 1.0, "track region must survive every frame")

    def test_painted_region_follows_track_motion(self):
        paint = torch.zeros((1, 12, 12))
        paint[0, 2:5, 2:5] = 1.0
        track = torch.zeros((3, 12, 12))
        for f, dx in enumerate((0, 3, 6)):
            track[f, 4:6, 4 + dx:6 + dx] = 1.0
        out = self._node().follow(paint, track, grow=0)[0]
        # the painted region must shift with the track's centroid drift
        self.assertGreater(out[2, 2:5, 2 + 6:5 + 6].max().item(), 0.0,
                           "painted region must move with the head")
        self.assertLess(out[2, 2:5, 2:5].max().item(), 0.9,
                        "painted region must not stay anchored at the first-frame spot")

    def test_painted_region_follows_downward_motion(self):
        paint = torch.zeros((1, 12, 12))
        paint[0, 2:5, 2:5] = 1.0
        track = torch.zeros((2, 12, 12))
        track[0, 4:6, 4:6] = 1.0
        track[1, 7:9, 4:6] = 1.0  # head moves down by 3
        out = self._node().follow(paint, track, grow=0)[0]
        self.assertGreater(out[1, 5:8, 2:5].max().item(), 0.0,
                           "painted region must move down with the head")
        self.assertLess(out[1, 2:5, 2:5].max().item(), 0.9,
                        "painted region must not stay at the first-frame row")

    def test_track_gap_falls_back_to_last_shift(self):
        paint = torch.zeros((1, 12, 12))
        paint[0, 2:5, 2:5] = 1.0
        track = torch.zeros((3, 12, 12))
        track[0, 4:6, 4:6] = 1.0
        track[1, 4:6, 7:9] = 1.0
        # frame 2 empty: painted region must keep the previous shift, not vanish
        out = self._node().follow(paint, track, grow=0)[0]
        self.assertGreater(out[2, 2:5, 2 + 3:5 + 3].max().item(), 0.9,
                           "a track gap must not drop the painted region")

    def test_painted_region_single_frame_broadcasts(self):
        paint = torch.zeros((1, 8, 8))
        paint[0, 0:3, 0:3] = 1.0
        track = torch.zeros((5, 8, 8))
        track[2, 6:8, 6:8] = 1.0
        out = self._node().follow(paint, track, grow=0)[0]
        self.assertEqual(out.shape, (5, 8, 8))
        self.assertEqual(out[2, 6:8, 6:8].max().item(), 1.0)

    def test_grow_dilates_the_painted_region(self):
        paint = torch.zeros((1, 8, 8))
        paint[0, 3, 3] = 1.0
        track = torch.zeros((1, 8, 8))
        out = self._node().follow(paint, track, grow=3)[0]
        self.assertGreater(out[0].sum().item(), 1.0, "grow must widen the painted region")


class TestMaskPreviewProgress(_NodesTestBase):
    def test_snapshot_unknown_token_is_empty(self):
        snap = self.nodes._preview_progress_snapshot("nope")
        self.assertFalse(snap["found"])
        self.assertEqual(snap["value"], 0)
        self.assertEqual(snap["max"], 0)

    def test_snapshot_missing_token_is_empty(self):
        self.assertFalse(self.nodes._preview_progress_snapshot("")["found"])

    def test_snapshot_reads_registered_entry(self):
        self.nodes._MASK_PREVIEW_PROGRESS["abc"] = {"pid": "p1", "value": 45, "max": 124, "done": False}
        snap = self.nodes._preview_progress_snapshot("abc")
        self.assertTrue(snap["found"])
        self.assertEqual(snap["value"], 45)
        self.assertEqual(snap["max"], 124)
        self.assertFalse(snap["done"])

    def test_snapshot_surfaces_done(self):
        self.nodes._MASK_PREVIEW_PROGRESS["abc"] = {"pid": "p1", "value": 124, "max": 124, "done": True}
        self.assertTrue(self.nodes._preview_progress_snapshot("abc")["done"])

    def test_progress_route_returns_snapshot(self):
        self.nodes._MASK_PREVIEW_PROGRESS["tok"] = {"pid": "p1", "value": 10, "max": 100, "done": False}
        resp = _run(self.nodes.mask_preview_progress(_FakeRequest({}, query={"token": "tok"})))
        self.assertEqual(resp.kwargs["data"]["value"], 10)
        self.assertEqual(resp.kwargs["data"]["max"], 100)

    def test_progress_route_unknown_token(self):
        resp = _run(self.nodes.mask_preview_progress(_FakeRequest({}, query={"token": "ghost"})))
        self.assertFalse(resp.kwargs["data"]["found"])

    def test_sync_unknown_token_is_noop(self):
        self.nodes._sync_preview_progress("ghost", "p1")

    def test_sync_ignores_other_prompt(self):
        self.nodes._MASK_PREVIEW_PROGRESS["abc"] = {"pid": "p1", "value": 0, "max": 0, "done": False}
        self.nodes._sync_preview_progress("abc", "p2")
        self.assertEqual(self.nodes._MASK_PREVIEW_PROGRESS["abc"]["value"], 0)


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


class TestSmartMask(_NodesTestBase):
    def _stub_comfy_utils(self):
        """Register the comfy helpers _smart_mask_segment needs so it runs
        standalone. _install_stubs only wires comfy.model_base, so the smart
        helper must get its own model_management/utils/mapping stubs."""
        import sys

        comfy = sys.modules.get("comfy")
        comfy.__path__ = []
        mm = sys.modules.get("comfy.model_management") or types.ModuleType("comfy.model_management")
        sys.modules["comfy.model_management"] = mm
        mm.get_torch_device = lambda: "cpu"
        mm.load_model_gpu = lambda model: None
        mm.intermediate_device = lambda: "cpu"
        cu = sys.modules.get("comfy.utils") or types.ModuleType("comfy.utils")
        sys.modules["comfy.utils"] = cu

        def common_upscale(tensor, width, height, method, crop="disabled"):
            return torch.nn.functional.interpolate(tensor, size=(height, width), mode="bilinear", align_corners=False)

        cu.common_upscale = common_upscale
        comfy.model_management = mm
        comfy.utils = cu
        return mm, cu

    def _fake_model(self):
        captured = {}

        def forward_segment(self, _frame, point_inputs=None, mask_inputs=None, **kwargs):
            if point_inputs is not None:
                captured["point_coords"] = point_inputs["point_coords"]
                captured["point_labels"] = point_inputs["point_labels"]
            return torch.ones((1, 1, 1008, 1008)) * 2.0

        decoder = type("Decoder", (), {"forward_segment": forward_segment})()
        fake = type("Model", (), {})()
        fake.diffusion_model = decoder
        fake.get_dtype = lambda: torch.float32
        model = type("Wrapped", (), {})()
        model.model = fake
        return model, captured

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_segment_builds_point_inputs_and_thresholds(self):
        self._stub_comfy_utils()
        model, captured = self._fake_model()
        image = torch.zeros((1, 40, 60, 3))
        mask = self.nodes._smart_mask_segment(model, image, [(10, 10)], [(30, 20)], refine_iterations=2, threshold=0.5)
        self.assertEqual(mask.shape, (40, 60))
        self.assertEqual(mask.max().item(), 1.0)
        labels = captured["point_labels"]
        self.assertEqual(labels[0].tolist(), [1, 0])
        coords = captured["point_coords"][0]
        self.assertAlmostEqual(float(coords[0][0]), 10 / 60 * 1008, places=4)
        self.assertAlmostEqual(float(coords[1][1]), 20 / 40 * 1008, places=4)

    def test_parse_smart_points_normalizes_ints(self):
        self.assertEqual(
            self.nodes._parse_smart_points([{"x": 1.7, "y": 2.4}, {"x": "5", "y": 0}]),
            [(2, 2), (5, 0)],
        )

    def test_corner_points_tuck_into_the_frame_border(self):
        pts = self.nodes._smart_mask_corner_points(1920, 1080)
        self.assertEqual(len(pts), 4)
        self.assertTrue(all(0 <= x < 1920 and 0 <= y < 1080 for x, y in pts))
        self.assertIn((32, 32), pts)
        self.assertIn((1887, 32), pts)
        self.assertIn((32, 1047), pts)
        self.assertIn((1887, 1047), pts)

    def test_corner_points_clamp_on_tiny_frames(self):
        pts = self.nodes._smart_mask_corner_points(10, 10)
        self.assertTrue(all(0 <= x < 10 and 0 <= y < 10 for x, y in pts))

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_run_keeps_tight_masks_without_corners(self):
        self._stub_comfy_utils()
        model, captured = self._fake_model_blob()
        image = torch.zeros((1, 100, 100, 3))
        mask = self.nodes._smart_mask_run(model, image, [(50, 50)], [])
        self.assertEqual(mask.shape, (100, 100))
        cov = float(mask.sum().item()) / (100 * 100)
        self.assertLess(cov, 0.4, "a tight mask must not pull in the corner fallback")
        self.assertEqual(captured["point_labels"][0].tolist(), [1], "no negatives should be added for a tight mask")

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_run_keeps_a_non_empty_mask_even_when_sam3_returns_the_whole_scene(self):
        self._stub_comfy_utils()
        model, _captured = self._fake_model_allpos()
        image = torch.zeros((1, 100, 100, 3))
        mask = self.nodes._smart_mask_run(model, image, [(50, 50)], [])
        self.assertGreater(mask.sum().item(), 0)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_run_respects_user_negatives_and_skips_the_auto_fallback(self):
        self._stub_comfy_utils()
        model, captured = self._fake_model_allpos()
        image = torch.zeros((1, 100, 100, 3))
        mask = self.nodes._smart_mask_run(model, image, [(50, 50)], [(10, 10)])
        self.assertEqual(mask.sum().item(), 100 * 100, "user negatives must be honored without the corner fallback")
        labels = captured["point_labels"][0].tolist()
        self.assertEqual(labels, [1, 0], "the user negative must stay the only negative")

    def _fake_model_blob(self):
        captured = {}

        def forward_segment(self, _frame, point_inputs=None, mask_inputs=None, **kwargs):
            if point_inputs is not None:
                captured["point_labels"] = point_inputs["point_labels"]
            h = torch.full((1, 1, 1008, 1008), -3.0)
            h[:, :, 450:550, 450:550] = 2.0
            return h

        decoder = type("Decoder", (), {"forward_segment": forward_segment})()
        fake = type("Model", (), {})()
        fake.diffusion_model = decoder
        fake.get_dtype = lambda: torch.float32
        model = type("Wrapped", (), {})()
        model.model = fake
        return model, captured

    def _fake_model_allpos(self):
        captured = {}

        def forward_segment(self, _frame, point_inputs=None, mask_inputs=None, **kwargs):
            if point_inputs is not None:
                captured["point_labels"] = point_inputs["point_labels"]
            return torch.ones((1, 1, 1008, 1008)) * 2.0

        decoder = type("Decoder", (), {"forward_segment": forward_segment})()
        fake = type("Model", (), {})()
        fake.diffusion_model = decoder
        fake.get_dtype = lambda: torch.float32
        model = type("Wrapped", (), {})()
        model.model = fake
        return model, captured

    def test_parse_smart_points_rejects_bad_shape(self):
        with self.assertRaises(ValueError):
            self.nodes._parse_smart_points("nope")
        with self.assertRaises(ValueError):
            self.nodes._parse_smart_points([{"x": "a", "y": 1}])
        with self.assertRaises(ValueError):
            self.nodes._parse_smart_points([1, 2])

    def test_clamp_smart_points_into_bounds(self):
        pts = self.nodes._clamp_smart_points([(-5, 200), (300, -2)], 100, 50)
        self.assertEqual(pts, [(0, 49), (99, 0)])

    def test_clamp_smart_points_empty_frame(self):
        self.assertEqual(self.nodes._clamp_smart_points([(1, 1)], 0, 0), [])

    def test_smart_mask_route_rejects_missing_fields(self):
        resp = _run(self.nodes.smart_mask(_FakeRequest({})))
        self.assertEqual(resp.kwargs["status"], 400)
        resp = _run(self.nodes.smart_mask(_FakeRequest({"source": "a.mp4"})))
        self.assertEqual(resp.kwargs["status"], 400)
        resp = _run(self.nodes.smart_mask(_FakeRequest({"source": "a.mp4", "ckpt_name": "x"})))
        self.assertEqual(resp.kwargs["status"], 400)
        resp = _run(self.nodes.smart_mask(_FakeRequest({"source": "a.mp4", "ckpt_name": "x", "positive": []})))
        self.assertEqual(resp.kwargs["status"], 400)

    def test_smart_mask_route_rejects_bad_json(self):
        resp = _run(self.nodes.smart_mask(_FakeRequest("not a dict")))
        self.assertEqual(resp.kwargs["status"], 400)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_smart_mask_route_rejects_an_empty_segmentation(self):
        (self.tmp / "input" / "clip.mp4").write_bytes(b"\x00\x00")
        (self.tmp / "models" / "checkpoints").mkdir(parents=True, exist_ok=True)
        (self.tmp / "models" / "checkpoints" / "sam.safetensors").write_bytes(b"\x00")
        import folder_paths as _fp
        original_full = getattr(_fp, "get_full_path", None)
        original_frame = self.nodes._mask_source_frame
        original_run = self.nodes._smart_mask_run

        def fake_full(key, name):
            return str(self.tmp / "models" / "checkpoints" / "sam.safetensors")

        _fp.get_full_path = fake_full
        self.nodes._mask_source_frame = lambda _path, _t: (torch.zeros((1, 40, 60, 3)), (60, 40))
        self.nodes._smart_mask_run = lambda *a, **k: torch.zeros((40, 60))
        self._stub_comfy_sd()
        try:
            resp = _run(self.nodes.smart_mask(_FakeRequest({
                "source": "clip.mp4", "ckpt_name": "sam.safetensors",
                "positive": [{"x": 30, "y": 20}], "negative": [],
            })))
        finally:
            if original_full is None:
                _fp.__dict__.pop("get_full_path", None)
            else:
                _fp.get_full_path = original_full
            self.nodes._mask_source_frame = original_frame
            self.nodes._smart_mask_run = original_run
        self.assertEqual(resp.kwargs["status"], 422)
        self.assertIn("did not find an object", resp.kwargs["data"]["error"])

    @unittest.skipUnless(_HAS_TORCH and _HAS_NUMPY, "torch/numpy not available")
    def test_smart_mask_route_rejects_a_mask_that_is_only_a_speck(self):
        (self.tmp / "input" / "clip.mp4").write_bytes(b"\x00\x00")
        (self.tmp / "models" / "checkpoints").mkdir(parents=True, exist_ok=True)
        (self.tmp / "models" / "checkpoints" / "sam.safetensors").write_bytes(b"\x00")
        import folder_paths as _fp
        original_full = getattr(_fp, "get_full_path", None)
        original_frame = self.nodes._mask_source_frame
        original_run = self.nodes._smart_mask_run

        def fake_full(key, name):
            return str(self.tmp / "models" / "checkpoints" / "sam.safetensors")

        _fp.get_full_path = fake_full
        self.nodes._mask_source_frame = lambda _path, _t: (torch.zeros((1, 40, 60, 3)), (60, 40))
        speck = torch.zeros((40, 60))
        speck[20, 30] = 1.0
        self.nodes._smart_mask_run = lambda *a, **k: speck
        self._stub_comfy_sd()
        try:
            resp = _run(self.nodes.smart_mask(_FakeRequest({
                "source": "clip.mp4", "ckpt_name": "sam.safetensors",
                "positive": [{"x": 30, "y": 20}], "negative": [],
            })))
        finally:
            if original_full is None:
                _fp.__dict__.pop("get_full_path", None)
            else:
                _fp.get_full_path = original_full
            self.nodes._mask_source_frame = original_frame
            self.nodes._smart_mask_run = original_run
        self.assertEqual(resp.kwargs["status"], 422)
        self.assertIn("did not find an object", resp.kwargs["data"]["error"])

    @unittest.skipUnless(_HAS_TORCH and _HAS_NUMPY, "torch/numpy not available")
    def test_despeckle_mask_keeps_the_object_and_drops_specks(self):
        m = torch.zeros((40, 60))
        m[10:30, 20:40] = 1.0
        m[5, 5] = 1.0
        m[35:38, 50:53] = 1.0
        out = self.nodes._despeckle_mask(m)
        self.assertEqual(float(out[5, 5]), 0.0, "a single stray pixel must be removed")
        self.assertEqual(float(out[35, 50]), 0.0, "a tiny isolated blob must be removed")
        self.assertEqual(float(out[10, 20]), 1.0, "the main object must survive")
        self.assertEqual(float(out[29, 39]), 1.0, "the main object must keep its full area")
        self.assertEqual(float(out.sum().item()), 400, "only the 20x20 object should remain")

    @unittest.skipUnless(_HAS_TORCH and _HAS_NUMPY, "torch/numpy not available")
    def test_despeckle_mask_skips_empty_and_full_frame_masks(self):
        empty = torch.zeros((10, 10))
        self.assertIs(self.nodes._despeckle_mask(empty), empty, "an empty mask must pass through untouched")
        full = torch.ones((10, 10))
        self.assertIs(self.nodes._despeckle_mask(full), full, "a whole-scene mask must pass through untouched")

    def _stub_comfy_sd(self):
        import sys
        comfy = sys.modules.get("comfy")
        comfy.__path__ = []
        sd = sys.modules.get("comfy.sd") or types.ModuleType("comfy.sd")
        sys.modules["comfy.sd"] = sd

        def load_checkpoint_guess_config(path, output_vae=True, output_clip=True, **kwargs):
            return type("Model", (), {})(), None, None, None

        sd.load_checkpoint_guess_config = load_checkpoint_guess_config
        comfy.sd = sd


class TestFrameMatchPlan(_NodesTestBase):
    def test_trim_to_shortest_caps_every_clip_to_the_shortest_window(self):
        plan = self.nodes._frame_match_plan(
            [{"frames": 120, "fps": 24}, {"frames": 240, "fps": 24}],
            mode="trim_to_shortest",
        )
        self.assertEqual(plan["out_frames"], 120)
        self.assertEqual(plan["fps"], 24.0)
        self.assertEqual([p["frame_load_cap"] for p in plan["clips"]], [120, 120])
        self.assertEqual([p["skip_first_frames"] for p in plan["clips"]], [0, 0])

    def test_pad_to_longest_loads_every_clip_fully(self):
        plan = self.nodes._frame_match_plan(
            [{"frames": 120, "fps": 24}, {"frames": 240, "fps": 24}],
            mode="pad_to_longest",
        )
        self.assertEqual(plan["out_frames"], 240)
        self.assertEqual([p["frame_load_cap"] for p in plan["clips"]], [120, 240])

    def test_normalizes_clip_fps_to_shared_timeline(self):
        plan = self.nodes._frame_match_plan(
            [{"frames": 120, "fps": 30}, {"frames": 96, "fps": 24}],
            mode="trim_to_shortest",
        )
        # 120 frames at 30 fps is 4s -> 96 frames at 24 fps.
        self.assertEqual(plan["out_frames"], 96)
        self.assertEqual([p["frame_load_cap"] for p in plan["clips"]], [96, 96])

    def test_per_clip_trim_start_skips_frames_and_end_limits_the_window(self):
        plan = self.nodes._frame_match_plan(
            [
                {"frames": 240, "fps": 24, "trim_start": 1.0},
                {"frames": 240, "fps": 24, "trim_start": 0.0, "trim_end": 5.0},
            ],
            mode="per_clip",
        )
        a, b = plan["clips"]
        self.assertEqual(a["skip_first_frames"], 24)
        self.assertEqual(a["frame_load_cap"], 216)
        self.assertEqual(b["skip_first_frames"], 0)
        self.assertEqual(b["frame_load_cap"], 120)
        self.assertEqual(plan["out_frames"], 216, "shorter windows pad up to the longest")

    def test_trim_start_clamps_to_at_least_one_frame(self):
        plan = self.nodes._frame_match_plan(
            [{"frames": 24, "fps": 24, "trim_start": 10.0}],
            mode="per_clip",
        )
        self.assertEqual(plan["clips"][0]["skip_first_frames"], 23)
        self.assertEqual(plan["clips"][0]["frame_load_cap"], 1)

    def test_zero_or_missing_frames_degrades_to_one(self):
        plan = self.nodes._frame_match_plan([{"frames": 0, "fps": 24}], mode="pad_to_longest")
        self.assertEqual(plan["clips"][0]["frame_load_cap"], 1)

    def test_unknown_mode_falls_back_to_shortest(self):
        plan = self.nodes._frame_match_plan(
            [{"frames": 120, "fps": 24}, {"frames": 240, "fps": 24}],
            mode="bogus",
        )
        self.assertEqual(plan["out_frames"], 120)

    def test_requires_at_least_one_clip(self):
        with self.assertRaises(ValueError):
            self.nodes._frame_match_plan([], "trim_to_shortest")


class TestStitchGeometry(_NodesTestBase):
    def test_fit_cell_contain_centers_and_never_crops(self):
        self.assertEqual(self.nodes._fit_cell(1920, 1080, 960, 540), (960, 540, 0, 0))
        self.assertEqual(self.nodes._fit_cell(640, 360, 1920, 1080), (1920, 1080, 0, 0))
        self.assertEqual(self.nodes._fit_cell(400, 800, 800, 800), (400, 800, 200, 0))

    def test_fit_cell_rejects_degenerate_cells(self):
        self.assertEqual(self.nodes._fit_cell(0, 100, 800, 800), (1, 1, 0, 0))
        self.assertEqual(self.nodes._fit_cell(100, 100, 0, 800), (1, 1, 0, 0))

    def test_grid_auto_columns_use_ceil_sqrt(self):
        geom = self.nodes._stitch_grid([(640, 360), (1920, 1080)], padding=8)
        self.assertEqual(geom["columns"], 2)
        self.assertEqual(geom["rows"], 1)
        self.assertEqual(geom["cell_w"], 1920)
        self.assertEqual(geom["cell_h"], 1080)
        self.assertEqual(geom["canvas_w"], 2 * 1920 + 8 * 3)
        self.assertEqual(geom["canvas_h"], 1080 + 8 * 2)
        self.assertEqual(geom["cells"][0], {"x": 8, "y": 8, "w": 1920, "h": 1080})
        self.assertEqual(geom["cells"][1], {"x": 1936, "y": 8, "w": 1920, "h": 1080})

    def test_grid_explicit_columns_wrap_rows(self):
        geom = self.nodes._stitch_grid([(100, 100)] * 3, padding=4, columns=2)
        self.assertEqual(geom["columns"], 2)
        self.assertEqual(geom["rows"], 2)
        self.assertEqual(geom["cells"][2]["x"], 4)
        self.assertEqual(geom["cells"][2]["y"], 4 + 100 + 4)

    def test_grid_single_column_stacks_vertically(self):
        geom = self.nodes._stitch_grid([(100, 100)] * 3, padding=0, columns=1)
        self.assertEqual(geom["columns"], 1)
        self.assertEqual(geom["rows"], 3)
        self.assertEqual(geom["canvas_w"], 100)
        self.assertEqual(geom["canvas_h"], 300)

    def test_stitch_frame_count_uses_the_longest_clip(self):
        self.assertEqual(self.nodes._stitch_frame_count([120, 240, 7]), 240)
        self.assertEqual(self.nodes._stitch_frame_count([5]), 5)

    def test_hex_to_rgb_tuple_parses_and_defaults_black(self):
        self.assertEqual(self.nodes._hex_to_rgb_tuple("#ff0000"), (1.0, 0.0, 0.0))
        self.assertEqual(self.nodes._hex_to_rgb_tuple("00ff00"), (0.0, 1.0, 0.0))
        self.assertEqual(self.nodes._hex_to_rgb_tuple("abc"), (170 / 255.0, 187 / 255.0, 204 / 255.0))
        self.assertEqual(self.nodes._hex_to_rgb_tuple("nope"), (0.0, 0.0, 0.0))
        self.assertEqual(self.nodes._hex_to_rgb_tuple(""), (0.0, 0.0, 0.0))

    def test_clamp_int_bounds_and_defaults(self):
        self.assertEqual(self.nodes._clamp_int(5, 0, 10, 3), 5)
        self.assertEqual(self.nodes._clamp_int(-2, 0, 10, 3), 0)
        self.assertEqual(self.nodes._clamp_int(99, 0, 10, 3), 10)
        self.assertEqual(self.nodes._clamp_int("oops", 0, 10, 3), 3)


class TestBuildCompareWorkflow(_NodesTestBase):
    def _clips(self):
        return [
            {"input_name": "h3_cmp_a.mp4", "frames": 120, "fps": 24, "trim_start": 0, "trim_end": None},
            {"input_name": "h3_cmp_b.mp4", "frames": 240, "fps": 24, "trim_start": 0, "trim_end": None},
        ]

    def test_builds_loaders_stitch_and_combine(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {})
        self.assertEqual(set(wf.keys()), {"l1", "l2", "stitch", "combine"})
        self.assertEqual(wf["l1"]["class_type"], "VHS_LoadVideo")
        self.assertEqual(wf["stitch"]["class_type"], "H3StitchFrames")
        self.assertEqual(wf["combine"]["class_type"], "VHS_VideoCombine")

    def test_loaders_carry_the_frame_plan_and_force_rate(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {"frame_match": "pad_to_longest"})
        self.assertEqual(wf["l1"]["inputs"]["force_rate"], 24.0)
        self.assertEqual(wf["l1"]["inputs"]["frame_load_cap"], 120)
        self.assertEqual(wf["l2"]["inputs"]["frame_load_cap"], 240)
        self.assertEqual(wf["l1"]["inputs"]["skip_first_frames"], 0)
        self.assertEqual(wf["l1"]["inputs"]["select_every_nth"], 1)
        self.assertEqual(wf["l1"]["inputs"]["format"], "None")
        self.assertEqual(wf["l1"]["inputs"]["video"], "h3_cmp_a.mp4")

    def test_trim_to_shortest_matches_caps_to_shortest(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {"frame_match": "trim_to_shortest"})
        self.assertEqual(wf["l1"]["inputs"]["frame_load_cap"], 120)
        self.assertEqual(wf["l2"]["inputs"]["frame_load_cap"], 120)

    def test_stitch_wires_every_loaded_image(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {})
        self.assertEqual(wf["stitch"]["inputs"]["image_1"], ["l1", 0])
        self.assertEqual(wf["stitch"]["inputs"]["image_2"], ["l2", 0])
        four = self.nodes._build_compare_workflow(
            [{"input_name": "h3_cmp_%d.mp4" % i, "frames": 120, "fps": 24} for i in range(4)], {}
        )
        self.assertEqual(four["stitch"]["inputs"]["image_4"], ["l4", 0])

    def test_combine_uses_clip_1_audio_and_saves_to_compare_folder(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {})
        self.assertEqual(wf["combine"]["inputs"]["audio"], ["l1", 2])
        self.assertEqual(wf["combine"]["inputs"]["images"], ["stitch", 0])
        self.assertEqual(wf["combine"]["inputs"]["frame_rate"], 24.0)
        self.assertEqual(wf["combine"]["inputs"]["save_output"], True)
        self.assertEqual(wf["combine"]["inputs"]["filename_prefix"], "one-node-minimax-h3/compare/h3_compare")

    def test_options_flow_into_the_graph(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {
            "padding": 16, "columns": 1, "background": "#123456",
            "codec": "h265", "filename_prefix": "one-node-minimax-h3/compare/mine",
        })
        self.assertEqual(wf["stitch"]["inputs"]["padding"], 16)
        self.assertEqual(wf["stitch"]["inputs"]["columns"], 1)
        self.assertEqual(wf["stitch"]["inputs"]["background"], "#123456")
        self.assertEqual(wf["combine"]["inputs"]["format"], "video/h265-mp4")
        self.assertEqual(wf["combine"]["inputs"]["filename_prefix"], "one-node-minimax-h3/compare/mine")

    def test_unknown_codec_falls_back_to_h264(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {"codec": "bogus"})
        self.assertEqual(wf["combine"]["inputs"]["format"], "video/h264-mp4")

    def test_rejects_wrong_clip_counts(self):
        with self.assertRaisesRegex(ValueError, "2 to 4"):
            self.nodes._build_compare_workflow([self._clips()[0]], {})
        with self.assertRaisesRegex(ValueError, "2 to 4"):
            self.nodes._build_compare_workflow(self._clips() * 3, {})

    def test_rejects_clip_without_a_staged_name(self):
        with self.assertRaisesRegex(ValueError, "staged input file"):
            self.nodes._build_compare_workflow(
                [{"input_name": "", "frames": 120, "fps": 24}, {"input_name": "x.mp4", "frames": 120, "fps": 24}], {}
            )

    def test_every_link_target_resolves(self):
        wf = self.nodes._build_compare_workflow(self._clips(), {})
        ids = set(wf.keys())
        for node in wf.values():
            for value in node["inputs"].values():
                if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                    self.assertIn(value[0], ids)


class TestH3StitchFramesNode(_NodesTestBase):
    def test_input_schema_locks_1_to_4_image_inputs(self):
        types = self.nodes.H3StitchFrames.INPUT_TYPES()
        self.assertIn("image_1", types["required"])
        self.assertIn("image_2", types["optional"])
        self.assertIn("image_3", types["optional"])
        self.assertIn("image_4", types["optional"])
        self.assertNotIn("image_5", types["optional"])
        self.assertEqual(types["required"]["pad_frames"][0], ["freeze", "black"])
        self.assertEqual(types["required"]["background"][1]["default"], "#000000")

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_returns_single_input_passthrough(self):
        import torch
        img = torch.zeros((5, 8, 8, 3))
        out = self.nodes.H3StitchFrames().stitch(img, None, None, None, 8, "freeze", 0, "#000000")
        self.assertIs(out[0], img)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_freezes_short_clips_to_the_longest_frame_count(self):
        import torch
        red = torch.zeros((10, 8, 8, 3))
        red[..., 0] = 1.0
        blue = torch.zeros((4, 8, 8, 3))
        blue[..., 2] = 1.0
        out = self.nodes.H3StitchFrames().stitch(red, blue, None, None, 0, "freeze", 2, "#000000")
        canvas = out[0]
        self.assertEqual(canvas.shape, (10, 8, 16, 3))
        self.assertGreater(canvas[0, 0, 0, 0], 0.9, "left cell red at frame 0")
        self.assertGreater(canvas[0, 0, 8, 2], 0.9, "right cell blue at frame 0")
        self.assertGreater(canvas[9, 0, 0, 0], 0.9, "left cell keeps red when frozen")
        self.assertGreater(canvas[9, 0, 8, 2], 0.9, "right cell freezes blue after its last frame")

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_black_pad_short_clips_after_their_last_frame(self):
        import torch
        red = torch.zeros((10, 8, 8, 3))
        red[..., 0] = 1.0
        blue = torch.zeros((4, 8, 8, 3))
        blue[..., 2] = 1.0
        out = self.nodes.H3StitchFrames().stitch(red, blue, None, None, 0, "black", 2, "#000000")
        canvas = out[0]
        self.assertEqual(canvas.shape, (10, 8, 16, 3))
        self.assertEqual(float(canvas[9, 0, 8, 2]), 0.0, "black pad has no blue")
        self.assertEqual(float(canvas[9, 0, 8, :].sum()), 0.0)

    @unittest.skipUnless(_HAS_TORCH, "torch not available")
    def test_background_color_fills_the_gutter(self):
        import torch
        red = torch.zeros((5, 8, 8, 3))
        red[..., 0] = 1.0
        blue = torch.zeros((5, 8, 8, 3))
        blue[..., 2] = 1.0
        out = self.nodes.H3StitchFrames().stitch(red, blue, None, None, 8, "freeze", 2, "#00ff00")
        canvas = out[0]
        self.assertEqual(canvas.shape, (5, 24, 40, 3), "2 cells of 8px plus 8px gutters")
        self.assertGreater(canvas[0, 0, 0, 1], 0.9, "gutter pixel is the background green")


class TestCompareWorkflowRoute(_NodesTestBase):
    def test_rejects_too_few_clips(self):
        resp = _run(self.nodes.compare_workflow(_FakeRequest({"clips": [{"filename": "a.mp4"}]})))
        self.assertEqual(resp.kwargs["status"], 400)
        self.assertIn("2 to 4", resp.kwargs["data"]["error"])

    def test_rejects_missing_files(self):
        resp = _run(self.nodes.compare_workflow(_FakeRequest({
            "clips": [{"filename": "ghost_a.mp4", "subfolder": ""}, {"filename": "ghost_b.mp4", "subfolder": ""}],
        })))
        self.assertEqual(resp.kwargs["status"], 404)

    def test_rejects_invalid_json(self):
        resp = _run(self.nodes.compare_workflow(_FakeRequest("nope")))
        self.assertEqual(resp.kwargs["status"], 400)

    def test_stages_and_builds_with_probed_frames(self):
        import folder_paths as _fp
        original_probe = self.nodes._probe_video_meta

        def fake_probe(_path):
            return 120, 24.0

        self.nodes._probe_video_meta = fake_probe
        out_root = Path(self.nodes._get_output_dir())
        sub = out_root / "one-node-minimax-h3"
        sub.mkdir(parents=True, exist_ok=True)
        (sub / "a.mp4").write_bytes(b"x")
        (sub / "b.mp4").write_bytes(b"x")
        try:
            resp = _run(self.nodes.compare_workflow(_FakeRequest({
                "clips": [
                    {"filename": "a.mp4", "subfolder": "one-node-minimax-h3", "type": "output"},
                    {"filename": "b.mp4", "subfolder": "one-node-minimax-h3", "type": "output"},
                ],
                "options": {"frame_match": "trim_to_shortest"},
            })))
        finally:
            self.nodes._probe_video_meta = original_probe
        data = resp.kwargs["data"]
        self.assertTrue(data["ok"])
        self.assertIn("wf", data)
        wf = data["wf"]
        self.assertEqual(wf["l1"]["inputs"]["frame_load_cap"], 120)
        input_dir = Path(_fp.get_input_directory())
        staged = data["clips"][0]["input_name"]
        self.assertTrue((input_dir / staged).is_file(), "the output must be staged into the input folder")


if __name__ == "__main__":
    unittest.main()
