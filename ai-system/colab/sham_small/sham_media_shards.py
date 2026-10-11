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
        recs = [json.loads(l) for l in Path(d, "out", "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
        assert n == 2 and all(Path(r["image"]).is_absolute() and Path(r["image"]).exists() for r in recs), recs
    print("sham_media_shards self-test OK")
