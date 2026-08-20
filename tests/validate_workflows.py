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
    "mask.json",
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
    if name == "mask.json":
        required = {
            "H3MaskVideoPrepare",
            "Video Slice",
            "SAM3_VideoTrack",
            "SAM3_TrackToMask",
            "MVEx_MaskCleanup",
            "MVEx_SubjectCrop",
            "MVEx_MaskToLatentSpace",
            "MVEx_LatentMaskToMask",
            "MVEx_SubjectUncrop",
        }
        class_types = {node["class_type"] for node in data.values()}
        missing = required - class_types
        if missing:
            raise ValueError(f"{name}: missing masking nodes {sorted(missing)}")
        if data["23"]["inputs"].get("method.shrink") != 12:
            raise ValueError(f"{name}: cleanup dynamic inputs are not flattened")
        if data["24"]["inputs"].get("mode.crop_scale") != 1.5:
            raise ValueError(f"{name}: crop dynamic inputs are not flattened")
        if data["24"]["inputs"].get("mode.aspect_ratio") != 0:
            raise ValueError(f"{name}: crop must follow the tracked mask's shape, not a fixed canvas")
        if data["24"]["inputs"].get("upscale_megapixels", 0) >= 0:
            raise ValueError(f"{name}: crop budget must scale both directions so any mask shape stays H3-safe")
        if not 0 < data["24"]["inputs"].get("divisible_by", 0) <= 32:
            raise ValueError(f"{name}: crop must stay on the 32px model grid")
        if data["27"]["inputs"].get("vae") != ["3", 0]:
            raise ValueError(f"{name}: latent mask must inspect the H3 video VAE")
        if data["27"]["inputs"].get("grow_spatial", 0) > 16:
            raise ValueError(f"{name}: latent mask growth must stay tight so the paste hugs the tracked object")
        if data["27"]["inputs"].get("grow_temporal") != 1:
            raise ValueError(f"{name}: latent mask must not inflate the tracked region across frames")
        if data["33"]["inputs"].get("cropped_masks") != ["39", 0]:
            raise ValueError(f"{name}: uncrop must paste the grown latent-region mask")
        if data["6"]["inputs"].get("length") != ["18", 4]:
            raise ValueError(f"{name}: conditioning length must follow prepared source frames")
        if data["6"]["inputs"].get("ref_audios.ref_audio_0") != ["18", 1]:
            raise ValueError(f"{name}: conditioning must receive the preserved source speech as an audio reference")
        if data["29"]["inputs"].get("audio") != ["18", 1]:
            raise ValueError(f"{name}: H3 audio VAE must receive normalized stereo audio")
        if data["14"]["inputs"].get("audio") != ["18", 2]:
            raise ValueError(f"{name}: preserved output must use the source audio track")
        if data["21"]["inputs"].get("max_objects") != 1 or data["22"]["inputs"].get("object_indices") != "0":
            raise ValueError(f"{name}: default mask tracking must select one object")
        if data["17"]["inputs"].get("video") != ["34", 0]:
            raise ValueError(f"{name}: source components must decode the sliced video")
        if data["34"]["inputs"].get("duration") != data["18"]["inputs"].get("max_seconds"):
            raise ValueError(f"{name}: video slice and H3 preparation durations must match")
        if data["14"]["inputs"].get("bit_depth") != ["17", 3]:
            raise ValueError(f"{name}: output must preserve the source video bit depth")
        latent_links = {
            ("25", "image"): ["24", 0],
            ("26", "pixels"): ["24", 0],
            ("27", "masks"): ["24", 1],
            ("39", "mask"): ["27", 0],
            ("28", "samples"): ["26", 0],
            ("28", "mask"): ["27", 0],
            ("29", "audio"): ["18", 1],
            ("31", "samples"): ["29", 0],
            ("31", "mask"): ["30", 0],
            ("32", "video_latent"): ["28", 0],
            ("32", "audio_latent"): ["31", 0],
            ("11", "latent_image"): ["32", 0],
            ("12", "samples"): ["11", 0],
            ("13", "samples"): ["11", 0],
            ("33", "cropped_images"): ["12", 0],
        }
        for (node_id, input_name), expected in latent_links.items():
            if data[node_id]["inputs"].get(input_name) != expected:
                raise ValueError(f"{name}: node {node_id} {input_name} breaks the Mask latent path")
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
