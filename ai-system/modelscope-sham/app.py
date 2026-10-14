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
os.environ.setdefault("SHAM_MEMORY_DIR", str(HERE / "_memory"))           # Palmyra Memory: one hashed directory per user (sham_memory.py)
REFRESH_SECONDS = int(os.environ.get("SHAM_REFRESH_SECONDS", 1200))
STATE = {"phase": "starting", "detail": "", "step": 0, "revision": "", "loaded_at": 0, "error": ""}
_LOCK = threading.Lock()
HOT = HERE / "_hot"            # signed code synced from the model repo (studio_code/): new code reaches the Studio without a Redeploy click
_PROC = {"p": None, "sig": ""}


def _token() -> str:
    return os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""


def _download() -> Path:
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    tok = _token()
    if tok:
        HubApi().login(tok)
    return Path(snapshot_download(MODEL_ID, cache_dir=str(HERE / "_models")))


def _load(model_dir: Path) -> None:
    import serve
    ckpt = next(iter(sorted(model_dir.rglob("final_merged.pt"))), None) or next(iter(sorted(model_dir.rglob("*.pt"))), None)
    tok = next(iter(sorted(model_dir.rglob("sham_small_tokenizer.json"))), None)
    if ckpt is None or tok is None:
        raise RuntimeError("المستودع لا يحوي نقطة الحفظ أو مقطّع النص بعد")
    with _LOCK:
        serve.load_model(checkpoint_path=str(ckpt), tokenizer_path=str(tok))
    STATE.update(phase="ready", detail=str(serve._state.get("source", "")), loaded_at=int(time.time()), error="")
    manifest = next(iter(sorted(model_dir.rglob("bridge_manifest.json"))), None)
    if manifest:
        try:
            STATE["revision"] = json.loads(manifest.read_text(encoding="utf-8")).get("sha", "")[:12]
        except Exception:
            pass


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
    while True:
        try:
            STATE.update(phase="downloading" if STATE["phase"] != "ready" else STATE["phase"])
            model_dir = _download()
            man = next(iter(sorted(model_dir.rglob("bridge_manifest.json"))), None)
            sha = json.loads(man.read_text(encoding="utf-8")).get("sha") if man else None
            if sha is None or sha != last_sha or STATE["phase"] != "ready":
                _load(model_dir)
                last_sha = sha
            _hot_sync(model_dir)
        except Exception as exc:
            STATE.update(phase="waiting" if STATE["phase"] != "ready" else "ready",
                         error=f"{type(exc).__name__}: {str(exc)[:200]}")
            print(traceback.format_exc()[-600:])
        time.sleep(300 if STATE["phase"] != "ready" else REFRESH_SECONDS)


def status() -> str:
    msg = dict(STATE)
    w = _worker_status()
    if w:
        msg["worker"] = w
    if msg["phase"] == "waiting" and not _token():
        msg["hint"] = "ضعي MODELSCOPE_API_TOKEN في إعدادات الاستوديو (متغيرات البيئة) ليقرأ المستودع الخاص"
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
        for name in ("sham_studio_chat", "sham_studio_media", "sham_decoding", "sham_chat", "sham_media_ask", "sham_intent", "sham_memory"):      # the hot copies replace the deployed ones
            sys.modules.pop(name, None)
        _CHAT_SEEN["mods"] = (importlib.import_module("sham_studio_chat"), importlib.import_module("sham_studio_media"))
        _CHAT_SEEN["stamp"] = stamp
    return _CHAT_SEEN["mods"]


def _studio_chat():
    return _studio_modules()[0]


def _json_notice(text: str) -> str:
    return json.dumps({"type": "notice", "text": text}, ensure_ascii=False)


def generate_any(prompt: str, max_new_tokens: float = 60) -> str:
    """JSON {"type": text|image|audio|notice, ...}: the MODEL decides whether its answer is words, a picture or a sound (sham_studio_media.generate_any)."""
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import serve
    n = int(max(1, min(200, max_new_tokens)))
    try:
        with _LOCK:
            res = _studio_modules()[1].generate_any(serve._state["model"], serve._state["text_tokenizer"], serve._state["image_tokenizer"],
                                                    serve._state["audio_tokenizer"], prompt, n)
        return json.dumps(res, ensure_ascii=False)
    except Exception as exc:
        print(f"generate_any failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return _json_notice("تعذّر توليد الرد الآن.")


def _busy() -> str:
    """The 2-core box is writing another answer: say so at once instead of queueing behind it (callers fall back to serve.py)."""
    return json.dumps({"type": "busy", "text": "شام مشغول بطلب آخر الآن — أعد المحاولة بعد قليل."}, ensure_ascii=False)


def _busy_wait() -> float:
    try:
        return max(0.0, float(os.environ.get("SHAM_STUDIO_BUSY_WAIT", "25")))
    except ValueError:
        return 25.0


def generate_media(kind: str, prompt: str) -> str:
    """JSON like generate_any, but the USER chose the kind (image | audio | video), e.g. the bot's /image command.
    Media is slow on this CPU: if another request holds the model for more than SHAM_STUDIO_BUSY_WAIT seconds, {"type": "busy"} comes back."""
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import serve
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        res = _studio_modules()[1].make_media(serve._state["model"], serve._state["text_tokenizer"], serve._state["image_tokenizer"],
                                              serve._state["audio_tokenizer"], kind.strip().lower(), prompt)
        return json.dumps(res, ensure_ascii=False)
    except Exception as exc:
        print(f"generate_media failed ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
        return _json_notice("تعذّر التوليد الآن.")
    finally:
        _LOCK.release()


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
                                                 max_new_tokens=int(max(1, min(200, max_new_tokens))), use_chat_wrap=True)
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


def chat_memory(prompt: str, max_new_tokens: float = 60, user_id: str = "", history: str = "", summary: str = "", facts: str = "") -> str:
    """chat_auto WITH Palmyra Memory (sham_memory.py, 2026-10-14). A new entry — chat_auto and every other endpoint are unchanged.
    user_id: the caller's id for this person (hashed on disk); history: JSON [{"q","a"}] of the recent turns from the site's database (optional:
    without it the Studio's own log is used); summary: the site's rolling summary; facts: JSON {"name", "city", ...}. Without user_id, or with
    SHAM_MEMORY=0, this answers exactly like chat_auto. Media and live-search routes go the same way as chat_auto; a plain message gets the
    memory answer, and «انسَ معلوماتي» deletes this user's memory. JSON like chat_auto, plus "memory" stats."""
    from sham_intent import route_text
    if not (user_id or "").strip():
        return chat_auto(prompt, max_new_tokens)
    try:
        import sham_memory
    except Exception as exc:
        print(f"sham_memory unavailable ({type(exc).__name__}) — chat_auto", flush=True)
        return chat_auto(prompt, max_new_tokens)
    if not sham_memory.memory_enabled():
        return chat_auto(prompt, max_new_tokens)
    if sham_memory.is_forget_command(prompt):
        sham_memory.UserMemory(user_id).forget()
        return json.dumps({"type": "notice", "text": "تم. حذفت كل ما أتذكّره عنك.", "forgotten": True, "route": "forget"}, ensure_ascii=False)
    route, _arg = route_text(prompt)
    if route != "chat" or prompt.strip().startswith("#"):
        return chat_auto(prompt, max_new_tokens)
    if STATE["phase"] != "ready":
        return _json_notice("(شام يتهيأ بعد: " + STATE["phase"] + ")")
    import serve

    def _json(s, default):
        try:
            v = json.loads(s) if (s or "").strip() else default
            return v if isinstance(v, type(default)) else default
        except Exception:
            return default
    hist = _json(history, [])
    hist = [{"q": str(t.get("q", ""))[:2000], "a": str(t.get("a", ""))[:2000]} for t in hist if isinstance(t, dict)][-60:] if (history or "").strip() else None
    if not _LOCK.acquire(timeout=_busy_wait()):
        return _busy()
    try:
        res = sham_memory.memory_answer(serve._state["model"], serve._state["text_tokenizer"], user_id.strip(), prompt,
                                        int(max(1, min(200, max_new_tokens))), history=hist, summary=(summary or "")[:1500],
                                        site_facts=_json(facts, {}))
    except Exception as exc:
        print(f"chat_memory failed ({type(exc).__name__}: {str(exc)[:160]}) — chat_auto", flush=True)
        res = None
    finally:
        _LOCK.release()
    if res is None or (res.get("type") == "text" and not res.get("text")):
        return chat_auto(prompt, max_new_tokens)
    res["route"] = "memory"
    return json.dumps(res, ensure_ascii=False)


def memory_forget(user_id: str) -> str:
    """Delete everything Palmyra Memory keeps for this user (the bot also calls this when the user asks it to forget)."""
    try:
        import sham_memory
        gone = sham_memory.UserMemory((user_id or "").strip()).forget() if (user_id or "").strip() else False
    except Exception:
        gone = False
    return json.dumps({"type": "notice", "forgotten": bool(gone)}, ensure_ascii=False)


def generate_text(prompt: str, max_new_tokens: float = 60) -> str:
    if STATE["phase"] != "ready":
        return "(شام يتهيأ بعد: " + STATE["phase"] + ")"
    import torch
    import serve
    from generate import generate_tokens
    from model import SpecialTokens
    n = int(max(1, min(200, max_new_tokens)))
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
    media = gr.Interface(generate_media, [gr.Textbox(label="kind"), gr.Textbox(label="prompt")], gr.Textbox(label="json"),
                         api_name="generate_media", flagging_mode="never")
    read = gr.Interface(understand_media, [gr.Textbox(label="kind"), gr.Textbox(label="b64"), gr.Textbox(label="question"),
                                          gr.Textbox(label="teach"), gr.Number(label="num_frames", value=2)],
                        gr.Textbox(label="json"), api_name="understand_media", flagging_mode="never")
    web = gr.Interface(ask_web, [gr.Textbox(label="question"), gr.Number(label="max_new_tokens", value=60)], gr.Textbox(label="json"),
                       api_name="ask_web", flagging_mode="never")
    auto = gr.Interface(chat_auto, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60)], gr.Textbox(label="json"),
                        api_name="chat_auto", flagging_mode="never")
    mem = gr.Interface(chat_memory, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60), gr.Textbox(label="user_id"),
                                     gr.Textbox(label="history"), gr.Textbox(label="summary"), gr.Textbox(label="facts")],
                       gr.Textbox(label="json"), api_name="chat_memory", flagging_mode="never")
    forget = gr.Interface(memory_forget, [gr.Textbox(label="user_id")], gr.Textbox(label="json"), api_name="memory_forget", flagging_mode="never")
    st = gr.Interface(status, None, gr.Textbox(label="status"), api_name="status", flagging_mode="never")
    return gr.TabbedInterface([chat, anyk, media, read, web, auto, mem, forget, st],
                              ["شام", "شام (نص أو وسائط)", "وسائط بطلب", "فهم وسائط", "بحث حي", "رسالة عادية (توجيه تلقائي)", "رسالة مع ذاكرة",
                               "مسح الذاكرة", "الحالة"], title="شام — Sham")


if __name__ == "__main__":
    threading.Thread(target=_worker, daemon=True).start()
    build_ui().queue().launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
