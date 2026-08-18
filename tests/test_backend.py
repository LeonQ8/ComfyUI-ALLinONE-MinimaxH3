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

    def test_empty_when_missing_dir(self):
        self.assertEqual(self.nodes._scan("nonexistent", [".safetensors"]), [])


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload
        self.match_info = {}

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


if __name__ == "__main__":
    unittest.main()
