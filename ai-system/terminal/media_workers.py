"""Phase 2 of the agent system: the four directions as workers of the coordinator (see, hear, write, make), on Sham's own service endpoints.

  see    image/video -> text      POST /ask/image | /ask/video   (multipart: file + question)         -> {"answer": ...}  saved as JSON
  hear   audio -> text            POST /ask/audio                (multipart: file + question)         -> {"answer": ...}  saved as JSON
  write  prompt -> long text      POST /generate/text            (json: prompt, max_new_tokens)       -> {"text": ...}    saved as a file
  make   prompt -> image|audio|video  POST /generate/image|audio|video                                 -> the media bytes  saved as a file

Every input and output is a FILE inside the task folder (confined like every other step), passed between steps by name, never pasted into the context.
Every generated file is judged by the existing media quality gate (ai-system/colab/sham_small/media_quality.py, read only): a blank or noise picture, silent audio or an empty video is a
FAILED step with the gate's reason code, so the coordinator retries or replans instead of delivering it. Nothing here edits Sham; it only calls the endpoints it already serves.
stdlib only (+ the gate's own numpy/Pillow when a file is judged).
"""
from __future__ import annotations

import io
import json
import mimetypes
import os
import sys
import uuid
import urllib.error
import urllib.request

_SHAM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "colab", "sham_small")


def quality_of(path: str) -> tuple[bool, str]:
    """The existing gate, by file type. -> (ok, reason code | stats)."""
    if _SHAM not in sys.path:
        sys.path.append(_SHAM)
    import media_quality as mq
    data = open(path, "rb").read()
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in (".png", ".jpg", ".jpeg", ".webp"):
            import numpy as np
            from PIL import Image
            img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
            return True, json.dumps(mq.check_image(img))
        if ext == ".wav":
            return True, json.dumps(mq.check_wav(data))
        if ext == ".mp4":
            return True, json.dumps(mq.check_mp4(data))
    except mq.MediaQualityError as e:
        return False, str(getattr(e, "reason", None) or getattr(e, "code", None) or e)
    except Exception as e:                                  # not decodable at all
        return False, f"unreadable: {type(e).__name__}"
    return True, "no gate for this file type"


def _multipart(fields: dict, file_field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    out.write(f'--{b}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{os.path.basename(filename)}"\r\nContent-Type: {ctype}\r\n\r\n'.encode("utf-8"))
    out.write(data + f"\r\n--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


class ShamMedia:
    """A thin client of one Sham service (a Studio, or a local `serve.py`)."""

    def __init__(self, base_url: str, timeout: float = 120.0, headers: dict | None = None):
        self.base, self.timeout, self.headers = base_url.rstrip("/"), timeout, dict(headers or {})

    def _call(self, path: str, body: bytes, ctype: str) -> tuple[int, bytes, str]:
        req = urllib.request.Request(self.base + path, data=body, headers={"Content-Type": ctype, **self.headers})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.status, r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def ask(self, kind: str, filename: str, data: bytes, question: str) -> dict:
        body, ctype = _multipart({"question": question}, "file", filename, data)
        code, raw, _ = self._call(f"/ask/{kind}", body, ctype)
        if code != 200:
            raise RuntimeError(f"HTTP {code}: {raw[:120].decode('utf-8', 'replace')}")
        return json.loads(raw)

    def text(self, prompt: str, max_new_tokens: int = 200) -> str:
        code, raw, _ = self._call("/generate/text", json.dumps({"prompt": prompt, "max_new_tokens": max_new_tokens}).encode(), "application/json")
        if code != 200:
            raise RuntimeError(f"HTTP {code}: {raw[:120].decode('utf-8', 'replace')}")
        return json.loads(raw)["text"]

    def make(self, kind: str, prompt: str, num_frames: int = 2) -> bytes:
        payload = {"prompt": prompt, **({"num_frames": num_frames} if kind == "video" else {})}
        code, raw, _ = self._call(f"/generate/{kind}", json.dumps(payload).encode(), "application/json")
        if code != 200:
            raise RuntimeError(f"HTTP {code}: {raw[:160].decode('utf-8', 'replace')}")      # e.g. 503 native-video-unavailable: reported honestly, never faked
        return raw


EXT = {"image": ".png", "audio": ".wav", "video": ".mp4"}


def install(coord, media: ShamMedia) -> None:
    """Add see / hear / write / make to a Coordinator. They use the coordinator's own folder confinement."""
    path = coord.verify._path

    def see(step):
        a = step.args
        kind = a.get("media", "image")
        src = path(a["file"])
        ans = media.ask(kind, os.path.basename(src), open(src, "rb").read(), a.get("question", "ما الذي في هذا الملف؟"))
        out = a.get("out", f"{step.id}.json")
        json.dump(ans, open(path(out), "w", encoding="utf-8"), ensure_ascii=False)
        return True, str(ans.get("answer", ""))

    def hear(step):
        a = dict(step.args, media="audio")
        step.args = a
        return see(step)

    def write(step):
        a = step.args
        text = media.text(a["prompt"], int(a.get("max_new_tokens", 200)))
        out = a.get("out", f"{step.id}.md")
        open(path(out), "w", encoding="utf-8").write(text)
        return True, text[:300]

    def make(step):
        a = step.args
        kind = a.get("media", "image")
        data = media.make(kind, a["prompt"], int(a.get("num_frames", 2)))
        out = a.get("out", f"{step.id}{EXT[kind]}")
        open(path(out), "wb").write(data)
        good, why = quality_of(path(out))
        if not good:
            os.remove(path(out))                             # a rejected file is never left lying around as if it were a result
            return False, f"quality gate: {why}"
        return True, f"{out} ({len(data)} bytes) {why}"

    coord.workers.update({"see": see, "hear": hear, "write": write, "make": make})
