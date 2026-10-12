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
        r = studio_client.generate_any(q, 60, timeout=170) if api == "any" else studio_client.generate_media(api, q, timeout=300)
        if r is None:
            print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): — لا جواب (الاستوديو ما زال على النسخة القديمة؟)")
            continue
        size = f" | {len(r.get('b64') or '') * 3 // 4:,} بايت {r.get('mime', '')}" if r.get("b64") else ""
        print(f"\nس: {q}\nج ({time.time() - t0:.0f} ث): النوع={r.get('type')}{size} {(r.get('text') or '')[:500]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
