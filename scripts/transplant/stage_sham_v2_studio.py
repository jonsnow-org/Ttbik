"""Fill a cloned Studio repo with the Sham app for the v2 Studio: the existing Sham Studio app (as sham_app.py) behind a wrapper that sets the text vocabulary
and the model repo before anything of Sham is imported.   python scripts/transplant/stage_sham_v2_studio.py <studio_clone_dir>"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai-system" / "modelscope-sham"))
import sync_to_modelscope as s                                                   # noqa: E402

studio = pathlib.Path(sys.argv[1])
print(s.stage_studio(studio))
shutil.move(str(studio / "app.py"), str(studio / "sham_app.py"))
(studio / "app.py").write_text('''import os
import runpy

os.environ["SHAM_TEXT_VOCAB"] = "151936"          # the donor's own text vocabulary (Qwen3); Sham's image / audio / special ranges sit above it
os.environ["SHAM_MS_MODEL"] = "novaai2026/sham-v2"
# Sham v2's donor supports a longer RoPE context. This extends the usable context window without changing learned weights.
# setdefault preserves any explicit Studio operator setting.
os.environ.setdefault("SHAM_LIMITS", "open")
os.environ.setdefault("SHAM_MAX_SEQ_LEN", "4096")
os.environ.setdefault("SHAM_MAX_PROMPT_TOKENS", "3072")
os.environ.setdefault("SHAM_MAX_NEW_TOKENS", "1024")
os.environ.setdefault("SHAM_GENERATE_ANY_MAX_TOKENS", "768")
os.environ.setdefault("SHAM_GENERATE_CHAT_MAX_TOKENS", "1024")    # cap for the native role-message chat endpoint
# Sham v2 only: constrain the beginning of a tool call to a real name loaded in the prompt. The model still chooses the tool and arguments;
# src/lib/shamTools.ts validates the JSON/schema, and the executor keeps its normal permission/confirmation checks.
# This improves the existing text-call protocol without changing Sham v1 or pretending the underlying protocol is native API tool-calling.
# Enable the structured assistant/tool_calls response endpoint only in this dedicated Sham v2 Studio.
os.environ.setdefault("SHAM_NATIVE_TOOL_CALLS", "1")
os.environ.setdefault("SHAM_TOOLCALL_GUARD", "1")    # v2 constrained tool-call decoding
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sham_app.py"), run_name="__main__")
''', encoding="utf-8")
print("wrapper written")
