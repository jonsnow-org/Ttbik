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


def main() -> None:
    donor = sys.argv[1]
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


main()
