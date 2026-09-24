"""Sham control center — auto-discovers every Sham notebook and output on Kaggle.

The owner runs many notebooks whose Kaggle names are auto-generated
(notebook24ffaf0b22 …), so it's impossible to remember which is which.
This module identifies each one by what's INSIDE it, not by its name:

  * every kernel of the account is listed through the Kaggle API, its
    source is pulled and matched against fingerprints of the real Sham
    tracks (the dataset slug each track publishes to, its title, the
    files it writes);
  * every dataset of the account is listed with its files, and the
    progress JSON each tokenizer track writes is read for real metrics;
  * the latest run status of every kernel (complete / error / running)
    is read, duplicates of the same track are detected, and the
    most recent healthy kernel of each track is marked as the primary;
  * from all that, the pipeline state (text → image tokenizer → audio
    tokenizer → video corpus → stage-2 multimodal) and ONE clear next
    step are computed, in Arabic.

Output: a JSON registry (machine-readable, read back by Claude next
session and by the resume orchestrator) and an Arabic text report
(printed + sent to Telegram).

Run from the `sham_control_center.ipynb` Kaggle notebook. `python3
sham_registry.py --self-test` runs the offline test with a fake API.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Track definitions — the single source of truth for "what is what".
# `markers`: strings whose presence in a kernel's source identifies it
# (checked in order; the first track with a hit wins, most specific first).
# `dataset`: the Kaggle dataset slug the track publishes its output to.
# `key_files`: files that must exist in that dataset for the track to count
# as having produced a usable result.
# ---------------------------------------------------------------------------

TRACKS: list[dict[str, Any]] = [
    {
        "id": "control_center",
        "name": "مركز تحكم شام (هذا الدفتر)",
        "markers": ["sham_registry", "مركز تحكم شام"],
        "kind": "tool",
    },
    {
        "id": "orchestrator",
        "name": "منسّق الاستئناف التلقائي",
        "markers": ["Kaggle Resume Orchestrator", "TARGET_KERNELS"],
        "kind": "tool",
    },
    {
        "id": "stage2_multimodal",
        "name": "المرحلة الثانية — دمج الصورة والصوت مع النص (GPU)",
        "markers": ["final_multimodal.pt", "المرحلة الثانية: إضافة الصورة والصوت"],
        "kind": "train",
        "outputs": ["final_multimodal.pt"],
    },
    {
        "id": "video_corpus",
        "name": "مسار جمع وترميز الفيديو",
        "markers": ["sham-video-corpus", "video_corpus_progress.json"],
        "dataset": "sham-video-corpus",
        "key_files": ["video_corpus.jsonl"],
        "progress_file": "video_corpus_progress.json",
        "kind": "train",
    },
    {
        "id": "image_tokenizer",
        "name": "مسار ترميز الصورة (VQ-VAE)",
        "markers": ["sham-image-tokenizer-checkpoint", "image_tokenizer_progress.json"],
        "dataset": "sham-image-tokenizer-checkpoint",
        "key_files": ["image_tokenizer.pt"],
        "progress_file": "image_tokenizer_progress.json",
        "kind": "train",
    },
    {
        "id": "audio_tokenizer",
        "name": "مسار ترميز الصوت (VQ-VAE)",
        "markers": ["sham-audio-tokenizer-checkpoint", "audio_tokenizer_progress.json"],
        "dataset": "sham-audio-tokenizer-checkpoint",
        "key_files": ["audio_tokenizer.pt"],
        "progress_file": "audio_tokenizer_progress.json",
        "kind": "train",
    },
    {
        "id": "research_track",
        "name": "المسار B — البحث الذاتي من الإنترنت (CPU)",
        "markers": ["sham-research-track-checkpoint", "sham_research_tokenizer.json"],
        "dataset": "sham-research-track-checkpoint-v2",
        "key_files": ["final.pt"],
        "kind": "train",
    },
    {
        "id": "cpu_training_track",
        "name": "المسار A — التدريب النصي المستمر (CPU)",
        "markers": ["sham-cpu-track-checkpoint", "sham_cpu_tokenizer.json"],
        "dataset": "sham-cpu-track-checkpoint-v2",
        "key_files": ["final.pt"],
        "kind": "train",
    },
    {
        "id": "text_stage1",
        "name": "المرحلة الأولى — تدريب النص الأساسي (GPU)",
        "markers": ["sham-checkpoint", "sham_small_tokenizer.json", "أول دورة تدريب نصية"],
        "dataset": "sham-checkpoint",
        "key_files": ["final.pt", "sham_small_tokenizer.json"],
        "kind": "train",
    },
]
TRACK_BY_ID = {t["id"]: t for t in TRACKS}
# Anything mentioning these but matching no track above is still Sham-related.
SHAM_HINTS = ["sham", "شام", "Ttbik", "tokenizer.pt", "vqvae", "VQ-VAE", "nova"]

STATUS_AR = {
    "complete": "✅ اكتمل",
    "running": "⏳ يعمل الآن",
    "queued": "⏳ في الانتظار",
    "error": "❌ فشل",
    "cancelRequested": "⛔ أُوقف",
    "cancelAcknowledged": "⛔ أُوقف",
    "unknown": "❔ غير معروف",
}


@dataclass
class KernelInfo:
    ref: str
    title: str
    track: str | None
    track_name: str
    status: str
    failure: str = ""
    last_run: str = ""
    gpu: bool = False
    inputs: list[str] = field(default_factory=list)
    role: str = ""  # primary | duplicate | not_sham | tool
    note: str = ""


@dataclass
class DatasetInfo:
    ref: str
    title: str
    last_updated: str
    size_mb: float
    files: list[str]
    track: str | None
    progress: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Small helpers that tolerate the Kaggle client's snake_case / camelCase drift
# ---------------------------------------------------------------------------

def _get(obj: Any, *names: str, default: Any = None) -> Any:
    for n in names:
        if isinstance(obj, dict) and n in obj:
            return obj[n]
        v = getattr(obj, n, None)
        if v is not None:
            return v
    return default


def _status_name(raw: Any) -> str:
    s = str(getattr(raw, "name", raw) or "unknown")
    s = s.split(".")[-1]
    low = s.lower()
    for k in ("complete", "running", "queued", "error"):
        if k in low:
            return k
    if "cancel" in low:
        return "cancelAcknowledged"
    return "unknown"


def _iso(v: Any) -> str:
    if not v:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()[:19]
    return str(v)[:19]


def identify_track(source: str, title: str = "") -> str | None:
    blob = f"{title}\n{source}"
    for t in TRACKS:
        if any(m in blob for m in t["markers"]):
            return t["id"]
    return None


def is_sham_related(source: str, title: str = "") -> bool:
    blob = f"{title}\n{source}".lower()
    return any(h.lower() in blob for h in SHAM_HINTS)


def track_for_dataset(slug: str, files: list[str]) -> str | None:
    for t in TRACKS:
        if t.get("dataset") and slug.split("/")[-1] == t["dataset"]:
            return t["id"]
    names = {f.split("/")[-1] for f in files}
    for t in TRACKS:
        if t.get("key_files") and all(k in names for k in t["key_files"]) and t.get("dataset"):
            return t["id"]
    return None


# ---------------------------------------------------------------------------
# Discovery (talks to the Kaggle API)
# ---------------------------------------------------------------------------

def list_all_kernels(api: Any) -> list[Any]:
    out, page = [], 1
    while page <= 20:
        batch = api.kernels_list(mine=True, page=page, page_size=100) or []
        batch = [b for b in batch if b]
        out.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return out


def pull_source(api: Any, ref: str, workdir: Path) -> tuple[str, dict]:
    d = workdir / ref.replace("/", "__")
    d.mkdir(parents=True, exist_ok=True)
    try:
        api.kernels_pull(ref, str(d), metadata=True, quiet=True)
    except TypeError:
        api.kernels_pull(ref, str(d), metadata=True)
    src_parts, meta = [], {}
    for p in d.iterdir():
        if p.name == "kernel-metadata.json":
            try:
                meta = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        elif p.suffix in (".ipynb", ".py", ".r", ".R"):
            try:
                txt = p.read_text(encoding="utf-8", errors="ignore")
                if p.suffix == ".ipynb":
                    nb = json.loads(txt)
                    txt = "\n".join("".join(c.get("source", [])) for c in nb.get("cells", []))
                src_parts.append(txt)
            except Exception:
                pass
    return "\n".join(src_parts), meta


def fetch_failure_log(api: Any, ref: str, workdir: Path) -> str:
    """Last lines of a failed run's log, if the client supports filtered output download."""
    d = workdir / ("log__" + ref.replace("/", "__"))
    d.mkdir(parents=True, exist_ok=True)
    try:
        api.kernels_output(ref, str(d), file_pattern=r".*\.log$", force=True, quiet=True)
    except TypeError:
        return ""
    except Exception:
        return ""
    for p in d.rglob("*.log"):
        try:
            raw = p.read_text(encoding="utf-8", errors="ignore")
            try:
                entries = json.loads(raw)
                lines = [e.get("data", "") for e in entries if isinstance(e, dict)]
                raw = "".join(lines)
            except Exception:
                pass
            errs = [l for l in raw.splitlines() if re.search(r"Error|Exception|Traceback|خطأ", l)]
            tail = (errs[-3:] if errs else raw.splitlines()[-5:])
            return "\n".join(tail)[-600:]
        except Exception:
            continue
    return ""


class RateLimitedApi:
    """Wraps the Kaggle API client: spaces calls out and retries when Kaggle
    answers 429 (Too Many Requests) or a transient 5xx, honouring Retry-After.
    A registry scan makes many calls (status + pull per notebook, file lists per
    dataset); without this a big account trips Kaggle's rate limit mid-scan."""

    def __init__(self, api: Any, min_interval: float = 1.2, retries: int = 6, sleep=time.sleep):
        self._api, self._min, self._retries, self._sleep = api, min_interval, retries, sleep
        self._last = 0.0

    @staticmethod
    def _transient(exc: Exception) -> tuple[bool, float | None]:
        resp = getattr(exc, "response", None)
        code = getattr(resp, "status_code", None) or getattr(exc, "status", None)
        text = str(exc)
        if code is None:
            code = 429 if ("429" in text or "Too Many Requests" in text) else None
            if code is None and any(f" {c} " in f" {text} " for c in ("500", "502", "503", "504")):
                code = 503
        if code == 429 or (isinstance(code, int) and 500 <= code < 600):
            after = None
            try:
                after = float((getattr(resp, "headers", None) or {}).get("Retry-After"))
            except (TypeError, ValueError):
                pass
            return True, after
        return False, None

    def __getattr__(self, name: str):
        fn = getattr(self._api, name)
        if not callable(fn):
            return fn

        def call(*args, **kwargs):
            delay = 5.0
            for attempt in range(self._retries + 1):
                wait = self._min - (time.monotonic() - self._last)
                if wait > 0:
                    self._sleep(wait)
                self._last = time.monotonic()
                try:
                    return fn(*args, **kwargs)
                except Exception as exc:
                    transient, after = self._transient(exc)
                    if not transient or attempt == self._retries:
                        raise
                    pause = min(after or delay, 120.0)
                    print(f"sham_registry: Kaggle طلب التمهّل ({name}) — انتظار {pause:.0f} ث ثم إعادة المحاولة {attempt + 1}/{self._retries}")
                    self._sleep(pause)
                    delay = min(delay * 2, 120.0)
        return call


def discover(api: Any, workdir: Path, with_logs: bool = True) -> tuple[list[KernelInfo], list[DatasetInfo]]:
    if not isinstance(api, RateLimitedApi):
        api = RateLimitedApi(api)
    kernels: list[KernelInfo] = []
    for k in list_all_kernels(api):
        ref = _get(k, "ref")
        if not ref:
            continue
        title = _get(k, "title", default="") or ""
        try:
            source, meta = pull_source(api, ref, workdir)
        except Exception as exc:  # private/deleted/permission — still list it
            source, meta = "", {}
            print(f"sham_registry: could not pull {ref}: {exc}")
        track = identify_track(source, title)
        try:
            st = api.kernels_status(ref)
            status = _status_name(_get(st, "status"))
            failure = _get(st, "failure_message", "failureMessage", default="") or ""
        except Exception as exc:
            status, failure = "unknown", str(exc)[:200]
        info = KernelInfo(
            ref=ref,
            title=title,
            track=track,
            track_name=TRACK_BY_ID[track]["name"] if track else ("دفتر متعلق بشام — من دفاتر المهندس" if is_sham_related(source, title) else "ليس من شام"),
            status=status,
            failure=failure,
            last_run=_iso(_get(k, "last_run_time", "lastRunTime")),
            gpu=bool(meta.get("enable_gpu") or _get(k, "enable_gpu", "enableGpu", default=False)),
            inputs=list(meta.get("dataset_sources") or []) + list(meta.get("kernel_sources") or []),
        )
        if status == "error" and with_logs and not failure:
            info.failure = fetch_failure_log(api, ref, workdir)
        kernels.append(info)

    datasets: list[DatasetInfo] = []
    for ds in api.dataset_list(mine=True) or []:
        ref = _get(ds, "ref")
        if not ref:
            continue
        files: list[str] = []
        try:
            resp = api.dataset_list_files(ref, page_size=200)
            for f in (_get(resp, "files", "dataset_files", default=[]) or []):
                name = _get(f, "name", "file_name", default=None)
                if name:
                    files.append(str(name))
        except Exception:
            pass
        track = track_for_dataset(ref, files)
        info = DatasetInfo(
            ref=ref,
            title=_get(ds, "title", default="") or "",
            last_updated=_iso(_get(ds, "last_updated", "lastUpdated")),
            size_mb=round(float(_get(ds, "total_bytes", "totalBytes", default=0) or 0) / 1e6, 1),
            files=files,
            track=track,
        )
        pf = TRACK_BY_ID.get(track or "", {}).get("progress_file")
        if pf and any(f.split("/")[-1] == pf for f in files):
            try:
                target = workdir / ("ds__" + ref.replace("/", "__"))
                target.mkdir(parents=True, exist_ok=True)
                api.dataset_download_file(ref, pf, path=str(target), force=True, quiet=True)
                for p in target.rglob(pf + "*"):
                    if p.suffix == ".zip":
                        shutil.unpack_archive(str(p), str(target))
                for p in target.rglob(pf):
                    info.progress = json.loads(p.read_text(encoding="utf-8"))
                    break
            except Exception:
                pass
        datasets.append(info)
    return kernels, datasets


# ---------------------------------------------------------------------------
# Analysis: primaries, duplicates, pipeline state, next step
# ---------------------------------------------------------------------------

_STATUS_RANK = {"complete": 3, "running": 4, "queued": 4, "error": 1, "cancelAcknowledged": 1, "unknown": 0}


def assign_roles(kernels: list[KernelInfo]) -> None:
    by_track: dict[str, list[KernelInfo]] = {}
    for k in kernels:
        if not k.track:
            # Owner directive 2026-09-24: Sham-related notebooks that aren't one of
            # Claude's known tracks are the ENGINEER's own notebooks — his domain.
            # Reported to the owner, never listed as work for Claude, and excluded
            # from the public (Claude-visible) registry entirely.
            k.role = "engineer" if k.track_name.startswith("دفتر متعلق") else "not_sham"
            continue
        if TRACK_BY_ID[k.track]["kind"] == "tool":
            k.role = "tool"
            continue
        by_track.setdefault(k.track, []).append(k)
    for track, ks in by_track.items():
        ks.sort(key=lambda k: (_STATUS_RANK.get(k.status, 0), k.last_run), reverse=True)
        ks[0].role = "primary"
        for other in ks[1:]:
            other.role = "duplicate"
            other.note = f"نسخة مكررة من «{TRACK_BY_ID[track]['name']}» — الأساسي هو {ks[0].ref}"


def _dataset_ready(datasets: list[DatasetInfo], track: str) -> DatasetInfo | None:
    t = TRACK_BY_ID[track]
    for d in datasets:
        if d.track != track:
            continue
        names = {f.split("/")[-1] for f in d.files}
        if all(k in names for k in t.get("key_files", [])):
            return d
    return None


def pipeline_state(kernels: list[KernelInfo], datasets: list[DatasetInfo]) -> dict[str, Any]:
    prim = {k.track: k for k in kernels if k.role == "primary"}

    def stage(track: str) -> dict[str, Any]:
        ds = _dataset_ready(datasets, track) if TRACK_BY_ID[track].get("dataset") else None
        k = prim.get(track)
        ready = bool(ds) or (track == "stage2_multimodal" and k is not None and k.status == "complete")
        return {
            "track": track,
            "name": TRACK_BY_ID[track]["name"],
            "ready": ready,
            "dataset": ds.ref if ds else None,
            "dataset_updated": ds.last_updated if ds else None,
            "progress": ds.progress if ds else {},
            "kernel": k.ref if k else None,
            "kernel_status": k.status if k else "missing",
        }

    order = ["text_stage1", "image_tokenizer", "audio_tokenizer", "video_corpus", "stage2_multimodal"]
    stages = {t: stage(t) for t in order}
    for t in ("cpu_training_track", "research_track"):
        stages[t] = stage(t)

    s = stages
    if not s["text_stage1"]["ready"]:
        step = ("المرحلة الأولى (النص) لم تُنتج نقطة حفظ بعد.",
                "شغّلي دفتر «المرحلة الأولى — تدريب النص الأساسي» حتى يكتمل وينشر مجموعة البيانات sham-checkpoint.")
        current = "text_stage1"
    elif not s["image_tokenizer"]["ready"]:
        step = ("أداة ترميز الصورة غير جاهزة بعد.", "شغّلي «مسار ترميز الصورة» (CPU) حتى ينشر image_tokenizer.pt.")
        current = "image_tokenizer"
    elif not s["audio_tokenizer"]["ready"]:
        step = ("أداة ترميز الصوت غير جاهزة بعد.", "شغّلي «مسار ترميز الصوت» (CPU) حتى ينشر audio_tokenizer.pt.")
        current = "audio_tokenizer"
    elif not s["stage2_multimodal"]["ready"]:
        inputs = [x for x in (s["text_stage1"]["dataset"], s["image_tokenizer"]["dataset"], s["audio_tokenizer"]["dataset"]) if x]
        step = (
            "النص وأداتا الصورة والصوت جاهزة — حان وقت دمجها في شام (المرحلة الثانية).",
            "افتحي دفتر «المرحلة الثانية» ← Add Input ← أضيفي هذه المجموعات: " + "، ".join(inputs)
            + " ← فعّلي GPU ← Save & Run All. الدفتر يعثر عليها تلقائياً ويستخدم أداتي الترميز المدرّبتين بدل تدريب جديد.",
        )
        current = "stage2_multimodal"
    else:
        step = ("شام متعدد الوسائط جاهز (نص + صورة + صوت).",
                "الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».")
        current = "serve"
    return {"stages": stages, "current_stage": current, "next_step": {"why": step[0], "do": step[1]}}


def build_registry(kernels: list[KernelInfo], datasets: list[DatasetInfo]) -> dict[str, Any]:
    assign_roles(kernels)
    state = pipeline_state(kernels, datasets)
    resumable = [k.ref for k in kernels if k.role == "primary" and TRACK_BY_ID[k.track]["kind"] == "train"
                 and k.track in ("cpu_training_track", "research_track", "image_tokenizer", "audio_tokenizer", "video_corpus")]
    return {
        "generated_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
        "kernels": [asdict(k) for k in kernels],
        "datasets": [asdict(d) for d in datasets],
        "pipeline": state,
        # Consumed by kaggle_resume_orchestrator.ipynb when its own list is left empty.
        "orchestrator_targets": resumable,
    }


def _fmt_progress(p: dict[str, Any]) -> str:
    if not p:
        return ""
    keys = [k for k in ("samples_consumed", "step", "last_loss", "loss", "codebook_usage", "frames", "videos") if k in p]
    return " · ".join(f"{k}={p[k]}" for k in keys[:4])


def render_report(reg: dict[str, Any]) -> str:
    """FULL report — for the owner only (Telegram). Real names + links."""
    if reg["kernels"] and not all("alias" in k for k in reg["kernels"]):
        assign_aliases(reg)
    L: list[str] = []
    ps = reg["pipeline"]
    L.append(f"🧭 تقرير مركز تحكم شام — {reg['generated_at']}")
    L.append("")
    L.append("👉 الخطوة الحالية:")
    L.append(f"   {ps['next_step']['why']}")
    L.append(f"   {ps['next_step']['do']}")
    L.append("")
    L.append("📊 حالة المراحل:")
    for key in ("text_stage1", "image_tokenizer", "audio_tokenizer", "video_corpus", "stage2_multimodal", "cpu_training_track", "research_track"):
        s = ps["stages"][key]
        mark = "✅" if s["ready"] else ("⏳" if s["kernel_status"] in ("running", "queued") else "⬜")
        extra = _fmt_progress(s["progress"])
        L.append(f"{mark} {s['name']}" + (f" — {extra}" if extra else ""))
    L.append("")
    L.append("📒 الدفاتر:")
    groups = [("primary", "الأساسي لكل مسار"), ("duplicate", "مكررة (يمكن حذفها أو تجاهلها)"), ("engineer", "دفاتر المهندس (من اختصاصه)"), ("tool", "أدوات")]
    for role, title in groups:
        ks = [k for k in reg["kernels"] if k["role"] == role]
        if not ks:
            continue
        L.append(f"— {title}:")
        for k in ks:
            alias = f"[{k['alias']}] " if k.get("alias") else ""
            line = f"  {STATUS_AR.get(k['status'], k['status'])} | {alias}{k['track_name']} | {k['ref']}\n      🔗 https://www.kaggle.com/code/{k['ref']}"
            if k["status"] == "error" and k["failure"]:
                line += f"\n      سبب الفشل: {k['failure'][:200]}"
            L.append(line)
    failed = [k for k in reg["kernels"] if k["status"] == "error" and k["role"] == "primary"]
    if failed:
        L.append("")
        L.append("⚠️ دفاتر شام الأساسية التي فشلت (Claude يراها بأسمائها المختصرة فقط):")
        for k in failed:
            L.append(f"  • [{k.get('alias', '')}] {k['track_name']} — {k['ref']}")
    eng_failed = [k for k in reg["kernels"] if k["status"] == "error" and k["role"] == "engineer"]
    if eng_failed:
        L.append("")
        L.append("🛠 دفاتر المهندس التي فشلت (للمهندس — ليست من مهام Claude):")
        for k in eng_failed:
            L.append(f"  • {k['ref']}")
    L.append("")
    L.append("💾 مجموعات البيانات (النتائج المحفوظة):")
    for d in reg["datasets"]:
        if not d["track"] and not any(h in (d["ref"] + d["title"]).lower() for h in ("sham", "tokenizer")):
            continue
        tname = TRACK_BY_ID[d["track"]]["name"] if d["track"] else "غير مصنّفة"
        L.append(f"  • {d['ref']} ({d['size_mb']}MB، آخر تحديث {d['last_updated'][:10]}) ← {tname}")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# Privacy split (owner directive 2026-09-24): the FULL registry/report —
# real notebook names, Kaggle links, dataset refs — goes only to the owner
# (Telegram). Anything that leaves her account for Claude/the repo is the
# PUBLIC version: generic aliases ("دفتر ترميز الصورة 1"), status, progress,
# and the error summary only — never notebook names, links, titles, source,
# inputs, or dataset refs. The owner maps aliases to real names from her own
# full report, where each alias is printed next to the real notebook.
# ---------------------------------------------------------------------------

def assign_aliases(reg: dict[str, Any]) -> None:
    """Adds an `alias` to every kernel/dataset in the FULL registry (in place)."""
    counters: dict[str, int] = {}
    for k in sorted(reg["kernels"], key=lambda k: k.get("last_run") or ""):
        base = TRACK_BY_ID[k["track"]]["name"].split(" —")[0].split(" (")[0] if k["track"] else (
            "دفتر المهندس" if k["role"] == "engineer" else "دفتر آخر")
        counters[base] = counters.get(base, 0) + 1
        k["alias"] = f"{base} {counters[base]}"
    dcount: dict[str, int] = {}
    for d in reg["datasets"]:
        base = "نتائج " + (TRACK_BY_ID[d["track"]]["name"].split(" —")[0].split(" (")[0] if d["track"] else "غير مصنّفة")
        dcount[base] = dcount.get(base, 0) + 1
        d["alias"] = f"{base} {dcount[base]}"


def _scrub(text: str, secrets: list[str]) -> str:
    out = text or ""
    for s in secrets:
        if s:
            out = out.replace(s, "…")
    out = re.sub(r"/kaggle/(input|working)/[^\s'\"]+", "/kaggle/…", out)
    out = re.sub(r"https?://\S+", "[رابط]", out)
    return out[:300]


def public_registry(reg: dict[str, Any]) -> dict[str, Any]:
    """Privacy-safe copy for Claude / the repo (see note above)."""
    if not all("alias" in k for k in reg["kernels"]):
        assign_aliases(reg)
    secrets = [k["ref"] for k in reg["kernels"]] + [k["title"] for k in reg["kernels"] if k.get("title")]
    secrets += [d["ref"] for d in reg["datasets"]] + [d["ref"].split("/")[0] for d in reg["datasets"]]
    secrets += [k["ref"].split("/")[0] for k in reg["kernels"]]
    secrets = sorted({s for s in secrets if len(s) > 2}, key=len, reverse=True)
    alias_of = {d["ref"]: d["alias"] for d in reg["datasets"]}
    kernels = [
        {"alias": k["alias"], "track": k["track"], "status": k["status"], "role": k["role"],
         "last_run": k["last_run"][:10], "gpu": k["gpu"], "failure": _scrub(k["failure"], secrets)}
        for k in reg["kernels"] if k["role"] not in ("not_sham", "engineer")
    ]
    datasets = [
        {"alias": d["alias"], "track": d["track"], "size_mb": d["size_mb"], "last_updated": d["last_updated"][:10],
         "progress": d["progress"], "has_key_files": bool(d["track"] and _dataset_ready([DatasetInfo(**{kk: vv for kk, vv in d.items() if kk != "alias"})], d["track"]))}
        for d in reg["datasets"] if d["track"]
    ]
    stages = {}
    for key, st in reg["pipeline"]["stages"].items():
        stages[key] = {"name": st["name"], "ready": st["ready"], "kernel_status": st["kernel_status"],
                       "progress": st["progress"], "dataset": alias_of.get(st["dataset"]) if st["dataset"] else None}
    step = dict(reg["pipeline"]["next_step"])
    for ref, al in alias_of.items():
        step["do"] = step["do"].replace(ref, f"«{al}»")
    step["do"] = _scrub(step["do"], secrets)
    return {
        "generated_at": reg["generated_at"],
        "privacy": "public — aliases only; real names are in the owner's Telegram report",
        "kernels": kernels,
        "other_notebooks_count": sum(1 for k in reg["kernels"] if k["role"] == "not_sham"),
        "engineer_notebooks_count": sum(1 for k in reg["kernels"] if k["role"] == "engineer"),
        "datasets": datasets,
        "pipeline": {"current_stage": reg["pipeline"]["current_stage"], "next_step": step, "stages": stages},
    }


def render_public_report(pub: dict[str, Any]) -> str:
    L = [f"🧭 تقرير شام (نسخة مختصرة بلا أسماء) — {pub['generated_at']}", "",
         "👉 الخطوة الحالية:", f"   {pub['pipeline']['next_step']['why']}", f"   {pub['pipeline']['next_step']['do']}", ""]
    for key, st in pub["pipeline"]["stages"].items():
        mark = "✅" if st["ready"] else ("⏳" if st["kernel_status"] in ("running", "queued") else "⬜")
        extra = _fmt_progress(st["progress"])
        L.append(f"{mark} {st['name']}" + (f" — {extra}" if extra else ""))
    L.append("")
    for k in pub["kernels"]:
        line = f"{STATUS_AR.get(k['status'], k['status'])} | {k['alias']} | {k['role']}"
        if k["status"] == "error" and k["failure"]:
            line += f" | الخطأ: {k['failure'][:150]}"
        L.append(line)
    return "\n".join(L)


# ---------------------------------------------------------------------------
# Offline self-test with a fake Kaggle API
# ---------------------------------------------------------------------------

def _self_test() -> None:
    class NS(dict):
        __getattr__ = dict.get

    sources = {
        "me/notebook24ffaf0b22": "# شام — مسار جمع وتدريب أداة ترميز الصوت\nDATASET='sham-audio-tokenizer-checkpoint'\naudio_tokenizer_progress.json",
        "me/notebookf4a8feee6": "# شام — مسار ترميز الصورة\n'sham-image-tokenizer-checkpoint' image_tokenizer_progress.json",
        "me/notebookold111": "# old copy\n'sham-image-tokenizer-checkpoint'",
        "me/notebooktext": "# شام — أول دورة تدريب نصية حقيقية\n'sham-checkpoint' sham_small_tokenizer.json",
        "me/stage2nb": "# المرحلة الثانية: إضافة الصورة والصوت\nfinal_multimodal.pt",
        "me/random": "print('hello world')",
    }
    statuses = {"me/notebook24ffaf0b22": "error", "me/notebookf4a8feee6": "complete", "me/notebookold111": "complete",
                "me/notebooktext": "complete", "me/stage2nb": "error", "me/random": "complete"}

    class FakeApi:
        def kernels_list(self, **kw):
            return [NS(ref=r, title=r.split("/")[1], last_run_time=("2026-09-01" if r.endswith("old111") else f"2026-09-2{i}")) for i, r in enumerate(sources)] if kw.get("page", 1) == 1 else []

        def kernels_pull(self, ref, path, metadata=True, quiet=True):
            Path(path, "nb.ipynb").write_text(json.dumps({"cells": [{"source": [sources[ref]]}]}), encoding="utf-8")
            Path(path, "kernel-metadata.json").write_text(json.dumps({"enable_gpu": ref == "me/stage2nb", "dataset_sources": []}), encoding="utf-8")

        def kernels_status(self, ref):
            return NS(status=statuses[ref], failure_message="CUDA out of memory" if ref == "me/stage2nb" else "")

        def kernels_output(self, *a, **k):
            raise RuntimeError("no log in test")

        def dataset_list(self, mine=True):
            return [NS(ref="me/sham-checkpoint", title="ckpt", last_updated="2026-09-20", total_bytes=5e8),
                    NS(ref="me/sham-image-tokenizer-checkpoint", title="img", last_updated="2026-09-23", total_bytes=1.5e8),
                    NS(ref="me/sham-audio-tokenizer-checkpoint", title="aud", last_updated="2026-09-23", total_bytes=3.6e7)]

        def dataset_list_files(self, ref, page_size=200):
            files = {"me/sham-checkpoint": ["checkpoints/final.pt", "sham_small_tokenizer.json"],
                     "me/sham-image-tokenizer-checkpoint": ["image_tokenizer.pt", "image_tokenizer_progress.json"],
                     "me/sham-audio-tokenizer-checkpoint": ["audio_tokenizer.pt"]}[ref]
            return NS(files=[NS(name=f) for f in files])

        def dataset_download_file(self, ref, name, path=None, force=True, quiet=True):
            Path(path, name).write_text(json.dumps({"samples_consumed": 12000, "last_loss": 0.041}), encoding="utf-8")

    with tempfile.TemporaryDirectory() as td:
        kernels, datasets = discover(FakeApi(), Path(td))
    reg = build_registry(kernels, datasets)
    roles = {k["ref"]: (k["track"], k["role"]) for k in reg["kernels"]}
    assert roles["me/notebook24ffaf0b22"] == ("audio_tokenizer", "primary"), roles
    assert roles["me/notebookf4a8feee6"][1] == "primary" and roles["me/notebookold111"][1] == "duplicate", roles
    assert roles["me/random"] == (None, "not_sham"), roles
    assert reg["pipeline"]["current_stage"] == "stage2_multimodal", reg["pipeline"]
    assert "sham-image-tokenizer-checkpoint" in reg["pipeline"]["next_step"]["do"]
    assert reg["pipeline"]["stages"]["image_tokenizer"]["progress"]["samples_consumed"] == 12000
    report = render_report(reg)
    assert "الخطوة الحالية" in report and "CUDA out of memory" in report
    assert "https://www.kaggle.com/code/me/notebook24ffaf0b22" in report  # owner sees real names + links
    print(report)
    pub = public_registry(reg)
    blob = json.dumps(pub, ensure_ascii=False) + render_public_report(pub)
    for leak in ("notebook24ffaf0b22", "notebookf4a8feee6", "me/", "sham-image-tokenizer-checkpoint", "random"):
        assert leak not in blob, f"public registry leaked {leak!r}"
    assert "مسار ترميز الصوت 1" in blob and "CUDA out of memory" in blob
    print("\n--- public (Claude) ---\n" + render_public_report(pub))
    print("\nsham_registry self-test: OK")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        _self_test()
