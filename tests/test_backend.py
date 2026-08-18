"""Backend tests for One Node MiniMax H3 (nodes.py).

Loads nodes.py via importlib with stubbed ComfyUI modules so the suite runs
without a ComfyUI install. Each test isolates one pure helper used by the
backend (path safety, history, favorites, config, model scan).

Run from repo root: `python -m unittest discover -s tests -p 'test_*.py'`.
"""

import importlib.util
import json
import os
import shutil
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
