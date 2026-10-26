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
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sham_app.py"), run_name="__main__")
''', encoding="utf-8")
print("wrapper written")
