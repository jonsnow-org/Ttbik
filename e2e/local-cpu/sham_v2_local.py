"""A local Sham v2 (Qwen3-1.7B body in Sham's own class, built in memory exactly like scripts/transplant/build_v2.py --speed-only) behind the Studio's generate_any API.
CPU only. The text answer path is Sham's real sham_studio_chat.studio_generate."""
import os, sys, json, time
os.environ["SHAM_TEXT_VOCAB"] = "151936"
# STUDIO_ENV=prod  -> the environment the deployed v2 Studio really has today (scripts/transplant/stage_sham_v2_studio.py wrapper: no SHAM_LIMITS)
# STUDIO_ENV=fixed -> the environment the fixed wrapper sets
if os.environ.get("STUDIO_ENV", "prod") == "fixed":
    for k, v in {"SHAM_LIMITS": "open", "SHAM_GENERATE_ANY_MAX_TOKENS": "768"}.items():
        os.environ.setdefault(k, v)
SHAM = "/workspace/work/Ttbik/ai-system/colab/sham_small"
sys.path.insert(0, SHAM); os.chdir(SHAM)
import torch
torch.set_num_threads(8)
from sham_transplant import LazyDonor, native_model
from text_tokenizer import ShamTextTokenizer
from sham_studio_chat import studio_generate
import huggingface_hub
D = "/workspace/work/e2e/qwen3-1.7b"
huggingface_hub.snapshot_download = lambda *a, **k: D      # LazyDonor reads the local copy
torch.set_default_dtype(torch.bfloat16)
t=time.time()
model = native_model(LazyDonor("Qwen/Qwen3-1.7B"), max_seq_len=int(os.environ.get("SHAM_CTX","2048")), chat_format="qwen3"); model.train(False)
tok = ShamTextTokenizer.load(D + "/tokenizer.json")
print("model built", round(time.time()-t,1), "s", flush=True)
import gradio as gr
LOG = open("/workspace/work/e2e/v2_calls.jsonl", "a")
_OPEN = os.environ.get("SHAM_LIMITS", "").strip().lower() == "open"
MAX_NEW = int(os.environ.get("SHAM_MAX_NEW_TOKENS", "768" if _OPEN else "200"))          # modelscope-sham/app.py line 42
CAP = max(32, int(os.environ.get("SHAM_GENERATE_ANY_MAX_TOKENS", "96")))                  # modelscope-sham/app.py generate_any
def generate_any(prompt, max_new_tokens=60):
    t0 = time.time()
    n = int(max(1, min(MAX_NEW, CAP, max_new_tokens)))                                    # the Studio's own bound on every answer
    with torch.no_grad():
        ans = studio_generate(model, tok, prompt, n, search_fn=None)
    LOG.write(json.dumps({"prompt_chars": len(prompt), "prompt": prompt, "max_new": max_new_tokens, "n_used": n, "prompt_tokens_kept": __import__("sham_studio_chat").MAX_PROMPT_TOKENS, "answer": ans, "s": round(time.time()-t0,1)}, ensure_ascii=False) + "\n"); LOG.flush()
    return json.dumps({"type": "text", "text": ans}, ensure_ascii=False)
def status(): return json.dumps({"phase": "ready"})
with gr.Blocks() as demo:
    a = gr.Textbox(); b = gr.Number(value=60); o = gr.Textbox()
    gr.Button("x", visible=False).click(generate_any, [a, b], o, api_name="generate_any")
    gr.Button("s", visible=False).click(status, None, o, api_name="status")
demo.queue(default_concurrency_limit=1).launch(server_name="127.0.0.1", server_port=int(os.environ.get("PORT", "7872")))
