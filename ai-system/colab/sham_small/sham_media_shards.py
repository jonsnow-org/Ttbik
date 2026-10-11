"""
Consumer side of the media factory (ai-system/lightning/media_factory.py): the Kaggle tokenizer notebooks call this instead of collecting.

    batches = list_batches("image")                         # every `sham-media-image-<stamp>` dataset of the account, oldest first
    manifest, taken = next_batches("image", consumed, max_batches=4, work="/kaggle/working/corpus/images")
        -> one merged manifest.jsonl (the same record format collect() writes) over the batches not yet consumed, plus their names;
           the notebook records `taken` in its progress file so a later run starts at the next batch.

A manifest line points at files relative to its own folder, so each record gets a `_root` made absolute here and the merged manifest is
written next to the first batch. Nothing is downloaded twice (sham_inputs.fetch_dataset caches). Offline self-test: python sham_media_shards.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def _user() -> str | None:
    from sham_inputs import _ensure_credentials
    return _ensure_credentials()


def list_batches(kind: str) -> list[str]:
    user = _user()
    if not user:
        return []
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    prefix = f"sham-media-{kind}-"
    names: list[str] = []
    for page in range(1, 11):
        r = subprocess.run(["kaggle", "datasets", "list", "-m", "-s", prefix, "--csv", "-p", str(page)], capture_output=True, text=True)
        rows = [l.split(",", 1)[0] for l in (r.stdout or "").splitlines()[1:] if "/" in l.split(",", 1)[0]]
        if not rows:
            break
        names += [ref.split("/", 1)[1] for ref in rows if ref.split("/", 1)[0] == user]
    return sorted({n for n in names if n.startswith(prefix)})


def merge_manifests(roots: list[Path], out_manifest: Path) -> int:
    """Writes one manifest whose paths are absolute; returns the number of records."""
    n = 0
    out_manifest.parent.mkdir(parents=True, exist_ok=True)
    with open(out_manifest, "w", encoding="utf-8") as out:
        for root in roots:
            for mf in sorted(root.rglob("manifest.jsonl")):
                for line in mf.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    rec = json.loads(line)
                    for key in ("image", "audio"):
                        if isinstance(rec.get(key), str):
                            rec[key] = str((mf.parent / rec[key]).resolve())
                    if isinstance(rec.get("frames"), list):
                        rec["frames"] = [str((mf.parent / f).resolve()) for f in rec["frames"]]
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    n += 1
    return n


def merge_manifest_files(files: list[str | Path], out_manifest: str | Path) -> int:
    """One manifest over several manifests of different origins (the factory's batches AND the notebook's own direct collection):
    every relative path becomes absolute against its own manifest's folder. Returns the record count."""
    n = 0
    out = Path(out_manifest)
    out.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    with open(out, "w", encoding="utf-8") as fh:
        for mf in map(Path, files):
            if not mf.exists():
                continue
            for line in mf.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                rec = json.loads(line)
                for key in ("image", "audio"):
                    if isinstance(rec.get(key), str):
                        rec[key] = str((mf.parent / rec[key]).resolve())
                if isinstance(rec.get("frames"), list):
                    rec["frames"] = [str((mf.parent / f).resolve()) for f in rec["frames"]]
                sig = rec.get("image") or rec.get("audio") or line
                if sig in seen:
                    continue
                seen.add(sig)
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n += 1
    return n


def with_factory(kind: str, manifest: str | Path | None, work: str | Path, k: int = 1, limit: int | None = None, seed: int | None = None) -> str | None:
    """For consumers that do not track consumption (the LM stages): `manifest` (the stage's own direct collection, may be None) plus a random
    sample (<= limit records) of k random factory batches. Returns the merged manifest path, or `manifest` unchanged when the factory has no
    batch. Never raises: a stage must not stop because the factory is empty or a download failed."""
    import random

    from sham_inputs import fetch_dataset
    try:
        every = list_batches(kind)
        if not every:
            return str(manifest) if manifest else None
        rng = random.Random(seed if seed is not None else int(__import__("time").time()) // 3600)
        roots = [Path(r) for r in (fetch_dataset(n) for n in rng.sample(every, min(k, len(every)))) if r]
        if not roots:
            return str(manifest) if manifest else None
        tmp = Path(work) / "factory_all.jsonl"
        n = merge_manifests(roots, tmp)
        lines = tmp.read_text(encoding="utf-8").splitlines()
        if limit and len(lines) > limit:
            lines = rng.sample(lines, limit)
        sampled = Path(work) / "factory_sample.jsonl"
        sampled.write_text("\n".join(lines) + "\n", encoding="utf-8")
        files = ([manifest] if manifest else []) + [sampled]
        out = Path(work) / "merged" / "manifest.jsonl"
        total = merge_manifest_files(files, out)
        print(f"🏭 {kind}: {len(lines):,} عيّنة من المصنع (من {n:,}) + مصدر المرحلة المباشر = {total:,}")
        return str(out)
    except Exception as exc:
        print(f"⚠ تعذّر قراءة مصنع الوسائط ({type(exc).__name__}): {str(exc)[:100]} — يُكمل المصدر المباشر وحده")
        return str(manifest) if manifest else None


def next_batches(kind: str, consumed: set[str], max_batches: int, work: str | Path, reuse_last: int = 3) -> tuple[str | None, list[str]]:
    """The batches not consumed yet (oldest first, at most max_batches). When the factory has nothing new, the latest `reuse_last` batches are
    used for another pass, so a GPU session is never idle (a second epoch over fresh-enough data beats no training)."""
    from sham_inputs import fetch_dataset
    every = list_batches(kind)
    todo = [b for b in every if b not in consumed][:max_batches] or every[-reuse_last:]
    roots, taken = [], []
    for name in todo:
        root = fetch_dataset(name)
        if root:
            roots.append(Path(root))
            taken.append(name)
    if not roots:
        return None, []
    out = Path(work) / "manifest.jsonl"
    n = merge_manifests(roots, out)
    print(f"🏭 {len(taken)} دفعة من مصنع الوسائط ({kind}): {n:,} عيّنة")
    return (str(out) if n else None), taken


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d, "a"), Path(d, "b")
        for root, name in ((a, "x"), (b, "y")):
            (root / "images").mkdir(parents=True)
            (root / "images" / f"{name}.jpg").write_bytes(b"jpg")
            (root / "manifest.jsonl").write_text(json.dumps({"image": f"images/{name}.jpg", "caption": name}) + "\n", encoding="utf-8")
        n = merge_manifests([a, b], Path(d, "out", "manifest.jsonl"))
        m2 = merge_manifest_files([a / "manifest.jsonl", b / "manifest.jsonl", a / "manifest.jsonl"], Path(d, "out2", "manifest.jsonl"))
        assert m2 == 2, "the same file listed twice must not duplicate records"
        recs = [json.loads(l) for l in Path(d, "out", "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
        assert n == 2 and all(Path(r["image"]).is_absolute() and Path(r["image"]).exists() for r in recs), recs
    print("sham_media_shards self-test OK")
