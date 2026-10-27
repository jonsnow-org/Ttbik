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
# The Qwen3 body is NOT the small model the Studio's conservative limits were written for. Without these the Studio keeps only the last 384 prompt tokens, cuts every answer
# at 96 new tokens and breaks every tool call / code file in the middle (reproduced on CPU, see PR). setdefault: a value set in the Studio's settings still wins.
os.environ.setdefault("SHAM_LIMITS", "open")                    # prompt window 1200 tokens, answers up to 768 (modelscope-sham/app.py, sham_studio_chat.py)
os.environ.setdefault("SHAM_GENERATE_ANY_MAX_TOKENS", "768")    # generate_any's own cap (default 96) - the agent loop's calls go through generate_any
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sham_app.py"), run_name="__main__")
''', encoding="utf-8")
print("wrapper written")
