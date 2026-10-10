"""
Automatic repair of a platform failure no code can prevent: Kaggle could not ATTACH one of a notebook's input datasets
(`ERRORED_MOUNTING_DATASET … /input/datasets/<owner>/<name>`, e.g. the chat stage on 2026-10-09: the notebook never started, so
its checkpoint stayed 6 days old).

Every Sham notebook finds the datasets it needs by itself through the Kaggle API, so an attached input is only a shortcut. The
status job (every 3 hours) therefore:
  1. finds notebooks whose last run died with that error;
  2. pulls the notebook with its settings (`kernels pull -m`: GPU, internet, privacy, secrets exactly as they are);
  3. removes ONLY the failing dataset from `dataset_sources`;
  4. pushes the notebook back (which starts the run the failed one should have been) — at most once per notebook per 24 h and
     twice per status run, so a persistent platform fault can never burn the free GPU quota in a loop.
The attempt record lives in `repairs.json` on the `sham-status` branch. Nothing else about the notebook is touched.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

MOUNT_RE = re.compile(r"/input/datasets/([\w.\-]+)/([\w.\-]+)")
COOLDOWN_S = 24 * 3600


def mount_target(failure: str) -> str | None:
    if "ERRORED_MOUNTING_DATASET" not in (failure or ""):
        return None
    m = MOUNT_RE.search(failure)
    return f"{m.group(1)}/{m.group(2)}" if m else None


def repair_mount_failures(kernels: list[dict], state: dict | None, work: Path, run=subprocess.run, now: float | None = None,
                          max_per_run: int = 2) -> tuple[list[str], dict]:
    """(human notes, new state). kernels: registry rows with ref/alias/status/failure."""
    now = time.time() if now is None else now
    state, notes, done = dict(state or {}), [], 0
    for k in kernels:
        slug = mount_target(k.get("failure", "")) if k.get("status") == "error" else None
        if not slug:
            continue
        ref = k["ref"]
        last = state.get(ref, {}).get("at")
        if last is not None and now - last < COOLDOWN_S:
            continue
        if done >= max_per_run:
            notes.append(f"⏭ {k.get('alias', '?')}: يؤجَّل إلى الجولة القادمة (حد {max_per_run} إصلاحات في الجولة)")
            continue
        d = Path(work) / ref.replace("/", "__")
        d.mkdir(parents=True, exist_ok=True)
        try:
            r = run(["kaggle", "kernels", "pull", ref, "-p", str(d), "-m"], capture_output=True, text=True, timeout=180)
            meta_p = d / "kernel-metadata.json"
            if r.returncode != 0 or not meta_p.exists():
                raise RuntimeError("تعذّر سحب الدفتر: " + ((r.stderr or r.stdout or "").strip().splitlines() or ["؟"])[0][:100])
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            sources = meta.get("dataset_sources") or []
            kept = [s for s in sources if s.lower() != slug.lower()]
            if len(kept) == len(sources):
                state[ref] = {"at": now, "result": "المجموعة ليست في مدخلات الدفتر المحفوظة"}
                notes.append(f"ℹ {k.get('alias', '?')}: «{slug}» ليست بين مدخلاته المحفوظة — لا شيء يُزال")
                continue
            meta["dataset_sources"] = kept
            meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            p = run(["kaggle", "kernels", "push", "-p", str(d)], capture_output=True, text=True, timeout=300)
            out = ((p.stdout or "") + (p.stderr or "")).strip()
            ok = p.returncode == 0 and "error" not in out.lower()
            state[ref] = {"at": now, "dropped": slug, "ok": ok}
            done += 1
            notes.append(f"🔧 {k.get('alias', '?')}: أُزيلت «{slug}» من مدخلاته وأُعيد رفعه وتشغيله تلقائياً" if ok else
                         f"❌ {k.get('alias', '?')}: فشل رفع الدفتر بعد إزالة «{slug}»: {out[:100]}")
        except Exception as exc:
            state[ref] = {"at": now, "error": f"{type(exc).__name__}: {str(exc)[:100]}"}
            notes.append(f"❌ {k.get('alias', '?')}: تعذّر الإصلاح التلقائي — {str(exc)[:100]}")
    return notes, state


if __name__ == "__main__":
    import tempfile

    pushes = []

    class R:
        def __init__(self, out="", code=0): self.stdout, self.stderr, self.returncode = out, "", code

    def fake_run(cmd, **k):
        if cmd[:3] == ["kaggle", "kernels", "pull"]:
            d = Path(cmd[cmd.index("-p") + 1])
            (d / "kernel-metadata.json").write_text(json.dumps({
                "id": cmd[3], "enable_gpu": True, "dataset_sources": ["me/keep-this", "me/sham-crawl-xlive-corpus"]}), encoding="utf-8")
            (d / "nb.ipynb").write_text("{}", encoding="utf-8")
            return R()
        if cmd[:3] == ["kaggle", "kernels", "push"]:
            meta = json.loads((Path(cmd[cmd.index("-p") + 1]) / "kernel-metadata.json").read_text(encoding="utf-8"))
            pushes.append(meta)
            return R("Kernel version 14 successfully pushed.")
        return R("", 1)

    fail = "mount data: ERRORED_MOUNTING_DATASET: DataSourceUrl.addDataset(gs://x => /tmp/fs/k/input/datasets/me/sham-crawl-xlive-corpus): retry budget exhausted"
    kernels = [{"ref": "me/chat5", "alias": "المرحلة الثالثة 5", "status": "error", "failure": fail},
               {"ref": "me/other", "alias": "x", "status": "error", "failure": "CUDA out of memory"},
               {"ref": "me/fine", "alias": "y", "status": "complete", "failure": ""}]
    with tempfile.TemporaryDirectory() as td:
        notes, st = repair_mount_failures(kernels, {}, Path(td), run=fake_run, now=1000.0)
        assert len(pushes) == 1 and pushes[0]["dataset_sources"] == ["me/keep-this"] and pushes[0]["enable_gpu"] is True, pushes
        assert st["me/chat5"]["ok"] and any("أُزيلت" in n for n in notes) and "me/other" not in st, (notes, st)
        # the cooldown: the same notebook failing again within 24 h is NOT pushed again (no quota-burning loop)
        notes2, st2 = repair_mount_failures(kernels, st, Path(td), run=fake_run, now=1000.0 + 3600)
        assert len(pushes) == 1 and not notes2, (pushes, notes2)
        notes3, _ = repair_mount_failures(kernels, st, Path(td), run=fake_run, now=1000.0 + COOLDOWN_S + 1)
        assert len(pushes) == 2, "after the cooldown it may try again"
        # a failing pull is reported, never raised
        notes4, st4 = repair_mount_failures(kernels, {}, Path(td), run=lambda *a, **k: R("", 1), now=5.0)
        assert any("تعذّر" in n for n in notes4) and "error" in st4["me/chat5"]
    assert mount_target("CUDA out of memory") is None and mount_target(fail) == "me/sham-crawl-xlive-corpus"
    print("sham_auto_repair self-test OK")
