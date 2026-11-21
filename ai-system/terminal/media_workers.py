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


class GradioMedia:
    """The same four calls (ask / text / make) as ShamMedia, over a Studio's Gradio API (the way the real Sham Pro Studio is served: api_name understand_media,
    generate_chat, generate_media; protocol POST /gradio_api/call/v2/<api> then GET the event stream, as ai-system/colab/sham_small/web/studio_client.py proved).
    It is ONE model's client: the address and the token are given by the caller, there is no default and no fallback to another model's Studio, and a busy / notice /
    error answer is raised as a failure (the coordinator retries or replans) and never turned into a result."""

    def __init__(self, base_url: str, token: str, timeout: float = 180.0, session=None):
        if not base_url or not token:
            raise ValueError("a Studio address and its token are both required (no default Studio, no other model's Studio)")
        import requests
        self.base, self.timeout = base_url.rstrip("/"), timeout
        self.http = session or requests
        self.headers = {"Authorization": f"Bearer {token}", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"}

    def _call(self, api: str, payload: dict):
        sub = self.http.post(f"{self.base}/gradio_api/call/v2/{api}", headers=self.headers, json=payload, timeout=30)
        sub.raise_for_status()
        res = self.http.get(f"{self.base}/gradio_api/call/{api}/{sub.json()['event_id']}", headers=self.headers, timeout=self.timeout, stream=True)
        res.raise_for_status()
        for line in res.iter_lines():
            line = line.decode("utf-8", "replace") if isinstance(line, bytes) else line
            if line and line.startswith("data:"):
                data = json.loads(line[len("data:"):].strip())
                if isinstance(data, list) and data:
                    out = data[0]
                    return json.loads(out) if isinstance(out, str) and out[:1] in "{[" else out
        raise RuntimeError(f"{api}: the Studio sent no result")

    @staticmethod
    def _ok(res, *types):
        if not isinstance(res, dict) or res.get("type") not in types:
            what = (res.get("text") or res.get("reason") or res.get("type")) if isinstance(res, dict) else str(res)[:80]
            raise RuntimeError(f"studio did not answer: {str(what)[:160]}")      # busy / notice / error: reported, never faked
        return res

    def ask(self, kind: str, filename: str, data: bytes, question: str) -> dict:
        import base64
        r = self._ok(self._call("understand_media", {"kind": kind, "b64": base64.b64encode(data).decode("ascii"), "question": question, "teach": "", "num_frames": 2}), "text")
        return {"answer": r.get("text", "")}

    def text(self, prompt: str, max_new_tokens: int = 200) -> str:
        msgs = json.dumps([{"role": "user", "content": prompt}], ensure_ascii=False)
        return str(self._ok(self._call("generate_chat", {"messages_json": msgs, "max_new_tokens": max_new_tokens, "temperature": 0.6, "think_tokens": 0}), "text").get("text", ""))

    def make(self, kind: str, prompt: str, num_frames: int = 2) -> bytes:
        import base64
        r = self._ok(self._call("generate_media", {"kind": kind, "prompt": prompt}), kind)
        return base64.b64decode(r["b64"])


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
