"""Build Sham v2 from a chat-tuned donor (the donor's own tokenizer, Sham's media ranges on top), then look at it: the answers of Sham's own chat path, the speed of
Sham's own class on this CPU, and bits per byte on our text. Read-only: nothing is published.

  python scripts/transplant/build_v2.py Qwen/Qwen3-1.7B
"""
import os
import sys
import time
from pathlib import Path

os.environ["SHAM_TEXT_VOCAB"] = "151936"                 # before anything of Sham is imported
ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.chdir(SHAM)

import torch                                                                    # noqa: E402

import probe as P                                                               # noqa: E402
from checkpoint import load_checkpoint                                          # noqa: E402
from sham_studio_chat import studio_generate                                    # noqa: E402
from sham_transplant import run_native                                          # noqa: E402
from text_tokenizer import ShamTextTokenizer                                    # noqa: E402

PROMPTS = ["مرحبا", "كيف حالك؟", "من أنت؟", "اكتب دالة بايثون تجمع رقمين.", "اشرح لي بجملتين ما هو الذكاء الاصطناعي.", "ما عاصمة سوريا؟"]


def deployable(out: Path, base_dir: Path) -> Path:
    """The folder the Studio loads: final_merged.pt (the name its loader prefers), the tokenizer, Sham's own image / audio tokenizers (the media side stays ours),
    configuration.json (the hub requires it) and the manifest the Studio uses to notice a new version. The checkpoint is stored in bfloat16 (half the size)."""
    import hashlib
    import json
    import shutil
    dst = Path("/tmp/sham_v2_deploy")
    shutil.rmtree(dst, ignore_errors=True)
    dst.mkdir(parents=True)
    payload = torch.load(out / "step_000000.pt", map_location="cpu", weights_only=False)
    payload["model_state_dict"] = {k: (v.to(torch.bfloat16) if v.is_floating_point() else v) for k, v in payload["model_state_dict"].items()}
    torch.save(payload, dst / "final_merged.pt")
    shutil.copy2(out / "sham_small_tokenizer.json", dst / "sham_small_tokenizer.json")
    for name in ("image_tokenizer.pt", "audio_tokenizer.pt"):
        src = next(iter(sorted(base_dir.rglob(name))), None)
        if src is None:
            raise RuntimeError(f"{name} not found in the base lineage: Sham's media tokenizers must travel with the checkpoint")
        shutil.copy2(src, dst / name)
    (dst / "configuration.json").write_text(json.dumps({"framework": "pytorch", "task": "text-generation"}), encoding="utf-8")
    h = hashlib.sha256()
    with open(dst / "final_merged.pt", "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    (dst / "bridge_manifest.json").write_text(json.dumps({"sha": h.hexdigest(), "source": "sham-v2 (donor body in Sham's class)"}), encoding="utf-8")
    return dst


def publish(folder: Path, repo: str) -> None:
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api = HubApi()
    api.login(os.environ["MODELSCOPE_TOKEN"])
    api.push_model(model_id=repo, model_dir=str(folder), visibility=Visibility.PRIVATE, license="apache-2.0", commit_message="sham v2")
    print(f"pushed {repo}", flush=True)


def speed_probe(model, tok, threads: int) -> None:
    """How fast does Sham's own class generate on `threads` cores (bfloat16)? Image generation is 256 tokens, a sound segment 80: the time for those is what matters for media."""
    import subprocess
    from generate import generate_tokens
    flags = subprocess.run("lscpu | grep -o -E 'amx[a-z_0-9]*|avx512_bf16' | sort -u | tr '\\n' ' '", shell=True, capture_output=True, text=True).stdout.strip()
    model.to(torch.bfloat16)
    torch.set_num_threads(threads)
    ids = torch.tensor([tok.encode("<|im_start|>user\nمرحبا<|im_end|>\n<|im_start|>assistant\n")])
    with torch.no_grad():
        generate_tokens(model, ids, max_new_tokens=4, temperature=1.0, top_k=1)          # warm-up
        t0 = time.time()
        generate_tokens(model, ids, max_new_tokens=48, temperature=1.0, top_k=1, allowed_ranges=[(0, tok.vocab_size)] * 48)
        dt = time.time() - t0
    print(f"SPEED bf16, {threads} threads, cpu flags [{flags}]: {48 / dt:.2f} tokens/s -> 256 tokens (one image) ~{256 * dt / 48:.0f} s, 80 tokens (one sound segment) ~{80 * dt / 48:.0f} s", flush=True)


def main() -> None:
    donor = [a for a in sys.argv[1:] if not a.startswith("--")][0]
    do_publish = "--publish" in sys.argv
    if "--speed-only" in sys.argv:
        torch.set_default_dtype(torch.bfloat16)                                    # a 4B donor does not fit in 16 GB as float32
        from huggingface_hub import snapshot_download
        from sham_transplant import LazyDonor, native_model
        model = native_model(LazyDonor(donor), chat_format="qwen3")                # built in memory only (no checkpoint written and read back: a 4B one would not fit twice)
        model.train(False)
        tok = ShamTextTokenizer.load(str(Path(snapshot_download(donor, allow_patterns=["tokenizer.json"])) / "tokenizer.json"))
        print(f"parameters: {sum(p.numel() for p in model.parameters()) / 1e9:.2f} B", flush=True)
        speed_probe(model, tok, 2)
        speed_probe(model, tok, os.cpu_count() or 4)
        return
    torch.set_num_threads(os.cpu_count() or 4)
    out = run_native(donor, "/tmp/sham_v2")
    model, step, _ = load_checkpoint(out / "step_000000.pt", map_location="cpu")
    model.train(False)
    tok = ShamTextTokenizer.load(str(out / "sham_small_tokenizer.json"))
    print(f"\n=== Sham v2 from {donor} (Sham's own class and chat path) ===", flush=True)
    toks = 0
    t0 = time.time()
    for p in PROMPTS:
        a = studio_generate(model, tok, p, max_new_tokens=60, search_fn=None)
        toks += len(tok.encode(a))
        print(f"[{p}] -> {a!r}", flush=True)
    print(f"speed in Sham's class on this CPU: {toks / (time.time() - t0):.2f} generated tokens/s (prompt reading included)", flush=True)
    T = P.texts()
    row = {}
    with torch.no_grad():
        for k, text in T.items():
            fn = lambda w: float(model(torch.tensor([w]), labels=torch.tensor([w]))[1])   # noqa: E731
            row[k] = P.bpb(fn, tok.encode, text)[0]
    print(f"bits/byte on our text: ar {row['arabic']:.3f} en {row['english']:.3f} code {row['code']:.3f}", flush=True)
    if do_publish:
        from sham_ci_merge import pick_base
        from sham_inputs import fetch_dataset
        _c, base_dir, label, _p = pick_base(fetch_dataset, probe=None)
        folder = deployable(out, base_dir)
        print(f"deployable folder: {[(p.name, round(p.stat().st_size / 1e6)) for p in sorted(folder.iterdir())]}", flush=True)
        # the folder must load exactly as the Studio will load it
        import serve
        serve.load_model(checkpoint_path=str(folder / "final_merged.pt"), tokenizer_path=str(folder / "sham_small_tokenizer.json"))
        print(f"loaded like the Studio: {serve._state.get('source')} | tokenizer check: {serve._state.get('tokenizer_check')}", flush=True)
        publish(folder, os.environ.get("SHAM_V2_REPO", "novaai2026/sham-v2"))


main()
