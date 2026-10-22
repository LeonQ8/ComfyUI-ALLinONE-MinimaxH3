import json
import re
from dataclasses import dataclass
from pathlib import Path

SCHEMA = 1
PHASES = ("before", "after")
_SHA1 = re.compile(r"^[0-9a-f]{40}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_FOLDER = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class Source:
    repo: str
    commit: str

    @property
    def archive_url(self):
        return f"https://github.com/{self.repo}/archive/{self.commit}.zip"


@dataclass(frozen=True)
class Download:
    url: str
    sha256: str


@dataclass(frozen=True)
class Node:
    folder: str
    source: Source


@dataclass(frozen=True)
class PipStep:
    name: str
    phase: str
    args: tuple


@dataclass(frozen=True)
class Manifest:
    stack_version: str
    supported_gpu: str
    installer_repo: str
    python_version: str
    python: Download
    pip_wheel: Download
    include_libs: Download
    comfyui: Source
    nodes: tuple
    pip: tuple
    skip_requirements: tuple = ()

    def node(self, folder):
        return next((n for n in self.nodes if n.folder == folder), None)


def _req(data, key, where):
    if not isinstance(data, dict) or key not in data:
        raise ManifestError(f"{where}: missing '{key}'")
    return data[key]


def _source(data, where):
    repo = _req(data, "repo", where)
    commit = _req(data, "commit", where)
    if not isinstance(repo, str) or not _REPO.match(repo):
        raise ManifestError(f"{where}: bad repo '{repo}'")
    if not isinstance(commit, str) or not _SHA1.match(commit):
        raise ManifestError(f"{where}: commit must be a full 40 character sha")
    return Source(repo, commit)


def _download(data, where):
    url = _req(data, "url", where)
    digest = _req(data, "sha256", where)
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ManifestError(f"{where}: url must use https")
    if not isinstance(digest, str) or not _SHA256.match(digest):
        raise ManifestError(f"{where}: bad sha256")
    return Download(url, digest)


def _nodes(raw_nodes):
    nodes = []
    seen = set()
    for i, raw in enumerate(raw_nodes):
        where = f"nodes[{i}]"
        folder = _req(raw, "folder", where)
        if not isinstance(folder, str) or not _FOLDER.match(folder):
            raise ManifestError(f"{where}: bad folder '{folder}'")
        if folder.lower() in seen:
            raise ManifestError(f"{where}: duplicate folder '{folder}'")
        seen.add(folder.lower())
        nodes.append(Node(folder, _source(raw, where)))
    return tuple(nodes)


def _pip(raw_steps):
    steps = []
    for i, raw in enumerate(raw_steps):
        where = f"pip[{i}]"
        phase = _req(raw, "phase", where)
        args = _req(raw, "args", where)
        if phase not in PHASES:
            raise ManifestError(f"{where}: phase must be one of {PHASES}")
        if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
            raise ManifestError(f"{where}: args must be a non-empty list of strings")
        steps.append(PipStep(_req(raw, "name", where), phase, tuple(args)))
    return tuple(steps)


def parse(data):
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise ManifestError(f"unsupported schema {data.get('schema') if isinstance(data, dict) else None!r}")
    installer_repo = _req(data, "installer_repo", "manifest")
    if not isinstance(installer_repo, str) or not _REPO.match(installer_repo):
        raise ManifestError(f"manifest: bad installer_repo '{installer_repo}'")
    python = _req(data, "python", "manifest")
    skip = data.get("skip_requirements", [])
    if not isinstance(skip, list) or not all(isinstance(s, str) and s for s in skip):
        raise ManifestError("manifest: skip_requirements must be a list of package names")
    return Manifest(
        stack_version=_req(data, "stack_version", "manifest"),
        supported_gpu=_req(data, "supported_gpu", "manifest"),
        installer_repo=installer_repo,
        python_version=_req(python, "version", "python"),
        python=_download(python, "python"),
        pip_wheel=_download(_req(data, "pip_wheel", "manifest"), "pip_wheel"),
        include_libs=_download(_req(data, "include_libs", "manifest"), "include_libs"),
        comfyui=_source(_req(data, "comfyui", "manifest"), "comfyui"),
        nodes=_nodes(_req(data, "nodes", "manifest")),
        pip=_pip(_req(data, "pip", "manifest")),
        skip_requirements=tuple(skip),
    )


def load(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestError(f"cannot read {path}: {error}") from error
    return parse(data)
