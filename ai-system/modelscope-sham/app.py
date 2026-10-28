"""
Sham on the ModelScope Studio (free CPU box: 2 vCPU / 16 GB / always on) — hosting and a worker for Sham's own jobs.

What it does
  * serves the trained Sham (text now; the same load path as ai-system/colab/sham_small/serve.py) through Gradio's own API, the
    mechanism this Studio's platform proxy already speaks (gradio 6.17.3):  /gradio_api/call/generate_text , /gradio_api/call/status
  * keeps itself current: every REFRESH_SECONDS it asks the ModelScope hub for the newest published checkpoint and hot-swaps it
  * reads media too (understand_media: picture / sound / video → answer; optional `teach` keeps the pair for guarded self-learning) and
    writes short videos (generate_media kind=video); media calls answer {"type": "busy"} instead of queueing behind a slow one
  * never crashes on a missing model or token: it says what it is waiting for in `status` and retries

Where the model comes from (no github.com here — ModelScope's network cannot reach it):
  a GitHub job (sham-modelscope.yml) copies Kaggle's `sham-merged-checkpoint` into the ModelScope model repo SHAM_MS_MODEL and pushes
  this folder into the Studio's git repo. The Studio only ever talks to modelscope.cn.

Settings (Studio settings → environment variables — set once by the owner, never in code):
  MODELSCOPE_API_TOKEN   the account token, needed because the model repo is private

Nothing here answers by rule: every reply is the trained model's own generation.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

os.environ["no_proxy"] = "127.0.0.1,localhost"          # Gradio's localhost self-check (same fix as the previous app in this Studio)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "sham_small"))
sys.path.insert(0, str(HERE))
import codesign

MODEL_ID = os.environ.get("SHAM_MS_MODEL", "novaai2026/sham-merged")
os.environ.setdefault("SHAM_SELF_LEARN_DIR", str(HERE / "_selflearn"))      # experiences from understand_media wait here (self_learn.py)
# Limits that exist only because today's Sham is small and still training. SHAM_LIMITS=open lifts them to what the model itself can hold
# (its max_seq_len), with no code change; each can also be set alone. Defaults = today's behaviour exactly.
_OPEN = os.environ.get("SHAM_LIMITS", "").strip().lower() == "open"
MAX_NEW_TOKENS = int(os.environ.get("SHAM_MAX_NEW_TOKENS", "768" if _OPEN else "200"))
REFRESH_SECONDS = int(os.environ.get("SHAM_REFRESH_SECONDS", 1200))
STATE = {"phase": "starting", "detail": "", "step": 0, "revision": "", "loaded_at": 0, "error": ""}
_LOCK = threading.Lock()
HOT = HERE / "_hot"            # signed code synced from the model repo (studio_code/): new code reaches the Studio without a Redeploy click
_PROC = {"p": None, "sig": ""}


def _say(msg: str) -> None:
    """One clear line per phase in the run log (the download progress bars are switched off: they filled the 10,000-line log by themselves)."""
    try:
        mem = {l.split(":")[0]: int(l.split()[1]) // 1024 for l in open("/proc/meminfo") if l.split(":")[0] in ("MemTotal", "MemAvailable")}
        extra = f" | RAM free {mem.get('MemAvailable', 0)} of {mem.get('MemTotal', 0)} MB"
    except Exception:
        extra = ""
    print(f"[sham] {time.strftime('%H:%M:%S')} {msg}{extra}", flush=True)


def _token() -> str:
    return os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""


def _download() -> Path:
    import contextlib
    cache = HERE / "_models"
    # The media bundle is ~2.16 GiB. Do not start a new multi-gigabyte snapshot
    # download on an almost-full 8 GiB Studio when a complete cached model can
    # keep serving; report the low-space condition instead of filling the disk.
    min_free = int(float(os.environ.get("SHAM_MIN_REFRESH_FREE_GIB", "2.6")) * (1024 ** 3))
    try:
        free = shutil.disk_usage(HERE).free
    except OSError:
        free = min_free
    if free < min_free:
        cached = sorted(cache.rglob("final_merged.pt"), key=lambda p: p.stat().st_mtime, reverse=True) if cache.exists() else []
        for ckpt in cached:
            if (ckpt.parent / "sham_small_tokenizer.json").is_file():
                _say(f"disk low ({free / 2**30:.2f} GiB free): keeping cached model; skipped snapshot refresh")
                return ckpt.parent
        _say(f"disk low ({free / 2**30:.2f} GiB free) but no complete cached model; first download may fail")
    os.environ["TQDM_DISABLE"] = "1"                         # no progress bars in the log
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    tok = _token()
    if tok:
        HubApi().login(tok)
    _say(f"downloading {MODEL_ID}")
    with open(os.devnull, "w") as quiet, contextlib.redirect_stderr(quiet):       # bars that ignore TQDM_DISABLE write to stderr
        path = Path(snapshot_download(MODEL_ID, cache_dir=str(cache)))
    _say("download finished")
    return path


def _load(model_dir: Path) -> None:
    import serve
    ckpt = next(iter(sorted(model_dir.rglob("final_merged.pt"))), None) or next(iter(sorted(model_dir.rglob("*.pt"))), None)
    tok = next(iter(sorted(model_dir.rglob("sham_small_tokenizer.json"))), None)
    if ckpt is None or tok is None:
        raise RuntimeError("المستودع لا يحوي نقطة الحفظ أو مقطّع النص بعد")
    if STATE["phase"] != "ready":
        STATE.update(phase="loading")                              # a hot swap of a newer checkpoint keeps serving the old one meanwhile
    _say(f"loading the model into memory ({ckpt.stat().st_size // 2**20} MB file)")
    with _LOCK:
        serve.load_model(checkpoint_path=str(ckpt), tokenizer_path=str(tok))
    STATE.update(phase="ready", detail=str(serve._state.get("source", "")), loaded_at=int(time.time()), error="")
    _refresh_media_assets(model_dir)
    _say("ready: the model is loaded")
    manifest = next(iter(sorted(model_dir.rglob("bridge_manifest.json"))), None)
    if manifest:
        try:
            STATE["revision"] = json.loads(manifest.read_text(encoding="utf-8")).get("sha", "")[:12]
        except Exception:
            pass


def _refresh_media_assets(model_dir: Path) -> None:
    """Refresh media readiness independently from the large text checkpoint."""
    try:
        from sham_media_ready import inspect_ready_assets
        assets = inspect_ready_assets(model_dir)
        STATE["media_assets"] = assets
        STATE["media_root"] = assets["root"] if assets["ready"] else ""
        if os.environ.get("SHAM_LOCAL_VIDEO", "") != "1" and assets.get("root"):
            # video weights fetched here by the earlier in-process video path (~2.9 GiB of this Studio's ~9.8 GiB disk) are dead weight now: reclaim them
            import shutil as _shutil
            _old = Path(assets["root"]) / "video_animatediff"
            if _old.is_dir():
                _shutil.rmtree(_old, ignore_errors=True)
                _say("removed the unused in-Studio video weights (video lives in the video Studio)")
        image_mb = assets.get("image_bytes", 0) / 2**20
        audio_mb = assets.get("audio_bytes", 0) / 2**20
        _say(f"media assets: ready={assets['ready']} image={image_mb:.1f} MiB audio={audio_mb:.1f} MiB reason={assets.get('reason', '')[:100]}")
    except Exception as exc:                                # noqa: BLE001
        STATE["media_root"] = ""
        STATE["media_assets"] = {"ready": False, "reason": f"{type(exc).__name__}: {str(exc)[:120]}"}
        _say(f"media check failed: {type(exc).__name__}")


def _media_signature(model_dir: Path) -> tuple:
    """Cheap metadata-only signature so new media weights are detected without hashing gigabytes."""
    root = model_dir / "media"
    if not root.is_dir():
        return ()
    return tuple(
        (str(p.relative_to(root)), p.stat().st_size, p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*")) if p.is_file()
    )


def _hot_sync(model_dir: Path) -> None:
    """Run the worker from studio_code/ of the model repo — ONLY if its signature verifies (codesign.py), checked again on the copy
    that is executed. A changed signature restarts the worker; an invalid one is refused and reported, and nothing runs."""
    src = next(iter(sorted(model_dir.rglob("studio_code"))), None)
    if src is None or not (src / "ms_worker.py").exists():
        return
    sig_file = src / codesign.SIG_NAME
    sig = sig_file.read_text(encoding="utf-8").strip() if sig_file.exists() else ""
    p = _PROC["p"]
    if not sig or not codesign.verify(src, sig):          # checked on every cycle, even when a worker is already running
        STATE["code"] = "رُفض: توقيع الكود غير صحيح أو غائب — لم يُنفَّذ (العامل الحالي يبقى كما هو)"
        return
    if sig == _PROC["sig"] and p is not None and p.poll() is None:
        return
    if p is not None and p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=20)
        except Exception:
            p.kill()
    shutil.rmtree(HOT, ignore_errors=True)
    shutil.copytree(src, HOT, symlinks=True)
    if not codesign.verify(HOT, sig):
        shutil.rmtree(HOT, ignore_errors=True)
        STATE["code"] = "رُفض: النسخة المنسوخة لا تطابق التوقيع"
        return
    env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TMPDIR") if k in os.environ}      # no account token, no secrets
    env.update(PYTHONPATH=str(HOT / "sham_small"), SHAM_MS_MODEL=MODEL_ID)
    log = open(HERE / "worker.log", "ab")
    _PROC["p"] = subprocess.Popen([sys.executable, str(HOT / "ms_worker.py")], cwd=str(HOT), env=env, stdout=log, stderr=log)
    _PROC["sig"] = sig
    STATE["code"] = f"يعمل (توقيع {sig[:8]})"


def _worker_status() -> dict:
    try:
        return json.loads((HOT / "worker_status.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _worker() -> None:
    last_sha = None
    last_media_sig = None
    while True:
        try:
            STATE.update(phase="downloading" if STATE["phase"] != "ready" else STATE["phase"])
            model_dir = _download()
            # Detect the packaged donor media independently before attempting to load Sham's text checkpoint.
            # A broken/not-yet-ready text body must not hide usable local image and speech weights.
            _refresh_media_assets(model_dir)
            man = next(iter(sorted(model_dir.rglob("bridge_manifest.json"))), None)
            sha = json.loads(man.read_text(encoding="utf-8")).get("sha") if man else None
            media_sig = _media_signature(model_dir)
            if sha is None or sha != last_sha or STATE["phase"] != "ready":
                _load(model_dir)
                last_sha = sha
                last_media_sig = _media_signature(model_dir)
            elif media_sig != last_media_sig:
                # Media weights are published in a separate workflow and intentionally
                # do not change the text checkpoint manifest. Refresh only media state.
                _refresh_media_assets(model_dir)
                last_media_sig = media_sig
            _hot_sync(model_dir)
        except Exception as exc:
            STATE.update(phase="waiting" if STATE["phase"] != "ready" else "ready",
                         error=f"{type(exc).__name__}: {str(exc)[:200]}")
            _say(f"failed: {type(exc).__name__}: {str(exc)[:200]}")
            print(traceback.format_exc()[-600:])
        time.sleep(300 if STATE["phase"] != "ready" else REFRESH_SECONDS)


def status() -> str:
    msg = dict(STATE)
    try:
        disk = shutil.disk_usage(HERE)
        msg["disk"] = {
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "free_mib": round(disk.free / 2**20, 1),
            "warning": "المساحة الحرة أقل من 1 GiB" if disk.free < 2**30 else "",
        }
    except OSError as exc:
        msg["disk"] = {"error": type(exc).__name__}
    w = _worker_status()
    if w:
        msg["worker"] = w
    if msg["phase"] == "waiting" and not _token():
        msg["hint"] = "ضعي MODELSCOPE_API_TOKEN في إعدادات الاستوديو (متغيرات البيئة) ليقرأ المستودع الخاص"
    if not msg.get("media_assets", {}).get("ready"):
        msg["media_hint"] = "لم تُثبت جاهزية الأوزان المحلية للصورة والصوت؛ لن يُستخدم أي مولّد خارجي. افحص media_assets.reason."
    return json.dumps(msg, ensure_ascii=False)


_CHAT_SEEN: dict = {}


def _studio_modules():
    """sham_studio_chat.py (the answer path) and sham_studio_media.py (pictures and sounds from the model's own tokens) live in sham_small. Prefer the
    SIGNED hot copy (_hot/sham_small, refreshed by the GitHub bridge without a Redeploy click) over the copy deployed with this file, and reload when it
    changes: later changes to how Sham answers need no manual deploy. Returns (chat module, media module)."""
    import importlib
    hot = HOT / "sham_small"
    files = [hot / "sham_studio_chat.py", hot / "sham_studio_media.py"]
    stamp = tuple((str(f), f.stat().st_mtime) if f.exists() else ("deployed", 0) for f in files)
    if _CHAT_SEEN.get("stamp") != stamp:
        if files[0].exists() and str(hot) not in sys.path:
            sys.path.insert(0, str(hot))
        for name in ("sham_studio_chat", "sham_studio_media", "sham_decoding", "sham_chat", "sham_media_ask", "sham_intent"):      # the hot copies replace the deployed ones
            sys.modules.pop(name, None)
        _CHAT_SEEN["mods"] = (importlib.import_module("sham_studio_chat"), importlib.import_module("sham_studio_media"))
        _CHAT_SEEN["stamp"] = stamp
    return _CHAT_SEEN["mods"]


def _studio_chat():
    return _studio_modules()[0]


def _json_notice(text: str) -> str:
    return json.dumps({"type": "notice", "text": text}, ensure_ascii=False)


def generate_any(prompt: str, max_new_tokens: float = 60) -> str:
    """JSON {"type": text|image|audio|notice, ...}: the MODEL decides whether its answer is words, a picture or a sound (sham_studio_media.generate_any).

    The Studio runs on CPU. Bound both generation length and lock waiting so a queued request
    does not sit until the caller's ~90-second HTTP deadline and then report a misleading timeout.
    SHAM_GENERATE_ANY_MAX_TOKENS can raise the default cap when the hardware is faster.
    """
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import serve
    try:
        token_cap = max(32, int(os.environ.get("SHAM_GENERATE_ANY_MAX_TOKENS", "96")))
    except (TypeError, ValueError):
        token_cap = 96
    n = int(max(1, min(MAX_NEW_TOKENS, token_cap, max_new_tokens)))
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        res = _studio_modules()[1].generate_any(serve._state["model"], serve._state["text_tokenizer"], serve._state["image_tokenizer"],
                                                serve._state["audio_tokenizer"], prompt, n)
        return json.dumps(_vet(res), ensure_ascii=False)
    except Exception as exc:
        print(f"generate_any failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return _json_notice("تعذّر توليد الرد الآن.")
    finally:
        _LOCK.release()


def _vet(res):
    """Quality gate at the Studio's exit: a blank / noise picture, silent audio or an empty video becomes a typed error (media_quality.py), never a reply."""
    from media_quality import gate_reply
    return gate_reply(res)


def _busy() -> str:
    """The 2-core box is writing another answer: say so at once instead of queueing behind it (callers fall back to serve.py)."""
    return json.dumps({"type": "busy", "text": "شام مشغول بطلب آخر الآن — أعد المحاولة بعد قليل."}, ensure_ascii=False)


def _busy_wait() -> float:
    try:
        return max(0.0, float(os.environ.get("SHAM_STUDIO_BUSY_WAIT", "25")))
    except ValueError:
        return 25.0


# Hugging Face generation implementation is preserved in quarantine/huggingface/modelscope-sham-app.py.disabled.

def _generate_media_with_backend(kind: str, prompt: str, backend: str, scenes: list[str] | None = None, narration: str = "") -> str:
    """Run exactly the selected Sham-owned path: internal tokens or packaged donor weights. No silent fallback."""
    selected = (backend or "internal").strip().lower()
    if selected not in ("internal", "ready"):
        return json.dumps({"type": "error", "text": "مسار الوسائط المحدد غير معروف."}, ensure_ascii=False)

    # The donor-weight generator is self-contained and must remain usable even
    # while Sham's separate text checkpoint is loading or unavailable.
    if selected == "ready":
        if not STATE.get("media_root"):
            return json.dumps({
                "type": "error",
                "text": "المسار البديل غير جاهز: لم تُعثر أوزان الصورة والصوت المحلية المطلوبة داخل مستودع شام. اختر «شام الداخلي» أو جهّز الأوزان محلياً."
            }, ensure_ascii=False)
    elif STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")

    if selected == "ready" and kind.strip().lower() == "video" and os.environ.get("SHAM_LOCAL_VIDEO", "") != "1":
        # The video pipeline needs 4-5.5 GB of RAM: loading it next to the text model killed this Studio (HTTP 502 right after sampling). Real video is Sham v2's own video Studio
        # (sham-v2-video-server); the bot calls it directly. SHAM_LOCAL_VIDEO=1 brings the old in-process path back (a Studio with the RAM for it).
        return json.dumps({"type": "error", "reason": "video_elsewhere", "text": "الفيديو يُصنع في استوديو الفيديو الخاص بشام v2، لا في استوديو المحادثة."}, ensure_ascii=False)
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        if selected == "ready":
            from sham_media_ready import make
            result = make(Path(STATE["media_root"]), kind, prompt, scenes=scenes, narration=narration)
        else:
            import serve
            result = _studio_modules()[1].make_media(
                serve._state["model"], serve._state["text_tokenizer"],
                serve._state["image_tokenizer"], serve._state["audio_tokenizer"],
                kind.strip().lower(), prompt
            )
        result = _vet(result)
        if isinstance(result, dict):
            result.setdefault("backend", selected)
        return json.dumps(result, ensure_ascii=False)
    except Exception as exc:
        print(f"generate_media[{selected}] failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return json.dumps({"type": "error", "text": "تعذّر التوليد عبر المسار المحدد؛ لم يتم التحويل تلقائياً إلى مسار آخر.", "backend": selected}, ensure_ascii=False)
    finally:
        _LOCK.release()


def generate_media(kind: str, prompt: str) -> str:
    """Stable API for bots and callers: defaults to Sham's internal generator. Optional local ready weights are selected explicitly in the Studio UI."""
    backend = os.environ.get("SHAM_MEDIA_BACKEND", "internal")
    return _generate_media_with_backend(kind, prompt, backend)


PANEL_BACKENDS = {"شام الداخلي (الأساسي)": "internal", "المسار البديل (أوزان محلية جاهزة)": "ready"}     # the labels clients send (src/lib/shamStudio.ts SHAM_BACKEND_LABELS)


def generate_media_from_panel(kind: str, prompt: str, backend_label: str, scenes_json: str = "", narration: str = "") -> str:
    """Select one media backend and optionally provide video shots and spoken narration."""
    label = (backend_label or "").strip()
    # explicit enum: an unknown label is an error, never a silent "internal" (which would answer with the untrained decoder). The Hugging Face route no longer exists.
    backend = PANEL_BACKENDS.get(label)
    if backend is None:
        return json.dumps({"type": "error", "reason": "unknown_route", "text": f"مسار الوسائط «{label[:60]}» غير معروف. المسارات المتاحة: " + " | ".join(PANEL_BACKENDS)}, ensure_ascii=False)
    try:
        scenes = json.loads(scenes_json) if (scenes_json or "").strip() else []
        if not isinstance(scenes, list):
            raise ValueError("scenes_json must contain a JSON list")
        scenes = [str(item).strip()[:300] for item in scenes if str(item).strip()][:6]
    except (TypeError, ValueError, json.JSONDecodeError):
        return json.dumps({"type": "error", "text": "مشاهد الفيديو يجب أن تكون قائمة JSON صحيحة."}, ensure_ascii=False)
    return _generate_media_with_backend(kind, prompt, backend, scenes=scenes, narration=(narration or "")[:1500])


def understand_media(kind: str, b64: str, question: str = "", teach: str = "", num_frames: float = 2) -> str:
    """Sham reads a picture / sound / video (base64 of the file, any format) and answers `question` about it — the same function as serve.py's
    /ask/audio (sham_media_ask.understand). `teach` = the user's own description of what they sent: the pair is kept as a self-learning
    experience (the guarded queue; the served weights never change). JSON {"type": "text", "text", "queued", "pending"?, "reason"?} | notice | busy."""
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import base64

    import serve
    from sham_media_ask import max_upload_bytes, understand
    try:
        raw = base64.b64decode((b64 or "").split(",")[-1], validate=False)
    except Exception:
        return _json_notice("الملف غير صالح.")
    if not raw or len(raw) > max_upload_bytes():
        return _json_notice("الملف فارغ أو أكبر من الحد المسموح.")
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        res = understand(serve._state["model"], serve._state["text_tokenizer"], serve._state["image_tokenizer"], serve._state["audio_tokenizer"],
                         kind, raw, question, teach=teach or None, num_frames=int(max(1, min(4, num_frames or 2))), state=serve._state)
        return json.dumps(res, ensure_ascii=False)
    except Exception as exc:
        print(f"understand_media failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return _json_notice("تعذّرت قراءة الملف الآن.")
    finally:
        _LOCK.release()


def ask_web(question: str, max_new_tokens: float = 60) -> str:
    """The engineer's live web answer (self_learn.ask_web_generate: sources in the prompt), now on the Studio too, and — exactly like serve.py's
    /ask/web — the turn is kept as an experience for the guarded learning round. JSON {"type": "text", "text", "hits", "queued", ...}."""
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import serve
    from self_learn import ask_web_generate, learn_in_background, record_experience, self_learn_enabled
    q = (question or "").strip()
    if not q:
        return _json_notice("اكتب سؤالك.")
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        answer, hits, sources = ask_web_generate(serve._state["model"], serve._state["text_tokenizer"], q,
                                                 max_new_tokens=int(max(1, min(MAX_NEW_TOKENS, max_new_tokens))), use_chat_wrap=True)
    except Exception as exc:
        print(f"ask_web failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return _json_notice("تعذّر البحث الآن.")
    finally:
        _LOCK.release()
    res = {"type": "text", "text": answer, "hits": len(hits), "queued": False}
    if self_learn_enabled():
        rec = record_experience(q, hits, sources)
        res.update(queued=rec["queued"], pending=rec.get("pending"))
        if not rec["queued"]:
            res["reason"] = rec.get("reason", "")
        elif learn_in_background(serve._state):
            res["learning_started"] = True
    return json.dumps(res, ensure_ascii=False)


def chat_auto(prompt: str, max_new_tokens: float = 60) -> str:
    """One entry for a plain message, no slash commands (owner, 2026-10-14): sham_intent.route_text catches the clear cases — «قم بتوليد صورة
    ارنب» → generate_media, «ابحث عن سعر الذهب اليوم» → ask_web (live search + experience) — and everything else goes to generate_any, where the
    model itself decides between words and media and may search on its own. JSON like generate_any, plus "route"."""
    from sham_intent import route_text
    route, arg = route_text(prompt)
    if route in ("image", "audio", "video"):
        out = generate_media(route, arg)
    elif route == "web":
        out = ask_web(arg, max_new_tokens)
    else:
        out = generate_any(prompt, max_new_tokens)
    try:
        obj = json.loads(out)
        obj["route"] = route
        return json.dumps(obj, ensure_ascii=False)
    except Exception:
        return out


def generate_text(prompt: str, max_new_tokens: float = 60) -> str:
    if STATE["phase"] != "ready":
        return "(شام يتهيأ بعد: " + STATE["phase"] + ")"
    import torch
    import serve
    from generate import generate_tokens
    from model import SpecialTokens
    n = int(max(1, min(MAX_NEW_TOKENS, max_new_tokens)))
    with _LOCK:
        tok, model = serve._state["text_tokenizer"], serve._state["model"]
        try:        # 2026-10-12: dialogue layout + today's date as context + the model's own learned web search (sham_studio_chat.py, hot code)
            return _studio_chat().studio_generate(model, tok, prompt, n)
        except Exception as exc:        # never take the Studio down: the raw continuation below is the old behaviour
            print(f"studio_generate failed ({type(exc).__name__}: {str(exc)[:120]}) — raw continuation", flush=True)
        ids = torch.tensor([tok.encode(prompt)], dtype=torch.long)
        out = generate_tokens(model, ids, max_new_tokens=n, temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS, repetition_penalty=1.3,
                              allowed_ranges=[(0, tok.vocab_size)] * n)
    new = [i for i in out[0, ids.shape[1]:].tolist() if i != SpecialTokens.EOS]
    return tok.decode(new)


def build_ui():
    import gradio as gr
    chat = gr.Interface(generate_text, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60)],
                        gr.Textbox(label="text"), api_name="generate_text", flagging_mode="never")
    anyk = gr.Interface(generate_any, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60)], gr.Textbox(label="json"),
                        api_name="generate_any", flagging_mode="never")
    media = gr.Interface(
        generate_media_from_panel,
        [
            gr.Textbox(label="نوع الوسائط (image / audio / video)", value="image"),
            gr.Textbox(label="الوصف أو النص المطلوب"),
            gr.Radio(
                choices=["شام الداخلي (الأساسي)", "المسار البديل (أوزان محلية جاهزة)"],
                value="شام الداخلي (الأساسي)",
                label="مسار وسائط شام — اختر المسار لكل طلب",
                info="الأساسي يستخدم مفكك شام نفسه. البديل يعمل فقط إذا كانت أوزانه المحلية موجودة."
            ),
            gr.Textbox(label="مشاهد الفيديو بصيغة JSON (اختياري)", value="[]"),
            gr.Textbox(label="التعليق الصوتي (اختياري)", value=""),
        ],
        gr.Textbox(label="النتيجة (JSON)"),
        api_name="generate_media_from_panel",
        flagging_mode="never",
    )
    legacy = gr.Interface(generate_media, [gr.Textbox(label="kind"), gr.Textbox(label="prompt")], gr.Textbox(label="json"),
                          api_name="generate_media", flagging_mode="never")      # registered again: older clients call it (it was missing => HTTP 500)
    read = gr.Interface(understand_media, [gr.Textbox(label="kind"), gr.Textbox(label="b64"), gr.Textbox(label="question"),
                                          gr.Textbox(label="teach"), gr.Number(label="num_frames", value=2)],
                        gr.Textbox(label="json"), api_name="understand_media", flagging_mode="never")
    web = gr.Interface(ask_web, [gr.Textbox(label="question"), gr.Number(label="max_new_tokens", value=60)], gr.Textbox(label="json"),
                       api_name="ask_web", flagging_mode="never")
    auto = gr.Interface(chat_auto, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60)], gr.Textbox(label="json"),
                        api_name="chat_auto", flagging_mode="never")
    st = gr.Interface(status, None, gr.Textbox(label="status"), api_name="status", flagging_mode="never")
    return gr.TabbedInterface([chat, anyk, media, legacy, read, web, auto, st],
                              ["شام", "شام (نص أو وسائط)", "وسائط بطلب", "وسائط (واجهة قديمة)", "فهم وسائط", "بحث حي", "رسالة عادية (توجيه تلقائي)", "الحالة"], title="شام — Sham")


if __name__ == "__main__":
    threading.Thread(target=_worker, daemon=True).start()
    build_ui().queue().launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
