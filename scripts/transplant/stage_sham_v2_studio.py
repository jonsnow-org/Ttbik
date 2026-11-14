"""Stage Sham v2 as an isolated ModelScope Studio application.

The shared Sham loader is copied first; the current Hub downloader is applied
only to the staged v2 copy, never to the source used by Sham v1.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai-system" / "modelscope-sham"))
import sync_to_modelscope as s  # noqa: E402

SHAM_V2_WRAPPER = '''import os
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
'''


def patch_staged_sham_v2_download(studio: pathlib.Path) -> None:
    """Use a token-aware ModelScope Hub downloader in the staged v2 copy only."""
    app_path = studio / "sham_app.py"
    source = app_path.read_text(encoding="utf-8")
    replacements = (
        (
            "    from modelscope import snapshot_download\n    from modelscope.hub.api import HubApi",
            "    from modelscope_hub.compat import snapshot_download\n    from modelscope_hub import HubApi",
            "ModelScope downloader imports",
        ),
        (
            "                HubApi().login(tok)",
            "                HubApi(token=tok).whoami()",
            "ModelScope token validation",
        ),
        (
            "snapshot_download(MODEL_ID, cache_dir=str(cache))",
            "snapshot_download(MODEL_ID, cache_dir=str(cache), token=tok or None)",
            "explicit token passed to the private v2 model download",
        ),
    )
    for old, new, label in replacements:
        if source.count(old) != 1:
            raise RuntimeError(f"Cannot safely stage Sham v2: expected exactly one {label} target.")
        source = source.replace(old, new, 1)
    app_path.write_text(source, encoding="utf-8")

    requirements_path = studio / "requirements.txt"
    requirements = requirements_path.read_text(encoding="utf-8")
    pin = "modelscope-hub==0.6.1"
    if pin not in requirements.splitlines():
        requirements_path.write_text(requirements.rstrip() + "\n" + pin + "\n", encoding="utf-8")


def write_sham_v2_wrapper(studio: pathlib.Path) -> None:
    (studio / "app.py").write_text(SHAM_V2_WRAPPER, encoding="utf-8")
    # status() reports this as "build": the deploy compares it with the commit it pushed (ModelScope's runner can ship a cached old build)
    (studio / "BUILD_STAMP").write_text(os.environ.get("GITHUB_SHA", "")[:12] + "\n", encoding="utf-8")


def stage_sham_v2(studio: pathlib.Path) -> str:
    """Stage and patch only the target Sham v2 Studio clone."""
    result = s.stage_studio(studio)
    shutil.move(str(studio / "app.py"), str(studio / "sham_app.py"))
    patch_staged_sham_v2_download(studio)
    write_sham_v2_wrapper(studio)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: stage_sham_v2_studio.py <studio_work_dir>")
    print(stage_sham_v2(pathlib.Path(sys.argv[1])))
    print("Sham v2 wrapper and token-aware ModelScope downloader staged")
