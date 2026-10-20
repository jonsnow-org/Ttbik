"""
Combined variant (DESIGN ONLY — not deployed anywhere): one Studio serving both Sham and the open coder, for the case where the account may
run only one Studio. It is NOT pushed over Sham's Studio; the owner decides first.

How it would be laid out in that single Studio's git repo (Sham's files untouched, byte for byte):
    app.py, sham_small/…            Sham's app exactly as it is today
    coder_app.py                    = ai-system/modelscope-coder/app.py
    combined_app.py                 = this file; the Studio entry file would point here instead of app.py
    llama-b11757-bin-ubuntu-x64.tar.gz

Shared queue / CPU split on the 2 vCPU box:
  * the coder's api names get the prefix "coder_" (coder_chat, coder_job_result, coder_cancel, coder_status) so Sham's own api names
    (generate_text, think, status, …) keep working unchanged for the bot; the bot reads OPEN_CODER_API_PREFIX=coder_.
  * the coder runs ONE generation at a time (its own FIFO queue) on CODER_THREADS=1, so Sham always keeps a core.
  * memory: Sham (~165M params) + coder Q4_K_M (~2.7 GB weights + KV at -c 32768) fits in 16 GB.
"""
import importlib.util
import os
import threading
from pathlib import Path

os.environ.setdefault("CODER_API_PREFIX", "coder_")
os.environ.setdefault("CODER_THREADS", "1")
HERE = Path(__file__).resolve().parent


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


if __name__ == "__main__":
    import gradio as gr
    coder = _load("coder_app", "coder_app.py")
    sham = _load("sham_app", "app.py")
    threading.Thread(target=sham._worker, daemon=True).start()
    coder.start_background()
    gr.TabbedInterface([sham.build_ui(), coder.build_ui()], ["Sham", "coder"]).queue(default_concurrency_limit=8).launch(
        server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
