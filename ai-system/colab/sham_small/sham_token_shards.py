"""
Pre-tokenized text shards: the text pipeline's insurance against a stalled internet.

The endless text stream (sham_text_stream) reads ~22 web sources live. When Hugging Face rate-limits a Kaggle session (HTTP 429) or the
network stalls, it fell back to ~2,000 windows of a tiny seed slice — a few seconds of training repeated. This module lets the free GitHub
runner (which has the network, ~120 windows/s) cook FRESH windows ahead of time into a Kaggle dataset, `sham-text-shards`:

    build(out_dir, seconds)   run the SAME stream (same sources, same mixing, same EOS between documents) and write its windows as
                              uint16 .npy shards + a manifest (window length, tokenizer fingerprint, counts, per-source mix)
    load(tokenizer, seq_len)  find shards that match this tokenizer and window length (/kaggle/input, SHAM_SHARDS_DIR, the working
                              dir) and return a ShardWindows object — a memory-mapped, shuffled list-like of windows — or None

sham_text_stream.stream_for uses it as the fallback: sources healthy → live stream (unchanged); sources stalled → fresh shard windows
instead of the same 2,000 again. A shard built with another tokenizer or window length is never used (the fingerprint decides).
Nothing here changes a weight; it only changes which text is available when the live sources are not.

    SHAM_SHARD_SECONDS (default 5400)   how long the GitHub job collects
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import random
import tempfile
import time
from pathlib import Path

import numpy as np

DATASET = "sham-text-shards"
MANIFEST = "shards_manifest.json"
WINDOWS_PER_SHARD = 20_000
MAX_WINDOWS = int(os.environ.get("SHAM_SHARD_MAX_WINDOWS", 400_000))      # ~0.8 GB: enough insurance, light to mount on Kaggle


def fingerprint(tokenizer) -> str:
    return hashlib.sha256(tokenizer._tokenizer.to_str().encode("utf-8")).hexdigest()[:16]


def build(out_dir: str, seconds: float, tokenizer=None, seq_len: int = 1024, seed: int | None = None, make_stream=None,
          windows_per_shard: int = WINDOWS_PER_SHARD, fake: bool = False, max_windows: int = MAX_WINDOWS) -> dict:
    """Runs the live stream for `seconds` and writes what it produced. Returns the manifest."""
    import sham_text_stream as M
    from text_tokenizer import ShamTextTokenizer

    tokenizer = tokenizer or ShamTextTokenizer.load(str(Path(__file__).with_name("sham_general_tokenizer.json")))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    seed = int(time.time()) % 1_000_000 if seed is None else seed
    s = M.Stream(tokenizer, seq_len, seed=seed, queue_windows=1024, slots=2, chunk_docs=512, use_process=make_stream is None,
                 make_stream=make_stream, fake=fake).start()
    rows: list = []
    shards, total = [], 0
    t_end = time.time() + seconds

    def flush():
        nonlocal rows, total
        if not rows:
            return
        arr = np.stack(rows)
        name = f"shard_{seed}_{len(shards):04d}.npy"
        np.save(out / name, arr[np.random.default_rng(seed + len(shards)).permutation(len(arr))])
        shards.append({"file": name, "windows": int(len(arr))})
        total += len(arr)
        rows = []

    try:
        while time.time() < t_end and total + len(rows) < max_windows:
            try:
                w = s.windows.get(timeout=2.0)
            except Exception:
                if s.stop.is_set():
                    break
                continue
            rows.append(np.asarray(w, dtype=np.uint16))     # 2 bytes a token, not a Python int (the runner has 16 GB)
            if len(rows) >= windows_per_shard:
                flush()
        flush()
    finally:
        mix = dict(s.per_source)
        stats = dict(s.stats)
        s.close(wait=1.0)
    manifest = {"seq_len": seq_len, "tokenizer": fingerprint(tokenizer), "windows": total, "shards": shards, "seed": seed,
                "created": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "per_source": {k: v for k, v in mix.items() if v},
                "docs": stats.get("docs", 0), "restarts": stats.get("restarts", 0)}
    (out / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print(f"🧱 أقراص النص: {total:,} نافذة ({total * seq_len / 1e6:,.0f} مليون رمز) في {len(shards)} ملفاً | وثائق {manifest['docs']:,}")
    return manifest


class ShardWindows:
    """Memory-mapped windows from matching shards; looks like a list of lists to the stream's fallback logic."""

    def __init__(self, arrays: list, seed: int = 0):
        self.arrays = arrays
        self.index = [(a, i) for a, arr in enumerate(arrays) for i in range(len(arr))]
        random.Random(seed).shuffle(self.index)

    def __len__(self) -> int:
        return len(self.index)

    def __bool__(self) -> bool:
        return bool(self.index)

    def __getitem__(self, i: int) -> list:
        a, j = self.index[i % len(self.index)]
        return self.arrays[a][j].astype(np.int64).tolist()


def _roots() -> list[Path]:
    roots = [os.environ.get("SHAM_SHARDS_DIR", ""), "/kaggle/working", "/tmp/sham_inputs"]
    found = [Path(p) for p in roots if p and Path(p).exists()]
    found += [Path(p).parent for p in glob.glob("/kaggle/input/**/" + MANIFEST, recursive=True)]
    return found


def load(tokenizer, seq_len: int, roots: list | None = None) -> ShardWindows | None:
    fp = fingerprint(tokenizer)
    arrays, seen = [], set()
    for root in roots if roots is not None else _roots():
        for man in Path(root).rglob(MANIFEST):
            try:
                m = json.loads(man.read_text(encoding="utf-8"))
            except Exception:
                continue
            if m.get("tokenizer") != fp or m.get("seq_len") != seq_len:
                continue            # another tokenizer or window length: its ids would mean other words
            for sh in m.get("shards", []):
                p = man.parent / sh["file"]
                if p.exists() and p not in seen:
                    seen.add(p)
                    try:
                        arrays.append(np.load(p, mmap_mode="r"))
                    except Exception:
                        continue
    windows = ShardWindows(arrays) if arrays else None
    return windows if windows else None


def publish_main() -> None:
    """The GitHub job: collect for SHAM_SHARD_SECONDS, then replace the dataset's contents (fresh data every run)."""
    from sham_inputs import publish_dataset
    work = Path(tempfile.mkdtemp())
    man = build(str(work), float(os.environ.get("SHAM_SHARD_SECONDS", "5400")))
    if man["windows"] < 1000:
        print("⚠ أقل من 1000 نافذة — لا نشر (المصادر متوقفة؟)")
        return
    print("نُشر إلى", publish_dataset(work, DATASET, f"{man['windows']:,} windows @ {man['seq_len']}"))


if __name__ == "__main__" and os.environ.get("SHAM_SHARDS_PUBLISH"):
    publish_main()
elif __name__ == "__main__":
    from text_tokenizer import ShamTextTokenizer

    tok = ShamTextTokenizer.load(str(Path(__file__).with_name("sham_general_tokenizer.json")))
    with tempfile.TemporaryDirectory() as d:
        man = build(d, seconds=8, tokenizer=tok, seq_len=64, seed=5, fake=True, windows_per_shard=40)
        assert man["windows"] >= 40 and len(man["shards"]) >= 1 and man["tokenizer"] == fingerprint(tok), man
        w = load(tok, 64, roots=[d])
        assert w is not None and len(w) == man["windows"], (w and len(w), man["windows"])
        first = w[0]
        assert len(first) == 64 and max(first) < 42256 and len(set(map(tuple, (w[i] for i in range(min(30, len(w))))))) > 20
        assert load(tok, 128, roots=[d]) is None                      # other window length: not used
        import types
        import sham_text_stream as M
        os.environ["SHAM_SHARDS_DIR"] = d
        stub = types.SimpleNamespace(fallback=[[1] * 64])
        M._attach_shards(stub, tok, 64)                                 # the stream's fallback becomes the fresh windows
        assert len(stub.fallback) == man["windows"] and len(stub.fallback[0]) == 64
        os.environ.pop("SHAM_SHARDS_DIR")
        (Path(d) / MANIFEST).write_text(json.dumps({**man, "tokenizer": "other"}), encoding="utf-8")
        assert load(tok, 64, roots=[d]) is None                       # other tokenizer: not used
        assert load(tok, 64, roots=[tempfile.gettempdir() + "/none-here"]) is None
    print("sham_token_shards self-test OK")
