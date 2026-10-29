"""Publish only a genuinely trained Sham v2 checkpoint to its private ModelScope repo.

This is intentionally separate from build_v2.py: a native transplant at step 0 is a donor
initialization, not a trained Sham model. The current production weights/media stay untouched
unless checkpoint, tokenizer, Arabic/code, and tool-call gates all pass.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
# Keep the shared token-ID ranges identical to the donor tokenizer before importing any Sham module.
os.environ.setdefault("SHAM_TEXT_VOCAB", "151936")
sys.path.insert(0, str(SHAM))

DATA_DIR = Path(os.environ.get("SHAM_V2_TRAINED_DIR", "/tmp/sham-v2-trained"))
OUT_DIR = Path(os.environ.get("SHAM_V2_STAGE_DIR", "/tmp/sham-v2-deploy"))
MODEL_ID = os.environ.get("SHAM_V2_REPO", "novaai2026/sham-v2")
MAX_CHECKPOINT_BYTES = int(float(os.environ.get("SHAM_V2_MAX_CHECKPOINT_GIB", "5.5")) * (1024 ** 3))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def one_file(name: str) -> Path:
    matches = sorted(p for p in DATA_DIR.rglob(name) if p.is_file() and p.stat().st_size > 0)
    require(len(matches) == 1, f"Expected exactly one {name} in the trained dataset; found {len(matches)}")
    return matches[0]


def verify_metrics(history: list[dict], step: int) -> dict:
    require(bool(history), "v2_history.json is empty; refusing to deploy an untracked training run")
    latest = history[-1]
    require(int(latest.get("step") or 0) == step,
            f"History/checkpoint step mismatch: history={latest.get('step')} checkpoint={step}")

    before = latest.get("tools_before") or {}
    after = latest.get("tools_after") or {}
    cases = int(after.get("cases") or 0)
    valid = int(after.get("valid") or 0)
    right = int(after.get("right") or 0)
    before_valid = int(before.get("valid") or 0)
    before_right = int(before.get("right") or 0)
    require(cases >= 4, "No held-out tool-call evaluation found; refusing to publish")
    require(valid >= math.ceil(0.70 * cases),
            f"Only {valid}/{cases} tool outputs were well-formed (need >=70%)")
    require(right >= max(1, math.ceil(0.25 * cases)),
            f"Only {right}/{cases} tool choices were correct (need >=25%)")
    require(valid >= before_valid and right >= before_right,
            f"Tool performance regressed: before valid/right={before_valid}/{before_right}, after={valid}/{right}")

    ar = latest.get("arabic_after") or {}
    ar_cases = int(ar.get("arabic_cases") or 0)
    ar_script = int(ar.get("arabic_script") or 0)
    require(ar_cases >= 3, "No held-out Arabic evaluation found; refusing to publish")
    require(ar_script >= math.ceil((2.0 / 3.0) * ar_cases),
            f"Arabic script gate failed: {ar_script}/{ar_cases} responses passed")
    require(bool(ar.get("capital_syria")), "Arabic factual smoke test failed (capital of Syria)")
    require(bool(ar.get("python_code")), "Python code smoke test failed (function/return)")

    losses = latest.get("train_loss_last") or []
    require(len(losses) >= 5, "Training history has fewer than five loss observations")
    try:
        recent = [float(x) for x in losses if math.isfinite(float(x))]
    except (TypeError, ValueError):
        recent = []
    require(len(recent) >= 5, "Training loss observations are missing or non-finite")
    print(
        "QUALITY GATE PASS: "
        f"step={step}; tools right={right}/{cases} (before {before_right}/{cases}); "
        f"valid={valid}/{cases}; Arabic={ar_script}/{ar_cases}; "
        f"capital_syria={bool(ar.get('capital_syria'))}; python_code={bool(ar.get('python_code'))}; "
        f"last_loss={recent[-1]:.4f}",
        flush=True,
    )
    return latest


def main() -> int:
    require(bool(os.environ.get("MODELSCOPE_TOKEN", "").strip()), "MODELSCOPE_TOKEN is missing")
    names = ["final_merged.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt", "v2_history.json"]
    files = {name: one_file(name) for name in names}
    tokenizer_path = files["sham_small_tokenizer.json"]
    history = json.loads(files["v2_history.json"].read_text(encoding="utf-8"))
    require(isinstance(history, list), "v2_history.json must contain a list of training runs")

    import torch
    source = files["final_merged.pt"]
    require(source.stat().st_size > 0, "Training checkpoint is empty")
    payload = torch.load(source, map_location="cpu", weights_only=False, mmap=True)
    require(isinstance(payload, dict) and isinstance(payload.get("model_state_dict"), dict),
            "Checkpoint has no model_state_dict")
    step = int(payload.get("step") or 0)
    require(step > 0, f"Refusing step-zero donor checkpoint ({step}); train Sham v2 first")
    cfg = payload.get("config") or {}
    require(int(cfg.get("adapter_rank") or 0) > 0, "Checkpoint has no trained low-rank adapters")
    state = payload["model_state_dict"]
    adapter_keys = [name for name in state if name.endswith(".adapter_down") or name.endswith(".adapter_up")]
    require(len(adapter_keys) >= 8, f"Expected adapter tensors in checkpoint; found {len(adapter_keys)}")
    extra = payload.get("extra") or {}
    require(extra.get("native_tokenizer") is True, "Checkpoint is missing the native-tokenizer compatibility stamp")

    latest = verify_metrics(history, step)
    # Ask the same token-stamp validator used by the live Studio to accept this exact
    # checkpoint/tokenizer pair before uploading any weights.
    from sham_tok_id import resolve
    resolved, note = resolve(extra, tokenizer_path)
    require(Path(resolved).resolve() == tokenizer_path.resolve() and str(note).startswith("ok"),
            f"Tokenizer compatibility check failed: {note}")

    shutil.rmtree(OUT_DIR, ignore_errors=True)
    OUT_DIR.mkdir(parents=True)
    # Match the Studio's existing bf16 loader and keep the media bundle out of this upload:
    # ModelScope push_model is additive, so media/sdxs and media/piper remain untouched.
    payload["model_state_dict"] = {
        name: (tensor.to(torch.bfloat16) if torch.is_tensor(tensor) and tensor.is_floating_point() else tensor)
        for name, tensor in state.items()
    }
    torch.save(payload, OUT_DIR / "final_merged.pt")
    del state, payload
    if (OUT_DIR / "final_merged.pt").stat().st_size > MAX_CHECKPOINT_BYTES:
        raise RuntimeError(
            f"Converted checkpoint is too large ({(OUT_DIR / 'final_merged.pt').stat().st_size / 1024**3:.2f} GiB); "
            f"limit is {MAX_CHECKPOINT_BYTES / 1024**3:.2f} GiB. Production weights were not changed."
        )

    shutil.copy2(tokenizer_path, OUT_DIR / "sham_small_tokenizer.json")
    shutil.copy2(files["image_tokenizer.pt"], OUT_DIR / "image_tokenizer.pt")
    shutil.copy2(files["audio_tokenizer.pt"], OUT_DIR / "audio_tokenizer.pt")
    shutil.copy2(files["v2_history.json"], OUT_DIR / "v2_history.json")
    (OUT_DIR / "configuration.json").write_text(
        json.dumps({"framework": "pytorch", "task": "text-generation"}, ensure_ascii=False),
        encoding="utf-8",
    )
    digest = hashlib.sha256()
    with (OUT_DIR / "final_merged.pt").open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    (OUT_DIR / "bridge_manifest.json").write_text(
        json.dumps({
            "sha": digest.hexdigest(),
            "source": "trained Sham v2 checkpoint",
            "step": step,
            "donor": latest.get("donor", "unknown"),
            "tools_right": (latest.get("tools_after") or {}).get("right"),
            "tools_cases": (latest.get("tools_after") or {}).get("cases"),
            "arabic_script": (latest.get("arabic_after") or {}).get("arabic_script"),
            "arabic_cases": (latest.get("arabic_after") or {}).get("arabic_cases"),
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    files_summary = [(p.name, round(p.stat().st_size / 1e6, 1)) for p in sorted(OUT_DIR.iterdir())]
    print(f"Verified trained checkpoint step={step}; loading the staged checkpoint through the production loader before publish.", flush=True)

    # Preflight the exact saved artifact with the same loader the ModelScope Studio imports.
    # Any checkpoint/tokenizer/config incompatibility fails before the live private repo is touched.
    import serve
    serve.load_model(
        checkpoint_path=str(OUT_DIR / "final_merged.pt"),
        tokenizer_path=str(OUT_DIR / "sham_small_tokenizer.json"),
    )
    loaded_model = serve._state.get("model")
    loaded_tokenizer = serve._state.get("text_tokenizer")
    require(loaded_model is not None and loaded_tokenizer is not None,
            f"Production loader did not initialise the model/tokenizer: {serve._state.get('tokenizer_check')}")
    require(int(getattr(getattr(loaded_model, "cfg", None), "max_seq_len", 0)) >= 4096,
            "Staged model context is shorter than the required 4096 tokens")
    from sham_studio_chat import qwen3_chat_messages
    preflight_answer = qwen3_chat_messages(
        loaded_model, loaded_tokenizer,
        [{"role": "user", "content": "ما عاصمة سوريا؟ أجب بالعربية بجملة قصيرة."}],
        max_new_tokens=48, temperature=0.0, think_tokens=0,
    )
    require("دمشق" in preflight_answer,
            f"Staged checkpoint failed the live Arabic smoke check; refusing to publish: {preflight_answer[:180]}")
    print(
        f"STAGED RUNTIME PREFLIGHT PASS: {serve._state.get('source')} | "
        f"context={loaded_model.cfg.max_seq_len} | answer={preflight_answer[:180]}",
        flush=True,
    )
    del loaded_model, loaded_tokenizer
    import gc
    gc.collect()

    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api = HubApi()
    api.login(os.environ["MODELSCOPE_TOKEN"])
    api.push_model(
        model_id=MODEL_ID,
        model_dir=str(OUT_DIR),
        visibility=Visibility.PRIVATE,
        license="apache-2.0",
        commit_message=f"trained Sham v2 checkpoint step {step}",
    )
    print(f"Published trained Sham v2 checkpoint step={step} to {MODEL_ID}; media/ was not modified.", flush=True)
    return 0


def _self_test() -> None:
    good = {
        "step": 42,
        "tools_before": {"cases": 5, "valid": 3, "right": 1},
        "tools_after": {"cases": 5, "valid": 4, "right": 2},
        "arabic_after": {"arabic_cases": 3, "arabic_script": 2, "capital_syria": True, "python_code": True},
        "train_loss_last": [3.2, 2.8, 2.3, 2.0, 1.8],
    }
    assert verify_metrics([good], 42) is good
    for mutate in (
        lambda x: x["tools_after"].update(right=0),
        lambda x: x["arabic_after"].update(arabic_script=0),
        lambda x: x["arabic_after"].update(python_code=False),
        lambda x: x.update(step=41),
    ):
        bad = json.loads(json.dumps(good))
        mutate(bad)
        try:
            verify_metrics([bad], 42)
        except RuntimeError:
            pass
        else:
            raise AssertionError("quality gate accepted a deliberately bad checkpoint report")
    print("publish_sham_v2_trained quality-gate self-test OK")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        _self_test()
        raise SystemExit(0)
    raise SystemExit(main())
