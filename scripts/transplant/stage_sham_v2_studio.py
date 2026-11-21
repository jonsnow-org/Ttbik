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
# T-LDM is off until the trained Sham 2 head exists and the owner turns it on (never a silent fallback to Sham 1).
os.environ.setdefault("SHAM_TLDM", "0")
os.environ.setdefault("SHAM_TLDM_REPO", "novaai2026/sham2-tldm-head")
# Training-admission only (experience.deny_reason). Does not restrict work-time commands.
_HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("SHAM_TLDM_DENYLIST", os.path.join(_HERE, "tldm", "evolution", "owner_denylist.txt"))
os.environ.setdefault("SHAM_TLDM_EVOLUTION_ROOT", os.path.join("/mnt/workspace/sham2_tldm_evolution") if os.path.isdir("/mnt/workspace") else os.path.join(_HERE, "tldm_evolution"))
# Terminal mesh presence (sham_mesh_node.start_presence): Sham 2 joins https://sham-mesh.jonsnowx1r.workers.dev as a node as soon as the
# Studio runs (heartbeat, lesson index, idle pure jobs) in a daemon thread; proposals stay opt-in (SHAM_MESH_SERVE_PEERS=1). SHAM_MESH=0 = off.
try:
    import sys as _sys
    _sys.path.insert(0, _HERE)
    import sham_mesh_node as _mesh
    _mesh.start_presence()
except Exception as _exc:
    print(f"mesh presence not started ({type(_exc).__name__})", flush=True)
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



def stage_tldm_serving(studio: pathlib.Path) -> None:
    """Copy the T-LDM serving hook and the packages it imports. Training code is not copied. SHAM_TLDM stays off.

    serve_adapter imports data/trajectories -> terminal_tasks (reads tools/organize.py, imports terminal/sandbox_terminal) and augment:
    all staged (live 2026-11-18: generate_tldm failed with ModuleNotFoundError terminal_tasks). test_stage_sham_v2_studio imports the staged tree."""
    root = ROOT / "ai-system"
    src = root / "modelscope-sham" / "sham_tldm_serve.py"
    if src.is_file():
        shutil.copy2(src, studio / "sham_tldm_serve.py")
    exp = root / "modelscope-sham" / "sham_tldm_experience.py"
    if exp.is_file():
        shutil.copy2(exp, studio / "sham_tldm_experience.py")
    tldm_src = root / "tldm"
    dest = studio / "tldm"
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("serve_adapter.py",):
        f = tldm_src / name
        if f.is_file():
            shutil.copy2(f, dest / name)
    for folder, files in (("sham_tldm", None), ("memory", ("store.py",)), ("data", ("trajectories.py", "augment.py", "terminal_tasks.py")), ("tools", ("organize.py",))):
        src_dir = tldm_src / folder
        out = dest / folder
        if not src_dir.exists():
            continue
        if files is None:
            if out.exists():
                shutil.rmtree(out)
            shutil.copytree(src_dir, out, ignore=shutil.ignore_patterns("test_*", "__pycache__", "*.pyc"))
        else:
            out.mkdir(parents=True, exist_ok=True)
            for name in files:
                f = src_dir / name
                if f.is_file():
                    shutil.copy2(f, out / name)
    evo_src = tldm_src / "evolution"
    evo_out = dest / "evolution"
    if evo_src.is_dir():
        evo_out.mkdir(parents=True, exist_ok=True)
        # Serving ingest only (record/hints). Training engine, adapters and curriculum stay out.
        for name in ("__init__.py", "api.py", "experience.py", "lessons.py", "owner_denylist.txt"):
            f = evo_src / name
            if f.is_file():
                shutil.copy2(f, evo_out / name)
    distill = studio / "distill"                       # terminal/sandbox_terminal imports ../distill/exec_verify (the python3 rules)
    distill.mkdir(parents=True, exist_ok=True)
    if (root / "distill" / "exec_verify.py").is_file():
        shutil.copy2(root / "distill" / "exec_verify.py", distill / "exec_verify.py")
    term = studio / "terminal"
    term.mkdir(parents=True, exist_ok=True)
    for name in ("approvals.py", "sham_binding.py", "backends.py", "sandbox_terminal.py"):
        f = root / "terminal" / name
        if f.is_file():
            shutil.copy2(f, term / name)


def stage_mesh(studio: pathlib.Path) -> None:
    """The terminal mesh node of Sham 2 (sham_mesh_node.py + ai-system/terminal/mesh*.py). Joins at start-up (the wrapper calls start_presence); the chat hooks stay on the owner-gated T-LDM path; SHAM_MESH=0 turns it off."""
    root = ROOT / "ai-system"
    src = root / "modelscope-sham" / "sham_mesh_node.py"
    if src.is_file():
        shutil.copy2(src, studio / "sham_mesh_node.py")
    distill = studio / "distill"                       # terminal/sandbox_terminal imports ../distill/exec_verify (the python3 rules)
    distill.mkdir(parents=True, exist_ok=True)
    if (root / "distill" / "exec_verify.py").is_file():
        shutil.copy2(root / "distill" / "exec_verify.py", distill / "exec_verify.py")
    term = studio / "terminal"
    term.mkdir(parents=True, exist_ok=True)
    for name in ("mesh.py", "mesh_net.py", "mesh_crypto.py"):
        f = root / "terminal" / name
        if f.is_file():
            shutil.copy2(f, term / name)


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
    stage_tldm_serving(studio)
    stage_mesh(studio)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: stage_sham_v2_studio.py <studio_work_dir>")
    print(stage_sham_v2(pathlib.Path(sys.argv[1])))
    print("Sham v2 wrapper and token-aware ModelScope downloader staged")
