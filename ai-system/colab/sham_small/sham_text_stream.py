"""
Sham's text pipeline ("خط النص المتدفق") — the engineer's idea (collect, tokenize and train at the
same time, in one notebook) applied to the main text track.

What the first real session on the general mixture showed (2026-10-04): the held-out text fell from
5.82 to 3.61 (the first real learning), but the session trained on ~183M tokens drawn from a fixed
download of ~60k documents (several passes over the same text) and it ended after 4.8 of its 8.5
hours, because its batch list was counted in the wrong unit. Both come from the same design: download
a slice, tokenize it all into RAM, train on the slice.

Here the data is never a slice. Background threads read the mixture endlessly (shuffled shards, fresh
random seed per session; a source that fails or ends is restarted), a mixer draws documents from the
sources in the mixture's proportions, tokenizes them in batches (the tokenizer releases the GIL), cuts the
token stream into windows of `seq_len` (EOS between documents) and keeps a bounded queue of ready
windows. Training takes windows from the queue as it needs them, so

  • the GPU starts within seconds and never waits for a download or a tokenization pass;
  • every window is seen once: no epochs, no memorisation, at any session length;
  • memory stays small (a bounded queue, not the whole corpus as Python lists).

The notebook cells need no change for this: dataset.TextSequenceDataset recognises the pipeline file
that sham_text_mix.stream_mix returns and behaves as an (endless) dataset whose windows come from here.
"""

from __future__ import annotations

import json
import os
import queue
import random
import threading
import time
from pathlib import Path

import torch

SPEC_NAME = "sham_pipeline.json"
EOS = 42241          # model.SpecialTokens.EOS (the text tokenizer itself never emits it)
VIRTUAL_LEN = 10_000_000  # "endless": enough windows that no epoch ever completes


class CrawlCorpusDocs:
    """The text the collection notebooks published (every sham-crawl-*-corpus dataset of the account: the Kaggle live
    trainer's, the GitHub collector's, an engineer's...), as documents. Looks like a streaming dataset to Stream."""

    def __init__(self, names=None):
        self.names = names

    def _files(self):
        try:
            from sham_inputs import crawl_dataset_names, fetch_dataset
            names = self.names if self.names is not None else crawl_dataset_names()["corpora"]
            files = []
            for n in names:
                root = fetch_dataset(n)
                if root:
                    files += sorted(Path(root).rglob("text/**/*.txt"))
            return files
        except Exception:
            return []

    def shuffle(self, seed: int, buffer_size: int = 0):
        rng = random.Random(seed)
        files = self._files()
        rng.shuffle(files)
        for f in files:
            try:
                raw = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            docs = [d for d in raw.split("\n\n") if d.strip()] if "\n\n" in raw else [d for d in raw.split("\n") if d.strip()]
            rng.shuffle(docs)
            for d in docs:
                yield {"text": d}


class Stream:
    """Endless, bounded, multi-source window stream. One per session."""

    def __init__(self, tokenizer, seq_len: int = 1024, sources=None, seed: int | None = None,
                 queue_windows: int = 2048, docs_buffer: int = 256, make_stream=None, tokenize_batch: int = 32):
        import sham_text_mix as mix

        self.tok, self.seq_len = tokenizer, seq_len
        self.sources = list(sources or mix.SOURCES)
        if sources is None and not os.environ.get("SHAM_NO_CRAWL_CORPORA"):
            # what the collection notebooks published must not be lost: it joins the mixture as one more source
            self.sources.append(("crawl-corpora", "@crawl", None, "text", 5, 6000))
        self.seed = int(time.time()) % 1_000_000 if seed is None else seed
        self.make_stream = make_stream
        self.stop = threading.Event()
        self.windows: queue.Queue = queue.Queue(maxsize=queue_windows)
        self.docs = {s[0]: queue.Queue(maxsize=docs_buffer) for s in self.sources}
        self.stats = {"docs": 0, "windows": 0, "restarts": 0, "failed": 0, "waited": 0.0}
        self.per_source = {s[0]: 0 for s in self.sources}
        self.threads: list[threading.Thread] = []
        self._rng = random.Random(self.seed)
        self._started = False

    # -------------------------------------------------------------- producers
    def _open(self, src, round_no):
        label, name, config, field, _w, cap = src
        if name == "@crawl":
            return CrawlCorpusDocs()
        if self.make_stream is not None:
            ds = self.make_stream(src)
        else:
            from datasets import load_dataset
            ds = (load_dataset(name, config, split="train", streaming=True) if config
                  else load_dataset(name, split="train", streaming=True))
        try:
            ds = ds.shuffle(seed=self.seed + 7919 * round_no, buffer_size=2000)
        except Exception:
            pass
        return ds

    def _produce(self, src):
        import sham_text_mix as mix
        label, _n, _c, field, _w, cap = src
        round_no, quiet = 0, 0
        while not self.stop.is_set():
            got = 0
            try:
                for ex in self._open(src, round_no):
                    if self.stop.is_set():
                        return
                    text = (ex.get(field) or "").strip()
                    if len(text) < mix.MIN_CHARS:
                        continue
                    while not self.stop.is_set():
                        try:
                            self.docs[label].put(text[:cap], timeout=0.5)
                            break
                        except queue.Full:
                            continue
                    got += 1
            except Exception:
                self.stats["failed"] += 1
            round_no += 1
            self.stats["restarts"] += 1
            quiet = 0 if got else quiet + 1
            # a source that yields nothing is retried with growing pauses, never abandoned or fatal
            self.stop.wait(min(300, 2 ** min(quiet, 8)) if not got else (30 if src[1] == "@crawl" else 0.1))

    # ------------------------------------------------------------------ mixer
    def _next_docs(self, n):
        weights = {s[0]: s[4] for s in self.sources}
        out = []
        deadline = time.time() + 5
        while len(out) < n and not self.stop.is_set():
            live = [k for k, q in self.docs.items() if not q.empty()]
            if not live:
                if time.time() > deadline and out:
                    break
                self.stop.wait(0.05)
                continue
            k = self._rng.choices(live, [weights[x] for x in live])[0]
            try:
                out.append(self.docs[k].get_nowait())
                self.per_source[k] += 1
            except queue.Empty:
                continue
        return out

    def _mix(self):
        buf: list[int] = []
        L = self.seq_len
        while not self.stop.is_set():
            docs = self._next_docs(self.tokenize_batch_size)
            if not docs:
                continue
            try:
                encs = self.tok._tokenizer.encode_batch(docs)
            except Exception:
                self.stats["failed"] += 1
                continue
            for e in encs:
                buf.extend(e.ids)
                buf.append(EOS)
            self.stats["docs"] += len(docs)
            while len(buf) >= L:
                w, buf = buf[:L], buf[L:]
                while not self.stop.is_set():
                    try:
                        self.windows.put(w, timeout=0.5)
                        self.stats["windows"] += 1
                        break
                    except queue.Full:
                        continue

    tokenize_batch_size = 32

    def start(self):
        if self._started:
            return self
        self._started = True
        for s in self.sources:
            t = threading.Thread(target=self._produce, args=(s,), daemon=True)
            t.start()
            self.threads.append(t)
        for _ in range(2):  # two mixers keep tokenization ahead of even a fast GPU
            t = threading.Thread(target=self._mix, daemon=True)
            t.start()
            self.threads.append(t)
        return self

    # ---------------------------------------------------------------- consumer
    def next_window(self) -> torch.Tensor:
        t0 = time.time()
        while True:
            try:
                w = self.windows.get(timeout=1.0)
                self.stats["waited"] += time.time() - t0
                return torch.tensor(w, dtype=torch.long)
            except queue.Empty:
                if self.stop.is_set():
                    raise RuntimeError("stream stopped")
                if time.time() - t0 > 600:
                    raise RuntimeError("لا بيانات منذ 10 دقائق — كل المصادر متوقفة؟")

    def close(self):
        self.stop.set()

    def report(self) -> str:
        top = sorted(self.per_source.items(), key=lambda kv: -kv[1])
        mixline = " ".join(f"{k}:{v:,}" for k, v in top if v)
        return (f"🌊 خط النص: {self.stats['docs']:,} وثيقة → {self.stats['windows']:,} نافذة "
                f"| انتظار التدريب للبيانات {self.stats['waited']:.0f}ث | إعادة فتح مصادر {self.stats['restarts']} "
                f"(فشل {self.stats['failed']}) | {mixline}")


_ACTIVE: dict = {"stream": None}


def write_spec(output_dir: str, seq_len: int = 1024) -> str:
    p = Path(output_dir) / SPEC_NAME
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"pipeline": "sham_text_stream", "seq_len": seq_len, "created": time.time()}), encoding="utf-8")
    return str(p)


def stream_for(tokenizer, seq_len: int) -> Stream:
    """The session's single stream (a second dataset object in the same session shares it)."""
    s = _ACTIVE["stream"]
    if s is None or s.stop.is_set() or s.seq_len != seq_len:
        s = Stream(tokenizer, seq_len).start()
        _ACTIVE["stream"] = s
        print(f"🌊 خط النص المتدفق يعمل (بذرة {s.seed}) — لا شريحة محمّلة، ولا تكرار")
    return s


class StreamingWindows(torch.utils.data.Dataset):
    """Looks like a (huge) dataset to the notebook cells; every window requested is the next fresh one."""

    def __init__(self, tokenizer, seq_len: int):
        self.stream = stream_for(tokenizer, seq_len)

    def __len__(self) -> int:
        return VIRTUAL_LEN

    def __getitem__(self, idx: int) -> torch.Tensor:
        return self.stream.next_window()


def report() -> str:
    s = _ACTIVE["stream"]
    return s.report() if s is not None else ""


if __name__ == "__main__":
    import sham_text_mix as mix
    from text_tokenizer import ShamTextTokenizer

    tok = ShamTextTokenizer.load(str(Path(__file__).with_name("sham_general_tokenizer.json")))

    class Fake:
        def __init__(self, n, tag):
            self.n, self.tag = n, tag

        def shuffle(self, seed, buffer_size):
            r = random.Random(seed)
            words = lambda: " ".join(f"w{r.randrange(10**6)}" for _ in range(120))
            return iter([{"text": f"{self.tag} doc {r.random()} " + words(),
                          "content": f"{self.tag} code {r.random()} " + words()} for _ in range(self.n)])

    def fake_stream(src):
        if src[0] == "ko":
            raise RuntimeError("down")
        return Fake(60, src[0])

    s = Stream(tok, seq_len=128, sources=mix.SOURCES, seed=3, queue_windows=64, make_stream=fake_stream).start()
    seen = set()
    for _ in range(400):
        w = s.next_window()
        assert w.shape == (128,) and int(w.max()) < 42256
        seen.add(hash(tuple(w.tolist())))
    assert len(seen) > 380, len(seen)           # endless and (almost always) fresh: sources restart with new seeds
    assert s.stats["windows"] >= 400 and s.stats["restarts"] > 0
    assert len([k for k, v in s.per_source.items() if v]) >= 15   # many sources really mixed
    assert s.per_source.get("ko", 0) == 0 and s.stats["failed"] > 0  # a down source never stops the others
    print(s.report()[:160])
    s.close()

    # the published collection corpora join as one more source
    import tempfile
    d = Path(tempfile.mkdtemp()) / "text"
    d.mkdir(parents=True)
    (d / "a.txt").write_text("\n\n".join(f"collected doc {i} " + "alpha beta gamma " * 40 for i in range(30)), encoding="utf-8")
    docs = list(CrawlCorpusDocs([]).shuffle(1))
    assert docs == []
    import sham_inputs
    orig_fetch = sham_inputs.fetch_dataset
    sham_inputs.fetch_dataset = lambda n: d.parent
    try:
        docs = list(CrawlCorpusDocs(["sham-crawl-x-corpus"]).shuffle(1))
    finally:
        sham_inputs.fetch_dataset = orig_fetch
    assert len(docs) == 30 and docs[0]["text"].startswith("collected doc")

    # as a dataset object to the notebook cells
    _ACTIVE["stream"] = Stream(tok, 64, seed=5, queue_windows=32, make_stream=fake_stream).start()
    ds = StreamingWindows(tok, 64)
    assert len(ds) >= 10_000_000
    batch = torch.stack([ds[i] for i in range(0, 4)])
    assert batch.shape == (4, 64)
    _ACTIVE["stream"].close()
    print("sham_text_stream self-test OK")
