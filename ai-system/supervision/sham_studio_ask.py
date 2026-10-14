"""
Ask the hosted Sham (ModelScope Studio) some questions and print the answers (read-only, same call the Telegram bot makes).

    ASK="سؤال 1|سؤال 2" python sham_studio_ask.py        (needs MODELSCOPE_TOKEN; no secret is printed)

Prints the Studio's own status (phase/step and the network probe the worker wrote, so we can see whether it reaches a search provider) and, per question,
the answer and how long it took. Used to check what a new Studio version really does, instead of guessing from the log.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

DEFAULT = ["ما تاريخ اليوم؟", "في أي سنة نحن؟", "ما هي عاصمة فرنسا؟", "اللغة العربية هي"]


def _content_stats(r: dict) -> str:
    """Is the picture / sound empty or does it carry anything? (read-only look at the returned bytes)"""
    import base64, io
    raw = base64.b64decode(r["b64"])
    try:
        if r.get("mime") == "image/png":
            from PIL import Image
            import numpy as np
            a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
            blocks = a.reshape(a.shape[0] // 8, 8, a.shape[1] // 8, 8, 3).mean(axis=(1, 3))
            return f"{a.shape[1]}x{a.shape[0]} | متوسط {a.mean():.1f} | انحراف {a.std():.1f} | ألوان مختلفة {len(np.unique(a.reshape(-1, 3), axis=0))} | انحراف الكتل {blocks.std():.1f}"
        import wave
        import numpy as np
        w = wave.open(io.BytesIO(raw))
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        return f"{w.getframerate()} هرتز | {len(x) / w.getframerate():.1f} ث | أعلى سعة {np.abs(x).max():.0f} | انحراف {x.std():.1f}"
    except Exception as e:
        return f"تعذّر الفحص: {type(e).__name__}: {e}"


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        print("لا مفتاح ModelScope — لا فحص")
        return 0
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small" / "web"))
    import studio_client
    os.environ["MODELSCOPE_API_TOKEN"] = token
    st = studio_client.studio_status()
    print("حالة الاستوديو:", json.dumps(st, ensure_ascii=False)[:1800] if st else "لا يردّ")
    qs = [q.strip() for q in os.environ.get("ASK", "").split("|") if q.strip()] or DEFAULT
    api = os.environ.get("API", "text")           # text (the old call) | any (the model decides: words / picture / sound) | image | audio | video (the user chose the kind)
    for q in qs:
        t0 = time.time()
        if api == "text":
            a = studio_client.generate_text(q, 60, timeout=170)
            print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): {(a or '— لا جواب')[:600]}")
            continue
        if api == "think":         # 2026-10-14: the bot's new one-step path (app.py think + job_result), timed end to end
            try:
                r = json.loads(studio_client._call("think", {"prompt": q, "max_new_tokens": 60, "user_id": "ci-ask", "history": "", "summary": "",
                                                              "facts": ""}, timeout=60))
                first = time.time() - t0
                while r.get("type") == "pending" and time.time() - t0 < 120:
                    time.sleep(3)
                    r = json.loads(studio_client._call("job_result", {"job_id": r["job"], "detach": ""}, timeout=20))
            except Exception as exc:
                print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): — فشل think ({type(exc).__name__}: {str(exc)[:200]})")
                continue
            print(f"\nس: {q}\nج (أول رد {first:.1f} ث، نهائي {time.time() - t0:.1f} ث): النوع={r.get('type')} القرار={r.get('decision')} "
                  f"{(r.get('text') or '')[:400]}")
            continue
        r = studio_client.generate_any(q, 60, timeout=170) if api == "any" else studio_client.generate_media(api, q, timeout=300)
        if r is None:
            print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): — لا جواب (الاستوديو ما زال على النسخة القديمة؟)")
            continue
        size = f" | {len(r.get('b64') or '') * 3 // 4:,} بايت {r.get('mime', '')}" if r.get("b64") else ""
        print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): النوع={r.get('type')}{size} {(r.get('text') or '')[:500]}")
        if r.get("b64"):
            print("   فحص المحتوى:", _content_stats(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
