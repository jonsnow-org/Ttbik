"""
Sham — resume inputs without any manual "Add Input" setup on Kaggle.

Why (owner report, 2026-09-24): every track lost progress for the same
reason — the notebook's attached Input was missing, stale (Track A read
the old dataset while publishing to "-v2"), or gone after re-importing
the notebook from GitHub. Each track already publishes its own dataset
at the end of a run, so the fix is to make each run fetch that dataset
itself, via the Kaggle API, whenever it isn't attached:

    fetch_dataset("sham-cpu-track-checkpoint-v2")

  * attached under /kaggle/input  -> used as-is (no download);
  * otherwise                     -> latest version downloaded into
    FETCH_ROOT (outside /kaggle/working, so it never inflates the
    session's own Output);
  * doesn't exist yet (true first run) or no credentials -> None.

Everything that searched only /kaggle/input (tokenizer_select,
sham_data_sources.Ledger, data_acquisition.text_stream_position, the
notebooks' own resume cells) now searches input_roots(), i.e. both.

resume_text_lineage() picks the text checkpoint to continue from — the
highest step in the track's own dataset, else (one-time fork) the
highest step among the given fork datasets — always together with the
tokenizer saved in the SAME dataset, never an unrelated one found
elsewhere (a mismatched tokenizer silently corrupts every weight).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

KAGGLE_INPUT = Path("/kaggle/input")
FETCH_ROOT = Path("/tmp/sham_inputs")

_TEXT_CKPT = re.compile(r"^(?:step_(\d+)|final)\.pt$")


def input_roots() -> list[Path]:
    return [p for p in (KAGGLE_INPUT, FETCH_ROOT) if p.exists()]


def rglob_inputs(pattern: str) -> list[Path]:
    found: list[Path] = []
    for root in input_roots():
        found.extend(root.rglob(pattern))
    return found


def _attached_dir(name: str) -> Path | None:
    if not KAGGLE_INPUT.exists():
        return None
    # /kaggle/input/<name> (classic mount) or nested owner/type folders.
    for pattern in (name, f"*/{name}", f"*/*/{name}", f"*/*/*/{name}"):
        for p in KAGGLE_INPUT.glob(pattern):
            if p.is_dir():
                return p
    return None


def _ensure_credentials() -> str | None:
    if os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"):
        return os.environ["KAGGLE_USERNAME"]
    try:
        from kaggle_secrets import UserSecretsClient

        secrets = UserSecretsClient()
        os.environ["KAGGLE_USERNAME"] = secrets.get_secret("KAGGLE_USERNAME")
        os.environ["KAGGLE_KEY"] = secrets.get_secret("KAGGLE_KEY")
        return os.environ["KAGGLE_USERNAME"]
    except Exception as exc:
        print(f"  ⚠ لا توجد بيانات دخول Kaggle (KAGGLE_USERNAME/KAGGLE_KEY): {exc}")
        return None


def _unzip_nested(root: Path) -> None:
    # "-r zip" uploads subfolders (checkpoints/) as archives; a mounted Input
    # shows them extracted, a CLI download may not — make both look the same.
    for _ in range(3):
        archives = list(root.rglob("*.zip"))
        if not archives:
            return
        for z in archives:
            target = z.parent / z.stem
            with zipfile.ZipFile(z) as zf:
                zf.extractall(target)
            z.unlink()


def fetch_dataset(name: str, owner: str | None = None) -> Path | None:
    """Folder holding the latest version of the account's dataset `name`,
    or None when it doesn't exist yet / can't be reached."""
    attached = _attached_dir(name)
    if attached:
        print(f"  • {name}: مرفقة كمُدخل ({attached})")
        return attached
    dest = FETCH_ROOT / name
    if dest.exists() and any(dest.iterdir()):
        return dest
    user = _ensure_credentials()
    if not user:
        return None
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    dest.mkdir(parents=True, exist_ok=True)
    ref = f"{owner or user}/{name}"
    r = subprocess.run(["kaggle", "datasets", "download", "-d", ref, "-p", str(dest), "--unzip"],
                       capture_output=True, text=True)
    _unzip_nested(dest)
    if r.returncode != 0 or not any(dest.iterdir()):
        shutil.rmtree(dest, ignore_errors=True)
        msg = ((r.stderr or "") + (r.stdout or "")).strip().splitlines()
        print(f"  • {name}: غير متاحة ({msg[-1][:160] if msg else 'لا شيء'}) — طبيعي في أول تشغيل لهذا المسار")
        return None
    size_mb = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / 1e6
    print(f"  • {name}: نُزّلت آخر نسخة تلقائياً ({size_mb:,.0f} MB) إلى {dest}")
    return dest


def _checkpoint_step(path: Path) -> tuple[int, bool]:
    """(step, has_optimizer_state) — read without materializing the weights."""
    import torch

    payload = torch.load(path, map_location="cpu", weights_only=False, mmap=True)
    return int(payload.get("step") or 0), "optimizer_state_dict" in payload


def text_checkpoints(root: Path | None) -> list[tuple[int, bool, Path]]:
    if not root:
        return []
    out = []
    for p in root.rglob("*.pt"):
        if not _TEXT_CKPT.match(p.name):
            continue
        try:
            step, has_opt = _checkpoint_step(p)
        except Exception as exc:
            print(f"  ✖ {p}: تعذّرت قراءته ({exc.__class__.__name__})")
            continue
        out.append((step, has_opt, p))
    return sorted(out, key=lambda t: (t[0], t[1]))


def _tokenizer_in(root: Path, pattern: str) -> Path | None:
    found = sorted(root.rglob(pattern))
    return found[0] if found else None


def resume_text_lineage(own: str, forks: list[str] | tuple[str, ...] = (),
                        tokenizer_pattern: str = "*tokenizer*.json",
                        min_vocab: int = 0) -> dict | None:
    """{"checkpoint", "step", "has_optimizer", "tokenizer", "dataset", "forked"} or None."""
    from text_tokenizer import ShamTextTokenizer

    def best_in(name: str) -> dict | None:
        root = fetch_dataset(name)
        ckpts = text_checkpoints(root)
        if not ckpts:
            return None
        tok = _tokenizer_in(root, tokenizer_pattern)
        if tok is None:
            print(f"  ✖ {name}: فيها نقطة حفظ بلا أداة تقسيم النص الخاصة بها — تُتجاهل")
            return None
        vocab = ShamTextTokenizer.load(tok).vocab_size
        if vocab < min_vocab:
            print(f"  ✖ {name}: أداة تقسيم النص فيها صغيرة (vocab={vocab:,} < {min_vocab:,}) — لا يُستأنف منها")
            return None
        step, has_opt, path = ckpts[-1]
        return {"checkpoint": path, "step": step, "has_optimizer": has_opt, "tokenizer": tok, "dataset": name}

    print(f"البحث عن نقطة الاستئناف ({own}):")
    picked = best_in(own)
    if picked:
        picked["forked"] = False
    else:
        options = [x for x in (best_in(f) for f in forks) if x]
        picked = max(options, key=lambda x: x["step"]) if options else None
        if picked:
            picked["forked"] = True
    if picked:
        how = "تفرّع لمرة واحدة من" if picked["forked"] else "استئناف من"
        print(f"✅ {how} {picked['dataset']}: {picked['checkpoint'].name} (الخطوة {picked['step']:,}) "
              f"+ {picked['tokenizer'].name}")
    else:
        print("لا توجد نقطة حفظ سابقة — يبدأ من الصفر (متوقَّع فقط في أول تشغيل حقيقي).")
    return picked


def publish_dataset(upload_dir: str | Path, name: str, message: str) -> str | None:
    """Create-or-version the account's dataset `name` from upload_dir
    (subfolders zipped, same "-r zip" rule as every track). Returns the
    slug on success, None on failure (the files stay in this session's
    Output either way)."""
    import json

    user = _ensure_credentials()
    if not user:
        return None
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    slug = f"{user}/{name}"
    upload_dir = Path(upload_dir)
    (upload_dir / "dataset-metadata.json").write_text(
        json.dumps({"title": name, "id": slug, "licenses": [{"name": "unknown"}]}))
    listed = subprocess.run(["kaggle", "datasets", "list", "-m", "--csv"], capture_output=True, text=True)
    exists = slug in (listed.stdout or "")
    cmd = (["kaggle", "datasets", "version", "-p", str(upload_dir), "-m", message, "-r", "zip"] if exists
           else ["kaggle", "datasets", "create", "-p", str(upload_dir), "-r", "zip"])
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode == 0 and "error" not in out.lower():
        print(f"{'نُشرت نسخة جديدة إلى' if exists else 'أُنشئت'} {slug} — التشغيل القادم يلتقطها تلقائياً.")
        return slug
    print(f"تنبيه: فشل النشر إلى {slug} — الملفات آمنة في Output هذه الجلسة.\n{out}")
    return None


if __name__ == "__main__":
    import tempfile

    import torch

    from checkpoint import save_checkpoint
    from model import ShamSmall, ShamSmallConfig
    from text_tokenizer import train_text_tokenizer

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        KAGGLE_INPUT = td / "input"
        FETCH_ROOT = td / "fetched"
        os.environ.pop("KAGGLE_USERNAME", None)
        os.environ.pop("KAGGLE_KEY", None)

        cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
        seed = td / "seed.txt"
        seed.write_text("شام نموذج عربي يتعلم من النصوص الحقيقية. " * 50, encoding="utf-8")
        tok = train_text_tokenizer([str(seed)], vocab_size=300)

        def make(ds: str, steps: list[int], with_final: int | None = None, tok_name="t_tokenizer.json"):
            d = KAGGLE_INPUT / ds / "checkpoints"
            d.mkdir(parents=True)
            m = ShamSmall(cfg)
            opt = torch.optim.AdamW(m.parameters())
            for s in steps:
                save_checkpoint(d / f"step_{s}.pt", m, s, optimizer=opt)
            if with_final is not None:
                save_checkpoint(d / "final.pt", m, with_final)
            tok.save(KAGGLE_INPUT / ds / tok_name)

        make("old-track", [900])            # stale dataset, higher step, NOT ours
        make("fork-src", [300], with_final=350)
        # own dataset missing -> fork: highest step among forks, its own tokenizer
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert got["forked"] and got["step"] == 350 and got["checkpoint"].name == "final.pt", got
        assert got["tokenizer"].parent.name == "fork-src"
        # own dataset present -> own wins even though a stale one has more steps
        make("own-v2", [120, 200])
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert not got["forked"] and got["step"] == 200 and got["has_optimizer"], got
        # tokenizer too small -> refused, falls back to the fork
        got = resume_text_lineage("own-v2", forks=["fork-src"], min_vocab=10_000)
        assert got is None or got["dataset"] != "own-v2"
        # nested zip extraction (CLI download shape)
        z = FETCH_ROOT / "zipped"
        (z / "src").mkdir(parents=True)
        (z / "src" / "a.txt").write_text("x")
        shutil.make_archive(str(z / "checkpoints"), "zip", z / "src")
        shutil.rmtree(z / "src")
        _unzip_nested(z)
        assert (z / "checkpoints" / "a.txt").exists() and not list(z.rglob("*.zip"))
        assert fetch_dataset("missing-without-credentials") is None
        assert {p.name for p in rglob_inputs("*.txt")} == {"a.txt"}
    print("sham_inputs self-test: OK")
