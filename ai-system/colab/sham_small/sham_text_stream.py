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
import sys
import threading
import time
from pathlib import Path

import torch

SPEC_NAME = "sham_pipeline.json"
EOS = 42241          # model.SpecialTokens.EOS (the text tokenizer itself never emits it)
VIRTUAL_LEN = 10_000_000  # "endless": enough windows that no epoch ever completes


def _rss_gb() -> float:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1e6
    except Exception:
        pass
    return 0.0


def _mem_limit_gb() -> float:
    """Readers pause above this resident size: half the machine (cap 14 GB), or SHAM_STREAM_RSS_GB."""
    env = os.environ.get("SHAM_STREAM_RSS_GB")
    if env:
        return float(env)
    try:
        with open("/proc/meminfo") as f:
            total = int(f.readline().split()[1]) / 1e6
        return min(14.0, 0.5 * total)
    except Exception:
        return 12.0


def _tame_malloc() -> None:
    """glibc keeps one arena per thread: with many short-lived reader threads the freed memory is never returned and RSS only
    grows. Two arenas, and a malloc_trim after every chunk, keep the resident size flat. No-op where glibc is absent."""
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        libc.mallopt(-8, 2)          # M_ARENA_MAX = 2
    except Exception:
        pass


def _trim() -> None:
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


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


class _TestFake:
    """A source for the self-test of the process mode (picklable by name, no network)."""
    def __init__(self, tag):
        self.tag = tag

    def shuffle(self, seed, buffer_size):
        r = random.Random(seed)
        words = lambda: " ".join(f"w{r.randrange(10**6)}" for _ in range(120))
        return iter([{"text": f"{self.tag} doc {r.random()} " + words(), "content": f"{self.tag} code {r.random()} " + words()}
                     for _ in range(40)])


def _reader_main(sources, slots, chunk_docs, seed, out_q, stop_ev, mem_limit, fake):
    """Runs in a CHILD process: a few reader threads take turns over the sources (open → one chunk → close) and push
    (label, document) into out_q. Isolating the readers means an out-of-memory kill, a native crash or a hang in the HF /
    pyarrow code hits this process, never the notebook kernel; the parent restarts it and trains on the fallback meanwhile."""
    import gc

    import sham_text_mix as mix
    _tame_malloc()
    rng = random.Random(seed)
    lock = threading.Lock()
    counts = {x[0]: 0 for x in sources}
    rest: dict = {}
    fails: dict = {}
    busy: set = set()
    rnd = [0]

    def put(item) -> bool:
        while not stop_ev.is_set():
            try:
                out_q.put(item, timeout=0.5)
                return True
            except queue.Full:
                continue
        return False

    def open_(src, r):
        label, name, config, field, _w, cap = src
        if name == "@crawl":
            return CrawlCorpusDocs()
        if fake:
            ds = _TestFake(label)
        else:
            from datasets import load_dataset
            ds = (load_dataset(name, config, split="train", streaming=True) if config
                  else load_dataset(name, split="train", streaming=True))
        try:
            ds = ds.shuffle(seed=seed + 7919 * r, buffer_size=1000)
        except Exception:
            pass
        return ds

    def pick():
        now = time.time()
        with lock:
            cands = [x for x in sources if rest.get(x[0], 0) <= now and x[0] not in busy]
            if not cands:
                return None
            src = min(cands, key=lambda x: counts[x[0]] / x[4] + rng.random() * 0.02)   # the source furthest below its share
            busy.add(src[0])
            rnd[0] += 1
            return src, rnd[0]

    def chunk(src, r):
        label, _n, _c, field, _w, cap = src
        got, ds = 0, None
        try:
            ds = open_(src, r)
            for ex in ds:
                if stop_ev.is_set():
                    break
                text = (ex.get(field) or "").strip()
                if len(text) < mix.MIN_CHARS:
                    continue
                if not put((label, text[:cap])):
                    break
                got += 1
                with lock:
                    counts[label] += 1
                if got >= chunk_docs:
                    break
        except Exception:
            put(("!fail", ""))
        finally:
            del ds
            gc.collect()
            _trim()
        with lock:
            if got == 0:
                fails[label] = fails.get(label, 0) + 1
                rest[label] = time.time() + min(300, 2 ** min(fails[label], 8))
            else:
                fails[label] = 0
            busy.discard(label)
        put(("!open", ""))

    def slot():
        while not stop_ev.is_set():
            if _rss_gb() > mem_limit:
                put(("!mempause", ""))
                stop_ev.wait(1.0)
                continue
            got = pick()
            if got is None:
                stop_ev.wait(0.2)
                continue
            chunk(*got)

    ts = [threading.Thread(target=slot, daemon=True) for _ in range(slots)]
    for t in ts:
        t.start()
    while not stop_ev.is_set():
        stop_ev.wait(0.5)
    time.sleep(0.2)


class Stream:
    """Endless, bounded, multi-source window stream. One per session."""

    def __init__(self, tokenizer, seq_len: int = 1024, sources=None, seed: int | None = None,
                 queue_windows: int = 2048, docs_buffer: int = 192, make_stream=None, tokenize_batch: int = 32,
                 slots: int = 3, chunk_docs: int = 64, stall_seconds: float = 45.0, use_process: bool = False, fake: bool = False):
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
        self.slots, self.chunk_docs = slots, chunk_docs
        self._pick_lock = threading.Lock()
        self._busy: set = set()
        self._rest: dict = {}
        self._fails: dict = {}
        self._round = 0
        self.fallback: list = []          # a small fixed set of windows: served ONLY when the sources stall
        self._fb_i = 0
        self.stall_seconds = stall_seconds
        self.mem_limit = _mem_limit_gb()
        self.use_process, self.fake = use_process, fake
        self.proc = None
        self.out_q = None
        self.stop_ev = None
        self._ctx = None

    # -------------------------------------------------------------- producers
    # 2026-10-05: the first version kept ALL ~23 sources open at once (each HF streaming dataset runs ~10 threads and
    # holds read-ahead buffers): RSS reached 14 GB in two minutes and the first scheduled run (Track A on Kaggle CPU)
    # died with "Kernel died". Now a few reader SLOTS take turns: a slot picks a source (weighted, hungriest first),
    # opens it, reads one CHUNK of documents, CLOSES it and moves on — never more than `slots` streams open.
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
            ds = ds.shuffle(seed=self.seed + 7919 * round_no, buffer_size=1000)
        except Exception:
            pass
        return ds

    def _pick_source(self):
        """The source whose document queue is emptiest relative to its weight, among those not resting."""
        now = time.time()
        with self._pick_lock:
            cands = [s for s in self.sources if self._rest.get(s[0], 0) <= now and s[0] not in self._busy
                     and self.docs[s[0]].qsize() < self.docs[s[0]].maxsize * 0.5]
            if not cands:
                return None
            src = max(cands, key=lambda s: (1 - self.docs[s[0]].qsize() / max(self.docs[s[0]].maxsize, 1)) * s[4] * (0.5 + self._rng.random()))
            self._busy.add(src[0])
            return src

    def _read_chunk(self, src):
        import gc
        import sham_text_mix as mix
        label, _n, _c, field, _w, cap = src
        self._round += 1
        got, ds = 0, None
        try:
            ds = self._open(src, self._round)
            for ex in ds:
                if self.stop.is_set():
                    break
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
                if got >= self.chunk_docs:
                    break
        except Exception:
            self.stats["failed"] += 1
        finally:
            del ds
            gc.collect()
            _trim()
        self.stats["restarts"] += 1
        if got == 0:   # a source that yields nothing rests, longer each time — never abandoned, never fatal
            self._fails[label] = self._fails.get(label, 0) + 1
            self._rest[label] = time.time() + min(300, 2 ** min(self._fails[label], 8))
        else:
            self._fails[label] = 0
        self._busy.discard(label)

    def _slot(self):
        while not self.stop.is_set():
            if _rss_gb() > self.mem_limit:   # never let the process get near the kernel's OOM killer
                self.stats["mem_pauses"] = self.stats.get("mem_pauses", 0) + 1
                self.stop.wait(1.0)
                continue
            src = self._pick_source()
            if src is None:
                self.stop.wait(0.2)
                continue
            self._read_chunk(src)

    # ------------------------------------------------------------------ mixer
    def _next_docs_proc(self, n):
        out, deadline = [], time.time() + 5
        while len(out) < n and not self.stop.is_set():
            try:
                label, text = self.out_q.get(timeout=0.2)
            except queue.Empty:
                if out and time.time() > deadline:
                    break
                continue
            if label == "!fail":
                self.stats["failed"] += 1
            elif label == "!open":
                self.stats["restarts"] += 1
            elif label == "!mempause":
                self.stats["mem_pauses"] = self.stats.get("mem_pauses", 0) + 1
            else:
                out.append(text)
                self.per_source[label] = self.per_source.get(label, 0) + 1
        return out

    def _spawn_child(self):
        self.stop_ev = self._ctx.Event()
        self.proc = self._ctx.Process(
            target=_reader_main, daemon=True,
            args=(self.sources, self.slots, self.chunk_docs, self.seed + 104729 * self.stats.get("child_restarts", 0),
                  self.out_q, self.stop_ev, self.mem_limit, self.fake))
        # spawn would re-import the caller's __main__ (a notebook kernel, or a script without a __main__ guard) in the child:
        # hide its file/spec for the instant of start() so the child imports only this module
        main = sys.modules.get("__main__")
        saved = {k: getattr(main, k) for k in ("__file__", "__spec__") if main is not None and hasattr(main, k)}
        try:
            for k in saved:
                setattr(main, k, None)
            self.proc.start()
        finally:
            for k, v in saved.items():
                setattr(main, k, v)

    def _watch_child(self):
        """If the reader process dies (OOM kill, native crash), restart it with a new seed after a pause; training meanwhile
        continues on the windows already queued and then on the fallback set."""
        while not self.stop.is_set():
            self.stop.wait(2.0)
            if self.stop.is_set() or (self.proc is not None and self.proc.is_alive()):
                continue
            self.stats["child_restarts"] = self.stats.get("child_restarts", 0) + 1
            if self.stats["child_restarts"] > 20:
                return
            self.stop.wait(min(60.0, 3.0 * self.stats["child_restarts"]))
            if not self.stop.is_set():
                self._spawn_child()

    def _next_docs(self, n):
        if self.use_process:
            return self._next_docs_proc(n)
        return self._next_docs_thread(n)

    def _next_docs_thread(self, n):
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
        if self.use_process:
            import multiprocessing as mp
            self._ctx = mp.get_context("spawn")
            self.out_q = self._ctx.Queue(maxsize=256)
            self._spawn_child()
            t = threading.Thread(target=self._watch_child, daemon=True)
            t.start()
            self.threads.append(t)
        else:
            _tame_malloc()
            for _ in range(self.slots):
                t = threading.Thread(target=self._slot, daemon=True)
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
                waited = time.time() - t0
                if self.fallback and waited > self.stall_seconds:
                    # the sources stalled (network, rate limit, memory pause): keep training on the small fixed set
                    # instead of failing the whole session; it is reported
                    self.stats["fallback"] = self.stats.get("fallback", 0) + 1
                    self._fb_i = (self._fb_i + 1) % len(self.fallback)
                    return torch.tensor(self.fallback[self._fb_i], dtype=torch.long)
                if waited > 600:
                    raise RuntimeError("لا بيانات منذ 10 دقائق ولا احتياطي — كل المصادر متوقفة؟")

    def close(self, wait: float = 3.0):
        self.stop.set()
        if self.proc is not None:
            try:
                if self.stop_ev is not None:
                    self.stop_ev.set()
                self.proc.join(timeout=min(wait, 2.0))
                if self.proc.is_alive():
                    self.proc.terminate()      # a native HF read cannot be interrupted politely
                    self.proc.join(timeout=2.0)
            except Exception:
                pass
        end = time.time() + wait
        for t in self.threads:     # let the readers leave native HF/pyarrow code before the interpreter shuts down
            t.join(timeout=max(0.0, end - time.time()))

    def report(self) -> str:
        top = sorted(self.per_source.items(), key=lambda kv: -kv[1])
        mixline = " ".join(f"{k}:{v:,}" for k, v in top if v)
        return (f"🌊 خط النص: {self.stats['docs']:,} وثيقة → {self.stats['windows']:,} نافذة "
                f"| انتظار التدريب للبيانات {self.stats['waited']:.0f}ث | إعادة فتح مصادر {self.stats['restarts']} "
                f"(فشل {self.stats['failed']})"
                + (f" | ⚠ احتياطي استُعمل {self.stats['fallback']} مرة (المصادر توقفت)" if self.stats.get("fallback") else "")
                + (f" | توقف قراءة للذاكرة {self.stats['mem_pauses']} مرة" if self.stats.get("mem_pauses") else "")
                + f" | {mixline}")


_ACTIVE: dict = {"stream": None}


def write_spec(output_dir: str, seq_len: int = 1024) -> str:
    p = Path(output_dir) / SPEC_NAME
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"pipeline": "sham_text_stream", "seq_len": seq_len, "created": time.time()}), encoding="utf-8")
    return str(p)


def stream_for(tokenizer, seq_len: int, seed_files=None) -> Stream:
    """The session's single stream (a second dataset object in the same session shares it)."""
    s = _ACTIVE["stream"]
    if s is None or s.stop.is_set() or s.seq_len != seq_len:
        try:
            import torch as _t
            gpu = _t.cuda.is_available()
        except Exception:
            gpu = False
        # a CPU session consumes ~1 window/s: two readers and small queues are plenty (and light on memory)
        # 2026-10-10: a chunk used to be 64/32 documents. Every chunk re-opens the dataset (HF API calls, shard listing) and the
        # shuffle buffer must fill (300 documents) before the first one is emitted, so ~5x more was read than used and the
        # opens dominated: the GPU stage-1 session waited for data 21,638 s of ~30,000 (71%), and the GitHub soak managed 8.8
        # windows/s with 73 re-opens in 7 minutes. Long chunks amortise the open and the buffer; memory is unchanged because
        # at most `slots` streams are ever open at once.
        s = Stream(tokenizer, seq_len, slots=3 if gpu else 2, chunk_docs=int(os.environ.get("SHAM_STREAM_CHUNK", 1024 if gpu else 512)),
                   queue_windows=2048 if gpu else 256, use_process=os.environ.get("SHAM_STREAM_THREADS") != "1")
        s.fallback = _fallback_windows(tokenizer, seq_len, seed_files or [])
        s.start()
        _ACTIVE["stream"] = s
        import atexit
        atexit.register(s.close)
        print(f"🌊 خط النص المتدفق يعمل (بذرة {s.seed}) — لا شريحة محمّلة، ولا تكرار")
    return s


def _fallback_windows(tokenizer, seq_len: int, files, limit: int = 2000) -> list:
    """Windows of the small seed slice (the .txt shards stream_mix wrote), kept for the day the sources stall."""
    out: list = []
    try:
        for f in files:
            if not str(f).endswith(".txt"):
                continue
            ids = tokenizer._tokenizer.encode(Path(f).read_text(encoding="utf-8", errors="ignore")[:4_000_000]).ids
            for i in range(0, len(ids) - seq_len + 1, seq_len):
                out.append(ids[i:i + seq_len])
                if len(out) >= limit:
                    return out
    except Exception:
        pass
    return out


class StreamingWindows(torch.utils.data.Dataset):
    """Looks like a (huge) dataset to the notebook cells; every window requested is the next fresh one."""

    def __init__(self, tokenizer, seq_len: int, seed_files=None):
        self.stream = stream_for(tokenizer, seq_len, seed_files)

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

    open_now = {"n": 0, "max": 0}

    class Fake:
        def __init__(self, n, tag):
            self.n, self.tag = n, tag

        def shuffle(self, seed, buffer_size):
            r = random.Random(seed)
            words = lambda: " ".join(f"w{r.randrange(10**6)}" for _ in range(120))
            rows = [{"text": f"{self.tag} doc {r.random()} " + words(),
                     "content": f"{self.tag} code {r.random()} " + words()} for _ in range(self.n)]

            def gen():   # counts the streams that are open at the same time
                open_now["n"] += 1
                open_now["max"] = max(open_now["max"], open_now["n"])
                try:
                    yield from rows
                finally:
                    open_now["n"] -= 1
            return gen()

    def fake_stream(src):
        if src[0] == "ko":
            raise RuntimeError("down")
        return Fake(60, src[0])

    s = Stream(tok, seq_len=128, sources=mix.SOURCES, seed=3, queue_windows=64, make_stream=fake_stream,
               slots=3, chunk_docs=6).start()
    seen = set()
    for _ in range(400):
        w = s.next_window()
        assert w.shape == (128,) and int(w.max()) < 42256
        seen.add(hash(tuple(w.tolist())))
    assert len(seen) > 380, len(seen)           # endless and (almost always) fresh: every visit opens the source with a new seed
    assert s.stats["windows"] >= 400 and s.stats["restarts"] > 0
    for _ in range(2000):                      # how many sources a short window has reached depends on scheduling: keep reading (bounded)
        if len([k for k, v in s.per_source.items() if v]) >= 15:
            break
        s.next_window()
    assert len([k for k, v in s.per_source.items() if v]) >= 15   # many sources really mixed
    assert s.per_source.get("ko", 0) == 0 and s.stats["failed"] > 0  # a down source never stops the others
    assert open_now["max"] <= 3, open_now          # NEVER more streams open than slots (the Kaggle OOM of 2026-10-05)
    print(s.report()[:160])
    s.close()

    # PROCESS mode: the readers live in a child process; if it is killed (the Kaggle OOM) the notebook's process is untouched,
    # the parent restarts the child, and windows keep coming
    import sham_text_stream as M      # the process mode pickles the target by module name: use the imported module, not __main__
    sp = M.Stream(tok, 64, seed=11, queue_windows=64, slots=2, chunk_docs=8, use_process=True, fake=True, stall_seconds=2.0)
    sp.fallback = [[9] * 64 for _ in range(4)]
    sp.start()
    first = [sp.next_window() for _ in range(60)]
    assert len({tuple(w.tolist()) for w in first}) > 40 and sum(1 for k, v in sp.per_source.items() if v) >= 5, sp.per_source
    pid1 = sp.proc.pid
    sp.proc.kill()                                      # simulate the OOM killer
    sp.proc.join()
    more = [sp.next_window() for _ in range(40)]        # the fallback (and then the restarted child) keep it going
    t_end = time.time() + 20
    while sp.proc.pid == pid1 and time.time() < t_end:
        time.sleep(0.5)
    assert sp.stats.get("child_restarts", 0) >= 1 and sp.proc.pid != pid1 and sp.proc.is_alive(), sp.stats
    sp.close()
    assert not sp.proc.is_alive()

    # sources stall (a stream that never yields): training continues on the fixed fallback set, no exception
    class Stuck:
        def shuffle(self, seed, buffer_size):
            def gen():
                time.sleep(3600)
                yield {}
            return gen()
    fb = [[7] * 64 for _ in range(5)]
    st2 = Stream(tok, 64, seed=1, queue_windows=8, make_stream=lambda src: Stuck(), slots=2, chunk_docs=4, stall_seconds=0.5)
    st2.fallback = fb
    st2.start()
    got = [st2.next_window() for _ in range(3)]
    assert all(int(g[0]) == 7 for g in got) and st2.stats.get("fallback") == 3, st2.stats
    st2.close(wait=0.2)
    # memory guard: above the limit the readers open nothing at all
    os.environ["SHAM_STREAM_RSS_GB"] = "0.0001"
    opened = {"n": 0}
    class Count:
        def shuffle(self, seed, buffer_size):
            opened["n"] += 1
            return iter([])
    st3 = Stream(tok, 64, seed=1, queue_windows=8, make_stream=lambda src: Count(), slots=2, chunk_docs=4, stall_seconds=0.3)
    st3.fallback = fb
    st3.start()
    st3.next_window()
    time.sleep(0.5)
    assert opened["n"] == 0 and st3.stats.get("mem_pauses", 0) > 0, (opened, st3.stats)
    st3.close(wait=0.2)
    del os.environ["SHAM_STREAM_RSS_GB"]

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
