import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import apply, console, fetch, manifest, plan, state

WORKDIR = ".h3stack_work"
ROOT_FILES = ("Run-MiniMax-ALLinONE.bat", "README.txt")


def refresh_root_files(root):
    root = Path(root)
    for name in ROOT_FILES:
        source = root / "installer" / name
        if source.exists():
            shutil.copyfile(source, root / name)


def gpu_names(run=subprocess.run):
    try:
        out = run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def gpu_warning(m, names):
    if not names:
        return f"No NVIDIA GPU detected. This stack is tested on {m.supported_gpu} only."
    if not any(m.supported_gpu.lower() in name.lower() for name in names):
        return f"Detected {', '.join(names)}. This stack is tested on {m.supported_gpu} only and may not work."
    return None


def _modified_and_present(root, st):
    nodes_dir = Path(root) / "ComfyUI" / "custom_nodes"
    modified, present = {}, set()
    for folder, record in st["nodes"].items():
        path = nodes_dir / folder
        if path.is_dir():
            present.add(folder)
            modified[folder] = fetch.changed_files(path, record.get("files", {}))
    for node_dir in nodes_dir.iterdir() if nodes_dir.is_dir() else []:
        if node_dir.is_dir():
            present.add(node_dir.name)
    return modified, present


TITLES = {
    "python": "Set up Python {target}",
    "python_mismatch": "Python {target} required ({detail})",
    "comfyui": "Install ComfyUI @ {short}",
    "node_install": "Install {target} @ {short}",
    "node_update": "Update {target} to {short}",
    "node_remove": "Remove {target}",
    "node_skip_modified": "Keep your edited {target} ({detail})",
    "pip": "Install Python packages (PyTorch is the largest download)",
}


def describe(action):
    short = (action.detail if action.kind.startswith("node_") else action.target)[:7]
    return TITLES[action.kind].format(target=action.target, detail=action.detail, short=short)


def execute(root, m, force=False, dry_run=False, run=subprocess.run, fetch=fetch.fetch_source, report=print, when=None):
    root = Path(root)
    st = state.load(root)
    constraints_file = root / "installer" / "constraints.txt"
    constraints = constraints_file.read_text(encoding="utf-8") if constraints_file.exists() else ""
    modified, present = _modified_and_present(root, st)
    actions = plan.build(m, st, modified, present, force=force, constraints=constraints)
    if not actions:
        report(console.paint(f"Stack {m.stack_version} is up to date. Nothing to do.", "ok"))
        return 0
    report(console.paint(f"Stack {m.stack_version}: {len(actions)} step{'s' if len(actions) != 1 else ''}", "title"))
    for i, action in enumerate(actions, 1):
        report(console.paint(f"  {i:>2}. {describe(action)}", "dim"))
    mismatch = next((a for a in actions if a.kind == "python_mismatch"), None)
    if mismatch:
        report(console.paint(f"Python {mismatch.target} is required ({mismatch.detail}). Install into a new folder with install.bat.", "error"))
        return 2
    if dry_run:
        return 0
    when = when or time.strftime("%Y%m%d-%H%M%S")
    workdir = root / WORKDIR
    workdir.mkdir(exist_ok=True)
    began = time.monotonic()
    try:
        for i, action in enumerate(actions, 1):
            step_began = time.monotonic()
            report("")
            report(console.paint(f"[{i}/{len(actions)}] {describe(action)}", "step"))
            if action.kind == "python":
                apply.setup_python(root, m, workdir, run=run, report=report)
                st["python"] = m.python_version
            elif action.kind == "comfyui":
                apply.install_comfyui(root, m.comfyui, workdir, when, fetch=fetch, report=report)
                st["comfyui"] = m.comfyui.commit
            elif action.kind in ("node_install", "node_update"):
                node = m.node(action.target)
                recorded = st["nodes"].get(node.folder, {}).get("files", {})
                files = apply.replace_node(root, node, recorded, workdir, when, fetch=fetch, report=report)
                st["nodes"][node.folder] = {"commit": node.source.commit, "files": files}
            elif action.kind == "node_remove":
                apply.remove_node(root, action.target, when)
                st["nodes"].pop(action.target, None)
            elif action.kind == "node_skip_modified":
                report(console.paint(f"  Kept your edited copy of {action.target}. Run update.bat with --force to replace it.", "warn"))
            elif action.kind == "pip":
                apply.run_pip(root, m, workdir, run=run, report=report)
                installed = {n.folder: st["nodes"][n.folder]["commit"] for n in m.nodes if n.folder in st["nodes"]}
                st["pip_fingerprint"] = plan.pip_fingerprint(m, constraints, installed)
            state.save(root, st)
            report(console.paint(f"  Done in {console.duration(time.monotonic() - step_began)}", "ok"))
        st["stack_version"] = m.stack_version
        state.save(root, st)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(root / ".h3stack_staging", ignore_errors=True)
    report("")
    report(console.paint(f"Finished in {console.duration(time.monotonic() - began)}.", "ok"))
    if (root / "backups" / when).exists():
        report(f"Replaced code is in backups\\{when}.")
    return 0


def _swap_installer(root, incoming, report):
    target = root / "installer"
    fresh = root / "installer.new"
    shutil.rmtree(fresh, ignore_errors=True)
    shutil.copytree(incoming, fresh, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    backup = root / "backups" / time.strftime("%Y%m%d-%H%M%S") / "installer"
    backup.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.move(str(target), str(backup))
    shutil.move(str(fresh), str(target))


def self_update(root, ref, report=print, from_dir=None):
    root = Path(root)
    if from_dir is not None:
        incoming = Path(from_dir)
        manifest.load(incoming / "stack.json")
        _swap_installer(root, incoming, report)
        report(f"Installer updated from {incoming}.")
        return
    current = manifest.load(root / "installer" / "stack.json")
    workdir = root / WORKDIR
    workdir.mkdir(exist_ok=True)
    try:
        url = f"https://github.com/{current.installer_repo}/archive/{ref}.zip"
        archive = fetch.download(url, workdir / "installer_src.zip", report=report)
        source_root = fetch.extract_zip(archive, workdir / "installer_src", strip_top=True)
        incoming = source_root / "installer"
        manifest.load(incoming / "stack.json")
        _swap_installer(root, incoming, report)
        report(f"Installer updated from {current.installer_repo}@{ref}.")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="h3stack")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("install", "update"):
        p = sub.add_parser(name)
        p.add_argument("--root", required=True)
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--force", action="store_true")
    s = sub.add_parser("self-update")
    s.add_argument("--root", required=True)
    s.add_argument("--ref", default="main")
    s.add_argument("--from-dir")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(line_buffering=True)
    console.enable_colors()
    fetch.use_progress(console.Progress())
    try:
        if args.cmd == "self-update":
            self_update(args.root, args.ref, from_dir=args.from_dir)
            return 0
        m = manifest.load(Path(args.root) / "installer" / "stack.json")
        if args.cmd == "install":
            names = gpu_names()
            warning = gpu_warning(m, names)
            if warning:
                print(console.paint(f"WARNING: {warning}", "warn"))
            else:
                print(f"GPU: {', '.join(names)}")
        code = execute(args.root, m, force=args.force, dry_run=args.dry_run)
        if not args.dry_run:
            refresh_root_files(args.root)
        return code
    except subprocess.CalledProcessError as error:
        print(console.paint(f"ERROR: {Path(error.cmd[0]).name} exited with code {error.returncode}. See the messages above.", "error"))
        return 1
    except (manifest.ManifestError, fetch.FetchError, OSError) as error:
        print(console.paint(f"ERROR: {error}", "error"))
        return 1


if __name__ == "__main__":
    sys.exit(main())
