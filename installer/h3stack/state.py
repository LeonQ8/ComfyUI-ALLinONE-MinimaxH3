import json
from pathlib import Path

STATE_FILE = "h3stack_state.json"


def empty():
    return {"stack_version": None, "python": None, "comfyui": None, "nodes": {}, "pip_fingerprint": None}


def load(root):
    path = Path(root) / STATE_FILE
    if not path.exists():
        return empty()
    data = empty()
    data.update(json.loads(path.read_text(encoding="utf-8")))
    return data


def save(root, data):
    path = Path(root) / STATE_FILE
    tmp = path.with_name(STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)
