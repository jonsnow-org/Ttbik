"""
A text-training session on Modal (free credits, billed per second; CPU works without a card, GPU needs a payment method), started from GitHub — no notebook to open, nothing to click.

What it does (CPU by default; `--device gpu` for a T4 once a payment method is on the account):
  1. downloads the current best weights (Kaggle `sham-merged-checkpoint`) and the fresh pre-tokenized text windows (Kaggle `sham-text-shards`,
     built on GitHub — so no live internet source can rate-limit this session);
  2. times a few steps, then trains for the requested minutes (never more) with the project's own train() — mixed precision on the GPU and the
     held-out regression guard (sham_train_eval) that keeps the best weights seen, exactly as every other Sham session;
  3. publishes the result as the Kaggle dataset `sham-crawl-modal`: the merge job discovers every `sham-crawl-*` model by itself and adopts it only
     if no skill got worse (the merge gate). Nothing here changes the served model directly.

The Modal account is on the free Starter plan with Modal's own $1 usage cap (no card): a session of ~12 minutes costs about $0.12.
Secrets are passed from the GitHub runner's environment into the container and are never printed.

    modal run ai-system/modal/sham_gpu_text.py --minutes 12 --device cpu   (from GitHub: .github/workflows/sham-modal.yml)
    python sham_gpu_text.py                                       offline self-test (tiny model, CPU, local fakes)
"""

from __future__ import annotations

import copy
import os
import random
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "colab" / "sham_small"
DATASET_OUT = "sham-crawl-modal"


def session(minutes: float, fetch, publish, device: str = "cuda", seq_len: int = 1024, batch_size: int = 8, lr: float = 1e-4,
            work: Path | None = None) -> dict:
    """The whole session. `fetch(name)` -> a folder of that dataset; `publish(folder, name, message)` -> slug. Both are injected so the
    offline test needs no network."""
    import torch
    import sham_inputs        # noqa: F401  (installs the mixed-precision switch and the held-out regression guard on train.train)
    import sham_token_shards
    import train as T
    from checkpoint import load_checkpoint, save_checkpoint
    from text_tokenizer import ShamTextTokenizer

    t0 = time.time()
    out: dict = {"device": device}
    base = fetch("sham-merged-checkpoint")
    ckpt = next(iter(sorted(Path(base).rglob("final_merged.pt"))), None) if base else None
    tok_file = next(iter(sorted(Path(base).rglob("sham_small_tokenizer.json"))), None) if base else None
    if ckpt is None or tok_file is None:
        return {**out, "error": "لا نقطة حفظ مدموجة لأبدأ منها"}
    model, step0, _ = load_checkpoint(ckpt, map_location="cpu")
    tokenizer = ShamTextTokenizer.load(str(tok_file))
    shards_dir = fetch(sham_token_shards.DATASET)
    windows = sham_token_shards.load(tokenizer, seq_len, roots=[shards_dir] if shards_dir else []) if shards_dir else None
    if not windows:
        return {**out, "error": "لا نوافذ نص جاهزة تناسب مقطّع شام وطول النافذة"}
    out.update(start_step=step0, windows=len(windows))

    rng = random.Random(int(time.time()))

    def make_batches(n: int) -> list:
        return [torch.tensor([windows[rng.randrange(len(windows))] for _ in range(batch_size)], dtype=torch.long) for _ in range(n)]

    def cfg_for(steps: int):
        return T.TrainConfig(seq_len=seq_len, batch_size=batch_size, lr=lr, total_steps=steps, warmup_steps=max(1, steps // 20),
                             checkpoint_dir=str(work or tempfile.mkdtemp()), checkpoint_every=10 ** 9, log_every=max(1, steps // 5))

    # 1) time a few steps on a COPY, so the real run's step count fits the minutes asked for
    probe_n = 12
    trial = copy.deepcopy(model).to(device)
    ts = time.time()
    T.train(trial, make_batches(probe_n), cfg_for(probe_n), device=device)
    s_per_step = (time.time() - ts) / probe_n
    del trial
    budget = max(0.0, minutes * 60 - (time.time() - t0)) * 0.85
    steps = int(max(20, min(3000, budget / max(s_per_step, 1e-3))))
    out.update(seconds_per_step=round(s_per_step, 3), steps=steps, tokens_per_second=round(batch_size * seq_len / max(s_per_step, 1e-6)))

    # 2) the real run
    losses = T.train(model.to(device), make_batches(steps + 40), cfg_for(steps), device=device)
    out["loss_first"], out["loss_last"] = round(float(losses[0]), 3), round(float(losses[-1]), 3)
    try:
        from sham_train_eval import RESULT
        out["guard"] = RESULT.get("guard")
    except Exception:
        pass

    # 3) publish the trained copy for the merge gate
    up = Path(tempfile.mkdtemp())
    save_checkpoint(up / "final.pt", model.to("cpu"), step0 + steps)
    for name in ("sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt"):
        src = next(iter(sorted(Path(base).rglob(name))), None)
        if src:
            import shutil
            shutil.copy2(src, up / name)
    out["published"] = publish(up, DATASET_OUT, f"modal GPU text session: {steps} steps from step {step0:,}")
    out["minutes"] = round((time.time() - t0) / 60, 1)
    return out


# ------------------------------------------------------------------ Modal wiring (only when `modal` is installed: the GitHub job)
try:
    import modal
except ImportError:
    modal = None

if modal is not None:
    _env = {k: os.environ[k] for k in ("KAGGLE_USERNAME", "KAGGLE_API_TOKEN", "HF_TOKEN") if os.environ.get(k)}
    app = modal.App("sham-gpu-text")
    image = (modal.Image.debian_slim(python_version="3.11")
             .pip_install("torch", "numpy", "tokenizers", "kaggle", "requests", "pillow", "soundfile", "imageio-ffmpeg", "beautifulsoup4")
             .add_local_dir(str(SRC), remote_path="/root/sham_small",
                            ignore=["*.db", "__pycache__", "kaggle_notebooks", "colab_notebooks", "*.ipynb"]))

    _secrets = [modal.Secret.from_dict(_env)] if _env else []

    def _session_in_container(minutes: float, device: str) -> dict:
        sys.path.insert(0, "/root/sham_small")
        os.chdir("/root/sham_small")
        import subprocess
        user = os.environ.get("KAGGLE_USERNAME", "")
        print("🔎 مفاتيح داخل الحاوية: اسم المستخدم", "موجود" if user else "غائب", "| الرمز", "موجود" if os.environ.get("KAGGLE_API_TOKEN") else "غائب")
        for cmd in (["kaggle", "--version"], ["kaggle", "datasets", "status", f"{user}/sham-merged-checkpoint"]):
            r = subprocess.run(cmd, capture_output=True, text=True)
            print("🔎", " ".join(cmd[:3]), "→", r.returncode, ((r.stdout or "") + (r.stderr or "")).strip().replace(user, "<owner>")[-240:])
        r = subprocess.run(["kaggle", "datasets", "download", "-d", f"{user}/sham-text-shards", "-p", "/tmp/diag", "--unzip"], capture_output=True, text=True)
        print("🔎 تنزيل تجريبي →", r.returncode, ((r.stdout or "") + (r.stderr or "")).strip().replace(user, "<owner>")[-400:])
        print("🔎 ملفات:", subprocess.run("ls -la /tmp/diag 2>&1 | head -8; df -h /tmp | tail -1", shell=True, capture_output=True, text=True).stdout.strip()[-400:])
        from sham_inputs import fetch_dataset, publish_dataset
        small = device == "cpu"      # CPU: a shorter window and a smaller batch, the shape the CPU sessions of this project already use
        return session(minutes, fetch_dataset, publish_dataset, device=device, seq_len=512 if small else 1024, batch_size=4 if small else 8)

    @app.function(image=image, timeout=3600, secrets=_secrets, cpu=4.0, memory=8192)
    def run_session_cpu(minutes: float = 12.0) -> dict:
        return _session_in_container(minutes, "cpu")

    # Modal validates EVERY function of the app when it starts, and refuses a GPU function on an account without a payment method
    # ("Please add a payment method to use T4 GPU functions") — even when only the CPU one is called. So the GPU one exists only on request.
    if os.environ.get("SHAM_MODAL_GPU") == "1":
        @app.function(gpu="T4", image=image, timeout=3600, secrets=_secrets)
        def run_session_gpu(minutes: float = 12.0) -> dict:
            return _session_in_container(minutes, "cuda")

    @app.local_entrypoint()
    def main(minutes: float = 12.0, device: str = "cpu"):
        import json
        fn = run_session_gpu if device == "gpu" else run_session_cpu
        print(json.dumps(fn.remote(minutes), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    # offline self-test: a tiny model and fake datasets on CPU; the same session() code path as the GPU run
    sys.path.insert(0, str(SRC))
    import torch
    import json
    import shutil
    from checkpoint import save_checkpoint
    import sham_token_shards
    from model import ShamSmall, ShamSmallConfig
    from text_tokenizer import ShamTextTokenizer

    tok = ShamTextTokenizer.load(str(SRC / "sham_general_tokenizer.json"))
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        base, shards = d / "base", d / "shards"
        base.mkdir()
        cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=128)
        save_checkpoint(base / "final_merged.pt", ShamSmall(cfg), 100)
        shutil.copy2(SRC / "sham_general_tokenizer.json", base / "sham_small_tokenizer.json")
        sham_token_shards.build(str(shards), seconds=6, tokenizer=tok, seq_len=64, seed=3, fake=True, windows_per_shard=50)
        published = {}
        res = session(0.5, lambda n: {"sham-merged-checkpoint": base, sham_token_shards.DATASET: shards}.get(n),
                      lambda up, name, msg: published.update(name=name, files=sorted(p.name for p in Path(up).iterdir())) or name,
                      device="cpu", seq_len=64, batch_size=4, work=d / "w")
        assert "error" not in res and res["published"] == DATASET_OUT and "final.pt" in published["files"], (res, published)
        assert res["steps"] >= 20 and res["seconds_per_step"] > 0 and res["start_step"] == 100, res
        miss = session(0.1, lambda n: None, lambda *a: None, device="cpu")
        assert "error" in miss                                                # nothing to start from: says so, no crash
        print(json.dumps({k: res[k] for k in ("steps", "seconds_per_step", "loss_first", "loss_last")}))
    print("sham_gpu_text self-test OK")
