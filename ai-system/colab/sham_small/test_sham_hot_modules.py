"""The hot copy wins over a stale deployed copy already imported by the app (live 2026-11-11: MOTION_VOCAB_BASE ImportError)."""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def test_hot_media_imports_its_own_model_over_a_stale_deployed_one(tmp_path):
    stale = tmp_path / "deployed" / "sham_small"
    stale.mkdir(parents=True)
    (stale / "model.py").write_text("STALE = True\n", encoding="utf-8")
    hot = tmp_path / "_hot" / "sham_small"
    shutil.copytree(HERE, hot, ignore=shutil.ignore_patterns("__pycache__", "*.pt", "*.bin", "*.gguf", "data", "out*"))
    code = (f"import sys; sys.path.insert(0, {str(stale)!r}); import model; assert model.STALE; "
            f"sys.path.insert(0, {str(hot)!r}); import sham_studio_media, sham_studio_chat, model as m2; "
            "from model import MOTION_VOCAB_BASE; assert not hasattr(sys.modules['model'], 'STALE'); print('ok')")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=240)
    assert r.returncode == 0 and "ok" in r.stdout, r.stderr[-800:]
