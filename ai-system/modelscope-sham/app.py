"""
Sham on the ModelScope Studio (free CPU box: 2 vCPU / 16 GB / always on) — hosting and a worker for Sham's own jobs.

What it does
  * serves the trained Sham (text now; the same load path as ai-system/colab/sham_small/serve.py) through Gradio's own API, the
    mechanism this Studio's platform proxy already speaks (gradio 6.17.3):  /gradio_api/call/generate_text , /gradio_api/call/status
  * keeps itself current: every REFRESH_SECONDS it asks the ModelScope hub for the newest published checkpoint and hot-swaps it
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
REFRESH_SECONDS = int(os.environ.get("SHAM_REFRESH_SECONDS", 3 * 3600))
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
        ids = torch.tensor([tok.encode(prompt)], dtype=torch.long)
        out = generate_tokens(model, ids, max_new_tokens=n, temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS,
                              allowed_ranges=[(0, tok.vocab_size)] * n)
    new = [i for i in out[0, ids.shape[1]:].tolist() if i != SpecialTokens.EOS]
    return tok.decode(new)


def build_ui():
    import gradio as gr
    chat = gr.Interface(generate_text, [gr.Textbox(label="prompt"), gr.Number(label="max_new_tokens", value=60)],
                        gr.Textbox(label="text"), api_name="generate_text", flagging_mode="never")
    st = gr.Interface(status, None, gr.Textbox(label="status"), api_name="status", flagging_mode="never")
    return gr.TabbedInterface([chat, st], ["شام", "الحالة"], title="شام — Sham")


if __name__ == "__main__":
    threading.Thread(target=_worker, daemon=True).start()
    build_ui().queue().launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
