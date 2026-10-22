import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Action:
    kind: str
    target: str
    detail: str = ""


def pip_fingerprint(m, constraints="", node_commits=None):
    if node_commits is None:
        node_commits = {n.folder: n.source.commit for n in m.nodes}
    payload = {
        "constraints": hashlib.sha256(constraints.encode()).hexdigest(),
        "comfyui": m.comfyui.commit,
        "nodes": sorted(node_commits.items()),
        "pip": [(s.name, s.phase, list(s.args)) for s in m.pip],
    }
    if m.skip_requirements:
        payload["skip"] = sorted(m.skip_requirements)
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def build(m, st, modified, present, force=False, constraints=""):
    actions = []
    if st["python"] is None:
        actions.append(Action("python", m.python_version))
    elif st["python"] != m.python_version:
        actions.append(Action("python_mismatch", m.python_version, f"installed {st['python']}"))
    if st["comfyui"] != m.comfyui.commit:
        actions.append(Action("comfyui", m.comfyui.commit))
    installed = st["nodes"]
    planned = {}
    for node in m.nodes:
        record = installed.get(node.folder)
        planned[node.folder] = node.source.commit
        if record is None or node.folder not in present:
            actions.append(Action("node_install", node.folder, node.source.commit))
        elif record["commit"] != node.source.commit:
            edits = modified.get(node.folder, [])
            if edits and not force:
                actions.append(Action("node_skip_modified", node.folder, ", ".join(edits[:5])))
                planned[node.folder] = record["commit"]
            else:
                actions.append(Action("node_update", node.folder, node.source.commit))
    wanted = {n.folder for n in m.nodes}
    for folder in installed:
        if folder in wanted or folder not in present:
            continue
        edits = modified.get(folder, [])
        if edits and not force:
            actions.append(Action("node_skip_modified", folder, ", ".join(edits[:5])))
        else:
            actions.append(Action("node_remove", folder))
    code_changed = any(a.kind in ("comfyui", "node_install", "node_update") for a in actions)
    if code_changed or st["pip_fingerprint"] != pip_fingerprint(m, constraints, planned):
        actions.append(Action("pip", "requirements"))
    return actions
