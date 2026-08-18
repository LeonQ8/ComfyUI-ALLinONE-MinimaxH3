"""Validate every workflow JSON template before queue.

Fails fast if:
 - any file in workflows/*.json is missing from the expected set,
 - any file has a node without class_type or inputs,
 - any link target (string node id, int index) is not a real node in the
   same workflow (or in PLACEHOLDERS for chain_section, which uses synthetic
   ids injected by the JS at build time).

Run from repo root: `python tests/validate_workflows.py`. Exits 0 on success,
prints a one-line summary to stdout. Designed to run in <1 s with no deps.
"""

import json
import sys
from pathlib import Path

EXPECTED = {
    "audio_drive.json",
    "chain_section.json",
    "i2v.json",
    "image.json",
    "keyframes.json",
    "r2v.json",
    "t2v.json",
    "upscale.json",
    "upscale_rtx.json",
    "video_extend.json",
}

PLACEHOLDERS = {
    "chain_section.json": {"sec:previmg", "sec:ctxlat"},
}


def validate(name, data):
    if not isinstance(data, dict) or not data:
        raise ValueError(f"{name}: workflow is not a non-empty object")
    ids = set(data.keys())
    node_count = 0
    link_count = 0
    for node_id, node in data.items():
        if not isinstance(node, dict):
            raise ValueError(f"{name}: node {node_id!r} is not an object")
        if "class_type" not in node:
            raise ValueError(f"{name}: node {node_id!r} missing class_type")
        ct = node["class_type"]
        if not isinstance(ct, str) or not ct.strip():
            raise ValueError(f"{name}: node {node_id!r} has empty class_type")
        if "inputs" not in node or not isinstance(node["inputs"], dict):
            raise ValueError(f"{name}: node {node_id!r} missing inputs dict")
        for input_name, value in node["inputs"].items():
            if isinstance(value, list) and len(value) == 2:
                src_id, _src_idx = value
                if isinstance(src_id, str):
                    link_count += 1
                    placeholders = PLACEHOLDERS.get(name, set())
                    if src_id not in ids and src_id not in placeholders:
                        raise ValueError(
                            f"{name}: node {node_id} input {input_name!r} "
                            f"links to unknown source {src_id!r}"
                        )
        node_count += 1
    if node_count == 0:
        raise ValueError(f"{name}: has zero nodes")
    return node_count, link_count


def main():
    repo = Path(__file__).resolve().parent.parent
    wf_dir = repo / "workflows"
    if not wf_dir.is_dir():
        print(f"workflows dir not found: {wf_dir}", file=sys.stderr)
        return 2

    files = sorted(p.name for p in wf_dir.glob("*.json"))
    actual = set(files)
    if actual != EXPECTED:
        missing = EXPECTED - actual
        extra = actual - EXPECTED
        if missing:
            print(f"missing workflows: {sorted(missing)}", file=sys.stderr)
        if extra:
            print(f"unexpected workflows: {sorted(extra)}", file=sys.stderr)
        return 2

    total_nodes = 0
    total_links = 0
    for fname in files:
        path = wf_dir / fname
        try:
            text = path.read_text(encoding="utf-8-sig")
            data = json.loads(text)
        except json.JSONDecodeError as e:
            print(f"{fname}: invalid JSON ({e})", file=sys.stderr)
            return 2
        try:
            nodes, links = validate(fname, data)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        total_nodes += nodes
        total_links += links

    print(
        f"OK {len(files)} workflows, {total_nodes} nodes, {total_links} links"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
