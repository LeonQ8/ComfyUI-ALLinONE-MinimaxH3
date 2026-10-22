import argparse
import io
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from h3stack import manifest

IGNORED_PARTS = {"__pycache__", ".git"}


def constraint_lines(freeze_text):
    lines = []
    for raw in freeze_text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("-", "#")) or " @ " in line or "==" not in line:
            continue
        lines.append(line)
    return sorted(lines, key=str.lower)


def _normalize(data):
    return data.replace(b"\r\n", b"\n")


def _local_files(root):
    files = {}
    for path in Path(root).rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in IGNORED_PARTS for part in rel.parts) or path.suffix == ".pyc":
            continue
        files[rel.as_posix()] = path.read_bytes()
    return files


def compare_trees(archive_files, local_root):
    local = _local_files(local_root)
    shared = archive_files.keys() & local.keys()
    return {
        "differ": sorted(p for p in shared if _normalize(archive_files[p]) != _normalize(local[p])),
        "only_local": sorted(local.keys() - archive_files.keys()),
        "only_archive": sorted(archive_files.keys() - local.keys()),
    }


def archive_files(source):
    data = urllib.request.urlopen(source.archive_url).read()
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            rel = info.filename.split("/", 1)[1] if "/" in info.filename else ""
            if rel:
                files[rel] = z.read(info)
    return files


def cmd_constraints(args):
    freeze = subprocess.run([args.python, "-I", "-m", "pip", "freeze"], check=True, capture_output=True, text=True).stdout
    lines = constraint_lines(freeze)
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(lines)} pins to {args.out}")


def _local_folder(nodes_dir, folder, aliases):
    name = aliases.get(folder, folder)
    for child in Path(nodes_dir).iterdir():
        if child.is_dir() and child.name.lower() == name.lower():
            return child
    return None


def cmd_verify(args):
    m = manifest.load(args.stack)
    aliases = dict(item.split("=", 1) for item in args.alias)
    ok = True
    for node in m.nodes:
        local = _local_folder(args.nodes_dir, node.folder, aliases)
        if local is None:
            print(f"MISSING  {node.folder}")
            ok = False
            continue
        result = compare_trees(archive_files(node.source), local)
        status = "OK" if not result["differ"] else "DIFFERS"
        ok = ok and not result["differ"]
        print(f"{status:8} {node.folder} @ {node.source.commit[:7]}  differ={len(result['differ'])} only_local={len(result['only_local'])} only_archive={len(result['only_archive'])}")
        for rel in result["differ"][:10]:
            print(f"           ~ {rel}")
    return 0 if ok else 1


def main(argv=None):
    parser = argparse.ArgumentParser(prog="snapshot")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("constraints")
    c.add_argument("--python", required=True)
    c.add_argument("--out", default=str(HERE.parent / "constraints.txt"))
    v = sub.add_parser("verify")
    v.add_argument("--nodes-dir", required=True)
    v.add_argument("--stack", default=str(HERE.parent / "stack.json"))
    v.add_argument("--alias", action="append", default=[])
    args = parser.parse_args(argv)
    if args.cmd == "constraints":
        cmd_constraints(args)
        return 0
    return cmd_verify(args)


if __name__ == "__main__":
    sys.exit(main())
