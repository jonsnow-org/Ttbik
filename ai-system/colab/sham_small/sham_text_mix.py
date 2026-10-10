"""
Sham's general text mixture ("مزيج النص العام") — one text source for a model that
is NOT specialised in anything: many languages, code, mathematics, science and
school-level explanations, all streamed free from open sets (no sign-in).

Why it replaces "20,000 Arabic Wikipedia articles per session":
  • Arabic Wikipedia is ~0.6B tokens in total and its articles shrink with position,
    so later sessions re-read the same few thousand short articles dozens of times;
  • a general model needs breadth: every session here draws a FRESH random sample
    (shuffled shards + a random seed) from sources that hold billions of documents,
    so no session repeats another.

Everything is read on the fly (streaming) in parallel threads, one per source. A source
that is down is skipped (reported), never fatal. Used by data_acquisition.stream_hf_text_corpus
whenever a notebook asks for the old Arabic-Wikipedia slice, so the existing cells keep
working unchanged.
"""

from __future__ import annotations

import json
import os
import random
import threading
import time
from pathlib import Path

def _ensure_hf_token() -> None:
    """Unauthenticated Hugging Face requests are rate-limited hard (HTTP 429 «Rate limited. Waiting 111s» in the 2026-10-10 runs;
    Kaggle's shared addresses hit the limit even sooner). A free read token raises it. Taken from the environment (HF_TOKEN) or,
    on Kaggle, from a notebook secret named HF_TOKEN; absent = anonymous, exactly as before. Never printed."""
    if os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"):
        return
    try:
        from kaggle_secrets import UserSecretsClient
        tok = UserSecretsClient().get_secret("HF_TOKEN")
        if tok:
            os.environ["HF_TOKEN"] = tok
    except Exception:
        pass


_ensure_hf_token()

# (label, dataset, config, text_field, weight, max_chars)   — weights are shares of documents
SOURCES = [
    ("en-web-edu", "HuggingFaceFW/fineweb-edu", "sample-10BT", "text", 14, 6000),
    ("ar-web", "HuggingFaceFW/fineweb-2", "arb_Arab", "text", 11, 6000),
    ("ar-wiki", "wikimedia/wikipedia", "20231101.ar", "text", 3, 6000),
    ("en-wiki", "wikimedia/wikipedia", "20231101.en", "text", 3, 6000),
    ("fr", "HuggingFaceFW/fineweb-2", "fra_Latn", "text", 5, 6000),
    ("es", "HuggingFaceFW/fineweb-2", "spa_Latn", "text", 5, 6000),
    ("de", "HuggingFaceFW/fineweb-2", "deu_Latn", "text", 4, 6000),
    ("ru", "HuggingFaceFW/fineweb-2", "rus_Cyrl", "text", 4, 6000),
    ("zh", "HuggingFaceFW/fineweb-2", "cmn_Hani", "text", 6, 4000),
    ("ja", "HuggingFaceFW/fineweb-2", "jpn_Jpan", "text", 3, 3000),
    ("hi", "HuggingFaceFW/fineweb-2", "hin_Deva", "text", 3, 6000),
    ("tr", "HuggingFaceFW/fineweb-2", "tur_Latn", "text", 3, 6000),
    ("pt", "HuggingFaceFW/fineweb-2", "por_Latn", "text", 3, 6000),
    ("id", "HuggingFaceFW/fineweb-2", "ind_Latn", "text", 2, 6000),
    ("ko", "HuggingFaceFW/fineweb-2", "kor_Hang", "text", 2, 3000),
    ("sw", "HuggingFaceFW/fineweb-2", "swh_Latn", "text", 1, 6000),
    ("math-web", "open-web-math/open-web-math", None, "text", 6, 8000),
    ("math-edu", "HuggingFaceTB/finemath", "finemath-3plus", "text", 4, 8000),
    ("code", "codeparrot/codeparrot-clean", None, "content", 8, 8000),
    ("school-science", "HuggingFaceTB/cosmopedia", "khanacademy", "text", 3, 6000),
    ("school-math", "HuggingFaceTB/cosmopedia", "auto_math_text", "text", 3, 6000),
    ("textbooks", "HuggingFaceTB/cosmopedia", "openstax", "text", 2, 6000),
]
MAX_PARALLEL = 4   # sources read at the same time (each HF stream holds ~1-2 GB: 6 reached 10 GB peak)
MIN_CHARS = 200  # a stub is not worth a training window


def pipeline_enabled() -> bool:
    """The endless pipeline (sham_text_stream) feeds GPU sessions by default. CPU sessions use a fixed fresh slice of the same
    mixture until the pipeline's new safeguards (reader process, memory guard, fallback) have been verified on a real CPU run:
    the first scheduled CPU run with the pipeline died of memory (2026-10-05). SHAM_PIPELINE=1 / 0 forces it on / off."""
    v = os.environ.get("SHAM_PIPELINE")
    if v in ("0", "1"):
        return v == "1"
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def plan(total: int) -> dict[str, int]:
    weight = sum(s[4] for s in SOURCES)
    return {s[0]: max(1, round(total * s[4] / weight)) for s in SOURCES}


def _read_source(src, quota, seed, sink, lock, report, make_stream=None):
    label, name, config, field, _w, cap = src
    got = 0
    try:
        if make_stream is None:
            from datasets import load_dataset
            stream = (load_dataset(name, config, split="train", streaming=True) if config
                      else load_dataset(name, split="train", streaming=True))
        else:
            stream = make_stream(src)
        try:
            stream = stream.shuffle(seed=seed, buffer_size=2000)
        except Exception:
            pass
        for ex in stream:
            text = (ex.get(field) or "").strip()
            if len(text) < MIN_CHARS:
                continue
            with lock:
                sink.append(text[:cap])
            got += 1
            if got >= quota:
                break
    except Exception as exc:  # a source being down must never stop the others
        report[label] = f"{got:,} (توقف: {type(exc).__name__})"
        return
    report[label] = f"{got:,}"


def stream_mix(output_dir: str, max_documents: int = 50_000, documents_per_file: int = 5_000,
               seed: int | None = None, progress_path: str | None = None,
               sources=None, make_stream=None) -> list[str]:
    """Writes shard_*.txt (one document per line block) like stream_hf_text_corpus and
    returns the file list. Random seed per call → every session sees different documents."""
    seed = int(time.time()) % 1_000_000 if seed is None else seed
    chosen = list(sources or SOURCES)
    weight = sum(s[4] for s in chosen)
    quotas = {s[0]: max(1, round(max_documents * s[4] / weight)) for s in chosen}
    docs: list[str] = []
    report: dict[str, str] = {}
    lock = threading.Lock()
    gate = threading.Semaphore(MAX_PARALLEL)

    def run(s):
        with gate:
            _read_source(s, quotas[s[0]], seed, docs, lock, report, make_stream)

    threads = [threading.Thread(target=run, args=(s,), daemon=True) for s in chosen]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    random.Random(seed).shuffle(docs)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for i in range(0, len(docs), documents_per_file):
        p = out / f"shard_{i // documents_per_file:05d}.txt"
        p.write_text("\n".join(d.replace("\r", "") for d in docs[i:i + documents_per_file]), encoding="utf-8")
        files.append(str(p))
    ok = sum(1 for v in report.values() if not v.endswith(")"))
    print(f"🌍 المزيج العام: {len(docs):,} وثيقة من {ok}/{len(chosen)} مصدراً (بذرة {seed}) في {len(files)} ملف")
    print("   " + " | ".join(f"{k}: {v}" for k, v in report.items()))
    if make_stream is None and pipeline_enabled():
        import sham_text_stream
        files.append(sham_text_stream.write_spec(output_dir))
        print("🌊 وُضع ملف خط النص المتدفق: التدريب يسحب نوافذه من الخط، والملفات أعلاه نسخة صغيرة للأدوات الأخرى")
    if progress_path:
        Path(progress_path).parent.mkdir(parents=True, exist_ok=True)
        Path(progress_path).write_text(json.dumps({
            "dataset": "wikimedia/wikipedia", "config": "20231101.ar", "split": "train",
            "documents_consumed": 0, "mix": True, "seed": seed, "documents": len(docs)}), encoding="utf-8")
    return files


def _mix_main(kwargs: dict, q) -> None:
    try:
        q.put(("ok", stream_mix(**kwargs)))
    except BaseException as exc:   # noqa: BLE001 - reported to the parent, never raised in the child
        q.put(("error", f"{type(exc).__name__}: {str(exc)[:200]}"))


def stream_mix_isolated(timeout: float = 1800.0, **kwargs) -> list[str]:
    """stream_mix in a short-lived CHILD process. The HF streaming libraries leave several GB resident (malloc arenas, a
    background I/O thread that crashes the interpreter at exit); in the child they die with it, so the notebook's own process
    stays small. Any failure falls back to running stream_mix in-process."""
    import multiprocessing as mp
    import sys
    try:
        ctx = mp.get_context("spawn")
        q = ctx.Queue()
        proc = ctx.Process(target=_mix_main, args=(kwargs, q), daemon=True)
        main = sys.modules.get("__main__")      # keep spawn from re-importing the caller's __main__ (notebook kernel / script)
        saved = {k: getattr(main, k) for k in ("__file__", "__spec__") if main is not None and hasattr(main, k)}
        try:
            for k in saved:
                setattr(main, k, None)
            proc.start()
        finally:
            for k, v in saved.items():
                setattr(main, k, v)
        deadline = time.time() + timeout
        status = payload = None
        while time.time() < deadline:          # poll, so a child that dies silently (OOM kill) never blocks us for the whole timeout
            try:
                status, payload = q.get(timeout=2.0)
                break
            except Exception:
                if not proc.is_alive():
                    try:
                        status, payload = q.get(timeout=1.0)
                    except Exception:
                        status, payload = "error", f"العملية الفرعية انتهت (رمز {proc.exitcode}) بلا نتيجة"
                    break
        if status is None:
            status, payload = "error", "انتهت المهلة"
        proc.join(timeout=10)
        if proc.is_alive():
            proc.terminate()
        if status == "ok":
            return payload
        print(f"⚠ المزيج في عملية منفصلة فشل ({payload}) — يُعاد داخل العملية الحالية")
    except Exception as exc:
        print(f"⚠ تعذّر عزل تحميل المزيج ({type(exc).__name__}: {str(exc)[:100]}) — يُعاد داخل العملية الحالية")
    return stream_mix(**kwargs)


if __name__ == "__main__":
    import tempfile

    class Fake:
        def __init__(self, n, tag):
            self.rows = [{"text": f"{tag} document number {i} " + "word " * 80, "content": f"{tag} code {i} " + "x = 1\n" * 60}
                         for i in range(n)]

        def shuffle(self, seed, buffer_size):
            r = list(self.rows)
            random.Random(seed).shuffle(r)
            return iter(r)

    def fake_stream(src):
        if src[0] == "ko":
            raise RuntimeError("down")
        return Fake(400, src[0])

    q = plan(1000)
    assert abs(sum(q.values()) - 1000) < len(SOURCES), q
    with tempfile.TemporaryDirectory() as d:
        a = stream_mix(d + "/a", 500, 200, seed=1, make_stream=fake_stream, progress_path=d + "/p.json")
        b = stream_mix(d + "/b", 500, 200, seed=2, make_stream=fake_stream)
        ta = "\n".join(Path(f).read_text(encoding="utf-8") for f in a)
        tb = "\n".join(Path(f).read_text(encoding="utf-8") for f in b)
        assert len(a) == 3 and ta.count("\n") >= 440  # the code source adds inner newlines
        assert "ko document" not in ta and "zh document" in ta  # a failed source is skipped, others still read
        assert ta != tb  # a new seed = a different sample
        assert json.loads(Path(d + "/p.json").read_text())["mix"] is True
    print("sham_text_mix self-test OK")
