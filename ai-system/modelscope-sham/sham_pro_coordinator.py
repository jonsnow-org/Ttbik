"""Sham Pro's coordinator INSIDE its own Studio (one model, one Studio: nothing of it touches another model).

A multi-step task ("describe photo.png, write a report, make a picture for it") is planned by Sham Pro's own chat, run step by step by the coordinator (ai-system/terminal/tasks.py:
durable task file, verifier, retry then replan, budget) and every see / hear / write / make step calls Sham Pro's own functions IN PROCESS (understand_media, generate_chat,
generate_media): no HTTP call to itself, so it cannot wait on the lock it is running under. Generated files still pass the media quality gate; a busy / notice / error answer from a
function fails that step instead of becoming a result.

Owner-only (the app sends owner=1 only for the owner, like generate_tldm) and one task at a time (the model and the task share the same cores). The Gradio entry points are in app.py
(`coordinate_start`, `coordinate_status`); the app functions are handed in by the caller so this module imports nothing from app.py.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import sys
import threading
import time
import uuid

HERE = pathlib.Path(__file__).resolve().parent
for _cand in (HERE / "terminal", HERE.parent / "terminal"):
    if _cand.is_dir() and str(_cand) not in sys.path:
        sys.path.insert(0, str(_cand))

from media_workers import GradioMedia, install  # noqa: E402
from sham_pro_agent import StudioPlanner  # noqa: E402
from tasks import Coordinator  # noqa: E402

ROOT = pathlib.Path(os.environ.get("SHAM_COORD_DIR", str(HERE / "_coord")))
MAX_KEPT = 8
MAX_FILE_BYTES = 3_000_000
_TASKS: dict[str, dict] = {}
_LOCK = threading.Lock()


class LocalMedia(GradioMedia):
    """The GradioMedia contract, served by direct calls to the Studio's own functions (api name -> callable returning the JSON string the Gradio api returns)."""

    def __init__(self, functions: dict):
        self.functions = functions

    def _call(self, api: str, payload: dict):
        fn = self.functions.get(api)
        if fn is None:
            raise RuntimeError(f"{api}: not available in this Studio")
        out = fn(**payload)
        return json.loads(out) if isinstance(out, str) and out[:1] in "{[" else out


def _folder(session: str) -> pathlib.Path:
    return ROOT / hashlib.sha256((session or "default").encode()).hexdigest()[:12]


def _summary(rec: dict) -> dict:
    t = rec.get("task")
    steps = [{"id": s.id, "kind": s.kind, "status": s.status, "result": (s.result or "")[:200]} for s in (t.steps if t else [])]
    folder = pathlib.Path(rec["folder"])
    files = sorted(p.name for p in folder.iterdir() if p.is_file() and not p.name.startswith(".")) if folder.is_dir() else []
    return {"type": "coordinator", "id": rec["id"], "status": rec["status"], "goal": rec["goal"], "steps": steps, "log": (t.log[-12:] if t else []), "files": files, "error": rec.get("error", "")}


def start(goal: str, session: str, functions: dict, owner: bool, coordinator_factory=None) -> dict:
    """Begin a task in the background and return at once. -> {"type": "coordinator", "id", "status": "planning", ...} or a notice."""
    goal = (goal or "").strip()[:2000]
    if not owner:
        return {"type": "notice", "text": "المنسّق متاح للمالك فقط."}
    if not goal:
        return {"type": "notice", "text": "اكتب المهمة."}
    with _LOCK:
        if any(r["status"] in ("planning", "running") for r in _TASKS.values()):
            return {"type": "busy", "text": "مهمة أخرى تعمل الآن؛ انتظر انتهاءها."}
        folder = _folder(session)
        folder.mkdir(parents=True, exist_ok=True)
        rec = {"id": uuid.uuid4().hex[:10], "goal": goal, "status": "planning", "folder": str(folder), "session": session, "task": None}
        _TASKS[rec["id"]] = rec
        for old in sorted(_TASKS, key=lambda k: _TASKS[k].get("t", 0))[:-MAX_KEPT]:
            _TASKS.pop(old, None)
        rec["t"] = time.time()

    def work():
        try:
            media = LocalMedia(functions)
            c = (coordinator_factory or (lambda f, m: Coordinator(f, StudioPlanner(m))))(str(folder), media)
            install(c, media)
            task = c.new_task(goal)
            rec["task"], rec["status"] = task, "running"
            c.run(task)
            rec["status"] = task.status
        except Exception as exc:                                    # a task never takes the Studio down
            rec["status"], rec["error"] = "failed", f"{type(exc).__name__}: {str(exc)[:200]}"

    threading.Thread(target=work, daemon=True, name="coordinator-" + rec["id"]).start()
    return _summary(rec)


def status(task_id: str, session: str, file: str = "") -> dict:
    rec = _TASKS.get((task_id or "").strip())
    if not rec or rec["session"] != session:                         # a task belongs to the session that started it
        return {"type": "notice", "text": "لا توجد مهمة بهذا المعرّف."}
    if file:
        p = pathlib.Path(rec["folder"]) / os.path.basename(file)
        if not p.is_file() or p.name.startswith("."):
            return {"type": "notice", "text": "لا يوجد هذا الملف."}
        if p.stat().st_size > MAX_FILE_BYTES:
            return {"type": "notice", "text": "الملف أكبر من الحد المسموح للنقل."}
        return {"type": "file", "name": p.name, "b64": base64.b64encode(p.read_bytes()).decode("ascii")}
    return _summary(rec)
