import hashlib
import shutil
import urllib.request
import zipfile
from pathlib import Path

IGNORED_PARTS = {"__pycache__", ".git"}
TIMEOUT = 60
_progress = None


class FetchError(RuntimeError):
    pass


def use_progress(progress):
    global _progress
    _progress = progress


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, dest, sha256=None, report=print, label=None):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    label = label or url.rsplit("/", 1)[-1]
    with urllib.request.urlopen(url, timeout=TIMEOUT) as response, open(part, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        if _progress:
            _progress.start(label, total)
        else:
            report(f"  downloading {label}")
        for chunk in iter(lambda: response.read(1 << 16), b""):
            out.write(chunk)
            if _progress:
                _progress.advance(len(chunk))
        if _progress:
            _progress.finish()
    if sha256 and sha256_file(part) != sha256:
        part.unlink()
        raise FetchError(f"checksum mismatch for {url}")
    part.replace(dest)
    return dest


def extract_zip(archive, dest, strip_top=False):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(archive) as z:
        prefix = ""
        if strip_top:
            tops = {name.split("/", 1)[0] for name in z.namelist() if name.strip("/")}
            if len(tops) != 1:
                raise FetchError(f"{archive} does not have a single top folder")
            prefix = tops.pop() + "/"
        for info in z.infolist():
            name = info.filename
            if prefix:
                if not name.startswith(prefix):
                    continue
                name = name[len(prefix):]
            if not name:
                continue
            target = (dest / name).resolve()
            if target != root and root not in target.parents:
                raise FetchError(f"unsafe path in archive: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)
    return dest


def fetch_source(source, dest, workdir, report=print):
    label = f"{source.repo.split('/', 1)[1]} @ {source.commit[:7]}"
    archive = download(source.archive_url, Path(workdir) / f"{source.commit}.zip", report=report, label=label)
    try:
        extract_zip(archive, dest, strip_top=True)
    finally:
        archive.unlink()
    return Path(dest)


def _tracked_paths(folder):
    folder = Path(folder)
    for path in folder.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(folder)
        if any(part in IGNORED_PARTS for part in rel.parts) or path.suffix == ".pyc":
            continue
        yield rel.as_posix(), path


def file_digests(folder):
    return {rel: sha256_file(path) for rel, path in _tracked_paths(folder)}


def changed_files(folder, recorded):
    folder = Path(folder)
    changed = []
    for rel, digest in recorded.items():
        path = folder / rel
        if not path.is_file() or sha256_file(path) != digest:
            changed.append(rel)
    return sorted(changed)


def untracked_files(folder, recorded):
    return sorted(rel for rel, _ in _tracked_paths(folder) if rel not in recorded)
