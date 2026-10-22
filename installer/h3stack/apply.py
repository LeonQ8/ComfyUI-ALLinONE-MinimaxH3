import re
import shutil
import subprocess
from pathlib import Path

from . import console
from . import fetch as fetchmod

PRESERVE = ("models", "input", "output", "user", "custom_nodes", "extra_model_paths.yaml")
TORCH_FAMILY = {"torch", "torchvision", "torchaudio"}
_NAME = re.compile(r"[<>=!~;\[\s@]")


def python_exe(root):
    return Path(root) / "python_embeded" / "python.exe"


def pip_cache(root):
    return Path(root) / "pip_cache"


def pth_text(version):
    major, minor = version.split(".")[:2]
    lines = ["../ComfyUI", f"python{major}{minor}.zip", ".", "Lib/site-packages", "Lib", "Scripts", "# import site"]
    return "\n".join(lines) + "\n"


def _backup(root, when, *parts):
    path = Path(root) / "backups" / when
    for part in parts[:-1]:
        path = path / part
    path.mkdir(parents=True, exist_ok=True)
    return path / parts[-1]


def _staging(root, name):
    path = Path(root) / ".h3stack_staging" / name
    if path.exists():
        shutil.rmtree(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _merge_move(old, new):
    if old.is_dir() and new.is_dir():
        for child in old.iterdir():
            target = new / child.name
            if target.is_dir() and not child.is_dir():
                shutil.rmtree(target)
            elif target.exists() and not target.is_dir():
                target.unlink()
            if child.is_dir() and target.is_dir():
                _merge_move(child, target)
            else:
                shutil.move(str(child), str(target))
        old.rmdir()
        return
    if new.is_dir():
        shutil.rmtree(new)
    elif new.exists():
        new.unlink()
    shutil.move(str(old), str(new))


def setup_python(root, m, workdir, run=subprocess.run, report=print):
    py_dir = Path(root) / "python_embeded"
    major, minor = m.python_version.split(".")[:2]
    (py_dir / f"python{major}{minor}._pth").write_text(pth_text(m.python_version), encoding="utf-8")
    libs = fetchmod.download(m.include_libs.url, Path(workdir) / "include_libs.zip", m.include_libs.sha256, report, label="Python headers for Triton")
    fetchmod.extract_zip(libs, py_dir)
    wheel_name = m.pip_wheel.url.rsplit("/", 1)[-1]
    wheel = fetchmod.download(m.pip_wheel.url, Path(workdir) / wheel_name, m.pip_wheel.sha256, report, label=wheel_name.split("-py3")[0])
    fetchmod.extract_zip(wheel, py_dir / "Lib" / "site-packages")
    run([str(python_exe(root)), "-I", "-m", "pip", "--version"], check=True)


def install_comfyui(root, source, workdir, when, fetch=fetchmod.fetch_source, report=print):
    root = Path(root)
    target = root / "ComfyUI"
    fresh = _staging(root, "ComfyUI")
    fetch(source, fresh, workdir, report=report)
    if target.exists():
        for name in PRESERVE:
            old = target / name
            if old.exists():
                _merge_move(old, fresh / name)
        shutil.move(str(target), str(_backup(root, when, "ComfyUI_code")))
    shutil.move(str(fresh), str(target))


def replace_node(root, node, recorded, workdir, when, fetch=fetchmod.fetch_source, report=print):
    nodes_dir = Path(root) / "ComfyUI" / "custom_nodes"
    nodes_dir.mkdir(parents=True, exist_ok=True)
    target = nodes_dir / node.folder
    fresh = _staging(root, node.folder)
    fetch(node.source, fresh, workdir, report=report)
    digests = fetchmod.file_digests(fresh)
    if target.exists():
        for rel in fetchmod.untracked_files(target, recorded):
            dest = fresh / rel
            if not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target / rel, dest)
        shutil.move(str(target), str(_backup(root, when, "custom_nodes", node.folder)))
    shutil.move(str(fresh), str(target))
    return digests


def remove_node(root, folder, when):
    target = Path(root) / "ComfyUI" / "custom_nodes" / folder
    if target.exists():
        shutil.move(str(target), str(_backup(root, when, "custom_nodes", folder)))


def _normalized(name):
    return re.sub(r"[-_.]+", "-", name.lower())


def filtered_requirements(src, dst, skip=()):
    skipped = {_normalized(n) for n in TORCH_FAMILY | set(skip)}
    keep = []
    for line in Path(src).read_text(encoding="utf-8", errors="ignore").splitlines():
        name = _normalized(_NAME.split(line.strip(), 1)[0])
        if name in skipped:
            continue
        keep.append(line)
    Path(dst).write_text("\n".join(keep) + "\n", encoding="utf-8")
    return Path(dst)


def _requirement_files(root, m):
    cui = Path(root) / "ComfyUI"
    files = [cui / "requirements.txt"] + [cui / "custom_nodes" / n.folder / "requirements.txt" for n in m.nodes]
    return [f for f in files if f.exists()]


def pip_steps(root, m, workdir):
    base = [str(python_exe(root)), "-I", "-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check",
            "--cache-dir", str(pip_cache(root))]
    constraints = ["-c", str(Path(root) / "installer" / "constraints.txt")]
    steps = [(step.name, base + list(step.args)) for step in m.pip if step.phase == "before"]
    for i, req in enumerate(_requirement_files(root, m)):
        filtered = filtered_requirements(req, Path(workdir) / f"req_{i}.txt", m.skip_requirements)
        steps.append((f"{req.parent.name} requirements", base + ["-r", str(filtered)] + constraints))
    steps += [(step.name, base + list(step.args) + constraints) for step in m.pip if step.phase == "after"]
    return steps


def pip_commands(root, m, workdir):
    return [cmd for _, cmd in pip_steps(root, m, workdir)]


def run_pip(root, m, workdir, run=subprocess.run, report=print):
    steps = pip_steps(root, m, workdir)
    for i, (label, cmd) in enumerate(steps, 1):
        report(console.paint(f"  Packages {i}/{len(steps)}: {label}", "step"))
        run(cmd, check=True)
