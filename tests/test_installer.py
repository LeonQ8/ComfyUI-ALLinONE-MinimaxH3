import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALLER = REPO_ROOT / "installer"
sys.path.insert(0, str(INSTALLER))
sys.path.insert(0, str(INSTALLER / "tools"))

import snapshot
from h3stack import apply, cli, console, fetch, manifest, plan, state

SHA1 = "a" * 40
SHA256 = "b" * 64


def sample_data():
    return {
        "schema": 1,
        "stack_version": "2026.10.22",
        "supported_gpu": "RTX 40",
        "installer_repo": "LeonQ8/ComfyUI-ALLinONE-MinimaxH3",
        "python": {"version": "3.12.10", "url": "https://example.com/py.zip", "sha256": SHA256},
        "pip_wheel": {"url": "https://example.com/pip-26.1-py3-none-any.whl", "sha256": SHA256},
        "include_libs": {"url": "https://example.com/libs.zip", "sha256": SHA256},
        "comfyui": {"repo": "comfyanonymous/ComfyUI", "commit": SHA1},
        "nodes": [
            {"folder": "NodeA", "repo": "owner/node-a", "commit": SHA1},
            {"folder": "NodeB", "repo": "owner/node-b", "commit": "c" * 40},
        ],
        "pip": [
            {"name": "torch", "phase": "before", "args": ["torch==2.9.1+cu130"]},
            {"name": "triton", "phase": "after", "args": ["triton-windows==3.5.1.post24"]},
        ],
    }


class ManifestTests(unittest.TestCase):
    def test_parses_valid_manifest(self):
        m = manifest.parse(sample_data())
        self.assertEqual(m.python_version, "3.12.10")
        self.assertEqual(m.comfyui.archive_url, f"https://github.com/comfyanonymous/ComfyUI/archive/{SHA1}.zip")
        self.assertEqual([n.folder for n in m.nodes], ["NodeA", "NodeB"])
        self.assertEqual(m.node("NodeB").source.repo, "owner/node-b")
        self.assertIsNone(m.node("Missing"))
        self.assertEqual(m.pip[0].phase, "before")

    def test_rejects_short_commit(self):
        data = sample_data()
        data["nodes"][0]["commit"] = "abc123"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_rejects_duplicate_folder_case_insensitive(self):
        data = sample_data()
        data["nodes"][1]["folder"] = "nodea"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_rejects_unsafe_folder(self):
        data = sample_data()
        data["nodes"][0]["folder"] = "../escape"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_rejects_plain_http_download(self):
        data = sample_data()
        data["python"]["url"] = "http://example.com/py.zip"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_rejects_unknown_pip_phase(self):
        data = sample_data()
        data["pip"][0]["phase"] = "middle"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_rejects_unknown_schema(self):
        data = sample_data()
        data["schema"] = 2
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_repo_stack_json_is_valid_and_complete(self):
        m = manifest.load(INSTALLER / "stack.json")
        folders = {n.folder for n in m.nodes}
        required = {
            "ComfyUI-ALLinONE-MinimaxH3", "ComfyUI-H3-Motion-Context-MultiRef", "ComfyUI-VideoHelperSuite",
            "ComfyUI-SeedVR2_VideoUpscaler", "Nvidia_RTX_Nodes_ComfyUI", "ComfyUI-MiniMax-H3-Turbo",
            "ComfyUI-KJNodes", "ComfyUI-MiniMax-H3-Studio", "MaskVidExperiments", "ComfyUI-PlagueKind-Nodes",
            "H3-Optimizations", "ComfyUI-Spectrum-MiniMax-H3", "comfyui-vrgamedevgirl",
        }
        self.assertEqual(folders, required)
        self.assertEqual(m.python_version, "3.12.10")
        self.assertEqual(m.comfyui.commit, "63be2f9b82ad0dac88a7ceaa28a9cf3154125a18")
        self.assertIn("llama-cpp-python", m.skip_requirements)

    def test_skip_requirements_is_optional_and_validated(self):
        self.assertEqual(manifest.parse(sample_data()).skip_requirements, ())
        data = sample_data()
        data["skip_requirements"] = "llama-cpp-python"
        with self.assertRaises(manifest.ManifestError):
            manifest.parse(data)

    def test_skip_list_change_triggers_pip(self):
        data = sample_data()
        before = plan.pip_fingerprint(manifest.parse(data))
        data["skip_requirements"] = ["llama-cpp-python"]
        self.assertNotEqual(before, plan.pip_fingerprint(manifest.parse(data)))

    def test_installer_is_excluded_from_registry_archive(self):
        lines = (REPO_ROOT / ".comfyignore").read_text(encoding="utf-8").splitlines()
        self.assertIn("installer", [line.strip() for line in lines])


class StackDocTests(unittest.TestCase):
    KEY_CONSTRAINTS = ("comfy-kitchen", "comfyui_frontend_package", "transformers", "diffusers")

    def setUp(self):
        self.m = manifest.load(INSTALLER / "stack.json")
        self.doc = (INSTALLER / "STACK.md").read_text(encoding="utf-8")
        self.lines = self.doc.splitlines()

    def test_every_node_pin_is_listed(self):
        for node in self.m.nodes:
            rows = [line for line in self.lines if line.startswith(f"| {node.folder} |")]
            self.assertEqual(len(rows), 1, node.folder)
            self.assertIn(f"`{node.source.commit[:7]}`", rows[0], node.folder)

    def test_core_pins_are_listed(self):
        self.assertIn(f"`{self.m.comfyui.commit[:7]}`", self.doc)
        self.assertIn(self.m.python_version, self.doc)
        self.assertIn(f"Stack version: **{self.m.stack_version}**", self.doc)
        self.assertIn(f"- **{self.m.stack_version}**:", self.doc)
        for step in self.m.pip:
            for arg in step.args:
                if "==" in arg:
                    self.assertIn(arg.split("==", 1)[1], self.doc, arg)

    def test_key_constraints_and_skips_are_listed(self):
        pins = dict(line.split("==", 1) for line in (INSTALLER / "constraints.txt").read_text(encoding="utf-8").split())
        for name in self.KEY_CONSTRAINTS:
            self.assertIn(pins[name], self.doc, name)
        for name in self.m.skip_requirements:
            self.assertIn(name, self.doc)


class SnapshotTests(unittest.TestCase):
    def test_constraint_lines_keep_only_pinned_names(self):
        freeze = "\n".join([
            "torch==2.9.1+cu130",
            "sageattention @ https://example.com/sage.whl",
            "-e git+https://example.com/x.git#egg=x",
            "Pillow==11.3.0",
            "",
            "comfy-kitchen==0.2.39",
        ])
        self.assertEqual(snapshot.constraint_lines(freeze), ["comfy-kitchen==0.2.39", "Pillow==11.3.0", "torch==2.9.1+cu130"])

    def test_compare_trees_ignores_line_endings_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp)
            (local / "same.py").write_bytes(b"a = 1\r\nb = 2\r\n")
            (local / "changed.py").write_bytes(b"x = 2\n")
            (local / "extra.txt").write_bytes(b"local only")
            (local / "__pycache__").mkdir()
            (local / "__pycache__" / "same.cpython-312.pyc").write_bytes(b"\0")
            archive = {"same.py": b"a = 1\nb = 2\n", "changed.py": b"x = 1\n", "tests/test_x.py": b"pass\n"}
            result = snapshot.compare_trees(archive, local)
        self.assertEqual(result["differ"], ["changed.py"])
        self.assertEqual(result["only_local"], ["extra.txt"])
        self.assertEqual(result["only_archive"], ["tests/test_x.py"])


def make_zip(path, entries):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return path


class FetchTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_download_verifies_checksum(self):
        src = self.tmp / "payload.bin"
        src.write_bytes(b"hello")
        good = fetch.sha256_file(src)
        out = fetch.download(src.as_uri(), self.tmp / "out" / "p.bin", good, report=lambda *_: None)
        self.assertEqual(out.read_bytes(), b"hello")
        with self.assertRaises(fetch.FetchError):
            fetch.download(src.as_uri(), self.tmp / "out" / "q.bin", "0" * 64, report=lambda *_: None)
        self.assertFalse((self.tmp / "out" / "q.bin").exists())
        self.assertFalse((self.tmp / "out" / "q.bin.part").exists())

    def test_download_reports_progress(self):
        src = self.tmp / "payload.bin"
        src.write_bytes(b"x" * 200000)
        events = []

        class Recorder:
            def start(self, label, total):
                events.append(("start", label, total))

            def advance(self, amount):
                events.append(("advance", amount))

            def finish(self):
                events.append(("finish",))

        fetch.use_progress(Recorder())
        try:
            fetch.download(src.as_uri(), self.tmp / "out.bin", label="Payload")
        finally:
            fetch.use_progress(None)
        self.assertEqual(events[0], ("start", "Payload", 200000))
        self.assertEqual(sum(e[1] for e in events if e[0] == "advance"), 200000)
        self.assertEqual(events[-1], ("finish",))

    def test_extract_strips_single_top_folder(self):
        archive = make_zip(self.tmp / "a.zip", {"repo-abc/": "", "repo-abc/x.py": "x", "repo-abc/sub/y.txt": "y"})
        dest = fetch.extract_zip(archive, self.tmp / "dest", strip_top=True)
        self.assertEqual((dest / "x.py").read_text(), "x")
        self.assertEqual((dest / "sub" / "y.txt").read_text(), "y")

    def test_extract_rejects_path_escape(self):
        archive = make_zip(self.tmp / "bad.zip", {"../evil.txt": "no"})
        with self.assertRaises(fetch.FetchError):
            fetch.extract_zip(archive, self.tmp / "dest")
        self.assertFalse((self.tmp / "evil.txt").exists())

    def test_digests_detect_changes_and_untracked_files(self):
        folder = self.tmp / "node"
        (folder / "pkg").mkdir(parents=True)
        (folder / "a.py").write_text("a")
        (folder / "pkg" / "b.py").write_text("b")
        recorded = fetch.file_digests(folder)
        self.assertEqual(sorted(recorded), ["a.py", "pkg/b.py"])
        self.assertEqual(fetch.changed_files(folder, recorded), [])
        (folder / "a.py").write_text("edited")
        (folder / "cache.json").write_text("{}")
        (folder / "__pycache__").mkdir()
        (folder / "__pycache__" / "a.cpython-312.pyc").write_bytes(b"\0")
        (folder / "pkg" / "b.py").unlink()
        self.assertEqual(fetch.changed_files(folder, recorded), ["a.py", "pkg/b.py"])
        self.assertEqual(fetch.untracked_files(folder, recorded), ["cache.json"])


class ConsoleTests(unittest.TestCase):
    def test_size_and_duration_formatting(self):
        self.assertEqual(console.size(5 * (1 << 20)), "5.0 MB")
        self.assertEqual(console.size(3 * (1 << 30)), "3.00 GB")
        self.assertEqual(console.duration(42), "42s")
        self.assertEqual(console.duration(125), "2m 05s")
        self.assertEqual(console.duration(3725), "1h 02m")

    def test_progress_text_with_known_total(self):
        name, bar, tail = console.progress_text("torch", 50 << 20, 100 << 20, 10, bar_width=10)
        self.assertEqual(name.strip(), "torch")
        self.assertEqual(bar, "#####-----")
        self.assertEqual(tail, "  50%  50.0 MB / 100.0 MB  5.0 MB/s  ETA 10s")

    def test_progress_text_without_total(self):
        _, bar, tail = console.progress_text("ComfyUI", 3 << 20, 0, 1)
        self.assertEqual(bar, "")
        self.assertEqual(tail, "  3.0 MB  3.0 MB/s")

    def test_progress_text_can_drop_speed_to_keep_eta(self):
        _, _, tail = console.progress_text("torch", 1 << 30, 2 << 30, 100, with_speed=False)
        self.assertEqual(tail, "  50%  1.00 GB / 2.00 GB  ETA 1m 40s")

    def test_progress_line_fits_a_narrow_console(self):
        class FakeConsole:
            def __init__(self):
                self.text = ""

            def isatty(self):
                return True

            def write(self, data):
                self.text += data

            def flush(self):
                pass

        stream = FakeConsole()
        bar = console.Progress(stream=stream, interval=0)
        bar.start("torch-2.9.1+cu130 wheel", 2900 << 20)
        bar.began -= 60
        bar.advance(1500 << 20)
        frames = [f.rstrip() for f in stream.text.split("\r") if f.strip()]
        self.assertTrue(frames[-1].endswith("ETA 56s"))
        self.assertLessEqual(max(len(f) for f in frames), 99)

    def test_plain_text_when_colors_are_off(self):
        self.assertEqual(console.paint("hello", "ok"), "hello")


class StateTests(unittest.TestCase):
    def test_round_trip_and_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(state.load(tmp), state.empty())
            data = state.empty()
            data["comfyui"] = SHA1
            state.save(tmp, data)
            self.assertEqual(state.load(tmp)["comfyui"], SHA1)
            self.assertFalse((Path(tmp) / (state.STATE_FILE + ".tmp")).exists())


def installed_state(m):
    st = state.empty()
    st["stack_version"] = m.stack_version
    st["python"] = m.python_version
    st["comfyui"] = m.comfyui.commit
    st["nodes"] = {n.folder: {"commit": n.source.commit, "files": {}} for n in m.nodes}
    st["pip_fingerprint"] = plan.pip_fingerprint(m)
    return st


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.m = manifest.parse(sample_data())
        self.all_present = {"NodeA", "NodeB"}

    def kinds(self, actions):
        return [(a.kind, a.target) for a in actions]

    def test_fresh_install_does_everything_in_order(self):
        actions = plan.build(self.m, state.empty(), {}, set())
        self.assertEqual(self.kinds(actions), [
            ("python", "3.12.10"), ("comfyui", SHA1),
            ("node_install", "NodeA"), ("node_install", "NodeB"), ("pip", "requirements"),
        ])

    def test_up_to_date_install_is_a_no_op(self):
        st = installed_state(self.m)
        self.assertEqual(plan.build(self.m, st, {}, self.all_present), [])

    def test_single_node_bump_updates_only_that_node_and_pip(self):
        st = installed_state(self.m)
        data = sample_data()
        data["nodes"][1]["commit"] = "d" * 40
        newer = manifest.parse(data)
        actions = plan.build(newer, st, {"NodeA": [], "NodeB": []}, self.all_present)
        self.assertEqual(self.kinds(actions), [("node_update", "NodeB"), ("pip", "requirements")])

    def test_locally_modified_node_is_skipped_unless_forced(self):
        st = installed_state(self.m)
        data = sample_data()
        data["nodes"][0]["commit"] = "e" * 40
        newer = manifest.parse(data)
        modified = {"NodeA": ["nodes.py"], "NodeB": []}
        actions = plan.build(newer, st, modified, self.all_present)
        self.assertEqual(self.kinds(actions), [("node_skip_modified", "NodeA")])
        self.assertIn("nodes.py", actions[0].detail)
        forced = plan.build(newer, st, modified, self.all_present, force=True)
        self.assertEqual(self.kinds(forced)[0], ("node_update", "NodeA"))

    def test_deleted_node_folder_is_reinstalled_with_its_requirements(self):
        st = installed_state(self.m)
        actions = plan.build(self.m, st, {}, {"NodeA"})
        self.assertEqual(self.kinds(actions), [("node_install", "NodeB"), ("pip", "requirements")])

    def test_node_dropped_from_manifest_is_removed(self):
        st = installed_state(self.m)
        st["nodes"]["OldNode"] = {"commit": SHA1, "files": {}}
        actions = plan.build(self.m, st, {"OldNode": []}, self.all_present | {"OldNode"})
        self.assertEqual(self.kinds(actions), [("node_remove", "OldNode")])

    def test_node_updated_but_pip_unfinished_reruns_pip(self):
        data = sample_data()
        data["nodes"][1]["commit"] = "d" * 40
        newer = manifest.parse(data)
        st = installed_state(self.m)
        st["nodes"]["NodeB"]["commit"] = "d" * 40
        self.assertEqual(self.kinds(plan.build(newer, st, {}, self.all_present)), [("pip", "requirements")])

    def test_python_version_change_needs_reinstall(self):
        st = installed_state(self.m)
        st["python"] = "3.12.9"
        actions = plan.build(self.m, st, {}, self.all_present)
        self.assertEqual(self.kinds(actions)[0], ("python_mismatch", "3.12.10"))

    def test_pip_step_change_triggers_only_pip(self):
        st = installed_state(self.m)
        data = sample_data()
        data["pip"][1]["args"] = ["triton-windows==3.5.1.post25"]
        actions = plan.build(manifest.parse(data), st, {}, self.all_present)
        self.assertEqual(self.kinds(actions), [("pip", "requirements")])


def fake_fetch(files_by_commit):
    def _fetch(source, dest, workdir, report=print):
        dest = Path(dest)
        for rel, text in files_by_commit[source.commit].items():
            path = dest / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return dest
    return _fetch


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.work = self.root / ".work"
        self.work.mkdir()
        self.quiet = lambda *_: None

    def tearDown(self):
        self._tmp.cleanup()

    def test_pth_matches_tested_launcher(self):
        self.assertEqual(
            apply.pth_text("3.12.10"),
            "../ComfyUI\npython312.zip\n.\nLib/site-packages\nLib\nScripts\n# import site\n",
        )

    def test_setup_python_unpacks_pip_and_headers(self):
        (self.root / "python_embeded").mkdir()
        zips = {
            "libs.zip": make_zip(self.work / "src_libs.zip", {"include/Python.h": "h", "libs/python312.lib": "lib"}),
            "pip-26.1-py3-none-any.whl": make_zip(self.work / "src_pip.whl", {"pip/__init__.py": "", "pip-26.1.dist-info/METADATA": "m"}),
        }
        m = manifest.parse(sample_data())
        original = apply.fetchmod.download
        apply.fetchmod.download = lambda url, dest, sha256=None, report=print, label=None: zips[url.rsplit("/", 1)[-1]]
        calls = []
        try:
            apply.setup_python(self.root, m, self.work, run=lambda cmd, check: calls.append(cmd), report=self.quiet)
        finally:
            apply.fetchmod.download = original
        py_dir = self.root / "python_embeded"
        self.assertEqual((py_dir / "python312._pth").read_text(), apply.pth_text("3.12.10"))
        self.assertTrue((py_dir / "libs" / "python312.lib").exists())
        self.assertTrue((py_dir / "Lib" / "site-packages" / "pip" / "__init__.py").exists())
        self.assertEqual(calls, [[str(apply.python_exe(self.root)), "-I", "-m", "pip", "--version"]])

    def test_comfyui_swap_keeps_user_data_and_backs_up_code(self):
        old = self.root / "ComfyUI"
        (old / "models" / "loras").mkdir(parents=True)
        (old / "models" / "loras" / "mine.safetensors").write_text("weights")
        (old / "output").mkdir()
        (old / "output" / "clip.mp4").write_text("video")
        (old / "custom_nodes" / "MyNode").mkdir(parents=True)
        (old / "extra_model_paths.yaml").write_text("mine: {}")
        (old / "main.py").write_text("old")
        new_files = {"main.py": "new", "models/vae/put_vae_here": "", "custom_nodes/example_node.py.example": "ex"}
        apply.install_comfyui(self.root, manifest.Source("comfyanonymous/ComfyUI", "f" * 40), self.work, "T1",
                              fetch=fake_fetch({"f" * 40: new_files}), report=self.quiet)
        cui = self.root / "ComfyUI"
        self.assertEqual((cui / "main.py").read_text(), "new")
        self.assertEqual((cui / "models" / "loras" / "mine.safetensors").read_text(), "weights")
        self.assertTrue((cui / "models" / "vae" / "put_vae_here").exists())
        self.assertEqual((cui / "output" / "clip.mp4").read_text(), "video")
        self.assertTrue((cui / "custom_nodes" / "MyNode").is_dir())
        self.assertEqual((cui / "extra_model_paths.yaml").read_text(), "mine: {}")
        self.assertEqual((self.root / "backups" / "T1" / "ComfyUI_code" / "main.py").read_text(), "old")
        self.assertFalse((self.root / "backups" / "T1" / "ComfyUI_code" / "output").exists())

    def test_replace_node_carries_untracked_files_and_backs_up(self):
        nodes = self.root / "ComfyUI" / "custom_nodes"
        old = nodes / "NodeA"
        old.mkdir(parents=True)
        (old / "nodes.py").write_text("v1")
        recorded = fetch.file_digests(old)
        (old / "settings.json").write_text("{\"mine\": 1}")
        node = manifest.Node("NodeA", manifest.Source("owner/node-a", "9" * 40))
        digests = apply.replace_node(self.root, node, recorded, self.work, "T2",
                                     fetch=fake_fetch({"9" * 40: {"nodes.py": "v2"}}), report=self.quiet)
        self.assertEqual((nodes / "NodeA" / "nodes.py").read_text(), "v2")
        self.assertEqual((nodes / "NodeA" / "settings.json").read_text(), "{\"mine\": 1}")
        self.assertEqual(sorted(digests), ["nodes.py"])
        self.assertEqual((self.root / "backups" / "T2" / "custom_nodes" / "NodeA" / "nodes.py").read_text(), "v1")

    def test_remove_node_moves_it_to_backup(self):
        folder = self.root / "ComfyUI" / "custom_nodes" / "OldNode"
        folder.mkdir(parents=True)
        (folder / "x.py").write_text("x")
        apply.remove_node(self.root, "OldNode", "T3")
        self.assertFalse(folder.exists())
        self.assertTrue((self.root / "backups" / "T3" / "custom_nodes" / "OldNode" / "x.py").exists())

    def test_filtered_requirements_drop_torch_family(self):
        src = self.root / "requirements.txt"
        src.write_text("torch\ntorchvision>=0.20\ntorchaudio ; sys_platform == 'win32'\ntorchsde\nnumpy>=1.25\n")
        out = apply.filtered_requirements(src, self.root / "f.txt").read_text().splitlines()
        self.assertEqual(out, ["torchsde", "numpy>=1.25"])

    def test_filtered_requirements_drop_skipped_names_in_any_spelling(self):
        src = self.root / "requirements.txt"
        src.write_text("llama_cpp_python>=0.3\nLlama.Cpp-Python\nllama-index\n")
        out = apply.filtered_requirements(src, self.root / "f.txt", ("llama-cpp-python",)).read_text().splitlines()
        self.assertEqual(out, ["llama-index"])

    def test_pip_commands_order_and_constraints(self):
        cui = self.root / "ComfyUI"
        (cui / "custom_nodes" / "NodeA").mkdir(parents=True)
        (cui / "requirements.txt").write_text("torch\nnumpy\n")
        (cui / "custom_nodes" / "NodeA" / "requirements.txt").write_text("gguf\n")
        m = manifest.parse(sample_data())
        cmds = apply.pip_commands(self.root, m, self.work)
        py = str(apply.python_exe(self.root))
        constraints = str(self.root / "installer" / "constraints.txt")
        self.assertEqual(cmds[0][:5], [py, "-I", "-m", "pip", "install"])
        self.assertIn("torch==2.9.1+cu130", cmds[0])
        self.assertNotIn("-c", cmds[0])
        self.assertEqual([c[c.index("-r") + 1] for c in cmds[1:3]], [str(self.work / "req_0.txt"), str(self.work / "req_1.txt")])
        self.assertTrue(all(c[-2:] == ["-c", constraints] for c in cmds[1:]))
        cache = str(self.root / "pip_cache")
        self.assertTrue(all(c[c.index("--cache-dir") + 1] == cache for c in cmds))
        self.assertIn("triton-windows==3.5.1.post24", cmds[-1])
        self.assertEqual(len(cmds), 4)
        labels = [label for label, _ in apply.pip_steps(self.root, m, self.work)]
        self.assertEqual(labels, ["torch", "ComfyUI requirements", "NodeA requirements", "triton"])


class CliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "python_embeded").mkdir()
        (self.root / "installer").mkdir()
        (self.root / "installer" / "constraints.txt").write_text("numpy==2.2.6\n")
        self.m = manifest.parse(sample_data())
        self.calls = []
        self.lines = []
        files = {SHA1: {"main.py": "x", "requirements.txt": "numpy\n"}, "c" * 40: {"b.py": "b"}}
        self.fetch = fake_fetch(files)

    def tearDown(self):
        self._tmp.cleanup()

    def run_cmd(self, cmd, check):
        self.calls.append(cmd)

    def test_gpu_warning(self):
        self.assertIsNone(cli.gpu_warning(self.m, ["NVIDIA GeForce RTX 4070 Ti SUPER"]))
        self.assertIn("RTX 40", cli.gpu_warning(self.m, ["NVIDIA GeForce RTX 3090"]))
        self.assertIn("No NVIDIA GPU", cli.gpu_warning(self.m, []))

    def test_dry_run_prints_plan_and_changes_nothing(self):
        state_data = state.empty()
        state_data["python"] = "3.12.10"
        state.save(self.root, state_data)
        code = cli.execute(self.root, self.m, dry_run=True, run=self.run_cmd, fetch=self.fetch, report=self.lines.append)
        self.assertEqual(code, 0)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "ComfyUI").exists())
        self.assertTrue(any("Install NodeA @ aaaaaaa" in line for line in self.lines))

    def test_execute_installs_then_second_run_is_no_op(self):
        state_data = state.empty()
        state_data["python"] = "3.12.10"
        state.save(self.root, state_data)
        code = cli.execute(self.root, self.m, run=self.run_cmd, fetch=self.fetch, report=self.lines.append, when="T")
        self.assertEqual(code, 0)
        self.assertTrue((self.root / "ComfyUI" / "custom_nodes" / "NodeB" / "b.py").exists())
        saved = state.load(self.root)
        self.assertEqual(saved["comfyui"], SHA1)
        self.assertEqual(saved["pip_fingerprint"], plan.pip_fingerprint(self.m, "numpy==2.2.6\n"))
        self.assertEqual(sorted(saved["nodes"]), ["NodeA", "NodeB"])
        self.assertTrue(self.calls)
        self.calls.clear()
        self.lines.clear()
        self.assertEqual(cli.execute(self.root, self.m, run=self.run_cmd, fetch=self.fetch, report=self.lines.append), 0)
        self.assertEqual(self.calls, [])
        self.assertTrue(any("up to date" in line for line in self.lines))
        self.assertFalse((self.root / ".h3stack_work").exists())

    def test_step_titles_are_readable(self):
        self.assertEqual(cli.describe(plan.Action("node_update", "NodeB", "d" * 40)), "Update NodeB to ddddddd")
        self.assertEqual(cli.describe(plan.Action("comfyui", SHA1)), "Install ComfyUI @ aaaaaaa")
        self.assertEqual(cli.describe(plan.Action("python", "3.12.10")), "Set up Python 3.12.10")

    def test_constraints_change_reruns_only_pip(self):
        state_data = state.empty()
        state_data["python"] = "3.12.10"
        state.save(self.root, state_data)
        cli.execute(self.root, self.m, run=self.run_cmd, fetch=self.fetch, report=self.lines.append, when="T")
        (self.root / "installer" / "constraints.txt").write_text("numpy==2.3.5\n")
        self.calls.clear()
        self.lines.clear()
        cli.execute(self.root, self.m, dry_run=True, run=self.run_cmd, fetch=self.fetch, report=self.lines.append)
        steps = [line for line in self.lines if line.strip()[:2].rstrip(".").isdigit()]
        self.assertEqual(len(steps), 1)
        self.assertIn("Install Python packages", steps[0])

    def test_refresh_root_files_copies_runner_and_readme(self):
        (self.root / "installer" / "Run-MiniMax-ALLinONE.bat").write_text("run")
        (self.root / "installer" / "README.txt").write_text("new")
        (self.root / "README.txt").write_text("old")
        cli.refresh_root_files(self.root)
        self.assertEqual((self.root / "Run-MiniMax-ALLinONE.bat").read_text(), "run")
        self.assertEqual((self.root / "README.txt").read_text(), "new")

    def test_python_mismatch_stops_before_changes(self):
        state_data = state.empty()
        state_data["python"] = "3.11.9"
        state.save(self.root, state_data)
        code = cli.execute(self.root, self.m, run=self.run_cmd, fetch=self.fetch, report=self.lines.append)
        self.assertEqual(code, 2)
        self.assertFalse((self.root / "ComfyUI").exists())

    def write_source(self, data):
        source = self.root / "source_installer"
        source.mkdir()
        (source / "stack.json").write_text(data, encoding="utf-8")
        (source / "constraints.txt").write_text("numpy==2.3.0\n")
        return source

    def test_self_update_from_local_folder_swaps_and_backs_up(self):
        (self.root / "installer" / "stack.json").write_text(json.dumps(sample_data()), encoding="utf-8")
        source = self.write_source(json.dumps(sample_data()))
        cli.self_update(self.root, "main", report=self.lines.append, from_dir=source)
        self.assertEqual((self.root / "installer" / "constraints.txt").read_text(), "numpy==2.3.0\n")
        backups = list((self.root / "backups").glob("*/installer"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "constraints.txt").read_text(), "numpy==2.2.6\n")
        self.assertFalse((self.root / "installer.new").exists())

    def test_self_update_from_invalid_folder_changes_nothing(self):
        source = self.write_source("{\"schema\": 1}")
        with self.assertRaises(manifest.ManifestError):
            cli.self_update(self.root, "main", report=self.lines.append, from_dir=source)
        self.assertEqual((self.root / "installer" / "constraints.txt").read_text(), "numpy==2.2.6\n")
        self.assertFalse((self.root / "backups").exists())
        self.assertFalse((self.root / "installer.new").exists())


if __name__ == "__main__":
    unittest.main()
